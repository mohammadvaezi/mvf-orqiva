# [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names
#    Why:  a developer who installed the V1 test build replaces its extension with the fixed one, without
#          the whole setup again: the old extension goes (and any copy from before the rename), the new
#          one comes in, the sign-in to the Orqiva server is checked, a folder can be linked to its
#          project, and the VS Code menu settings are reported, so a hidden menu bar is told apart from
#          a problem in the extension. Everything is for this user only; the password is typed into
#          `orq login` itself, hidden. Fix-OrqivaIDE.cmd runs this file.
[CmdletBinding()]
param(
    # never ask; skip what would need an answer
    [switch] $NonInteractive
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path (Join-Path $env:LOCALAPPDATA 'Orqiva') 'bin'
$orq = Join-Path $bin 'orq.mjs'
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
function Yes([string] $q, [string] $default = 'y') {
    $hint = if ($default -eq 'y') { '[Y/n]' } else { '[y/N]' }
    return (Ask "$q $hint" $default) -match '^(y|yes|j|ja)$'
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

$vsix = Get-ChildItem -Path $here -Filter 'orqiva-*.vsix' | Select-Object -First 1
if (-not $vsix) {
    Write-Host 'The orqiva .vsix is missing next to this script.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '  Orqiva - fix for the VS Code extension' -ForegroundColor White
Write-Host '  Replaces the extension, checks the sign-in and the menu settings.'

# 1. VS Code must be closed, or it keeps the old extension loaded
Step 'Close VS Code'
$running = Get-Process -Name 'Code' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host '   VS Code is open. Save your work and close every VS Code window now.'
    if (-not $NonInteractive) { [void](Read-Host '   Press Enter when VS Code is closed') }
    if (Get-Process -Name 'Code' -ErrorAction SilentlyContinue) {
        Warn 'VS Code is still running. After this script, close it completely and open it again.'
    }
    else { Ok 'VS Code is closed' }
}
else { Ok 'VS Code is not running' }

# 2. the old extension out, the fixed one in
Step 'Replace the Orqiva extension'
$code = Find-Code
if (-not $code) {
    Warn "VS Code not found. In VS Code: Extensions, ..., Install from VSIX, and pick $($vsix.FullName)."
}
else {
    $before = & $code --list-extensions --show-versions 2>$null
    $old = @($before | Where-Object { $_ -match '^(broszio\.orqiva|broszio\.planecode|broszio\.prodengine)@' })
    foreach ($e in $old) {
        $id = $e.Split('@')[0]
        & $code --uninstall-extension $id 2>&1 | Out-Null
        Ok "Removed $e"
    }
    & $code --install-extension $vsix.FullName --force | Out-Host
    $installed = $LASTEXITCODE -eq 0
    $after = & $code --list-extensions --show-versions 2>$null
    $now = @($after | Where-Object { $_ -match '^broszio\.orqiva@' })
    if ($installed -and $now.Count) { Ok "Installed $($now[0]) from $($vsix.Name)" }
    else { Warn "VS Code could not install $($vsix.Name). In VS Code: Extensions, ..., Install from VSIX." }
}

# [PCODE-456 | S15 | v0.1.0] Planning in VS Code shows live in the portal: local AI runs, hook steps, plan documents synced
# 2b. the orq command: the Claude Code hooks run it, and report a planning run live to the portal
Step 'Update the orq command'
$newOrq = Join-Path $here 'orq.mjs'
if (-not (Test-Path $newOrq)) { Warn 'orq.mjs is missing next to this script; the orq command stays as it is.' }
else {
    New-Item -ItemType Directory -Force $bin | Out-Null
    if (Test-Path $orq) { Copy-Item $orq ($orq + '.before-fix') -Force }
    Copy-Item $newOrq $orq -Force
    Ok "orq updated in $bin"
}

# 3. the sign-in the extension uses: the same as orq login
Step 'Sign-in to your Orqiva server'
$creds = Join-Path $env:USERPROFILE '.orqiva\credentials.json'
$servers = @()
if (Test-Path $creds) {
    try {
        $c = Get-Content $creds -Raw | ConvertFrom-Json
        $servers = @($c.servers.PSObject.Properties | ForEach-Object { "$($_.Name) as $($_.Value.email)" })
    }
    catch { Warn "$creds could not be read; sign in again below." }
}
if ($servers.Count) { foreach ($s in $servers) { Ok "Signed in to $s" } }
else {
    Write-Host '   This computer is not signed in yet.'
    if (-not (Test-Path $orq)) {
        Warn 'The orq command is missing. Sign in from VS Code instead: Orqiva Home, step 2, Sign in.'
    }
    elseif (Yes 'Sign in now?') {
        $server = Ask 'Server address (e.g. http://195.167.221.229:8490)'
        $email = Ask 'Your e-mail address on that server'
        if ($server -and $email) {
            & node $orq login --server $server --email $email
            if ($LASTEXITCODE -eq 0) { Ok 'Signed in' }
            else { Warn "Sign-in failed. Try again later: orq login --server $server --email $email" }
        }
    }
    else { Write-Host '   Skipped. VS Code asks for it on the Orqiva Home tab, step 2.' }
}

# 4. optional: link a folder now, as orq link does (VS Code can do it too)
Step 'Link a project folder (optional)'
if ((Test-Path $orq) -and (Yes 'Link a folder to an Orqiva project now?' 'n')) {
    $folder = Ask 'Full path of the folder (e.g. C:\Users\you\Desktop\MyApp)'
    $key = Ask 'Project key from the web app (e.g. APP)'
    if ($folder -and $key -and (Test-Path $folder -PathType Container)) {
        Push-Location $folder
        try {
            & node $orq link $key
            if ($LASTEXITCODE -eq 0) { Ok "Linked $folder to $($key.ToUpper())" }
            else { Warn "Linking failed. In VS Code: Orqiva Home, Use an existing project." }
        }
        finally { Pop-Location }
    }
    elseif ($folder -or $key) { Warn "Folder '$folder' not found or no key given; link it later from VS Code." }
}
else { Write-Host '   Skipped. In VS Code: Orqiva Home, Use an existing project.' }

# 5. the menus: report the settings that hide them; change one only when asked
Step 'VS Code menu bar'
$settings = Join-Path $env:APPDATA 'Code\User\settings.json'
if (Test-Path $settings) {
    $text = Get-Content $settings -Raw
    $found = $false
    foreach ($k in @('window.menuBarVisibility', 'window.titleBarStyle', 'window.customTitleBarVisibility')) {
        $m = [regex]::Match($text, '"' + [regex]::Escape($k) + '"\s*:\s*"([^"]*)"')
        if ($m.Success) { Write-Host "   $k = $($m.Groups[1].Value)"; $found = $true }
    }
    if (-not $found) { Ok 'No menu settings changed: VS Code shows its normal menu bar' }
    $hidden = [regex]::Match($text, '"window\.menuBarVisibility"\s*:\s*"(hidden|toggle|compact)"')
    if ($hidden.Success) {
        Write-Host "   The menu bar is set to '$($hidden.Groups[1].Value)', which hides or folds File, Edit, Selection ..."
        if (Yes 'Set it back to the normal menu bar (classic)?') {
            Copy-Item $settings ($settings + '.before-orqiva-fix') -Force
            $text = $text.Remove($hidden.Index, $hidden.Length).Insert($hidden.Index, '"window.menuBarVisibility": "classic"')
            [IO.File]::WriteAllText($settings, $text, (New-Object Text.UTF8Encoding $false))
            Ok "Menu bar set to classic (backup: $settings.before-orqiva-fix)"
        }
    }
}
else { Ok 'No user settings yet: VS Code shows its normal menu bar' }

Step 'Done'
if ($problems.Count) {
    Write-Host '   Finished with notes:' -ForegroundColor Yellow
    foreach ($p in $problems) { Write-Host "   - $p" -ForegroundColor Yellow }
}
else { Ok 'The fixed extension is installed.' }
Write-Host ''
Write-Host '   Next: open VS Code, then your project folder. The Orqiva Home tab shows'
Write-Host '   "Sign in to Orqiva" and "Your project"; "Use an existing project" lists the projects'
Write-Host '   from the web app. FIX-GUIDE.html, next to this script, has every step and the menu check.'
if ($problems.Count) { exit 2 }
exit 0
