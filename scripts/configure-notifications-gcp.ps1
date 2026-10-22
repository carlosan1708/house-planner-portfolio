$ErrorActionPreference = "Stop"

$ProjectId = "example-house-planner"
$Region = "us-central1"
$Service = "house-planner-prod"
$PublicUrl = "https://house-planner.example.com"
$SchedulerAccountName = "house-planner-scheduler"
$SchedulerEmail = "$SchedulerAccountName@$ProjectId.iam.gserviceaccount.com"
$RuntimeEmail = "$Service@$ProjectId.iam.gserviceaccount.com"
$JobName = "house-planner-notification-dispatch"
$GmailSecrets = @(
  "house-planner-gmail-client-id",
  "house-planner-gmail-client-secret",
  "house-planner-gmail-refresh-token"
)

gcloud services enable gmail.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com --project $ProjectId

$ExistingAccount = gcloud iam service-accounts list --project $ProjectId --filter="email=$SchedulerEmail" --format="value(email)"
if (-not $ExistingAccount) {
  gcloud iam service-accounts create $SchedulerAccountName --project $ProjectId --display-name="House Planner notification scheduler"
}

foreach ($SecretName in $GmailSecrets) {
  $ExistingSecret = gcloud secrets describe $SecretName --project $ProjectId --format="value(name)"
  if (-not $ExistingSecret) {
    throw "Required Gmail secret '$SecretName' does not exist. Run scripts/connect-gmail.mjs first."
  }
  gcloud secrets add-iam-policy-binding $SecretName --project $ProjectId --member="serviceAccount:$RuntimeEmail" --role="roles/secretmanager.secretAccessor" --quiet | Out-Null
}

gcloud run services add-iam-policy-binding $Service --project $ProjectId --region $Region --member="serviceAccount:$SchedulerEmail" --role="roles/run.invoker" --quiet | Out-Null

$ExistingJob = gcloud scheduler jobs list --project $ProjectId --location $Region --filter="name:$JobName" --format="value(name)"
$SchedulerArgs = @(
  "--project", $ProjectId,
  "--location", $Region,
  "--schedule", "*/5 * * * *",
  "--time-zone", "Etc/UTC",
  "--uri", "$PublicUrl/api/notifications/dispatch",
  "--http-method", "POST",
  "--oidc-service-account-email", $SchedulerEmail,
  "--oidc-token-audience", $PublicUrl
)
if ($ExistingJob) {
  gcloud scheduler jobs update http $JobName @SchedulerArgs
} else {
  gcloud scheduler jobs create http $JobName @SchedulerArgs
}

Write-Host "Notification infrastructure configured for $SchedulerEmail."
