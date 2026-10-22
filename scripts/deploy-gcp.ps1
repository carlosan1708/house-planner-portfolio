param(
  [ValidatePattern('^house-planner-prod-[a-z0-9-]+$')]
  [string]$PromoteRevision = "",
  [ValidatePattern('^[1-9][0-9]*$')]
  [string]$QaRunId = "",
  [ValidateSet("cloud", "ci")]
  [string]$ValidationMode = "ci",
  [ValidatePattern('^[1-9][0-9]*$')]
  [string]$CiRunId = ""
)

$ErrorActionPreference = "Stop"

$ProjectId = "example-house-planner"
$Region = "us-central1"
$Service = "house-planner-prod"
$Bucket = "example-house-planner-house-planner-prod"
$AdminEmail = "admin@example.com"
$PublicUrl = "https://house-planner.example.com"
$GmailSender = "notifications@example.com"
$SchedulerServiceAccount = "house-planner-scheduler@$ProjectId.iam.gserviceaccount.com"
$Timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
$CandidateTag = "candidate-$Timestamp"
$RevisionSuffix = "gemini-$Timestamp"
$ReleaseSourceScript = Join-Path $PSScriptRoot "release-source.mjs"
$ReleaseQaScript = Join-Path $PSScriptRoot "release-qa.mjs"
$ReleaseCiScript = Join-Path $PSScriptRoot "release-ci.mjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required to verify release source provenance."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is required to verify release source provenance."
}

$SourceJson = & node $ReleaseSourceScript candidate
if ($LASTEXITCODE -ne 0) { throw "Release source validation failed. Production traffic was not changed." }
$Source = $SourceJson | ConvertFrom-Json
Write-Host "Verified clean Git source: $($Source.commit) (tree $($Source.tree))"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw "Google Cloud CLI (gcloud) is required. Install it and sign in before deploying."
}

$ActiveAccount = gcloud auth list --filter=status:ACTIVE --format="value(account)"
if (-not $ActiveAccount) {
  throw "No active Google Cloud account. Run: gcloud auth login"
}

if ($PromoteRevision) {
  if ($ValidationMode -eq "ci" -and (-not $CiRunId -or $QaRunId)) { throw "CI promotion requires -CiRunId and cannot mix cloud QA evidence. Production traffic was not changed." }
  if ($ValidationMode -eq "cloud" -and $CiRunId) { throw "Cloud QA promotion cannot use a CI run ID. Production traffic was not changed." }
  if ($ValidationMode -eq "cloud" -and -not $QaRunId) { throw "Promotion requires -QaRunId from a successful manual full regression in the isolated serverless QA project. Production traffic was not changed." }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) is required to verify trusted release evidence. Production traffic was not changed." }
  $RevisionJson = gcloud run revisions describe $PromoteRevision --project $ProjectId --region $Region --format=json
  if ($LASTEXITCODE -ne 0) { throw "Revision $PromoteRevision could not be read. Production traffic was not changed." }
  $RevisionState = $RevisionJson | ConvertFrom-Json
  $Ready = $RevisionState.status.conditions | Where-Object { $_.type -eq "Ready" -and $_.status -eq "True" } | Select-Object -First 1
  if (-not $Ready) { throw "Revision $PromoteRevision is not ready. Production traffic was not changed." }
  $RevisionTree = ($RevisionState.spec.containers[0].env | Where-Object { $_.name -eq "HOUSE_PLANNER_SOURCE_TREE" } | Select-Object -First 1).value
  $RevisionCommit = ($RevisionState.spec.containers[0].env | Where-Object { $_.name -eq "HOUSE_PLANNER_SOURCE_COMMIT" } | Select-Object -First 1).value
  if (-not $RevisionTree -or -not $RevisionCommit) { throw "Revision $PromoteRevision has no verified Git provenance. Production traffic was not changed." }
  git fetch origin main --quiet
  if ($LASTEXITCODE -ne 0) { throw "origin/main could not be refreshed. Production traffic was not changed." }
  $MainJson = & node $ReleaseSourceScript assert-main "--tree=$RevisionTree"
  if ($LASTEXITCODE -ne 0) { throw "Candidate merge verification failed. Production traffic was not changed." }
  $MainSource = $MainJson | ConvertFrom-Json
  git merge-base --is-ancestor $RevisionCommit refs/remotes/origin/main
  if ($LASTEXITCODE -ne 0) { throw "The exact tested candidate commit is not merged into origin/main. A squash/rebase requires validation on the final commit. Production traffic was not changed." }
  Write-Host "Verified candidate tree is merged in origin/main at $($MainSource.mainCommit)."
  if ($ValidationMode -eq "ci") {
    $CurrentProductionJson = gcloud run services describe $Service --project $ProjectId --region $Region --format=json
    if ($LASTEXITCODE -ne 0) { throw "Current production baseline could not be read. Production traffic was not changed." }
    $CurrentProduction = $CurrentProductionJson | ConvertFrom-Json
    $CurrentTraffic = @($CurrentProduction.status.traffic | Where-Object { $_.percent -gt 0 })
    if ($CurrentTraffic.Count -ne 1 -or $CurrentTraffic[0].percent -ne 100 -or -not $CurrentTraffic[0].revisionName) {
      throw "CI promotion requires one identifiable 100-percent production baseline. Production traffic was not changed."
    }
    $CurrentRevisionJson = gcloud run revisions describe $CurrentTraffic[0].revisionName --project $ProjectId --region $Region --format=json
    if ($LASTEXITCODE -ne 0) { throw "Current production revision could not be read. Production traffic was not changed." }
    $CurrentRevision = $CurrentRevisionJson | ConvertFrom-Json
    $DeployedTree = ($CurrentRevision.spec.containers[0].env | Where-Object { $_.name -eq "HOUSE_PLANNER_SOURCE_TREE" } | Select-Object -First 1).value
    if ($DeployedTree -notmatch '^[a-f0-9]{40}$') { throw "Current production baseline lacks valid source tree metadata. Production traffic was not changed." }
    $CiJson = & node $ReleaseCiScript "--run-id=$CiRunId" "--commit=$RevisionCommit" "--tree=$RevisionTree" "--deployed-tree=$DeployedTree"
    if ($LASTEXITCODE -ne 0) { throw "Trusted CI release verification failed. Production traffic was not changed." }
    $Ci = $CiJson | ConvertFrom-Json
    Write-Host "Verified standard CI for the exact source: $($Ci.url). Cloud QA was not used."
  } else {
    $QaJson = & node $ReleaseQaScript "--run-id=$QaRunId" "--commit=$RevisionCommit" "--tree=$RevisionTree"
    if ($LASTEXITCODE -ne 0) { throw "Trusted full QA verification failed. Production traffic was not changed." }
    $Qa = $QaJson | ConvertFrom-Json
    $QaRevisionJson = gcloud run revisions describe $Qa.target.revision --project $Qa.target.googleCloudProject --region $Region --format=json
    if ($LASTEXITCODE -ne 0) { throw "The tested isolated QA revision could not be read. Production traffic was not changed." }
    $QaRevision = $QaRevisionJson | ConvertFrom-Json
    $QaReady = $QaRevision.status.conditions | Where-Object { $_.type -eq "Ready" -and $_.status -eq "True" } | Select-Object -First 1
    $QaService = $QaRevision.metadata.labels.'serving.knative.dev/service'
    $QaCommit = ($QaRevision.spec.containers[0].env | Where-Object { $_.name -eq "HOUSE_PLANNER_SOURCE_COMMIT" } | Select-Object -First 1).value
    $QaTree = ($QaRevision.spec.containers[0].env | Where-Object { $_.name -eq "HOUSE_PLANNER_SOURCE_TREE" } | Select-Object -First 1).value
    $QaProject = ($QaRevision.spec.containers[0].env | Where-Object { $_.name -eq "GOOGLE_CLOUD_PROJECT" } | Select-Object -First 1).value
    $QaEnvironment = ($QaRevision.spec.containers[0].env | Where-Object { $_.name -eq "HOUSE_PLANNER_ENVIRONMENT" } | Select-Object -First 1).value
    if (-not $QaReady -or $QaService -ne $Qa.target.service -or $QaCommit -ne $RevisionCommit -or $QaTree -ne $RevisionTree -or $QaProject -ne $Qa.target.googleCloudProject -or $QaProject -eq $ProjectId -or $QaEnvironment -ne "qa") {
      throw "Deployed QA revision does not match trusted regression evidence and isolated source provenance. Production traffic was not changed."
    }
    Write-Host "Verified full regression and cleanup: $($Qa.url) (isolated revision $($Qa.target.revision))."
  }
  Write-Host "Routing production traffic to validated revision $PromoteRevision ..."
  gcloud run services update-traffic $Service --project $ProjectId --region $Region --to-revisions "$PromoteRevision=100"
  if ($LASTEXITCODE -ne 0) { throw "Traffic promotion failed." }
  $PromotedState = gcloud run services describe $Service --project $ProjectId --region $Region --format=json | ConvertFrom-Json
  $Promoted = $PromotedState.status.traffic | Where-Object { $_.revisionName -eq $PromoteRevision -and $_.percent -eq 100 } | Select-Object -First 1
  if (-not $Promoted) { throw "Traffic verification failed after promotion." }
  Write-Host "Promotion complete: $PublicUrl ($PromoteRevision)"
  return
}

$DeployArgs = @(
  "run", "deploy", $Service,
  "--project", $ProjectId,
  "--region", $Region,
  "--source", ".",
  "--allow-unauthenticated",
  "--no-traffic",
  "--tag", $CandidateTag,
  "--revision-suffix", $RevisionSuffix,
  "--timeout", "300s",
  "--concurrency", "80",
  "--max-instances", "3",
  "--update-env-vars", "GOOGLE_CLOUD_PROJECT=$ProjectId,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=gemini-3.1-pro-preview,HOUSE_PLANNER_BUCKET=$Bucket,HOUSE_PLANNER_ADMIN_EMAIL=$AdminEmail,HOUSE_PLANNER_PUBLIC_URL=$PublicUrl,HOUSE_PLANNER_GMAIL_SENDER=$GmailSender,HOUSE_PLANNER_GOOGLE_SERVICE_ACCOUNT=house-planner-sheets@$ProjectId.iam.gserviceaccount.com,HOUSE_PLANNER_SCHEDULER_SERVICE_ACCOUNT=$SchedulerServiceAccount,HOUSE_PLANNER_SOURCE_COMMIT=$($Source.commit),HOUSE_PLANNER_SOURCE_TREE=$($Source.tree)",
  "--remove-env-vars", "HOUSE_PLANNER_QA_EMAILS,HOUSE_PLANNER_QA_PROJECT_IDS,HOUSE_PLANNER_QA_ENVIRONMENT,HOUSE_PLANNER_QA_CLOUD_PROJECT,HOUSE_PLANNER_QA_SERVICE,HOUSE_PLANNER_ENVIRONMENT",
  "--update-secrets", "HOUSE_PLANNER_GMAIL_CLIENT_ID=house-planner-gmail-client-id:latest,HOUSE_PLANNER_GMAIL_CLIENT_SECRET=house-planner-gmail-client-secret:latest,HOUSE_PLANNER_GMAIL_REFRESH_TOKEN=house-planner-gmail-refresh-token:latest,HOUSE_PLANNER_GOOGLE_CLIENT_ID=house-planner-google-client-id:latest,HOUSE_PLANNER_GOOGLE_CLIENT_SECRET=house-planner-google-client-secret:latest,HOUSE_PLANNER_GOOGLE_TOKEN_KEY=house-planner-google-token-key:latest,HOUSE_PLANNER_VAULT_RECOVERY_KEY=house-planner-vault-recovery-key:1"
)

Write-Host "Deploying a zero-traffic House Planner revision as $ActiveAccount..."
& gcloud @DeployArgs
$DeployExitCode = $LASTEXITCODE
$ServiceState = gcloud run services describe $Service --project $ProjectId --region $Region --format=json | ConvertFrom-Json
$CandidateTraffic = $ServiceState.status.traffic | Where-Object { $_.tag -eq $CandidateTag } | Select-Object -First 1
$Revision = $CandidateTraffic.revisionName
$CandidateUrl = $CandidateTraffic.url
if (-not $Revision) {
  if ($DeployExitCode -ne 0) { throw "Google Cloud Run deployment failed." }
  throw "The candidate revision could not be identified."
}
if (-not $CandidateUrl) { throw "The candidate revision URL is unavailable." }
$RevisionJson = gcloud run revisions describe $Revision --project $ProjectId --region $Region --format=json
if ($LASTEXITCODE -ne 0) { throw "The candidate revision could not be read. Production traffic was not changed." }
$RevisionState = $RevisionJson | ConvertFrom-Json
$Ready = $RevisionState.status.conditions | Where-Object { $_.type -eq "Ready" -and $_.status -eq "True" } | Select-Object -First 1
if (-not $Ready) { throw "The candidate revision is not ready. Production traffic was not changed." }
$DeployedTree = ($RevisionState.spec.containers[0].env | Where-Object { $_.name -eq "HOUSE_PLANNER_SOURCE_TREE" } | Select-Object -First 1).value
$DeployedCommit = ($RevisionState.spec.containers[0].env | Where-Object { $_.name -eq "HOUSE_PLANNER_SOURCE_COMMIT" } | Select-Object -First 1).value
if ($DeployedTree -ne $Source.tree -or $DeployedCommit -ne $Source.commit) { throw "Candidate Git provenance verification failed. Production traffic was not changed." }
if ($DeployExitCode -ne 0) { Write-Warning "Cloud Run reported a legacy revision error, but the tagged candidate is ready. Continuing with the candidate smoke test." }

Write-Host "Smoke-testing $Revision at $CandidateUrl ..."
$Response = Invoke-WebRequest -Uri $CandidateUrl -UseBasicParsing -TimeoutSec 60
if ($Response.StatusCode -ne 200 -or $Response.Content -notmatch "House Planner") {
  throw "Candidate smoke test failed. Production traffic was not changed."
}

Write-Host "Candidate ready with zero production traffic."
Write-Host "CANDIDATE_REVISION=$Revision"
Write-Host "CANDIDATE_URL=$CandidateUrl"
if ($ValidationMode -eq "ci") {
  Write-Host "After the source is normally merged and standard CI passes on main for this exact tree, promote with its trusted run ID:"
  Write-Host "powershell -ExecutionPolicy Bypass -File ./scripts/deploy-gcp.ps1 -PromoteRevision $Revision -ValidationMode ci -CiRunId GITHUB_RUN_ID"
} else {
  Write-Host "After full regression passes in isolated serverless QA for this exact main commit/tree, promote with its trusted GitHub run ID:"
  Write-Host "powershell -ExecutionPolicy Bypass -File ./scripts/deploy-gcp.ps1 -PromoteRevision $Revision -ValidationMode cloud -QaRunId GITHUB_RUN_ID"
}
