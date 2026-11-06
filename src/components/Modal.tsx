import { ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-md',
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 fade-in">
      <div className={`bg-white rounded-xl shadow-2xl w-full ${width} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100">
          <h2 className="font-semibold text-neutral-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-neutral-100 text-neutral-500">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll p-5">{children}</div>
        {footer && <div className="border-t border-neutral-100 px-5 py-3 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
