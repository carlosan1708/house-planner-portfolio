$ErrorActionPreference = "Stop"

$ProjectId = "example-house-planner"
$Bucket = "example-house-planner-house-planner-prod"
$Package = Get-Content (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json
$Release = "v$($Package.version)"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Prefix = "gs://$Bucket/backups/$Release-$Stamp"
$SourceRoot = "gs://$Bucket/house-planner"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw "Google Cloud CLI is required."
}

Write-Host "Inventorying all production storage (workbooks, documents, photos, thumbnails, receipts, and drafts) ..."
$SourceObjects = @(gcloud storage ls --recursive $SourceRoot --project $ProjectId)
if ($LASTEXITCODE -ne 0 -or $SourceObjects.Count -eq 0) { throw "Production storage inventory failed or is empty." }
$SourceBytesLine = gcloud storage du --summarize $SourceRoot --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Production storage size could not be read." }
$SourceBytes = [int64](($SourceBytesLine -split '\s+')[0])

Write-Host "Backing up $($SourceObjects.Count) production objects ($SourceBytes bytes) to $Prefix/storage ..."
gcloud storage cp --recursive $SourceRoot "$Prefix/storage" --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Production storage backup failed." }

$BackupObjects = @(gcloud storage ls --recursive "$Prefix/storage" --project $ProjectId)
if ($LASTEXITCODE -ne 0) { throw "Backup storage inventory failed." }
$BackupBytesLine = gcloud storage du --summarize "$Prefix/storage" --project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Backup storage size could not be read." }
$BackupBytes = [int64](($BackupBytesLine -split '\s+')[0])
if ($BackupObjects.Count -ne $SourceObjects.Count -or $BackupBytes -ne $SourceBytes) {
  throw "Storage verification failed. Source: $($SourceObjects.Count) objects / $SourceBytes bytes. Backup: $($BackupObjects.Count) objects / $BackupBytes bytes."
}
Write-Host "Storage backup verified: $($BackupObjects.Count) objects / $BackupBytes bytes."

Write-Host "Exporting Firestore to $Prefix/firestore ..."
$ExportJson = gcloud firestore export "$Prefix/firestore" --project $ProjectId --async --format=json
if ($LASTEXITCODE -ne 0) { throw "Firestore export could not be started." }
$Export = $ExportJson | ConvertFrom-Json
if (-not $Export.name) { throw "Firestore export did not return an operation name." }

do {
  Start-Sleep -Seconds 5
  $OperationJson = gcloud firestore operations describe $Export.name --project $ProjectId --format=json
  if ($LASTEXITCODE -ne 0) { throw "Firestore export status could not be read." }
  $Operation = $OperationJson | ConvertFrom-Json
} while (-not $Operation.done)

if ($Operation.error) { throw "Firestore export failed: $($Operation.error.message)" }
if ($Operation.metadata.operationState -ne "SUCCESSFUL") { throw "Firestore export ended in state $($Operation.metadata.operationState)." }
$DocumentCount = $Operation.metadata.progressDocuments.completedWork
Write-Host "Firestore backup verified: $DocumentCount documents."

Write-Host "Backup completed and verified: $Prefix"
