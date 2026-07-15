@echo off
echo ============================================
echo   LexiLearn Deploy Package
echo ============================================
echo.

set "OUTDIR=deploy-package"

echo [1/3] npm build...
call npm install --silent
call npm run build
if errorlevel 1 (
    echo Build failed!
    pause
    exit /b 1
)
echo.

echo [2/3] Package files...
if exist "%OUTDIR%" rd /s /q "%OUTDIR%"
mkdir "%OUTDIR%"

xcopy /e /i /q dist "%OUTDIR%\dist" >nul
copy package.json "%OUTDIR%\" >nul
copy package-lock.json "%OUTDIR%\" >nul
copy ecosystem.config.cjs "%OUTDIR%\" >nul
copy src\services\adminServer.js "%OUTDIR%\" >nul
copy .env.example "%OUTDIR%\.env.template" >nul
copy .env "%OUTDIR%\" >nul

echo [3/3] Fix server.js and copy...
node fix-server-import.cjs
if errorlevel 1 ( echo Copy failed! & pause & exit /b 1 )

echo.
echo ============================================
echo   Done!
echo.
echo   Files: %OUTDIR%\
echo.
echo   Upload "%OUTDIR%" to your server, then:
echo   1. npm install --production
echo   2. node server.js
echo.
echo   Main:  https://your-server:3000/
echo   Admin: https://your-server:3000/admin/
echo ============================================
pause
