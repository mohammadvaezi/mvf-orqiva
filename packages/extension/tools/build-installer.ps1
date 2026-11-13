# [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs
# ── [PCODE-75 | S14 | v0.1.0] Package the toolchain as a Windows installer bundle ──
#    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
#    Why:  one command turns the engine folder and the packaged extension into a ZIP that installs on a
#          machine with nothing on it. The one rule that matters here is what does NOT go in: the
#          engine folder on a working machine holds secrets.bin, and a distribution bundle that carries
#          a credential store is the worst possible bug. The exclusion is enforced twice - once when
#          copying, once by scanning the staged bundle before it is zipped.
# ── [PCODE-76 | S08 | v0.1.0] Turn the setup into a Windows wizard that installs VS Code, Claude Code and all prerequisites ──
#    Why:  the .exe is compiled here from the staged bundle, after the credential gate, so the wizard
#          and the ZIP always carry exactly the same checked files.
[CmdletBinding()]
param(
    [string] $EngineSource = 'C:\Broszio Apps\plane\claude',
    [string] $ExtensionRoot,
    [string] $OutputDir
)

$ErrorActionPreference = 'Stop'
# [PCODE-75 | S14 | v0.1.0] resolved here, not in the param defaults: PowerShell 5.1 evaluates those
# before $PSScriptRoot exists when the script is started with -File.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ExtensionRoot) { $ExtensionRoot = Split-Path -Parent $ScriptDir }
if (-not $OutputDir) { $OutputDir = Join-Path $ExtensionRoot 'dist-installer' }
function Step([string] $t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok([string] $t) { Write-Host "   OK   $t" -ForegroundColor Green }

# never copied out of a working engine folder
$Excluded = @('secrets.bin', '.env', '__pycache__', '.pytest_cache', '.git')
# refused if found anywhere in the staged bundle, whatever it is called
$ForbiddenNames = @('secrets.bin', '.env', 'id_rsa', 'id_ed25519')
$ForbiddenContent = @(
    'plane_api_[0-9a-f]{32}',
    'AKIA[0-9A-Z]{16}',
    '(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)

$version = (Get-Content (Join-Path $ExtensionRoot 'package.json') -Raw | ConvertFrom-Json).version
$stage = Join-Path $env:TEMP "orqiva-bundle-$version"
$zip = Join-Path $OutputDir "Orqiva-Setup-$version.zip"

Step "Building Orqiva-Setup $version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage, $OutputDir | Out-Null

# ── [PCODE-75 | S14 | v0.1.0] the engine, minus anything that is or holds a credential ──
Step 'Engine'
if (-not (Test-Path $EngineSource)) { throw "No engine at $EngineSource" }
$engineTarget = Join-Path $stage 'engine'
New-Item -ItemType Directory -Force -Path $engineTarget | Out-Null
Get-ChildItem $EngineSource -Force | Where-Object { $Excluded -notcontains $_.Name } |
    ForEach-Object { Copy-Item $_.FullName -Destination $engineTarget -Recurse -Force }
# a nested __pycache__ survives a recursive copy of a folder
Get-ChildItem $engineTarget -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $Excluded -contains $_.Name } | Remove-Item -Recurse -Force
Ok "$((Get-ChildItem $engineTarget -Recurse -File).Count) engine files"

# ── [PCODE-75 | S14 | v0.1.0] the extension: the newest .vsix that has been packaged ──
Step 'Extension'
$vsix = Get-ChildItem $ExtensionRoot -Filter '*.vsix' | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $vsix) { throw "No .vsix in $ExtensionRoot - run npm run package first." }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'extension') | Out-Null
Copy-Item $vsix.FullName -Destination (Join-Path $stage 'extension') -Force
Ok $vsix.Name

# ── [PCODE-75 | S14 | v0.1.0] the installer and the documents a new machine needs ──
Step 'Installer and documents'
Copy-Item (Join-Path $ExtensionRoot 'installer\Setup.bat') -Destination $stage -Force
Copy-Item (Join-Path $ExtensionRoot 'installer\Uninstall.bat') -Destination $stage -Force
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'install') | Out-Null
Copy-Item (Join-Path $ExtensionRoot 'installer\*.ps1') -Destination (Join-Path $stage 'install') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'docs') | Out-Null
foreach ($doc in @('install.md', 'guide.md', 'release.md', 'known-issues.md')) {
    Copy-Item (Join-Path $ExtensionRoot "docs\$doc") -Destination (Join-Path $stage 'docs') -Force
}
Copy-Item (Join-Path $ExtensionRoot 'LICENSE') -Destination $stage -Force
Set-Content -Path (Join-Path $stage 'README.txt') -Encoding UTF8 -Value @"
Orqiva $version - Plane + Claude Code

Easiest: run Orqiva-Setup-$version.exe instead of this ZIP - it is a setup wizard.
With the ZIP: double-click Setup.bat.

It installs into %LOCALAPPDATA%\Orqiva for this Windows user only. It will report what is
missing (Python 3, Node.js, git, Visual Studio Code, Claude Code) and offer to install it - nothing
is installed without you saying yes.

You need a Plane API key: Plane -> Profile -> Personal access tokens. The installer asks for it and
stores it encrypted with Windows DPAPI, readable only by this Windows user. It is never written to a
file in clear text and never passed on a command line.

Setup.bat -WhatIf    lists every step it would take and changes nothing.
Uninstall.bat        removes it again, and asks separately about the stored key.

Read docs\install.md for the long version and docs\guide.md for the daily loop.
"@
Ok 'Setup.bat, install\, docs\, LICENSE, README.txt'

# ── [PCODE-75 | S14 | v0.1.0] the gate: nothing ships until the bundle is proven clean ──
Step 'Checking the bundle for credentials'
$offenders = @()
foreach ($f in Get-ChildItem $stage -Recurse -File -Force) {
    if ($ForbiddenNames -contains $f.Name) { $offenders += "$($f.FullName) (forbidden file)"; continue }
    if ($f.Length -gt 2MB -or $f.Extension -in '.vsix', '.png', '.ttf', '.zip') { continue }
    $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }
    foreach ($re in $ForbiddenContent) {
        if ($text -match $re) { $offenders += "$($f.FullName) (matches $re)" }
    }
}
if ($offenders) {
    $offenders | ForEach-Object { Write-Host "   !!   $_" -ForegroundColor Red }
    throw 'The bundle contains something credential-shaped. Nothing was written.'
}
Ok "$((Get-ChildItem $stage -Recurse -File).Count) files, none of them a credential"

Step 'Zipping'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Ok "$zip ($size MB)"

# ── [PCODE-76 | S08 | v0.1.0] the wizard: compiled from the same staged, checked bundle ──
Step 'Setup wizard'
$iscc = @((Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source,
          "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
          "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
          "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$exe = Join-Path $OutputDir "Orqiva-Setup-$version.exe"
if (-not $iscc) {
    Write-Host '   !!   Inno Setup was not found, so no .exe was built. winget install JRSoftware.InnoSetup' -ForegroundColor Yellow
} else {
    if (Test-Path $exe) { Remove-Item $exe -Force }
    & $iscc /Q "/DBundleDir=$stage" "/DAppVersion=$version" "/O$OutputDir" (Join-Path $ExtensionRoot 'installer\Orqiva.iss')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { throw "ISCC failed with exit code $LASTEXITCODE" }
    Ok "$exe ($([math]::Round((Get-Item $exe).Length / 1MB, 2)) MB)"
}
Remove-Item $stage -Recurse -Force

Write-Host "`nCopy Orqiva-Setup-$version.exe to the other machine and double-click it." -ForegroundColor Cyan
Write-Host "(Or the .zip: unzip it and double-click Setup.bat.)`n" -ForegroundColor Cyan
