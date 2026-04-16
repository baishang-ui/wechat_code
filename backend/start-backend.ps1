$ErrorActionPreference = 'Stop'

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $backendDir '.env'
$envExampleFile = Join-Path $backendDir '.env.example'
$packageFile = Join-Path $backendDir 'package.json'
$nodeModulesDir = Join-Path $backendDir 'node_modules'

function Write-Step($message) {
  Write-Host "[backend] $message" -ForegroundColor Cyan
}

if (-not (Test-Path -LiteralPath $packageFile)) {
  Write-Error "package.json not found: $packageFile"
}

try {
  $null = Get-Command node -ErrorAction Stop
} catch {
  Write-Error "Node.js not found. Please install Node.js and make sure 'node' is available."
}

if (-not (Test-Path -LiteralPath $envFile)) {
  if (-not (Test-Path -LiteralPath $envExampleFile)) {
    Write-Error ".env and .env.example are both missing. Please create backend config first."
  }

  Write-Step ".env not found, copying from .env.example"
  Copy-Item -LiteralPath $envExampleFile -Destination $envFile
}

if (-not (Test-Path -LiteralPath $nodeModulesDir)) {
  Write-Step "node_modules not found, installing dependencies"
  Push-Location $backendDir
  try {
    npm install
  } finally {
    Pop-Location
  }
}

Write-Step "starting backend server"
Write-Step "working directory: $backendDir"

Push-Location $backendDir
try {
  node src/server.js
} finally {
  Pop-Location
}
