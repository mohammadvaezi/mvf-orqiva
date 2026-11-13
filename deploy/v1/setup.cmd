@echo off
rem [PCODE-442 | S15 | v0.1.0] T38 V1 test package for the dev team: server bundle, IDE setup exe, setup guide
rem The setup exe runs this; it can also be double-clicked in the ide folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-OrqivaIDE.ps1" %*
echo.
pause
