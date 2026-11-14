param(
  [Parameter(Mandatory)][string]$ProjectId,
  [Parameter(Mandatory)][string]$PublicUrl,
  [string]$Region = "us-central1",
  [Parameter(Mandatory)][string]$Service,
  [string]$Database = "(default)",
  [string]$SchedulerAccount = "house-planner-scheduler"
)

$ErrorActionPreference = "Stop"
$PublicUrl = $PublicUrl.TrimEnd("/")
$SchedulerEmail = "$SchedulerAccount@$ProjectId.iam.gserviceaccount.com"
$JobName = "house-planner-assistant-index"

function Invoke-Gcloud {
  & gcloud @args
  if ($LASTEXITCODE -ne 0) { throw "Google Cloud command failed." }
}

Invoke-Gcloud services enable vision.googleapis.com aiplatform.googleapis.com cloudscheduler.googleapis.com --project $ProjectId
Invoke-Gcloud iam service-accounts describe $SchedulerEmail --project $ProjectId --format="value(email)" | Out-Null
Invoke-Gcloud run services add-iam-policy-binding $Service --project $ProjectId --region $Region --member="serviceAccount:$SchedulerEmail" --role="roles/run.invoker" --quiet

$IndexArgs = @("--project=$ProjectId", "--database=$Database")
$Indexes = Invoke-Gcloud firestore indexes composite list @IndexArgs --format=json | ConvertFrom-Json

function Add-Index([string]$Collection, [string]$Filter, [string]$Target, [string]$TargetConfig) {
  $Existing = $Indexes | Where-Object {
    $_.name -like "*/collectionGroups/$Collection/indexes/*" -and $_.queryScope -eq "COLLECTION" -and
    $_.fields[0].fieldPath -eq $Filter -and $_.fields[1].fieldPath -eq $Target -and
    $(if ($Target -eq "embedding") { $_.fields[1].vectorConfig.dimension -eq 768 } else { $_.fields[1].order -eq "ASCENDING" })
  }
  if (-not $Existing) {
    Invoke-Gcloud firestore indexes composite create @IndexArgs --collection-group=$Collection --query-scope=COLLECTION --async `
      --field-config="field-path=$Filter,order=ASCENDING" --field-config="field-path=$Target,$TargetConfig"
  }
}

Add-Index "assistantRagChunks" "section" "embedding" "vector-config={dimension=768,flat}"
Add-Index "assistantRagChunks" "scope" "embedding" "vector-config={dimension=768,flat}"
Add-Index "assistantRagJobs" "priority" "dueAt" "order=ASCENDING"

$ExistingJob = Invoke-Gcloud scheduler jobs list --project $ProjectId --location $Region --filter="name:$JobName" --format="value(name)"
$SchedulerArgs = @(
  "--project", $ProjectId, "--location", $Region, "--schedule", "* * * * *",
  "--time-zone", "Etc/UTC", "--attempt-deadline", "180s",
  "--uri", "$PublicUrl/api/assistant/documents/dispatch", "--http-method", "POST",
  "--oidc-service-account-email", $SchedulerEmail, "--oidc-token-audience", $PublicUrl
)
if ($ExistingJob) { Invoke-Gcloud scheduler jobs update http $JobName @SchedulerArgs }
else { Invoke-Gcloud scheduler jobs create http $JobName @SchedulerArgs }

Write-Host "Wait for the Firestore indexes to be READY before enabling the project allowlist."
