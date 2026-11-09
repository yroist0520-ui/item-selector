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

// 硬编码 basename：生产环境部署到 GitHub Pages 子路径 /item-selector/
// 本地 dev server 和其他部署（根路径）用 "/"
const basename: string = import.meta.env.DEV
  ? '/'
  : '/item-selector'
console.info('[Router] basename:', basename, 'dev:', import.meta.env.DEV, 'path:', window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
