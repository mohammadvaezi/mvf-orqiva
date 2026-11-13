# ── [PCODE-76 | S08 | v0.1.0] Turn the setup into a Windows wizard that installs VS Code, Claude Code and all prerequisites ──
#    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/c938fb29-5154-46b5-b079-cd9dae242e6a/
#    Why:  a fresh Windows machine has none of the tools the engine and the extension stand on. One tool
#          per call, so the wizard can show which one it is on and report each failure on its own, and so
#          Setup.bat can call the same code after its y/N question - one implementation, not two.
#          Order of preference: already there (skip) -> winget for this user -> winget for the machine
#          -> the vendor's own download. Exit code 0 = the tool is usable afterwards.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('git', 'python', 'node', 'vscode', 'claude')]
    [string] $Tool,
    [string] $LogFile
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($LogFile) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogFile) | Out-Null
    Start-Transcript -Path $LogFile -Append | Out-Null
}

function Say([string] $Text) { Write-Host "   $Text" }

# ── [PCODE-76 | S08 | v0.1.0] PATH as the registry has it now, not as this process inherited it ──
#    The wizard started before anything was installed; every tool added since is only in the registry.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Add-UserPath([string] $Dir) {
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($user -split ';' | Where-Object { $_ })
    if ($parts | Where-Object { $_.TrimEnd('\') -eq $Dir.TrimEnd('\') }) { return }
    [Environment]::SetEnvironmentVariable('Path', (($parts + $Dir) -join ';'), 'User')
    Say "added $Dir to the user PATH"
}

# ── [PCODE-76 | S08 | v0.1.0] Test-Tool: where each one lands when installed for this user ──
function Test-Tool([string] $Name) {
    Update-SessionPath
    if ($Name -eq 'python') { return Find-Python }
    $candidates = switch ($Name) {
        'git'    { @('git.exe', "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe", "$env:ProgramFiles\Git\cmd\git.exe") }
        'node'   { @('npx.cmd', "$env:LOCALAPPDATA\Programs\nodejs\npx.cmd", "$env:ProgramFiles\nodejs\npx.cmd") }
        'vscode' { @('code.cmd', "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
                     "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd") }
        'claude' { @('claude.exe', "$env:USERPROFILE\.local\bin\claude.exe", "$env:APPDATA\npm\claude.cmd") }
    }
    foreach ($c in $candidates) {
        if ($c -notmatch '\\') {
            $cmd = Get-Command $c -ErrorAction SilentlyContinue
            # the Microsoft Store stub for python lives in WindowsApps and installs nothing
            if ($cmd -and $cmd.Source -notmatch '\\WindowsApps\\') { return $cmd.Source }
        } elseif (Test-Path $c) { return $c }
    }
    return $null
}

# ── [PCODE-76 | S08 | v0.1.0] Python is asked for its version: a path alone cannot tell ──
#    WindowsApps holds both the Store's python.exe stub (prints nothing useful) and the real py.exe of
#    the Python install manager, so every candidate is run, and only Python 3.9+ counts.
function Find-Python {
    $candidates = @(
        @('py.exe', '-3'), @('python.exe'), @('python3.exe'),
        @("$env:LOCALAPPDATA\Python\bin\python.exe"),
        @("$env:LOCALAPPDATA\Programs\Python\Launcher\py.exe", '-3')
    ) + @(Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue |
        ForEach-Object { ,@($_.FullName) })
    foreach ($c in $candidates) {
        $exe = if ($c[0] -match '\\') { if (Test-Path $c[0]) { $c[0] } } else {
            (Get-Command $c[0] -All -ErrorAction SilentlyContinue | Select-Object -First 1).Source }
        if (-not $exe) { continue }
        $pyArgs = @($c | Select-Object -Skip 1) + '--version'
        try { $v = & $exe @pyArgs 2>&1 | Out-String } catch { continue }
        if ($v -match 'Python 3\.(\d+)' -and [int]$Matches[1] -ge 9) { return "$exe ($($v.Trim()))" }
    }
    return $null
}

function Find-Winget {
    $w = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($w) { return $w.Source }
    $p = "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
    if (Test-Path $p) { return $p }
    return $null
}

# ── [PCODE-76 | S08 | v0.1.0] winget: this user first, then the machine (that one may ask for UAC) ──
function Install-WithWinget([string] $Id) {
    $winget = Find-Winget
    if (-not $winget) { Say 'winget is not available on this machine'; return $false }
    foreach ($scope in @('user', $null)) {
        $wargs = @('install', '--id', $Id, '-e', '--silent', '--accept-source-agreements',
                   '--accept-package-agreements', '--disable-interactivity')
        if ($scope) { $wargs += @('--scope', $scope) }
        Say "winget $($wargs -join ' ')"
        & $winget @wargs | Out-Host
        # -1978335189 = already installed and no newer version
        if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189) { return $true }
        Say "winget exited with $LASTEXITCODE"
    }
    return $false
}

function Get-Download([string] $Url, [string] $FileName) {
    $target = Join-Path $env:TEMP $FileName
    Say "downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $target -UseBasicParsing
    return $target
}

function Invoke-Installer([string] $Exe, [string[]] $InstallerArgs) {
    Say "running $([IO.Path]::GetFileName($Exe)) $($InstallerArgs -join ' ')"
    $p = Start-Process -FilePath $Exe -ArgumentList $InstallerArgs -Wait -PassThru
    Remove-Item $Exe -Force -ErrorAction SilentlyContinue
    return ($p.ExitCode -eq 0)
}

# ── [PCODE-76 | S08 | v0.1.0] the vendors' own downloads, for a machine without winget ──
function Install-Direct([string] $Name) {
    switch ($Name) {
        'git' {
            $rel = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest' -UseBasicParsing
            $asset = $rel.assets | Where-Object { $_.name -match '^Git-[\d.]+-64-bit\.exe$' } | Select-Object -First 1
            if (-not $asset) { throw 'No 64-bit Git installer in the latest release' }
            $exe = Get-Download $asset.browser_download_url $asset.name
            return Invoke-Installer $exe @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES')
        }
        'python' {
            $exe = Get-Download 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' 'python-3.12.10-amd64.exe'
            return Invoke-Installer $exe @('/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1',
                                           'InstallLauncherAllUsers=0', 'Include_test=0')
        }
        'vscode' {
            $exe = Get-Download 'https://update.code.visualstudio.com/latest/win32-x64-user/stable' 'VSCodeUserSetup-x64.exe'
            return Invoke-Installer $exe @('/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES',
                                           '/MERGETASKS=!runcode,addcontextmenufiles,addcontextmenufolders,addtopath')
        }
    }
    return $false
}

# ── [PCODE-76 | S08 | v0.1.0] Node.js: the official zip, unpacked for this user - the MSI needs admin ──
function Install-Node {
    $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $lts = $index | Where-Object { $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
    if (-not $lts) { throw 'No LTS release of Node.js with a win-x64 zip was found' }
    $name = "node-$($lts.version)-win-x64"
    $zip = Get-Download "https://nodejs.org/dist/$($lts.version)/$name.zip" "$name.zip"
    $root = Join-Path $env:LOCALAPPDATA 'Programs'
    $dir = Join-Path $root 'nodejs'
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $root -Force
    Rename-Item (Join-Path $root $name) 'nodejs'
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Add-UserPath $dir
    return $true
}

# ── [PCODE-76 | S08 | v0.1.0] Claude Code: Anthropic's native installer, for this user ──
function Install-Claude {
    # in its own process: the vendor script may call exit, which would end this one too
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex' | Out-Host
    Add-UserPath (Join-Path $env:USERPROFILE '.local\bin')
    return $true
}

# ── [PCODE-76 | S08 | v0.1.0] main ──
$labels = @{ git = 'Git for Windows'; python = 'Python 3'; node = 'Node.js LTS'; vscode = 'Visual Studio Code'; claude = 'Claude Code' }
$wingetIds = @{ git = 'Git.Git'; python = 'Python.Python.3.12'; vscode = 'Microsoft.VisualStudioCode' }
Write-Host "`n== $($labels[$Tool])"
$code = 1
try {
    $found = Test-Tool $Tool
    if ($found) {
        Say "already installed ($found)"
        $code = 0
    } else {
        $ok = switch ($Tool) {
            'node'   { Install-Node }
            'claude' { Install-Claude }
            default  { (Install-WithWinget $wingetIds[$Tool]) -or (Install-Direct $Tool) }
        }
        $found = Test-Tool $Tool
        if ($ok -and $found) { Say "installed ($found)"; $code = 0 }
        else { Say "$($labels[$Tool]) could not be installed" }
    }
} catch {
    Say "failed: $($_.Exception.Message)"
}
if ($LogFile) { Stop-Transcript | Out-Null }
exit $code
