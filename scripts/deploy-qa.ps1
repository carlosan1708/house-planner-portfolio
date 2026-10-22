param([switch]$EnableBasicAi)
$ErrorActionPreference = "Stop"
$qaProject = "house-planner-qa-example"
$qaRegion = "us-central1"
$qaService = "house-planner-qa"
$qaBucket = "$qaProject-files"
Set-Location (Join-Path $PSScriptRoot "..")
function Invoke-QaGcloud([string[]]$Arguments) {
  $result = & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw "QA gcloud command failed: $($Arguments[0]) $($Arguments[1])" }
  return $result
}
if (git status --porcelain) { throw "QA deployment requires a clean committed source tree" }
$commit = git rev-parse HEAD
$tree = git rev-parse "HEAD^{tree}"
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$' -or $tree -notmatch '^[a-f0-9]{40}$') { throw "Invalid QA source provenance" }
$configPath = Join-Path $PSScriptRoot "../qa-cloud-config.json"
if (!(Test-Path -LiteralPath $configPath)) { throw "Run setup-serverless-qa.ps1 first" }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.projectId -ne $qaProject -or $config.storageBucket -ne $qaBucket) { throw "QA browser configuration target mismatch" }
$env:QA_FIREBASE_PROJECT_ID = $qaProject
$imagePath = "$qaRegion-docker.pkg.dev/$qaProject/house-planner-qa/app:$commit"
try {
  $cachedImageJson = & gcloud artifacts docker images describe $imagePath "--project=$qaProject" --format=json 2>$null
  $reuseImage = $LASTEXITCODE -eq 0
} catch {
  # Windows PowerShell can raise NativeCommandError for an expected cache miss.
  $reuseImage = $false
}
if ($reuseImage) {
  $cachedImage = $cachedImageJson | ConvertFrom-Json
  $imageDigest = $cachedImage.image_summary.digest
  if ($imageDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw "Cached QA image digest is invalid" }
} else {
  & node scripts/qa-budget-control.mjs --action=reserve --kind=build "--id=$commit-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  if ($LASTEXITCODE -ne 0) { throw "QA cost preflight blocked build" }
}
$repo = (Invoke-QaGcloud @("artifacts", "repositories", "list", "--project=$qaProject", "--location=$qaRegion", "--format=json") | ConvertFrom-Json) | Where-Object { $_.name -like "*/house-planner-qa" }
if (!$repo) { Invoke-QaGcloud @("artifacts", "repositories", "create", "house-planner-qa", "--project=$qaProject", "--location=$qaRegion", "--repository-format=docker", "--description=Disposable House Planner QA images") | Out-Null }
$cleanupFile = Join-Path ([IO.Path]::GetTempPath()) "house-planner-qa-artifact-policy-$PID.json"
try {
  $cleanupJson = @(@{ name = "keep-two-latest"; action = @{ type = "Keep" }; mostRecentVersions = @{ keepCount = 2 } }, @{ name = "remove-old-qa-images"; action = @{ type = "Delete" }; condition = @{ olderThan = "604800s"; tagState = "any" } }) | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText($cleanupFile, $cleanupJson, (New-Object Text.UTF8Encoding($false)))
  Invoke-QaGcloud @("artifacts", "repositories", "set-cleanup-policies", "house-planner-qa", "--project=$qaProject", "--location=$qaRegion", "--policy=$cleanupFile", "--no-dry-run") | Out-Null
} finally { Remove-Item -LiteralPath $cleanupFile -ErrorAction SilentlyContinue }
if (!$reuseImage) {
  Invoke-QaGcloud @("builds", "submit", ".", "--project=$qaProject", "--config=cloudbuild.qa.yaml", "--service-account=projects/$qaProject/serviceAccounts/qa-build@$qaProject.iam.gserviceaccount.com", "--substitutions=_QA_API_KEY=$($config.apiKey),_QA_APP_ID=$($config.appId),_SOURCE_COMMIT=$commit", "--quiet") | Out-Null
  $image = Invoke-QaGcloud @("artifacts", "docker", "images", "describe", $imagePath, "--project=$qaProject", "--format=json") | ConvertFrom-Json
  $imageDigest = $image.image_summary.digest
  if ($imageDigest -notmatch '^sha256:[a-f0-9]{64}$') { throw "Built QA image digest is invalid" }
}
$sourceBucket = "$qaProject`_cloudbuild"
$sourceLifecycle = Join-Path ([IO.Path]::GetTempPath()) "house-planner-qa-source-policy-$PID.json"
try {
  $sourceJson = @{ rule = @(@{ action = @{ type = "Delete" }; condition = @{ age = 3 } }) } | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($sourceLifecycle, $sourceJson, (New-Object Text.UTF8Encoding($false)))
  Invoke-QaGcloud @("storage", "buckets", "update", "gs://$sourceBucket", "--lifecycle-file=$sourceLifecycle", "--soft-delete-duration=0", "--no-versioning") | Out-Null
} finally { Remove-Item -LiteralPath $sourceLifecycle -ErrorAction SilentlyContinue }
$envFile = Join-Path ([IO.Path]::GetTempPath()) "house-planner-qa-runtime-$PID.json"
try {
  $vars = @{ HOUSE_PLANNER_ENVIRONMENT = "qa"; GOOGLE_CLOUD_PROJECT = $qaProject; HOUSE_PLANNER_BUCKET = $qaBucket; HOUSE_PLANNER_QA_EMAILS = "qa.houseplanner.20260830@example.com"; HOUSE_PLANNER_QA_PROJECT_IDS = "qa-primary,qa-isolation"; HOUSE_PLANNER_SOURCE_COMMIT = $commit; HOUSE_PLANNER_SOURCE_TREE = $tree; HOUSE_PLANNER_ADMIN_EMAIL = ""; NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT = "qa"; NEXT_PUBLIC_FIREBASE_PROJECT_ID = $qaProject; NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = $qaBucket; NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "$qaProject.firebaseapp.com"; NEXT_PUBLIC_FIREBASE_API_KEY = $config.apiKey; NEXT_PUBLIC_FIREBASE_APP_ID = $config.appId; NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "000000000000"; QA_AI_ENABLED = $(if ($EnableBasicAi) { "1" } else { "0" }); QA_BUDGET_PUSH_EMAIL = "qa-budget-push@$qaProject.iam.gserviceaccount.com"; QA_BUDGET_PUSH_AUDIENCE = "https://$qaService-000000000000.$qaRegion.run.app" }
  [IO.File]::WriteAllText($envFile, ($vars | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  Invoke-QaGcloud @("run", "deploy", $qaService, "--project=$qaProject", "--region=$qaRegion", "--image=$qaRegion-docker.pkg.dev/$qaProject/house-planner-qa/app@$imageDigest", "--service-account=qa-runtime@$qaProject.iam.gserviceaccount.com", "--env-vars-file=$envFile", "--set-secrets=HOUSE_PLANNER_VAULT_RECOVERY_KEY=qa-vault-recovery-key:latest", "--no-allow-unauthenticated", "--min-instances=0", "--max-instances=1", "--concurrency=8", "--cpu=1", "--memory=1Gi", "--timeout=120", "--cpu-throttling", "--no-cpu-boost", "--quiet") | Out-Null
} finally { Remove-Item -LiteralPath $envFile -ErrorAction SilentlyContinue }
foreach ($name in @("qa-runner", "qa-budget-push")) {
  Invoke-QaGcloud @("run", "services", "add-iam-policy-binding", $qaService, "--project=$qaProject", "--region=$qaRegion", "--member=serviceAccount:$name@$qaProject.iam.gserviceaccount.com", "--role=roles/run.invoker", "--format=none") | Out-Null
}
$url = Invoke-QaGcloud @("run", "services", "describe", $qaService, "--project=$qaProject", "--region=$qaRegion", "--format=value(status.url)")
$subscriptions = (Invoke-QaGcloud @("pubsub", "subscriptions", "list", "--project=$qaProject", "--format=json") | ConvertFrom-Json) | Where-Object { $_.name -eq "projects/$qaProject/subscriptions/qa-budget-push" }
$verb = $(if ($subscriptions) { "update" } else { "create" })
$subscriptionArgs = @("pubsub", "subscriptions", $verb, "qa-budget-push", "--project=$qaProject", "--push-endpoint=$url/api/qa/budget", "--push-auth-service-account=qa-budget-push@$qaProject.iam.gserviceaccount.com", "--push-auth-token-audience=https://$qaService-000000000000.$qaRegion.run.app", "--min-retry-delay=60s", "--max-retry-delay=600s", "--message-retention-duration=1d", "--ack-deadline=60", "--expiration-period=never")
if ($verb -eq "create") { $subscriptionArgs += "--topic=qa-budget" }
Invoke-QaGcloud $subscriptionArgs | Out-Null
Write-Host "Private isolated QA deployed: $url ($commit). Full cloud regression remains manual."
