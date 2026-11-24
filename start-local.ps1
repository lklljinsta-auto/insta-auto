$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function New-LocalKey([int]$length) {
    $bytes = New-Object byte[] $length
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Start Docker Desktop with Compose v2 first.' }
docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Start the Docker engine and retry.' }
# Keep the credentials private to the current Windows user, outside the checkout.
$folder = Join-Path $env:LOCALAPPDATA 'InstaAuto'
$null = New-Item -Type Directory -Force $folder
$envPath = Join-Path $folder 'local.env'
if (-not (Test-Path $envPath)) {
    $db = (New-LocalKey 32).Replace('+','-').Replace('/','_').TrimEnd('=')
    $admin = New-LocalKey 24
    $key = New-LocalKey 32
    $stream = [IO.File]::Open($envPath, 'CreateNew', 'Write', 'None')
    try {
        $value = [Text.Encoding]::ASCII.GetBytes("DB_PASSWORD=$db`nADMIN_PASSWORD=$admin`nTOKEN_ENCRYPTION_KEY=$key`n")
        $stream.Write($value, 0, $value.Length)
    } finally { $stream.Dispose() }
}
docker compose --env-file $envPath up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Startup failed. Existing data and credentials were preserved.' }
for ($i=0; $i -lt 90; $i++) {
    try {
        $health = Invoke-RestMethod 'http://localhost:3000/api/health' -TimeoutSec 2
        if ($health.database -and $health.status -eq 'ready') {
            Write-Host "Email: admin@localhost"
            Write-Host "Your local administrator password is the ADMIN_PASSWORD entry in $envPath"
            Start-Process 'http://localhost:3000/local-admin'
            return
        }
    } catch {}
    Start-Sleep -Seconds 2
}
throw 'Database or web startup timed out. Check docker compose logs.'
