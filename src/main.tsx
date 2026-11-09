import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './index.css'

// polyfill：某些运行时环境（puppeteer、旧浏览器）缺少 crypto.randomUUID
if (typeof globalThis.crypto !== 'undefined' && !(globalThis.crypto as any).randomUUID) {
  (globalThis.crypto as any).randomUUID = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
}

// 动态 basename 检测
// GitHub Pages 子路径部署：https://<user>.github.io/<repo>/items → basename="/<repo>"
// 本地 dev / 根域名部署：https://localhost:5173/items → basename="/"
function detectBasename(): string {
  const path = window.location.pathname
  const segments = path.split('/').filter(Boolean)
  // 已知的路由段（App.tsx 里定义的）
  const KNOWN = new Set(['items', 'agents', 'summary', 'backup', 'assets'])
  if (segments.length > 0 && !KNOWN.has(segments[0])) {
    return '/' + segments[0]
  }
  return '/'
}

const basename = detectBasename()
console.info('[Router] basename:', basename, 'pathname:', window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
