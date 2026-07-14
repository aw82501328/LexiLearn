@echo off
chcp 65001 >nul
echo ============================================
echo   LexiLearn 生产环境打包脚本
echo ============================================
echo.

set "DEPLOY_DIR=deploy-package"

echo [1/3] 安装依赖...
call npm install --silent
echo.

echo [2/3] 构建前端...
call npm run build
if errorlevel 1 (
    echo ❌ 构建失败，请检查错误信息
    pause
    exit /b 1
)
echo ✅ 构建完成
echo.

echo [3/3] 打包部署文件...
if exist "%DEPLOY_DIR%" rmdir /s /q "%DEPLOY_DIR%"
mkdir "%DEPLOY_DIR%"

REM 复制 dist/
xcopy /e /i /q dist "%DEPLOY_DIR%\dist" >nul

REM 复制服务端文件
copy server.js "%DEPLOY_DIR%\" >nul
copy package.json "%DEPLOY_DIR%\" >nul
copy package-lock.json "%DEPLOY_DIR%\" >nul
copy ecosystem.config.cjs "%DEPLOY_DIR%\" >nul

REM 复制 .env.example 为模板（不含真实密钥）
copy .env.example "%DEPLOY_DIR%\.env.template" >nul

echo.
echo ============================================
echo   ✅ 打包完成！
echo.
echo   部署文件在: %DEPLOY_DIR%\
echo.
echo   ── 部署步骤 ──
echo.
echo   1. 将 %DEPLOY_DIR% 整个文件夹上传到服务器
echo   2. 在服务器上创建 .env 文件（参考 .env.template）
echo   3. 服务器上执行：
echo      cd 部署目录
echo      npm install --production
echo      node server.js
echo.
echo   默认端口: 3000（可通过 .env 中 PORT 修改）
echo   数据目录: /root/eldata（可通过 .env 中 DATA_DIR 修改）
echo.
echo   管理后台访问: http://你的服务器:3000/admin/
echo   主应用访问:   http://你的服务器:3000/
echo ============================================

pause
