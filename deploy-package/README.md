# item-selector · Vercel 部署包

## 部署步骤（30 秒）
1. 打开 https://vercel.com/new
2. 点击 **Continue** 或 **Upload**（取决于是否登录）
3. 选择本 deploy-package 文件夹，拖拽上传
4. Framework Preset 选择 **Vite**（已自动识别）
5. Build Command 填 `npm run build`（或跳过，本包已构建）
6. Output Directory 填 `dist`
7. 点击 Deploy → 等待 30 秒 → 拿到正式 URL

## 也可以直接上传 dist.zip（不含源码）
如果 Vercel 不支持直接传文件夹，上传 dist.zip 也行——Vercel 会自动识别纯静态产物。
