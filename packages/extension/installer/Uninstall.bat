REM [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs
@echo off
REM ── [PCODE-75 | S14 | v0.1.0] Package the toolchain as a Windows installer bundle ──
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\Uninstall-Orqiva.ps1" %*
pause
