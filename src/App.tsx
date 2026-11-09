import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PackageCheck, UserPlus, FileSpreadsheet, ShieldCheck, Menu, X } from 'lucide-react'
import { useState, useEffect, lazy, Suspense } from 'react'
import { ToastHost } from '@/components/ToastHost'

// 每个页面独立 chunk —— 按需加载，首屏只加载默认路由的代码
const ItemLibrary = lazy(() => import('@/pages/ItemLibrary').then((m) => ({ default: m.ItemLibrary })))
const AgentEnroll = lazy(() => import('@/pages/AgentEnroll').then((m) => ({ default: m.AgentEnroll })))
const Summary = lazy(() => import('@/pages/Summary').then((m) => ({ default: m.Summary })))
const BackupPage = lazy(() => import('@/pages/BackupPage').then((m) => ({ default: m.BackupPage })))

const NAV = [
  { to: '/items', label: '代选单库', icon: PackageCheck, end: false },
  { to: '/agents', label: '代理录入', icon: UserPlus, end: false },
  { to: '/summary', label: '图片订单汇总', icon: FileSpreadsheet, end: false },
  { to: '/backup', label: '数据备份', icon: ShieldCheck, end: true },
]

function PageFallback() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 text-sm py-20">
      <div className="w-8 h-8 rounded-full border-2 border-neutral-200 border-t-neutral-500 animate-spin mb-3" />
      加载中...
    </div>
  )
}

export function App() {
  const loc = useLocation()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 路由切换自动关闭抽屉
  useEffect(() => {
    setDrawerOpen(false)
  }, [loc.pathname])

  return (
    <div className="min-h-full flex">
      {/* ========== 桌面侧边栏（≥md） ========== */}
      <aside className="hidden md:flex w-64 flex-shrink-0 bg-white border-r border-neutral-200 flex-col">
        <NavLink to="/items" end
          className="px-5 py-4 border-b border-neutral-100 hover:bg-neutral-50">
          <div className="text-base font-semibold text-neutral-900">图片代选单</div>
          <div className="text-xs text-neutral-400 mt-0.5">图片 × 人员 · 本地运行</div>
        </NavLink>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map((n) => {
            const Icon = n.icon
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition
                  ${isActive
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-700 hover:bg-neutral-100'}`
                }
              >
                <Icon size={17} />
                <span>{n.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="px-4 py-3 text-[11px] text-neutral-400 border-t border-neutral-100">
          数据存在 IndexedDB · 浏览器关闭后仍保留
        </div>
      </aside>

      {/* ========== 移动端抽屉（小屏时汉堡菜单打开） ========== */}
      {drawerOpen && (
        <>
          {/* 遮罩 */}
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-40"
            onClick={() => setDrawerOpen(false)}
          />
          {/* 抽屉本体 */}
          <aside className="md:hidden fixed top-0 left-0 bottom-0 w-72 bg-white z-50 flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <div>
                <div className="text-base font-semibold text-neutral-900">图片代选单</div>
                <div className="text-xs text-neutral-400 mt-0.5">图片 × 人员 · 本地运行</div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-500"
                aria-label="关闭菜单"
              >
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 p-2 space-y-0.5">
              {NAV.map((n) => {
                const Icon = n.icon
                return (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-3 rounded-lg text-[15px] transition
                      ${isActive
                        ? 'bg-neutral-900 text-white'
                        : 'text-neutral-700 hover:bg-neutral-100'}`
                    }
                  >
                    <Icon size={18} />
                    <span>{n.label}</span>
                  </NavLink>
                )
              })}
            </nav>
            <div className="px-4 py-3 text-[11px] text-neutral-400 border-t border-neutral-100">
              数据存在 IndexedDB · 浏览器关闭后仍保留
            </div>
          </aside>
        </>
      )}

      {/* ========== 主区 ========== */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* —— 移动端顶栏 —— */}
        <header className="md:hidden sticky top-0 z-30 bg-white border-b border-neutral-200 flex items-center gap-2 px-3 py-2.5">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-1 rounded-lg hover:bg-neutral-100 text-neutral-700"
            aria-label="打开菜单"
          >
            <Menu size={22} />
          </button>
          <div className="text-sm font-semibold text-neutral-900">图片代选单</div>
          <div className="flex-1" />
        </header>

        <div
          className="flex-1 overflow-y-auto thin-scroll"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 64px)' }}
        >
          <Suspense fallback={<PageFallback />}>
            <Routes location={loc}>
              <Route index element={<ItemLibrary />} />
              <Route path="/items" element={<ItemLibrary />} />
              <Route path="/agents" element={<AgentEnroll />} />
              <Route path="/summary" element={<Summary />} />
              <Route path="/backup" element={<BackupPage />} />
              <Route path="*" element={<ItemLibrary />} />
            </Routes>
          </Suspense>
        </div>

        {/* —— 移动端底部 Tabbar —— */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-neutral-200"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="grid grid-cols-4">
            {NAV.map((n) => {
              const Icon = n.icon
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => navigate(n.to)}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] transition
                    ${isActive
                      ? 'text-neutral-900'
                      : 'text-neutral-400'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                      <span className="mt-0.5 leading-none">{n.label}</span>
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        </nav>
      </main>

      <ToastHost />
    </div>
  )
}
