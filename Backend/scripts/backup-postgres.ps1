param(
  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.yml'),
  [string]$BackupDir = (Join-Path $PSScriptRoot '..\backups'),
  [string]$FilePrefix = 'skillforge'
)

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$composePath = (Resolve-Path $ComposeFile).Path
$backupPath = (Resolve-Path $BackupDir -ErrorAction SilentlyContinue)
if (-not $backupPath) {
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $backupPath = Resolve-Path $BackupDir
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = "$FilePrefix-$timestamp.dump"

Push-Location $rootDir
try {
  docker compose -f $composePath exec -T postgres sh -lc "export PGPASSWORD=`"`$POSTGRES_PASSWORD`"; pg_dump -h 127.0.0.1 -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" --clean --if-exists --format=custom --file `"/backups/$backupFile`""
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose exec failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Output "Backup written to $($backupPath.Path)\$backupFile"
