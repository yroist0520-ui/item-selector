@echo off
REM ============================================
REM  🚀 item-selector 一键推送到 GitHub + 开 Pages
REM  运行环境：Windows（Mac/Linux 看同目录下 本地推送.sh）
REM ============================================

chcp 65001 >nul
echo ==========================================
echo   图片代选单管理 - GitHub Pages 部署脚本
echo ==========================================
echo.

REM 1. 进入脚本所在目录
cd /d "%~dp0"
echo ✅ 项目目录: %CD%

REM 2. 检查 git
where git >nul 2>&1
if %errorlevel% neq 0 (
  echo ❌ 没装 git！去 https://git-scm.com/ 下载安装
  pause & exit /b 1
)
echo ✅ git 已安装

REM 3. 检查 node
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ℹ️ 没装 node，去 https://nodejs.org/ 下载 LTS 版
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo ✅ Node.js %%v

REM 4. 构建
echo.
echo 📦 构建项目...
if not exist "node_modules" (
  echo    首次运行，安装依赖中（2-3 分钟）...
  call npm install
)
call npm run build

REM 5. 复制到 docs
echo.
echo ✅ 更新 docs/...
if exist "docs" rmdir /s /q docs
mkdir docs
xcopy /e /y /q dist\* docs\ >nul
type nul > docs\.nojekyll
copy docs\index.html docs\404.html >nul
echo ✅ docs/ 已更新

REM 6. 提交
git add docs\
git diff --cached --quiet
if errorlevel 1 (
  for /f "tokens=2 delims==" %%d in ('wmic os get localdatetime ^| find "."') do set DATETIME=%%d
  git commit -m "build: 更新 GitHub Pages 构建产物"
  echo ✅ 已提交
)

REM 7. GitHub remote
git remote | findstr /x "github" >nul 2>&1
if errorlevel 1 (
  git remote add github https://github.com/Yroist/item-selector.git
  echo ✅ 新增 GitHub remote
)

REM 8. 推送
echo.
echo 🚀 推送中...
git push -u github master
if errorlevel 1 (
  echo.
  echo ❌ 推送失败。可能原因：
  echo    1. 没登录 GitHub → 跑：gh auth login
  echo    2. 仓库不存在 → 先去 github.com/new 创建空仓库 item-selector
  echo    3. 网络问题 → 检查 VPN
  pause & exit /b 1
)

echo.
echo 🎉 推送成功！
echo.
echo ==========================================
echo   下一步：开 GitHub Pages（网页 3 次点击）
echo ==========================================
echo.
echo 1. 打开: https://github.com/Yroist/item-selector/settings/pages
echo 2. Source: Deploy from a branch
echo 3. Branch: master - docs
echo 4. 点 Save
echo.
echo 等 ~1 分钟，公网 URL:
echo    https://yroist.github.io/item-selector/
echo.
echo 手机打开就能用了！
echo ==========================================
pause
