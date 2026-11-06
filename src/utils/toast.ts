type ToastType = 'success' | 'error' | 'info' | 'warning'
interface ToastItem { id: number; type: ToastType; message: string; duration: number }

let listeners: Array<(items: ToastItem[]) => void> = []
let items: ToastItem[] = []
let nextId = 1

function emit() { for (const l of listeners) l([...items]) }

function push(type: ToastType, message: string, duration = 2400) {
  const id = nextId++
  items = [...items, { id, type, message, duration }]
  emit()
  setTimeout(() => {
    items = items.filter((i) => i.id !== id)
    emit()
  }, duration)
}

export const toast = {
  success: (m: string, d?: number) => push('success', m, d),
  error: (m: string, d?: number) => push('error', m, d),
  info: (m: string, d?: number) => push('info', m, d),
  warning: (m: string, d?: number) => push('warning', m, d),
}

export function useToasts(listener: (items: ToastItem[]) => void) {
  if (!listeners.includes(listener)) listeners.push(listener)
  return () => { listeners = listeners.filter((l) => l !== listener) }
}

export type { ToastItem, ToastType }
