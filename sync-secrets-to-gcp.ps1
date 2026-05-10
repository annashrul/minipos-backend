# Sync secrets dari .env local ke Google Secret Manager.
#
# Usage:
#   1. Pastikan gcloud sudah login: gcloud auth login
#   2. Jalankan: .\sync-secrets-to-gcp.ps1
#
# Script akan:
#   - Set project ke pos-offline-116b6
#   - Untuk tiap secret: create kalau belum ada, atau add new version kalau sudah ada
#   - Grant Secret Accessor role ke service account pos-api-sa

$ErrorActionPreference = "Continue"

# Config
$ProjectId = "pos-offline-116b6"
$ServiceAccount = "pos-api-sa@pos-offline-116b6.iam.gserviceaccount.com"
$EnvPath = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path $EnvPath)) {
  Write-Error ".env tidak ditemukan di $EnvPath"
  exit 1
}

# Mapping: key di .env -> nama secret di GCP Secret Manager.
$SecretMap = [ordered]@{
  "DATABASE_URL"         = "database-url"
  "DIRECT_URL"           = "direct-url"
  "JWT_SECRET"           = "jwt-secret"
  "CLOUDINARY_URL"       = "cloudinary-url"
  "PUSHER_APP_ID"        = "pusher-app-id"
  "PUSHER_KEY"           = "pusher-key"
  "PUSHER_SECRET"        = "pusher-secret"
  "PUSHER_CLUSTER"       = "pusher-cluster"
  "XENDIT_SECRET_KEY"    = "xendit-secret-key"
  "XENDIT_WEBHOOK_TOKEN" = "xendit-webhook-token"
  "REDIS_URL"            = "redis-url"
  "GROQ_API_KEY"         = "groq-api-key"
}

Write-Host "Setting project to $ProjectId..." -ForegroundColor Cyan
gcloud config set project $ProjectId

# Parse .env
$EnvVars = @{}
Get-Content $EnvPath | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  if ($line -match '^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
    $key = $Matches[1]
    $val = $Matches[2]
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or
        ($val.StartsWith("'") -and $val.EndsWith("'"))) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $EnvVars[$key] = $val
  }
}

# Sync setiap secret
$Created = 0
$Updated = 0
$Skipped = 0

foreach ($envKey in $SecretMap.Keys) {
  $secretName = $SecretMap[$envKey]
  $value = $EnvVars[$envKey]

  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host "  [skip] $envKey kosong di .env" -ForegroundColor Yellow
    $Skipped++
    continue
  }

  Write-Host "[sync] $envKey -> $secretName" -ForegroundColor White

  gcloud secrets describe $secretName --project=$ProjectId | Out-Null
  $exists = ($LASTEXITCODE -eq 0)

  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $value, (New-Object System.Text.UTF8Encoding($false)))

  if ($exists) {
    gcloud secrets versions add $secretName --data-file=$tmp --project=$ProjectId
    $Updated++
  } else {
    gcloud secrets create $secretName --data-file=$tmp --replication-policy=automatic --project=$ProjectId
    $Created++
  }

  Remove-Item $tmp -Force -ErrorAction SilentlyContinue

  gcloud secrets add-iam-policy-binding $secretName --member="serviceAccount:$ServiceAccount" --role="roles/secretmanager.secretAccessor" --project=$ProjectId | Out-Null
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Created : $Created" -ForegroundColor Green
Write-Host "  Updated : $Updated" -ForegroundColor Green
Write-Host "  Skipped : $Skipped" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. git add backend/cloudbuild.yaml"
Write-Host "  2. git commit -m 'ci: sync env vars + secrets dari local ke Cloud Run'"
Write-Host "  3. git push"
