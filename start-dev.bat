@echo off
echo LexiLearn - Starting dev server...

REM Kill old process
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5176"') do taskkill /F /PID %%a 2>nul

REM Wait a moment
timeout /t 2 /nobreak >nul

echo Starting on http://localhost:5176 ...
echo   Main app:    http://localhost:5176/
echo   Admin panel: http://localhost:5176/admin
start "LexiLearn" cmd /c "cd /d %~dp0 && npm run dev"

echo.
echo Server started. Close this window.
