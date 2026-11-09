#!/bin/bash
# ============================================
# 🚀 item-selector 一键推送到 GitHub + 开 Pages
# 运行环境：Mac / Linux（Windows 看同目录下 push-github.bat）
# ============================================

set -e

echo "========================================="
echo "  图片代选单管理 → GitHub Pages 部署脚本"
echo "========================================="
echo ""

# 1. 检查必要工具
for tool in git; do
  if ! command -v $tool &>/dev/null; then
    echo "❌ 缺少 $tool，请先安装：brew install git"
    exit 1
  fi
done

echo "✅ git 已安装"

# 2. 进入项目目录
cd "$(dirname "$0")"
echo "✅ 项目目录: $(pwd)"

# 3. 检查 .git
if [ ! -d ".git" ]; then
  echo "❌ 这不是 git 仓库！请解压完整 tar.gz 包"
  exit 1
fi

echo "✅ git 仓库确认"

# 4. 检查源码
if [ ! -f "src/App.tsx" ] || [ ! -f "vite.config.ts" ]; then
  echo "❌ 源码不完整！请使用完整打包"
  exit 1
fi

echo "✅ 源码完整"

# 5. 检查/安装 node
if ! command -v node &>/dev/null; then
  echo "ℹ️ 未检测到 node，尝试安装..."
  if command -v brew &>/dev/null; then
    brew install node
  else
    echo "❌ 请先装 Node.js：https://nodejs.org/"
    exit 1
  fi
fi

NODE_VER=$(node --version)
echo "✅ Node.js $NODE_VER"

# 6. 安装依赖 + 构建
echo ""
echo "📦 构建项目..."
if [ ! -d "node_modules" ]; then
  echo "   首次运行，安装依赖中（2-3 分钟）..."
  npm install
fi

npm run build

# 7. 把 dist 复制到 docs（GitHub Pages 用 master/docs）
rm -rf docs/* docs/.nojekyll 2>/dev/null
cp -r dist/* docs/
touch docs/.nojekyll
cp docs/index.html docs/404.html   # SPA fallback
echo "✅ docs/ 已更新为最新构建产物"

# 8. 提交改动
git add docs/
if ! git diff --cached --quiet 2>/dev/null; then
  git commit -m "build: 更新 GitHub Pages 构建产物 $(date +%Y-%m-%d_%H-%M)"
  echo "✅ 已提交到本地"
fi

# 9. GitHub remote
REMOTE_NAME="github"
GITHUB_URL="https://github.com/Yroist/item-selector.git"

if git remote | grep -q "^${REMOTE_NAME}$"; then
  CURRENT_URL=$(git remote get-url "$REMOTE_NAME")
  if [ "$CURRENT_URL" != "$GITHUB_URL" ]; then
    git remote set-url "$REMOTE_NAME" "$GITHUB_URL"
  fi
  echo "✅ GitHub remote: $GITHUB_URL"
else
  git remote add "$REMOTE_NAME" "$GITHUB_URL"
  echo "✅ 新增 GitHub remote: $GITHUB_URL"
fi

# 10. 推送！
echo ""
echo "🚀 推送中..."
echo "   （第一次推送会弹出浏览器让你授权 GitHub）"
git push -u "$REMOTE_NAME" master 2>&1 || {
  echo ""
  echo "❌ 推送失败。可能的原因："
  echo "   1. 还没登录 GitHub → 终端跑：gh auth login"
  echo "   2. 仓库不存在 → 先在 github.com/new 创建空仓库 item-selector"
  echo "   3. 网络问题 → 检查 VPN"
  exit 1
}

echo ""
echo "🎉 推送成功！"
echo ""

# 11. 提示开 Pages
echo "========================================="
echo "  下一步：开 GitHub Pages（网页操作，3 次点击）"
echo "========================================="
echo ""
echo "1. 打开：https://github.com/Yroist/item-selector/settings/pages"
echo "2. Source 选：Deploy from a branch"
echo "3. Branch 选：master → /docs"
echo "4. 点 Save"
echo ""
echo "等 ~1 分钟，页面顶部会出现公网 URL："
echo "   ✅ https://yroist.github.io/item-selector/"
echo ""
echo "手机浏览器打开那个 URL 就能用了！"
echo "========================================="
