param(
  [string]$OutputRoot = "$env:USERPROFILE\voiceauto-deploy-bundles"
)

$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bundleDir = Join-Path $OutputRoot "voiceauto-$timestamp"

Write-Host "[1/5] Building project at $projectRoot"
Push-Location $projectRoot
npm run build
Pop-Location

Write-Host "[2/5] Creating external bundle directory: $bundleDir"
New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null

Write-Host "[3/5] Copying dist output"
Copy-Item -Path (Join-Path $projectRoot "dist\*") -Destination (Join-Path $bundleDir "dist") -Recurse -Force

Write-Host "[4/5] Copying reusable deployment assets"
New-Item -ItemType Directory -Force -Path (Join-Path $bundleDir "deploy") | Out-Null
Copy-Item -Path (Join-Path $projectRoot "deploy\nginx") -Destination (Join-Path $bundleDir "deploy") -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "deploy\docker") -Destination (Join-Path $bundleDir "deploy") -Recurse -Force
Copy-Item -Path (Join-Path $projectRoot "docs\deployment\server-deployment-guide.md") -Destination $bundleDir -Force

Write-Host "[5/5] Bundle ready"
Write-Host "Output: $bundleDir"
