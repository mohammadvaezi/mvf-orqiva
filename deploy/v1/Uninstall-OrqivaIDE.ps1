# [PCODE-442 | S15 | v0.1.0] T38 V1 test package for the dev team: server bundle, IDE setup exe, setup guide
#    Why:  takes back what Install-OrqivaIDE.ps1 did for this user. The sign-in (~/.orqiva) stays unless
#          -RemoveSignIn is given, so a reinstall does not need the password again.
[CmdletBinding()]
param([switch] $RemoveSignIn)

$ErrorActionPreference = 'Continue'
$root = Join-Path $env:LOCALAPPDATA 'Orqiva'
$bin = Join-Path $root 'bin'

$code = Get-Command code.cmd -ErrorAction SilentlyContinue
if ($code) { & $code.Source --uninstall-extension broszio.orqiva | Out-Host }

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
    $kept = ($userPath -split ';') | Where-Object { $_ -and $_ -ne $bin }
    [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
}
Remove-Item -Recurse -Force $bin -ErrorAction SilentlyContinue
Write-Host 'Removed the orq command and the VS Code extension.'

if ($RemoveSignIn) {
    Remove-Item -Recurse -Force (Join-Path $env:USERPROFILE '.orqiva') -ErrorAction SilentlyContinue
    Write-Host 'Removed the saved sign-in (~/.orqiva).'
}
else { Write-Host 'The sign-in in ~/.orqiva is kept; run with -RemoveSignIn to delete it too.' }
