$ErrorActionPreference = "Stop"
$qaProject = "house-planner-qa-example"
$qaRepository = "carlosan1708/house-planner-portfolio"
Set-Location (Join-Path $PSScriptRoot "..")
function Invoke-QaGcloud([string[]]$Arguments) {
  $result = & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw "QA credential operation failed" }
  return $result
}
function Save-QaSecret([string]$Name, [string]$Value) {
  $path = Join-Path ([IO.Path]::GetTempPath()) "house-planner-qa-secret-$PID.txt"
  try {
    [IO.File]::WriteAllText($path, $Value, (New-Object Text.UTF8Encoding($false)))
    Invoke-QaGcloud @("secrets", "versions", "add", $Name, "--project=$qaProject", "--data-file=$path", "--quiet") | Out-Null
  } finally { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }
}
$project = Invoke-QaGcloud @("projects", "describe", $qaProject, "--format=json") | ConvertFrom-Json
if ($project.labels.environment -ne "qa") { throw "QA project verification failed" }
foreach ($name in @("qa-identity-passwords", "qa-vault-recovery-key")) {
  $secrets = Invoke-QaGcloud @("secrets", "list", "--project=$qaProject", "--format=json") | ConvertFrom-Json
  if (!($secrets | Where-Object { $_.name -like "*/$name" })) { Invoke-QaGcloud @("secrets", "create", $name, "--project=$qaProject", "--replication-policy=automatic", "--quiet") | Out-Null }
}
$versions = Invoke-QaGcloud @("secrets", "versions", "list", "qa-identity-passwords", "--project=$qaProject", "--filter=state=ENABLED", "--format=value(name)")
if (!$versions) {
  $passwords = @{}
  foreach ($role in @("OWNER", "COMPANION", "EDITOR", "VIEWER", "RESTRICTED", "OUTSIDER")) {
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $passwords["QA_$($role)_PASSWORD"] = [Convert]::ToBase64String($bytes)
  }
  Save-QaSecret "qa-identity-passwords" ($passwords | ConvertTo-Json -Compress)
}
$raw = Invoke-QaGcloud @("secrets", "versions", "access", "latest", "--secret=qa-identity-passwords", "--project=$qaProject")
$passwords = ($raw -join "`n") | ConvertFrom-Json
foreach ($role in @("OWNER", "COMPANION", "EDITOR", "VIEWER", "RESTRICTED", "OUTSIDER")) {
  $name = "QA_$($role)_PASSWORD"
  $value = $passwords.$name
  if (!$value -or $value.Length -lt 12 -or $value.Length -gt 128) { throw "Invalid stored QA identity configuration" }
  $value | & gh secret set $name --repo $qaRepository --env serverless-qa
  if ($LASTEXITCODE -ne 0) { throw "GitHub QA secret update failed" }
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
}
$versions = Invoke-QaGcloud @("secrets", "versions", "list", "qa-vault-recovery-key", "--project=$qaProject", "--filter=state=ENABLED", "--format=value(name)")
if (!$versions) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Save-QaSecret "qa-vault-recovery-key" ([BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant())
}
$key = Invoke-QaGcloud @("secrets", "versions", "access", "latest", "--secret=qa-vault-recovery-key", "--project=$qaProject")
if (($key -join "`n") -notmatch '^[a-f0-9]{64}$') { throw "Invalid QA vault recovery key format (including trailing whitespace)" }
Invoke-QaGcloud @("secrets", "add-iam-policy-binding", "qa-vault-recovery-key", "--project=$qaProject", "--member=serviceAccount:qa-runtime@$qaProject.iam.gserviceaccount.com", "--role=roles/secretmanager.secretAccessor", "--format=none") | Out-Null
$env:HOUSE_PLANNER_ENVIRONMENT = "qa"
$env:GOOGLE_CLOUD_PROJECT = $qaProject
$env:HOUSE_PLANNER_BUCKET = "$qaProject-files"
foreach ($name in @("GOOGLE_APPLICATION_CREDENTIALS", "GCLOUD_PROJECT", "GCP_PROJECT", "GOOGLE_CLOUD_QUOTA_PROJECT", "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "NEXT_PUBLIC_HOUSE_PLANNER_ENVIRONMENT", "HOUSE_PLANNER_GMAIL_REFRESH_TOKEN", "HOUSE_PLANNER_GOOGLE_CLIENT_SECRET", "HOUSE_PLANNER_GOOGLE_TOKEN_KEY", "HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT", "FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST")) {
  Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}
$env:QA_BOOTSTRAP_ACCESS_TOKEN = (Invoke-QaGcloud @("auth", "print-access-token", "--impersonate-service-account=qa-runtime@$qaProject.iam.gserviceaccount.com", "--project=$qaProject")) -join ""
& node scripts/seed-qa.mjs
if ($LASTEXITCODE -ne 0) { throw "Isolated QA fixture provisioning failed" }
Write-Host "Six isolated QA identities and synthetic fixtures provisioned. Credentials were not printed."
