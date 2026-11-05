# AgroLens - instalacion local en Windows (PowerShell).
# Uso:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Falta '$cmd'. $hint" }
}
Need node 'Instala Node.js 22 LTS: https://nodejs.org'
Need npm  'Viene con Node.js'

Write-Host '==> Dependencias de servicios Node (workspaces)' -ForegroundColor Green
npm ci

Write-Host '==> Dependencias del frontend Angular' -ForegroundColor Green
Push-Location apps/web; npm ci; Pop-Location

if (Get-Command py -ErrorAction SilentlyContinue) { $py = 'py' } else { $py = 'python' }
Need $py 'Instala Python 3.12: https://www.python.org/downloads/'
Write-Host '==> Entorno Python del ai-service + entrenamiento del modelo' -ForegroundColor Green
Push-Location services/ai-service
& $py -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
& .\.venv\Scripts\python.exe -m scripts.train
Pop-Location

foreach ($s in 'fields-service', 'api-gateway') {
  if (-not (Test-Path "services/$s/.env")) { Copy-Item .env.example "services/$s/.env" }
}

Write-Host "`nListo. Siguientes pasos:" -ForegroundColor Green
Write-Host '  docker compose up --build        (todo el stack en http://localhost:8080)'
Write-Host '  o en modo desarrollo: ver README.md -> "Sin Docker"'
