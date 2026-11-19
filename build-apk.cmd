@echo off
rem Double-click (or run) to build a signed OpenErg APK on this PC. The APK lands in the dist folder.
cd /d "%~dp0"
node scripts\local-apk.js
set ERR=%errorlevel%
pause
exit /b %ERR%
