import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Image as ImageIcon, Upload, Edit2, Trash2, Search, Check, X, ImageOff } from 'lucide-react'
import { db, addItem, updateItem, deleteItem } from '@/db'
import { toast } from '@/utils/toast'
import { Modal } from '@/components/Modal'

export function ItemLibrary() {
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray())
  const [dragOver, setDragOver] = useState(false)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [replacingId, setReplacingId] = useState<string | null>(null)
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const globalInputRef = useRef<HTMLInputElement | null>(null)

  const filter = (items ?? []).filter((i) =>
    !search.trim() ? true : i.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (list.length === 0) return
    const results = await Promise.allSettled(
      list.map((f) => addItem(f.name.replace(/\.[^.]+$/, '') || '未命名', f)),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const fail = results.length - ok
    toast.success(`已添加 ${ok} 张图片${fail ? ` · ${fail} 张失败` : ''}`)
  }

  async function confirmRename() {
    if (!editingId) return
    const n = editingName.trim() || '未命名'
    await updateItem(editingId, { name: n })
    setEditingId(null)
    toast.success('已更新名称')
  }

  async function confirmReplace() {
    if (!replacingId || !replaceFile) return
    await updateItem(replacingId, { blob: replaceFile })
    setReplacingId(null); setReplaceFile(null)
    toast.success('图片已替换')
  }

  async function confirmDelete() {
    if (!confirmDelId) return
    const selCount = await deleteItem(confirmDelId)
    setConfirmDelId(null)
    toast.success(selCount > 0 ? `已删除（同时清除 ${selCount} 条选择关系）` : '已删除')
  }

  return (
    <div className="p-5 md:p-8 h-full flex flex-col">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold">代选单库</h1>
          <p className="text-sm text-neutral-500 mt-1">
            上传图片建立代选单库 · 共 {items?.length ?? 0} 张
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按名称搜索"
            className="h-9 pl-8 pr-3 rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 w-56"
          />
        </div>
        <button
          onClick={() => globalInputRef.current?.click()}
          className="h-9 px-4 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 flex items-center gap-1.5"
        >
          <Upload size={14} /> 上传图片
        </button>
        <input
          ref={globalInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files ?? [])}
        />
      </div>

      {/* 空态 / 拖拽 */}
      {items && items.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            addFiles(e.dataTransfer.files ?? [])
          }}
          className={`rounded-2xl border-2 border-dashed py-24 flex flex-col items-center text-center transition bg-white
            ${dragOver ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}
        >
          <div className="h-14 w-14 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 mb-3">
            <ImageIcon size={24} />
          </div>
          <div className="text-base font-medium">拖拽图片到这里</div>
          <div className="text-sm text-neutral-500 mt-1">支持 JPG / PNG / WEBP，可批量添加</div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files ?? []) }}
          className="flex-1 overflow-y-auto thin-scroll rounded-xl bg-white border border-neutral-200 p-4"
        >
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filter.map((it) => (
              <div
                key={it.id}
                className="group rounded-lg border border-neutral-200 overflow-hidden hover:border-neutral-300 bg-white"
              >
                <div className="aspect-square bg-neutral-50 relative">
                  <ImageFromBlob blob={it.blob} />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-2 text-[11px] text-white opacity-0 group-hover:opacity-100 flex gap-1 justify-end transition">
                    <button
                      onClick={() => { setReplacingId(it.id); setReplaceFile(null) }}
                      className="px-1.5 py-0.5 rounded bg-white/80 hover:bg-white text-neutral-700"
                      title="替换图片"
                    >替换</button>
                  </div>
                </div>
                <div className="p-2 flex items-center gap-1">
                  <div className="flex-1 min-w-0 text-xs text-neutral-800 truncate" title={it.name}>{it.name}</div>
                  <button
                    onClick={() => { setEditingId(it.id); setEditingName(it.name) }}
                    className="p-1 rounded hover:bg-neutral-100 text-neutral-500"
                    title="编辑名称"
                  ><Edit2 size={12} /></button>
                  <button
                    onClick={() => setConfirmDelId(it.id)}
                    className="p-1 rounded hover:bg-red-50 text-red-500"
                    title="删除"
                  ><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 编辑名称 */}
      <Modal open={!!editingId} onClose={() => setEditingId(null)} title="编辑名称"
        footer={
          <>
            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button onClick={confirmRename} className="px-3 py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800">保存</button>
          </>
        }>
        <input
          autoFocus
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400"
        />
      </Modal>

      {/* 替换图片 */}
      <Modal open={!!replacingId} onClose={() => { setReplacingId(null); setReplaceFile(null) }} title="替换图片"
        footer={
          <>
            <button onClick={() => { setReplacingId(null); setReplaceFile(null) }} className="px-3 py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button
              disabled={!replaceFile}
              onClick={confirmReplace}
              className="px-3 py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-40"
            >保存</button>
          </>
        }>
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </Modal>

      {/* 二次确认删除 */}
      <ConfirmDelete open={!!confirmDelId} onCancel={() => setConfirmDelId(null)} onConfirm={confirmDelete} />
    </div>
  )
}

function ConfirmDelete({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} title="确认删除？"
      footer={
        <>
          <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
          <button onClick={onConfirm} className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700">确认删除</button>
        </>
      }>
      <p className="text-sm text-neutral-700">
        该图片及其所有选择关系将一并删除。此操作无法撤销。
      </p>
    </Modal>
  )
}

/** 用 Blob 渲染图片，自动 revoke */
function ImageFromBlob({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u); setErr(false)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  if (err || !url) return <ImageOff size={24} className="absolute inset-0 m-auto text-neutral-300" />
  return (
    <img
      src={url}
      alt=""
      onError={() => setErr(true)}
      className="w-full h-full object-cover"
    />
  )
}
