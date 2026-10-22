param([string]$BillingAccount = "000000-000000-000000")
$ErrorActionPreference = "Stop"
$qaProject = "house-planner-qa-example"
$qaRegion = "us-central1"
$qaBucket = "$qaProject-files"
if ($BillingAccount -ne "000000-000000-000000") { throw "Unexpected QA billing account" }
function Invoke-QaGcloud([string[]]$Arguments) {
  $result = & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw "QA gcloud command failed: $($Arguments[0]) $($Arguments[1])" }
  return $result
}
function Invoke-QaApi([string]$Method, [string]$Uri, $Body = $null) {
  $token = Invoke-QaGcloud @("auth", "print-access-token", "--project=$qaProject")
  $headers = @{ Authorization = "Bearer $token"; "x-goog-user-project" = $qaProject }
  $args = @{ Method = $Method; Uri = $Uri; Headers = $headers }
  if ($null -ne $Body) { $args.ContentType = "application/json"; $args.Body = $Body | ConvertTo-Json -Depth 20 -Compress }
  # Read retries are safe; never replay an ambiguous creation request.
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try { return Invoke-RestMethod @args } catch {
      $status = [int]$_.Exception.Response.StatusCode
      if ($Method -ne "GET" -or $status -notin @(404, 429, 500, 502, 503, 504) -or $attempt -eq 2) { Write-Warning "QA API $Method $Uri failed ($status)"; throw }
      Start-Sleep -Seconds (2 * ($attempt + 1))
    }
  }
}
$projects = Invoke-QaGcloud @("projects", "list", "--filter=projectId=$qaProject", "--format=json") | ConvertFrom-Json
if (!$projects) {
  Invoke-QaGcloud @("projects", "create", $qaProject, "--name=House Planner QA", "--labels=environment=qa,application=house-planner") | Out-Null
  Invoke-QaGcloud @("billing", "projects", "link", $qaProject, "--billing-account=$BillingAccount") | Out-Null
}
$project = Invoke-QaGcloud @("projects", "describe", $qaProject, "--format=json") | ConvertFrom-Json
if ($project.labels.environment -ne "qa") { throw "QA project label mismatch" }
$billing = Invoke-QaGcloud @("billing", "projects", "describe", $qaProject, "--format=json") | ConvertFrom-Json
if (!$billing.billingEnabled -or $billing.billingAccountName -ne "billingAccounts/$BillingAccount") { throw "QA billing is disabled or mismatched. Do not bypass a monthly cutoff." }
Invoke-QaGcloud @("services", "enable", "run.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com", "firebase.googleapis.com", "identitytoolkit.googleapis.com", "firestore.googleapis.com", "storage.googleapis.com", "secretmanager.googleapis.com", "iamcredentials.googleapis.com", "cloudbilling.googleapis.com", "billingbudgets.googleapis.com", "pubsub.googleapis.com", "aiplatform.googleapis.com", "--project=$qaProject") | Out-Null

foreach ($name in @("qa-runtime", "qa-build", "qa-runner", "qa-budget-push")) {
  $accounts = Invoke-QaGcloud @("iam", "service-accounts", "list", "--project=$qaProject", "--filter=email:$name@$qaProject.iam.gserviceaccount.com", "--format=value(email)")
  if (!$accounts) { Invoke-QaGcloud @("iam", "service-accounts", "create", $name, "--project=$qaProject", "--display-name=House Planner $name") | Out-Null }
}
$runtime = "qa-runtime@$qaProject.iam.gserviceaccount.com"
foreach ($role in @("roles/datastore.user", "roles/firebaseauth.admin", "roles/billing.projectManager", "roles/aiplatform.user")) {
  Invoke-QaGcloud @("projects", "add-iam-policy-binding", $qaProject, "--member=serviceAccount:$runtime", "--role=$role", "--condition=None", "--format=none") | Out-Null
}
Invoke-QaGcloud @("iam", "service-accounts", "add-iam-policy-binding", $runtime, "--project=$qaProject", "--member=serviceAccount:$runtime", "--role=roles/iam.serviceAccountTokenCreator", "--format=none") | Out-Null
$operator = Invoke-QaGcloud @("config", "get-value", "account")
Invoke-QaGcloud @("iam", "service-accounts", "add-iam-policy-binding", $runtime, "--project=$qaProject", "--member=user:$operator", "--role=roles/iam.serviceAccountTokenCreator", "--format=none") | Out-Null
foreach ($role in @("roles/cloudbuild.builds.builder", "roles/run.admin", "roles/iam.serviceAccountUser")) {
  Invoke-QaGcloud @("projects", "add-iam-policy-binding", $qaProject, "--member=serviceAccount:qa-build@$qaProject.iam.gserviceaccount.com", "--role=$role", "--condition=None", "--format=none") | Out-Null
}

$buckets = (Invoke-QaGcloud @("storage", "buckets", "list", "--project=$qaProject", "--format=json") | ConvertFrom-Json) | Where-Object { $_.name -eq $qaBucket }
if (!$buckets) { Invoke-QaGcloud @("storage", "buckets", "create", "gs://$qaBucket", "--project=$qaProject", "--location=$qaRegion", "--uniform-bucket-level-access", "--public-access-prevention") | Out-Null }
foreach ($account in @($runtime, "qa-runner@$qaProject.iam.gserviceaccount.com")) {
  Invoke-QaGcloud @("storage", "buckets", "add-iam-policy-binding", "gs://$qaBucket", "--member=serviceAccount:$account", "--role=roles/storage.objectAdmin", "--format=none") | Out-Null
}
# Disposable test objects expire; monthly reservation ledger is excluded by prefix.
Invoke-QaApi "PATCH" "https://storage.googleapis.com/storage/v1/b/$qaBucket" @{ versioning = @{ enabled = $false }; softDeletePolicy = @{ retentionDurationSeconds = "0" }; lifecycle = @{ rule = @(@{ action = @{ type = "Delete" }; condition = @{ age = 3; matchesPrefix = @("house-planner/") } }) } } | Out-Null

$topics = Invoke-QaGcloud @("pubsub", "topics", "list", "--project=$qaProject", "--filter=name:qa-budget", "--format=value(name)")
if (!$topics) { Invoke-QaGcloud @("pubsub", "topics", "create", "qa-budget", "--project=$qaProject") | Out-Null }
# The Budgets API grants its publisher access when attaching this topic; the
# caller already has pubsub.topics.setIamPolicy on this isolated project.
$pubsubAgent = "service-$($project.projectNumber)@gcp-sa-pubsub.iam.gserviceaccount.com"
Invoke-QaApi "POST" "https://serviceusage.googleapis.com/v1beta1/projects/$($project.projectNumber)/services/pubsub.googleapis.com:generateServiceIdentity" @{} | Out-Null
Invoke-QaGcloud @("iam", "service-accounts", "add-iam-policy-binding", "qa-budget-push@$qaProject.iam.gserviceaccount.com", "--project=$qaProject", "--member=serviceAccount:$pubsubAgent", "--role=roles/iam.serviceAccountTokenCreator", "--format=none") | Out-Null

$existingBudgets = (Invoke-QaApi "GET" "https://billingbudgets.googleapis.com/v1/billingAccounts/$BillingAccount/budgets?pageSize=1000").budgets
foreach ($spec in @(@{ Name = "House Planner QA total USD6.00"; Units = "6" }, @{ Name = "House Planner QA Cloud Run cap USD3"; Units = "3"; Service = "152E-C115-5142" }, @{ Name = "House Planner QA Vertex cap USD0.50"; Units = "0"; Nanos = 500000000; Service = "C7E2-9256-1C43" })) {
  $existing = $existingBudgets | Where-Object { $_.displayName -eq $spec.Name -or (!$spec.Service -and $_.displayName -in @("House Planner QA total USD5.50", "House Planner QA total USD5")) }
  if (@($existing).Count -gt 1) { throw "Multiple existing QA budgets match the approved budget; resolve duplicates before setup" }
  if ($existing) {
    if ($existing.budgetFilter.projects.Count -ne 1 -or $existing.budgetFilter.projects[0] -notin @("projects/$qaProject", "projects/$($project.projectNumber)")) { throw "Existing QA budget has unsafe scope" }
    if (!$spec.Service -and $existing.displayName -in @("House Planner QA total USD5.50", "House Planner QA total USD5")) { throw "migrate existing approved total budget in-place after new QA handler deployment" }
    $expectedNanos = $(if ($spec.Nanos) { $spec.Nanos } else { 0 })
    if ($existing.amount.specifiedAmount.currencyCode -ne "USD" -or [int64]$existing.amount.specifiedAmount.units -ne [int64]$spec.Units -or [int64]$existing.amount.specifiedAmount.nanos -ne [int64]$expectedNanos -or $existing.budgetFilter.calendarPeriod -ne "MONTH" -or $existing.budgetFilter.creditTypesTreatment -ne "EXCLUDE_ALL_CREDITS") { throw "Existing QA budget amount or period has drifted" }
    if ($spec.Service) {
      if ($existing.budgetFilter.services.Count -ne 1 -or $existing.budgetFilter.services[0] -ne "services/$($spec.Service)" -or $existing.spendCap.outputState -ne "CONFIGURED") { throw "QA service spend cap is mismatched, inactive or enforced" }
    } elseif ($existing.budgetFilter.services.Count -gt 0 -or $existing.notificationsRule.pubsubTopic -ne "projects/$qaProject/topics/qa-budget") { throw "QA total budget notification scope has drifted" }
    continue
  }
  $body = @{ displayName = $spec.Name; budgetFilter = @{ projects = @("projects/$($project.projectNumber)"); calendarPeriod = "MONTH"; creditTypesTreatment = "EXCLUDE_ALL_CREDITS" }; amount = @{ specifiedAmount = @{ currencyCode = "USD"; units = $spec.Units; nanos = $(if ($spec.Nanos) { $spec.Nanos } else { 0 }) } }; thresholdRules = @(@{ thresholdPercent = 0.5; spendBasis = "CURRENT_SPEND" }, @{ thresholdPercent = 0.8; spendBasis = "CURRENT_SPEND" }, @{ thresholdPercent = 1.0; spendBasis = "CURRENT_SPEND" }); notificationsRule = @{ enableProjectLevelRecipients = $true } }
  if ($spec.Service) { $body.budgetFilter.services = @("services/$($spec.Service)"); $body.spendCap = @{ inputState = "CONFIGURED" } }
  else { $body.notificationsRule.pubsubTopic = "projects/$qaProject/topics/qa-budget"; $body.notificationsRule.schemaVersion = "1.0" }
  Invoke-QaApi "POST" "https://billingbudgets.googleapis.com/v1/billingAccounts/$BillingAccount/budgets" $body | Out-Null
}

$firebase = $null
try { $firebase = Invoke-QaApi "GET" "https://firebase.googleapis.com/v1beta1/projects/$qaProject" } catch { if ([int]$_.Exception.Response.StatusCode -ne 404) { throw } }
if (!$firebase) {
  $operation = Invoke-QaApi "POST" "https://firebase.googleapis.com/v1beta1/projects/${qaProject}:addFirebase" @{}
  for ($i = 0; $i -lt 30 -and !$operation.done; $i++) { Start-Sleep -Seconds 2; $operation = Invoke-QaApi "GET" "https://firebase.googleapis.com/v1beta1/$($operation.name)" }
  if (!$operation.done -or $operation.error) { throw "Firebase project initialization failed" }
}
$apps = (Invoke-QaApi "GET" "https://firebase.googleapis.com/v1beta1/projects/$qaProject/webApps").apps
$web = $apps | Where-Object { $_.displayName -eq "House Planner isolated QA" } | Select-Object -First 1
if (!$web) {
  $operation = Invoke-QaApi "POST" "https://firebase.googleapis.com/v1beta1/projects/$qaProject/webApps" @{ displayName = "House Planner isolated QA" }
  for ($i = 0; $i -lt 30 -and !$operation.done; $i++) { Start-Sleep -Seconds 2; $operation = Invoke-QaApi "GET" "https://firebase.googleapis.com/v1beta1/$($operation.name)" }
  if (!$operation.done -or $operation.error) { throw "Firebase web app initialization failed" }
  $web = $operation.response
}
$config = Invoke-QaApi "GET" "https://firebase.googleapis.com/v1beta1/projects/$qaProject/webApps/$($web.appId)/config"
$authConfig = $null
try { $authConfig = Invoke-QaApi "GET" "https://identitytoolkit.googleapis.com/admin/v2/projects/$qaProject/config" } catch { if ([int]$_.Exception.Response.StatusCode -ne 404) { throw } }
if (!$authConfig) { Invoke-QaApi "POST" "https://identitytoolkit.googleapis.com/v2/projects/$qaProject/identityPlatform:initializeAuth" @{} | Out-Null }
Invoke-QaApi "PATCH" "https://identitytoolkit.googleapis.com/admin/v2/projects/$qaProject/config?updateMask=signIn.email,authorizedDomains" @{ signIn = @{ email = @{ enabled = $true; passwordRequired = $true } }; authorizedDomains = @("localhost", "127.0.0.1", "$qaProject.firebaseapp.com") } | Out-Null
$databases = Invoke-QaGcloud @("firestore", "databases", "list", "--project=$qaProject", "--format=value(name)")
if (!$databases) { Invoke-QaGcloud @("firestore", "databases", "create", "--project=$qaProject", "--database=(default)", "--location=$qaRegion", "--type=firestore-native") | Out-Null }
$config | Add-Member -NotePropertyName storageBucket -NotePropertyValue $qaBucket -Force
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "../qa-cloud-config.json"), ($config | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

# Only the trusted main workflow using this GitHub environment can impersonate
# the QA runner. No service account keys or production IAM grants are created.
# This repository uses GitHub's immutable subject format, including both IDs.
$expectedCondition = "assertion.repository_id == '0' && assertion.repository_owner_id == '0' && assertion.ref == 'refs/heads/main' && assertion.sub == 'repo:carlosan1708@0/house-planner-portfolio@0:environment:serverless-qa'"
$pools = Invoke-QaGcloud @("iam", "workload-identity-pools", "list", "--project=$qaProject", "--location=global", "--format=value(name)")
if (!($pools | Where-Object { $_ -like "*/qa-github" })) { Invoke-QaGcloud @("iam", "workload-identity-pools", "create", "qa-github", "--project=$qaProject", "--location=global", "--display-name=House Planner QA GitHub") | Out-Null }
$providers = (Invoke-QaApi "GET" "https://iam.googleapis.com/v1/projects/$($project.projectNumber)/locations/global/workloadIdentityPools/qa-github/providers").workloadIdentityPoolProviders.name
if (!($providers | Where-Object { $_ -like "*/github" })) {
  Invoke-QaGcloud @("iam", "workload-identity-pools", "providers", "create-oidc", "github", "--project=$qaProject", "--location=global", "--workload-identity-pool=qa-github", "--issuer-uri=https://token.actions.githubusercontent.com", "--attribute-mapping=google.subject=assertion.sub,attribute.repository_id=assertion.repository_id", "--attribute-condition=$expectedCondition") | Out-Null
}
$provider = Invoke-QaGcloud @("iam", "workload-identity-pools", "providers", "describe", "github", "--project=$qaProject", "--location=global", "--workload-identity-pool=qa-github", "--format=json") | ConvertFrom-Json
if ($provider.attributeCondition -ne $expectedCondition -or $provider.oidc.issuerUri -ne "https://token.actions.githubusercontent.com" -or $provider.attributeMapping.'attribute.repository_id' -ne "assertion.repository_id" -or $provider.attributeMapping.'google.subject' -ne "assertion.sub" -or $provider.disabled) { throw "QA GitHub federation policy has drifted" }
Invoke-QaGcloud @("iam", "service-accounts", "add-iam-policy-binding", "qa-runner@$qaProject.iam.gserviceaccount.com", "--project=$qaProject", "--member=principalSet://iam.googleapis.com/projects/$($project.projectNumber)/locations/global/workloadIdentityPools/qa-github/attribute.repository_id/0", "--role=roles/iam.workloadIdentityUser", "--format=none") | Out-Null
Invoke-QaGcloud @("iam", "service-accounts", "add-iam-policy-binding", "qa-runner@$qaProject.iam.gserviceaccount.com", "--project=$qaProject", "--member=serviceAccount:qa-runner@$qaProject.iam.gserviceaccount.com", "--role=roles/iam.serviceAccountOpenIdTokenCreator", "--format=none") | Out-Null
Invoke-QaGcloud @("projects", "add-iam-policy-binding", $qaProject, "--member=serviceAccount:qa-runner@$qaProject.iam.gserviceaccount.com", "--role=roles/run.viewer", "--condition=None", "--format=none") | Out-Null
# Budget reservations use this fixed QA project in x-goog-user-project when
# updating the storage ledger, which requires serviceusage.services.use.
Invoke-QaGcloud @("projects", "add-iam-policy-binding", $qaProject, "--member=serviceAccount:qa-runner@$qaProject.iam.gserviceaccount.com", "--role=roles/serviceusage.serviceUsageConsumer", "--condition=None", "--format=none") | Out-Null
Write-Host "Isolated QA foundation ready: $qaProject. No production resource was changed."
