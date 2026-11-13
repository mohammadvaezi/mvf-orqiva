# [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs
# ── [PCODE-75 | S14 | v0.1.0] Package the toolchain as a Windows installer bundle ──
#    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
#    Why:  a second machine has to get the engine, the extension, the hooks and the PATH entry in one
#          go, and nothing here may be installed behind the operator's back or leave a credential on a
#          command line. Everything is user-scope, so no administrator rights are needed and nothing
#          outside this user's profile is touched.
# ── [PCODE-76 | S08 | v0.1.0] Turn the setup into a Windows wizard that installs VS Code, Claude Code and all prerequisites ──
#    Why:  the wizard runs this hidden, after it has installed the prerequisites itself: so it must find
#          tools installed minutes ago, write what it did to a log, and say through its exit code
#          whether anything went wrong. Setup.bat keeps the console flow and now offers every tool.
# ── [PCODE-77 | S08 | v0.1.0] Rename PlaneCode to ProdEngine (now Orqiva) with settings migration ──
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # where the engine is installed; the default keeps it out of Program Files, so no elevation
    [string] $InstallRoot = (Join-Path $env:LOCALAPPDATA 'Orqiva'),
    [string] $PlaneUrl = 'https://plan.broszio.com',
    [string] $PlaneWorkspace = 'prodsystem',
    # skip the parts that need the network or another program
    [switch] $SkipPrerequisites,
    [switch] $SkipExtension,
    # [PCODE-75 | S14 | v0.1.0] install the files now, connect later: the hooks then wait for the key
    [switch] $SkipCredentials,
    # for the smoke test: take the key from the environment rather than prompting
    [switch] $NonInteractive,
    # [PCODE-76 | S08 | v0.1.0] the wizard has no console to read: everything also goes here
    [string] $LogFile
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bundle = Split-Path -Parent $Here
$EngineSource = Join-Path $Bundle 'engine'
$EngineTarget = Join-Path $InstallRoot 'engine'
# [PCODE-76 | S08 | v0.1.0] each warning also counts as a problem, so the exit code tells the wizard
$script:Problems = 0
if ($LogFile) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null
    Start-Transcript -Path $LogFile -Append | Out-Null
}

function Say([string] $Text, [string] $Colour = 'Gray') { Write-Host $Text -ForegroundColor $Colour }
function Step([string] $Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Ok([string] $Text) { Write-Host "   OK   $Text" -ForegroundColor Green }
function Warn2([string] $Text) { $script:Problems++; Write-Host "   !!   $Text" -ForegroundColor Yellow }

# ── [PCODE-76 | S08 | v0.1.0] PATH as the registry has it now: tools installed in this run are on it ──
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}
Update-SessionPath

# [PCODE-76 | S08 | v0.1.0] the native installer's place first, then the old npm one
$ClaudeLocations = @("$env:USERPROFILE\.local\bin\claude.exe", "$env:APPDATA\npm\claude.cmd",
                     "$env:LOCALAPPDATA\Programs\claude\claude.exe")

# ── [PCODE-75 | S14 | v0.1.0] Find-Tool: PATH first, then the places winget puts things ──
function Find-Tool([string] $Name, [string[]] $Extra = @()) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in $Extra) { if (Test-Path $p) { return $p } }
    return $null
}

# ── [PCODE-76 | S08 | v0.1.0] Get-Python: also where a per-user install puts it, PATH or not ──
function Get-Python {
    $userPythons = @(Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | ForEach-Object { ,@($_.FullName) })
    foreach ($candidate in @(@('py', '-3'), @('python3'), @('python')) + $userPythons) {
        $exe = Find-Tool $candidate[0]
        if (-not $exe) { continue }
        $args = @()
        if ($candidate.Count -gt 1) { $args = $candidate[1..($candidate.Count - 1)] }
        try {
            $v = & $exe @args --version 2>&1 | Out-String
        } catch { continue }
        # the Microsoft Store stub answers to `python` and prints nothing useful
        if ($v -match 'Python 3\.(\d+)' -and [int]$Matches[1] -ge 9) {
            return [pscustomobject]@{ Exe = $exe; Args = $args; Version = $v.Trim() }
        }
    }
    return $null
}

# ── [PCODE-75 | S14 | v0.1.0] prerequisites: reported first, installed only on a yes ──
# [PCODE-76 | S08 | v0.1.0] the installing itself is Install-Prerequisite.ps1, shared with the wizard
function Install-Prerequisite([string] $Label, [string] $Tool, [string] $Manual) {
    Write-Host "   !!   $Label is missing." -ForegroundColor Yellow
    $answer = if ($NonInteractive) { 'y' } else { Read-Host "        Install $Label now? [y/N]" }
    if ($answer -notmatch '^(y|yes)$') {
        Warn2 "Skipped $Label. Install it yourself: $Manual"
        return $false
    }
    if ($PSCmdlet.ShouldProcess($Label, 'install')) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Here 'Install-Prerequisite.ps1') -Tool $Tool
        $ok = ($LASTEXITCODE -eq 0)
        Update-SessionPath
        if (-not $ok) { Warn2 "$Label could not be installed. Install it yourself: $Manual" }
        return $ok
    }
    return $false
}

function Test-Prerequisites {
    Step 'Checking this computer'
    $python = Get-Python
    if ($python) { Ok "$($python.Version) ($($python.Exe))" }
    else {
        if (Install-Prerequisite 'Python 3' 'python' 'https://www.python.org/downloads/') {
            $python = Get-Python
        }
    }

    # [PCODE-76 | S08 | v0.1.0] node for npx (the Plane MCP server), git for Claude Code, then the editor
    $node = Find-Tool 'node' @("$env:LOCALAPPDATA\Programs\nodejs\node.exe")
    if ($node) { Ok "Node.js $((& $node --version)) ($node)" }
    else { [void](Install-Prerequisite 'Node.js' 'node' 'https://nodejs.org/') }

    $git = Find-Tool 'git' @("$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")
    if ($git) { Ok "git ($git)" } else { [void](Install-Prerequisite 'git' 'git' 'https://git-scm.com/') }

    $code = Find-Tool 'code' @("$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd")
    if ($code) { Ok "VS Code ($code)" }
    else { [void](Install-Prerequisite 'Visual Studio Code' 'vscode' 'https://code.visualstudio.com/') }

    $claude = Find-Tool 'claude' $ClaudeLocations
    if ($claude) { Ok "Claude Code ($claude)" }
    elseif (Install-Prerequisite 'Claude Code' 'claude' 'https://claude.com/claude-code') {
        Say '        Sign in once by running:  claude'
    }
    return $python
}

# ── [PCODE-75 | S14 | v0.1.0] the engine: copied without anything secret ──
#    secrets.bin is this machine's DPAPI store; it is useless elsewhere and must never travel anyway.
$ExcludedFromEngine = @('secrets.bin', '.env', '__pycache__', '.pytest_cache')

function Copy-Engine {
    Step "Installing the engine into $EngineTarget"
    if (-not (Test-Path $EngineSource)) { throw "The bundle has no engine folder at $EngineSource" }
    foreach ($bad in @('secrets.bin', '.env')) {
        if (Test-Path (Join-Path $EngineSource $bad)) {
            throw "Refusing to install: the bundle contains $bad. Rebuild it with tools/build-installer.ps1."
        }
    }
    if ($PSCmdlet.ShouldProcess($EngineTarget, 'copy engine')) {
        New-Item -ItemType Directory -Force -Path $EngineTarget | Out-Null
        Get-ChildItem -Path $EngineSource -Force | Where-Object { $ExcludedFromEngine -notcontains $_.Name } |
            ForEach-Object { Copy-Item $_.FullName -Destination $EngineTarget -Recurse -Force }
        Ok "Engine files copied"
    } else {
        Say "   would copy $EngineSource -> $EngineTarget"
    }
}

# ── [PCODE-75 | S14 | v0.1.0] the key: prompted, then handed to Python on stdin ──
#    Never `install.py --key <value>`: a command line is visible in the process list and stays in the
#    console history. The value is decrypted from the SecureString in memory and piped straight in.
function Save-Credentials($Python) {
    Step 'Connecting to Plane'
    $store = Join-Path $EngineTarget 'secrets.bin'
    if (Test-Path $store) {
        Ok 'Credentials are already stored on this machine (delete secrets.bin to replace them).'
        return $true
    }
    Say '   The key comes from Plane -> Profile -> Personal access tokens.'
    Say '   It is stored encrypted with Windows DPAPI and is readable only by this Windows user.'
    if (-not $PSCmdlet.ShouldProcess('Plane credentials', 'store')) {
        Say '   would prompt for the key and store it encrypted'
        return $false
    }

    $secure = if ($NonInteractive) {
        if (-not $env:PLANE_API_KEY) { throw 'NonInteractive needs PLANE_API_KEY in the environment.' }
        ConvertTo-SecureString $env:PLANE_API_KEY -AsPlainText -Force
    } else {
        Read-Host '   Plane API key' -AsSecureString
    }

    $reader = @'
import sys, os
sys.path.insert(0, os.environ["ORQIVA_HOME"])
import plane_secrets
key = sys.stdin.readline().strip()
if not key:
    sys.exit("no key given")
plane_secrets.save({"PLANE_API_KEY": key,
                    "PLANE_BASE_URL": os.environ["ORQIVA_URL"],
                    "PLANE_WORKSPACE_SLUG": os.environ["ORQIVA_WS"]})
print("stored")
'@
    $env:ORQIVA_HOME = $EngineTarget
    $env:ORQIVA_URL = $PlaneUrl
    $env:ORQIVA_WS = $PlaneWorkspace
    $script = Join-Path $env:TEMP 'orqiva-store-key.py'
    Set-Content -Path $script -Value $reader -Encoding UTF8
    try {
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
            $out = $plain | & $Python.Exe @($Python.Args) $script 2>&1 | Out-String
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
            Remove-Variable plain -ErrorAction SilentlyContinue
        }
    } finally {
        Remove-Item $script -Force -ErrorAction SilentlyContinue
        Remove-Item Env:ORQIVA_HOME, Env:ORQIVA_URL, Env:ORQIVA_WS -ErrorAction SilentlyContinue
    }
    if ($out -match 'stored') { Ok 'Key stored, encrypted, on this machine'; return $true }
    Warn2 "The key was not stored: $($out.Trim())"
    return $false
}

# ── [PCODE-75 | S14 | v0.1.0] hooks, PATH, MCP: the engine's own installer does all of it ──
function Invoke-EngineInstall($Python) {
    Step 'Registering the Claude Code hooks, the PATH entry and the MCP server'
    $installer = Join-Path $EngineTarget 'install.py'
    if (-not $PSCmdlet.ShouldProcess($installer, 'run')) { Say "   would run $installer"; return }
    Push-Location $EngineTarget
    try {
        & $Python.Exe @($Python.Args) $installer --url $PlaneUrl --workspace $PlaneWorkspace
        if ($LASTEXITCODE -ne 0) { Warn2 "install.py exited with $LASTEXITCODE - see the message above." }
        else { Ok 'Hooks, PATH and MCP server registered' }
    } finally { Pop-Location }
}

# ── [PCODE-75 | S14 | v0.1.0] the extension ──
function Install-Extension {
    Step 'Installing the VS Code extension'
    $vsix = Get-ChildItem -Path (Join-Path $Bundle 'extension') -Filter '*.vsix' -ErrorAction SilentlyContinue |
        Sort-Object Name | Select-Object -Last 1
    if (-not $vsix) { Warn2 'No .vsix in the bundle; skipping.'; return }
    $code = Find-Tool 'code' @("$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
                               "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd")
    if (-not $code) {
        Warn2 'VS Code was not found on the PATH.'
        Say  "        Install it, then run:  code --install-extension `"$($vsix.FullName)`""
        return
    }
    if (-not $PSCmdlet.ShouldProcess($vsix.Name, 'install into VS Code')) {
        Say "   would install $($vsix.Name)"; return
    }
    # [PCODE-77 | S08 | v0.1.0] the extension was called Orqiva: two copies would register twice
    $installed = & $code --list-extensions 2>$null
    if ($installed -contains 'broszio.orqiva') {
        & $code --uninstall-extension broszio.orqiva 2>&1 | Out-Null
        Ok 'Removed the old Orqiva extension (now Orqiva)'
    }
    & $code --install-extension $vsix.FullName --force
    if ($LASTEXITCODE -eq 0) { Ok "$($vsix.Name) installed" } else { Warn2 "code exited with $LASTEXITCODE" }
}

# ── [PCODE-75 | S14 | v0.1.0] Start menu: one shortcut, rewritten rather than duplicated ──
function Add-Shortcut {
    Step 'Adding the Start-menu shortcut'
    $dir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Orqiva'
    $lnk = Join-Path $dir 'Orqiva.lnk'
    $target = Join-Path $EngineTarget 'PlaneClaude.bat'
    if (-not (Test-Path $target)) { Warn2 'PlaneClaude.bat not found; skipping the shortcut.'; return }
    if (-not $PSCmdlet.ShouldProcess($lnk, 'create')) { Say "   would create $lnk"; return }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = $target
    $s.WorkingDirectory = $EngineTarget
    $s.Description = 'Orqiva - Plane + Claude Code'
    $s.Save()
    Copy-Item (Join-Path $Here 'Uninstall-Orqiva.ps1') -Destination $InstallRoot -Force -ErrorAction SilentlyContinue
    Ok "Start menu -> Orqiva"
}

# ── [PCODE-75 | S14 | v0.1.0] main ──
Say ''
Say '  Orqiva - Plane + Claude Code' 'White'
Say '  ---------------------------------'
Say "  Installing into $InstallRoot (this user only, no administrator rights needed)."

$python = if ($SkipPrerequisites) { Get-Python } else { Test-Prerequisites }
if (-not $python) {
    Warn2 'No usable Python 3.9+ was found. Install Python and run this again.'
    if ($LogFile) { Stop-Transcript | Out-Null }
    exit 1
}

Copy-Engine
$hasKey = if ($SkipCredentials) {
    Write-Host "`n== Connecting to Plane" -ForegroundColor Cyan
    Warn2 'Skipped (-SkipCredentials). Run Setup.bat again, or PlaneClaude.bat -> Connect, when you have the key.'
    $false
} else { Save-Credentials $python }
if ($hasKey) { Invoke-EngineInstall $python }
else { Warn2 'Skipping hooks and MCP: install.py needs the key first. Run this installer again once you have one.' }
if (-not $SkipExtension) { Install-Extension }
Add-Shortcut

Step 'Done'
Say '   Next:'
Say '   1. Open a new terminal (the PATH changed) and check:  plane list'
Say '   2. Open a project folder in VS Code, then the Orqiva icon in the activity bar.'
Say '   3. New here? Read docs\guide.md in the bundle.'
Say ''
# [PCODE-76 | S08 | v0.1.0] 0 = clean, 2 = finished with warnings the log explains
if ($LogFile) { Stop-Transcript | Out-Null }
if ($script:Problems -gt 0) { exit 2 }
exit 0
