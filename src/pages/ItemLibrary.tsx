import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Image as ImageIcon, Upload, Edit2, Trash2, Search, ImageOff } from 'lucide-react'
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
    <div className="p-4 md:p-8 h-full flex flex-col gap-3 md:gap-5">
      {/* —— 顶部操作栏 —— */}
      <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3">
        <div className="md:flex-1 md:min-w-0">
          <h1 className="text-lg md:text-2xl font-semibold">代选单库</h1>
          <p className="text-xs md:text-sm text-neutral-500 mt-0.5 md:mt-1">
            上传图片建立代选单库 · 共 {items?.length ?? 0} 张
          </p>
        </div>

        {/* 手机上全宽堆叠，桌面横排 */}
        <div className="flex flex-col md:flex-row gap-2 md:gap-3">
          {/* 搜索 */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="按名称搜索"
              className="w-full md:w-56 h-11 md:h-9 pl-9 pr-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
            />
          </div>
          {/* 上传 */}
          <button
            onClick={() => globalInputRef.current?.click()}
            className="h-11 md:h-9 px-4 rounded-lg md:rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 flex items-center justify-center gap-1.5"
          >
            <Upload size={15} /> 上传图片
          </button>
        </div>

        <input
          ref={globalInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files ?? [])}
        />
      </div>

      {/* —— 空态 / 拖拽 —— */}
      {items && items.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            addFiles(e.dataTransfer.files ?? [])
          }}
          className={`flex-1 rounded-2xl border-2 border-dashed py-16 md:py-24 flex flex-col items-center text-center transition bg-white
            ${dragOver ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}
        >
          <div className="h-14 w-14 md:h-16 md:w-16 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 mb-3">
            <ImageIcon size={26} />
          </div>
          <div className="text-base md:text-lg font-medium">拖拽图片到这里</div>
          <div className="text-sm text-neutral-500 mt-1">支持 JPG / PNG / WEBP，可批量添加</div>
          <button
            onClick={() => globalInputRef.current?.click()}
            className="mt-5 h-11 md:h-10 px-6 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 flex items-center gap-1.5"
          >
            <Upload size={15} /> 或点击上传
          </button>
        </div>
      ) : (
        /* —— 图片网格 —— */
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files ?? []) }}
          className={`flex-1 overflow-y-auto thin-scroll rounded-xl bg-white border border-neutral-200 p-3 md:p-4 transition
            ${dragOver ? 'border-neutral-900 bg-neutral-50' : ''}`}
        >
          <div className="grid gap-2 md:gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filter.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                onEdit={() => { setEditingId(it.id); setEditingName(it.name) }}
                onReplace={() => { setReplacingId(it.id); setReplaceFile(null) }}
                onDelete={() => setConfirmDelId(it.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 编辑名称 */}
      <Modal open={!!editingId} onClose={() => setEditingId(null)} title="编辑名称"
        footer={
          <>
            <button onClick={() => setEditingId(null)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button onClick={confirmRename} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800">保存</button>
          </>
        }>
        <input
          autoFocus
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          className="w-full h-11 md:h-10 px-3 rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400"
        />
      </Modal>

      {/* 替换图片 */}
      <Modal open={!!replacingId} onClose={() => { setReplacingId(null); setReplaceFile(null) }} title="替换图片"
        footer={
          <>
            <button onClick={() => { setReplacingId(null); setReplaceFile(null) }} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button
              disabled={!replaceFile}
              onClick={confirmReplace}
              className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-40"
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

/** 卡片组件（拆分出来方便改） */
function ItemCard({
  item, onEdit, onReplace, onDelete,
}: {
  item: { id: string; name: string; blob: Blob }
  onEdit: () => void
  onReplace: () => void
  onDelete: () => void
}) {
  return (
    <div className="group rounded-lg border border-neutral-200 overflow-hidden hover:border-neutral-300 bg-white">
      <div className="aspect-square bg-neutral-50 relative">
        <ImageFromBlob blob={item.blob} />
        {/* 替换按钮：手机上始终可见，桌面 hover 显示 */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-1.5 md:p-2 flex gap-1 justify-end opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
          <button
            onClick={onReplace}
            className="px-2 py-1 md:px-1.5 md:py-0.5 rounded bg-white/85 hover:bg-white text-neutral-700 text-xs md:text-[11px] font-medium"
            title="替换图片"
          >替换</button>
        </div>
      </div>
      {/* 底部：名称 + 操作 */}
      <div className="p-1.5 md:p-2 flex items-center gap-0.5 md:gap-1">
        <div className="flex-1 min-w-0 text-[12px] md:text-xs text-neutral-800 truncate" title={item.name}>{item.name}</div>
        <button
          onClick={onEdit}
          className="p-1.5 md:p-1 rounded hover:bg-neutral-100 text-neutral-500"
          aria-label="编辑名称"
        ><Edit2 size={14} /></button>
        <button
          onClick={onDelete}
          className="p-1.5 md:p-1 rounded hover:bg-red-50 text-red-500"
          aria-label="删除"
        ><Trash2 size={14} /></button>
      </div>
    </div>
  )
}

function ConfirmDelete({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} title="确认删除？"
      footer={
        <>
          <button onClick={onCancel} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
          <button onClick={onConfirm} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700">确认删除</button>
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
      loading="lazy"
    />
  )
}
