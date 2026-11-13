@echo off
rem [PCODE-453 | S15 | v0.1.0] VS Code extension: onboarding on the Orqiva server (sign in, link, new project), no Plane names
rem Double-click: replaces the Orqiva VS Code extension with the fixed one and checks sign-in and menus.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Fix-OrqivaIDE.ps1" %*
echo.
pause
