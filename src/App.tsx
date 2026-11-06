import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { PackageCheck, UserPlus, FileSpreadsheet, ShieldCheck } from 'lucide-react'
import { ItemLibrary } from '@/pages/ItemLibrary'
import { AgentEnroll } from '@/pages/AgentEnroll'
import { Summary } from '@/pages/Summary'
import { BackupPage } from '@/pages/BackupPage'
import { ToastHost } from '@/components/ToastHost'

const NAV = [
  { to: '/items', label: '代选单库', icon: PackageCheck, end: false },
  { to: '/agents', label: '代理录入', icon: UserPlus, end: false },
  { to: '/summary', label: '图片订单汇总', icon: FileSpreadsheet, end: false },
  { to: '/backup', label: '数据备份', icon: ShieldCheck, end: true },
]

export function App() {
  const loc = useLocation()
  const navigate = useNavigate()

  return (
    <div className="min-h-full flex">
      {/* 侧边栏 */}
      <aside className="w-60 flex-shrink-0 bg-white border-r border-neutral-200 flex flex-col">
        <Link to="/items" className="px-5 py-4 border-b border-neutral-100">
          <div className="text-base font-semibold text-neutral-900">图片代选单</div>
          <div className="text-xs text-neutral-400 mt-0.5">图片 × 人员 · 本地运行</div>
        </Link>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map((n) => {
            const Icon = n.icon
            return (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(n.to)
                }}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition
                  ${isActive
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-700 hover:bg-neutral-100'}`
                }
              >
                <Icon size={16} />
                <span>{n.label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className="px-4 py-3 text-[11px] text-neutral-400 border-t border-neutral-100">
          数据存在 IndexedDB · 浏览器关闭后仍保留
        </div>
      </aside>

      {/* 主区 */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto thin-scroll">
          <Routes location={loc}>
            <Route index element={<ItemLibrary />} />
            <Route path="/items" element={<ItemLibrary />} />
            <Route path="/agents" element={<AgentEnroll />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route path="*" element={<ItemLibrary />} />
          </Routes>
        </div>
      </main>

      <ToastHost />
    </div>
  )
}
