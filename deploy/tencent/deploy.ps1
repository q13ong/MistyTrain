param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [string]$User = "root",

  [string]$IdentityFile = "",

  [int]$Port = 22,

  [Parameter(Mandatory = $true)]
  [string]$PublicOrigin,

  [Parameter(Mandatory = $true)]
  [string]$SessionSecret,

  [Parameter(Mandatory = $true)]
  [string]$DatabasePassword
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$archive = Join-Path $env:TEMP "fog-train-release.tar.gz"

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

Push-Location $repoRoot
try {
  tar `
    --exclude=".git" `
    --exclude="node_modules" `
    --exclude="apps/*/node_modules" `
    --exclude="packages/*/node_modules" `
    --exclude="apps/web/dist" `
    --exclude="apps/server/dist" `
    --exclude="packages/shared/dist" `
    --exclude=".pglite" `
    --exclude="test-results" `
    --exclude="playwright-report" `
    -czf $archive .
}
finally {
  Pop-Location
}

$sshArgs = @()
$scpArgs = @()
if ($IdentityFile) {
  $sshArgs += @("-i", $IdentityFile)
  $scpArgs += @("-i", $IdentityFile)
}
$sshArgs += @("-p", "$Port")
$scpArgs += @("-P", "$Port")

& ssh @sshArgs "$User@$Server" "mkdir -p /opt/fog-train"
& scp @scpArgs $archive "${User}@${Server}:/tmp/fog-train-release.tar.gz"
& ssh @sshArgs "$User@$Server" "tar -xzf /tmp/fog-train-release.tar.gz -C /opt/fog-train && rm /tmp/fog-train-release.tar.gz"
& ssh @sshArgs "$User@$Server" "sudo bash /opt/fog-train/deploy/tencent/bootstrap.sh"

$envFile = @"
PUBLIC_ORIGIN=$PublicOrigin
SESSION_SECRET=$SessionSecret
POSTGRES_DB=fog_train
POSTGRES_USER=fog_train
POSTGRES_PASSWORD=$DatabasePassword
"@

$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($envFile))
& ssh @sshArgs "$User@$Server" "printf '%s' '$encoded' | base64 -d | sudo tee /opt/fog-train/deploy/tencent/.env >/dev/null"
& ssh @sshArgs "$User@$Server" "cd /opt/fog-train/deploy/tencent && sudo docker compose up -d --build"
& ssh @sshArgs "$User@$Server" "cd /opt/fog-train/deploy/tencent && sudo docker compose ps"

Write-Host "部署完成：$PublicOrigin"
