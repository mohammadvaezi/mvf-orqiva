REM [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs
@echo off
REM ── [PCODE-75 | S14 | v0.1.0] Package the toolchain as a Windows installer bundle ──
REM    Why:  double-clicking a .ps1 opens Notepad on a default Windows, so the entry point is a .bat
REM          that calls PowerShell with the execution policy scoped to this one process - nothing about
REM          the machine's policy is changed, and no administrator rights are needed.
setlocal
echo.
echo   Orqiva setup
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\Install-Orqiva.ps1" %*
if errorlevel 1 (
  echo.
  echo   Setup did not finish. The message above says why.
)
echo.
pause
