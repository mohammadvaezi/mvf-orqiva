# [PCODE-442 | S15 | v0.1.0] T38 V1 test package for the dev team: server bundle, IDE setup exe, setup guide
#    Why:  one run puts a developer's Windows machine on the team's Orqiva server: the VS Code
#          extension, the `orq` command on PATH and, if wanted, the sign-in. Everything is for this user
#          only (no administrator rights), and the password is typed into `orq login` itself, hidden,
#          never passed on a command line or written to a log. Orqiva-IDE-Setup.exe runs this file;
#          it can also be run by hand from the ide folder.
[CmdletBinding()]
param(
    # the team's server, e.g. http://orqiva-test:8080; asked for when left out
    [string] $Server,
    # the address to sign in with; asked for when left out
    [string] $Email,
    # install the files only; sign in later with: orq login --server URL --email ADDRESS
    [switch] $SkipLogin,
    # never ask; skip what would need an answer
    [switch] $NonInteractive
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Join-Path $env:LOCALAPPDATA 'Orqiva'
$bin = Join-Path $root 'bin'
$problems = New-Object System.Collections.Generic.List[string]

function Step([string] $t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok([string] $t) { Write-Host "   OK    $t" -ForegroundColor Green }
function Warn([string] $t) { Write-Host "   NOTE  $t" -ForegroundColor Yellow; $problems.Add($t) }
function Ask([string] $q, [string] $default = '') {
    if ($NonInteractive) { return $default }
    $a = Read-Host "   $q"
    if ([string]::IsNullOrWhiteSpace($a)) { return $default }
    return $a.Trim()
}
function Yes([string] $q) { return (Ask "$q [Y/n]" 'y') -match '^(y|yes|j|ja)$' }

# PATH as the registry has it now: tools installed minutes ago are only there
function Update-SessionPath {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($m, $u) | Where-Object { $_ }) -join ';'
}

function Install-WithWinget([string] $id, [string] $name) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Warn "$name is missing and winget is not available. Install $name by hand, then run this setup again."
        return $false
    }
    Write-Host "   Installing $name with winget (Windows may ask for permission) ..."
    & winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements | Out-Host
    Update-SessionPath
    return $true
}

function Get-NodeMajor {
    $n = Get-Command node -ErrorAction SilentlyContinue
    if (-not $n) { return 0 }
    $v = (& node --version) -replace '^v', ''
    return [int]($v.Split('.')[0])
}

function Find-Code {
    $c = Get-Command code.cmd -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in @(
            (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'),
            (Join-Path $env:ProgramFiles 'Microsoft VS Code\bin\code.cmd'))) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$version = '0.1.0'
$vsix = Get-ChildItem -Path $here -Filter 'orqiva-*.vsix' | Select-Object -First 1
$orq = Join-Path $here 'orq.mjs'
if (-not $vsix -or -not (Test-Path $orq)) {
    Write-Host 'orq.mjs or the orqiva .vsix is missing next to this script.' -ForegroundColor Red
    exit 1
}
if ($vsix.Name -match 'orqiva-(.+)\.vsix') { $version = $Matches[1] }

Write-Host ''
Write-Host "  Orqiva $version - developer setup" -ForegroundColor White
Write-Host '  VS Code extension, the orq command line, and the sign-in to your team''s server.'

# 1. Node.js 22 or newer: orq runs on it
Step 'Node.js 22 or newer'
$major = Get-NodeMajor
if ($major -ge 22) { Ok "Node.js $(& node --version)" }
else {
    if ($major -gt 0) { Write-Host "   Node.js $(& node --version) is too old." }
    if (Yes 'Install Node.js LTS now?') {
        if (Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js') {
            $major = Get-NodeMajor
            if ($major -ge 22) { Ok "Node.js $(& node --version)" }
            else { Warn 'Node.js is still not found. Open a new terminal or sign out and in, then run this setup again.' }
        }
    }
    else { Warn 'Node.js 22 or newer is needed for orq: https://nodejs.org' }
}

# 2. the orq command, for this user
Step 'The orq command line'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Copy-Item -Force $orq (Join-Path $bin 'orq.mjs')
Set-Content -Path (Join-Path $bin 'orq.cmd') -Encoding ASCII -Value "@echo off`r`nnode `"%~dp0orq.mjs`" %*"
Copy-Item -Force (Join-Path $here 'Uninstall-OrqivaIDE.ps1') (Join-Path $root 'Uninstall-OrqivaIDE.ps1') -ErrorAction SilentlyContinue
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $bin)) {
    [Environment]::SetEnvironmentVariable('Path', ((@($userPath, $bin) | Where-Object { $_ }) -join ';'), 'User')
    Ok "Added $bin to your PATH (new terminals see it)"
}
Update-SessionPath
Ok "orq $version in $bin"

# 3. VS Code and the extension
Step 'VS Code and the Orqiva extension'
$code = Find-Code
if (-not $code -and (Yes 'VS Code was not found. Install it now?')) {
    if (Install-WithWinget 'Microsoft.VisualStudioCode' 'VS Code') { $code = Find-Code }
}
if ($code) {
    & $code --install-extension $vsix.FullName --force | Out-Host
    if ($LASTEXITCODE -eq 0) { Ok "Extension $($vsix.Name) installed" }
    else { Warn "VS Code could not install $($vsix.Name). In VS Code: Extensions, ..., Install from VSIX." }
}
else { Warn "VS Code not found. Later, in VS Code: Extensions, ..., Install from VSIX, and pick $($vsix.Name)." }

# 4. Claude Code is optional: the hooks keep it on the task loop
Step 'Claude Code (optional)'
if (Get-Command claude -ErrorAction SilentlyContinue) { Ok 'Claude Code found. In each repository, run: orq hooks install' }
else { Write-Host '   Not found. Optional: see the setup guide, "Claude Code".' }

# 5. sign in: orq asks for the password itself, hidden
Step 'Sign in to your Orqiva server'
$signedIn = $false
if (-not $SkipLogin) {
    if (-not $Server) { $Server = Ask 'Server address from your admin (e.g. http://orqiva-test:8080), Enter to skip' }
    if ($Server) {
        if (-not $Email) { $Email = Ask 'Your e-mail address on that server' }
        if ($Email -and (Get-NodeMajor) -ge 22) {
            & node (Join-Path $bin 'orq.mjs') login --server $Server --email $Email
            if ($LASTEXITCODE -eq 0) { $signedIn = $true }
            else { Warn "Sign-in failed. Try again later: orq login --server $Server --email $Email" }
        }
        elseif ($Email) { Warn "Node.js is missing, so sign in later: orq login --server $Server --email $Email" }
    }
}
if (-not $signedIn -and -not $problems.Count) { Write-Host '   Skipped. Later: orq login --server <address> --email <you@company>' }

Step 'Done'
if ($problems.Count) {
    Write-Host '   Finished with notes:' -ForegroundColor Yellow
    foreach ($p in $problems) { Write-Host "   - $p" -ForegroundColor Yellow }
}
else { Ok 'Everything is installed.' }
Write-Host ''
Write-Host '   Next, in a NEW terminal, inside your repository:'
Write-Host '     orq link <PROJECT-KEY>     e.g. orq link APP'
Write-Host '     orq hooks install          only if you use Claude Code'
Write-Host '   Then open the folder in VS Code. Uninstall: Uninstall-OrqivaIDE.ps1 in' $root
if ($problems.Count) { exit 2 }
exit 0
