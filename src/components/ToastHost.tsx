import { useEffect, useState } from 'react'
import { toast, useToasts, type ToastItem } from '@/utils/toast'

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => useToasts(setItems), [])

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-md bg-white fade-in
            ${t.type === 'error' ? 'border-red-200 text-red-700' : ''}
            ${t.type === 'success' ? 'border-emerald-200 text-emerald-700' : ''}
            ${t.type === 'warning' ? 'border-amber-200 text-amber-700' : ''}
            ${t.type === 'info' ? 'border-slate-200 text-slate-700' : ''}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

export { toast }
