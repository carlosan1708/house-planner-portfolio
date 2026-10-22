param(
  [string]$ProjectId = "example-house-planner",
  [string]$Region = "us-central1",
  [string]$Service = "house-planner-prod",
  [string]$PublicUrl = "https://house-planner.example.com"
)

$ErrorActionPreference = "Stop"
$SchedulerEmail = "house-planner-scheduler@$ProjectId.iam.gserviceaccount.com"
$JobName = "house-planner-analytics-cleanup"

gcloud services enable cloudscheduler.googleapis.com --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Could not enable Cloud Scheduler." }
$Account = gcloud iam service-accounts list --project $ProjectId --filter="email=$SchedulerEmail" --format="value(email)"
if ($LASTEXITCODE -ne 0) { throw "Could not inspect scheduler account." }
if (-not $Account) {
  gcloud iam service-accounts create house-planner-scheduler --project $ProjectId --display-name="House Planner scheduler"
  if ($LASTEXITCODE -ne 0) { throw "Could not create scheduler account." }
}
gcloud run services add-iam-policy-binding $Service --project $ProjectId --region $Region --member="serviceAccount:$SchedulerEmail" --role="roles/run.invoker" --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not grant scheduler invocation." }
$Existing = gcloud scheduler jobs list --project $ProjectId --location $Region --filter="name:$JobName" --format="value(name)"
if ($LASTEXITCODE -ne 0) { throw "Could not inspect analytics cleanup job." }
$JobArgs = @(
  "--project", $ProjectId,
  "--location", $Region,
  "--schedule", "0 3 * * *",
  "--time-zone", "America/Costa_Rica",
  "--uri", "$($PublicUrl.TrimEnd('/'))/api/usage/cleanup",
  "--http-method", "POST",
  "--oidc-service-account-email", $SchedulerEmail,
  "--oidc-token-audience", $PublicUrl.TrimEnd('/'),
  "--attempt-deadline", "270s",
  "--max-retry-attempts", "3",
  "--min-backoff", "60s",
  "--max-backoff", "300s"
)
if ($Existing) { gcloud scheduler jobs update http $JobName @JobArgs }
else { gcloud scheduler jobs create http $JobName @JobArgs }
if ($LASTEXITCODE -ne 0) { throw "Could not configure analytics cleanup job." }
Write-Host "Analytics cleanup configured: daily at 03:00 America/Costa_Rica."
Write-Host "Runtime must have HOUSE_PLANNER_SCHEDULER_SERVICE_ACCOUNT=$SchedulerEmail and HOUSE_PLANNER_PUBLIC_URL=$($PublicUrl.TrimEnd('/'))."
