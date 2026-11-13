# [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs
# ── [PCODE-75 | S14 | v0.1.0] Package the toolchain as a Windows installer bundle ──
#    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
#    Why:  an installer that cannot be reversed is not finished. This removes exactly what was added and
#          nothing else: the stored credentials are a separate question, asked separately, because the
#          same machine may still want them, and no `.plane/` folder in a repository is ever touched.
# ── [PCODE-77 | S08 | v0.1.0] Rename PlaneCode to ProdEngine (now Orqiva) with settings migration ──
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $InstallRoot = (Join-Path $env:LOCALAPPDATA 'Orqiva'),
    [switch] $KeepCredentials,
    [switch] $NonInteractive
)

$ErrorActionPreference = 'Stop'
$EngineTarget = Join-Path $InstallRoot 'engine'
function Step([string] $t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok([string] $t) { Write-Host "   OK   $t" -ForegroundColor Green }
function Warn2([string] $t) { Write-Host "   !!   $t" -ForegroundColor Yellow }

# ── [PCODE-75 | S14 | v0.1.0] the credentials are asked about on their own ──
Step 'Stored Plane credentials'
$store = Join-Path $EngineTarget 'secrets.bin'
$removeStore = $false
if (Test-Path $store) {
    if ($KeepCredentials) { Ok 'Kept (--KeepCredentials).' }
    else {
        $answer = if ($NonInteractive) { 'y' } else { Read-Host '   Remove the stored Plane key from this machine too? [y/N]' }
        $removeStore = $answer -match '^(y|yes)$'
        if (-not $removeStore) { Ok "Kept at $store" }
    }
} else { Ok 'None stored.' }

# ── [PCODE-75 | S14 | v0.1.0] the Claude Code hooks: ours removed, everyone else's kept ──
Step 'Claude Code hooks and MCP server'
$settingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'
if (Test-Path $settingsPath) {
    if ($PSCmdlet.ShouldProcess($settingsPath, 'remove the Orqiva hooks')) {
        $json = Get-Content $settingsPath -Raw | ConvertFrom-Json
        $removed = 0
        if ($json.hooks) {
            foreach ($event in @($json.hooks.PSObject.Properties.Name)) {
                $groups = @($json.hooks.$event)
                $kept = @()
                foreach ($g in $groups) {
                    $hooks = @($g.hooks | Where-Object { $_.command -notmatch 'hooks\.py' })
                    $removed += (@($g.hooks).Count - $hooks.Count)
                    if ($hooks.Count) { $g.hooks = $hooks; $kept += $g }
                }
                if ($kept.Count) { $json.hooks.$event = $kept }
                else { $json.hooks.PSObject.Properties.Remove($event) }
            }
        }
        if ($json.env -and $json.env.PSObject.Properties.Name -contains 'PLANE_CLAUDE_HOME') {
            $json.env.PSObject.Properties.Remove('PLANE_CLAUDE_HOME')
        }
        if ($json.permissions -and $json.permissions.allow) {
            $json.permissions.allow = @($json.permissions.allow | Where-Object { $_ -notmatch 'plane' })
        }
        $json | ConvertTo-Json -Depth 12 | Set-Content $settingsPath -Encoding UTF8
        Ok "Removed $removed hook entr$(if ($removed -eq 1) { 'y' } else { 'ies' }); everything else in settings.json was kept"
    }
} else { Ok 'No Claude Code settings file.' }

$claude = (Get-Command claude -ErrorAction SilentlyContinue)
if ($claude -and $PSCmdlet.ShouldProcess('plane', 'remove the MCP server')) {
    & $claude.Source mcp remove plane --scope user 2>&1 | Out-Null
    Ok 'MCP server removed'
}

# ── [PCODE-75 | S14 | v0.1.0] the environment: only our own entries ──
Step 'Environment'
if ($PSCmdlet.ShouldProcess('PLANE_CLAUDE_HOME and the PATH entry', 'remove')) {
    [Environment]::SetEnvironmentVariable('PLANE_CLAUDE_HOME', $null, 'User')
    $binDir = Join-Path $EngineTarget 'bin'
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($userPath) {
        $kept = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $binDir.TrimEnd('\') })
        [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
    }
    Ok 'PLANE_CLAUDE_HOME cleared and the bin folder taken off the user PATH'
}

# ── [PCODE-75 | S14 | v0.1.0] the extension, the shortcut, the folder ──
Step 'VS Code extension'
$code = Get-Command code -ErrorAction SilentlyContinue
if ($code -and $PSCmdlet.ShouldProcess('broszio.orqiva', 'uninstall')) {
    & $code.Source --uninstall-extension broszio.orqiva 2>&1 | Out-Null
    # [PCODE-77 | S08 | v0.1.0] and the same extension under its old name, if it is still there
    & $code.Source --uninstall-extension broszio.orqiva 2>&1 | Out-Null
    Ok 'Extension uninstalled (settings and the stored key in SecretStorage are untouched)'
} elseif (-not $code) { Warn2 'VS Code not on the PATH; uninstall the extension from its Extensions view.' }

Step 'Start menu'
$dir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Orqiva'
if ((Test-Path $dir) -and $PSCmdlet.ShouldProcess($dir, 'remove')) {
    Remove-Item $dir -Recurse -Force
    Ok 'Shortcut removed'
}

Step 'Files'
if (Test-Path $InstallRoot) {
    if ($removeStore) {
        if ($PSCmdlet.ShouldProcess($InstallRoot, 'remove')) { Remove-Item $InstallRoot -Recurse -Force; Ok "$InstallRoot removed" }
    } else {
        # everything but the credential store, which the operator chose to keep
        if ($PSCmdlet.ShouldProcess($EngineTarget, 'remove all but secrets.bin')) {
            Get-ChildItem $EngineTarget -Force -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ne 'secrets.bin' } | Remove-Item -Recurse -Force
            Ok "$EngineTarget emptied; secrets.bin kept"
        }
    }
}

Write-Host "`nOrqiva removed. Any .plane/ folder in your repositories was left alone - it belongs to the repository.`n" -ForegroundColor Cyan
