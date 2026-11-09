import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Image as ImageIcon, Upload, Edit2, Trash2, Search, ImageOff,
  Plus, Tag, FolderOpen,
} from 'lucide-react'
import { db, addItem, updateItem, deleteItem, setItemCategory, addCategory, deleteCategory, renameCategory, type Item, type Category } from '@/db'
import { toast } from '@/utils/toast'
import { Modal } from '@/components/Modal'

/** 虚拟分类：全部 / 未分类 */
const VIRTUAL_ALL = '__all__'
const VIRTUAL_NONE = '__none__'
const VIRTUALS: { id: string; name: string }[] = [
  { id: VIRTUAL_ALL, name: '全部' },
  { id: VIRTUAL_NONE, name: '未分类' },
]

export function ItemLibrary() {
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray()) ?? []
  const categories = useLiveQuery(() => db.categories.orderBy('order').toArray()) ?? []

  const [activeCat, setActiveCat] = useState<string>(VIRTUAL_ALL)
  const [search, setSearch] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const globalInputRef = useRef<HTMLInputElement | null>(null)

  // 编辑 / 删除 / 移动分类
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null)

  // 创建 / 编辑 / 删除分类
  const [showCreateCat, setShowCreateCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [renameCat, setRenameCat] = useState<{ id: string; name: string } | null>(null)
  const [confirmDelCat, setConfirmDelCat] = useState<Category | null>(null)

  const allCats = useMemo(
    () => [...VIRTUALS, ...categories],
    [categories],
  )

  const filtered = useMemo(() => {
    let list: Item[] = items
    if (activeCat === VIRTUAL_NONE) {
      list = list.filter((i) => !i.categoryId)
    } else if (activeCat !== VIRTUAL_ALL) {
      list = list.filter((i) => i.categoryId === activeCat)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((i) => i.name.toLowerCase().includes(q))
    }
    return list
  }, [items, activeCat, search])

  async function addFiles(files: FileList | File[]) {
    const ALLOWED = new Set(['jpeg', 'jpg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp'])
    const list = Array.from(files).filter((f) => {
      const type = f.type.replace('image/', '').toLowerCase()
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return f.type.startsWith('image/') || ALLOWED.has(type) || ALLOWED.has(ext)
    })
    if (list.length === 0) {
      toast.error('没有可上传的图片（支持 JPG/PNG/WEBP/HEIC/GIF/BMP）')
      return
    }
    // 上传到当前分类（"全部" 时 = 未分类）
    const catId = activeCat !== VIRTUAL_ALL && activeCat !== VIRTUAL_NONE ? activeCat : null

    const settled = await Promise.allSettled(
      list.map(async (f) => {
        try {
          await addItem(f.name.replace(/\.[^.]+$/, '') || '未命名', f, catId)
          return { ok: true as const }
        } catch (e) {
          return { ok: false as const, err: e instanceof Error ? e.message : String(e), name: f.name }
        }
      }),
    )
    const results = settled.map((r) =>
      r.status === 'fulfilled' ? r.value : { ok: false as const, err: 'unknown', name: '' },
    )
    const ok = results.filter((r) => r.ok).length
    const fails = results.filter(
      (r): r is Extract<typeof results[number], { ok: false }> => !r.ok,
    )
    if (fails.length === 0) {
      toast.success(`已添加 ${ok} 张图片`)
    } else {
      toast.error(
        `添加 ${ok} 张成功，${fails.length} 张失败：${fails[0].name || 'unknown'}（${fails[0].err.slice(0, 80)}）`,
      )
    }
  }

  async function confirmRename() {
    if (!editingId) return
    const n = editingName.trim() || '未命名'
    await updateItem(editingId, { name: n })
    setEditingId(null)
    toast.success('已更新名称')
  }

  async function confirmDelete() {
    if (!confirmDelId) return
    const selCount = await deleteItem(confirmDelId)
    setConfirmDelId(null)
    toast.success(selCount > 0 ? `已删除（同时清除 ${selCount} 条选择关系）` : '已删除')
  }

  async function confirmMove(targetCatId: string | null) {
    if (!moveTargetId) return
    await setItemCategory(moveTargetId, targetCatId)
    const catName = targetCatId
      ? categories.find((c) => c.id === targetCatId)?.name
      : '未分类'
    setMoveTargetId(null)
    toast.success(`已移动到「${catName ?? '未分类'}」`)
  }

  async function confirmCreateCat() {
    const n = newCatName.trim()
    if (!n) { toast.error('请输入分类名'); return }
    await addCategory(n)
    setNewCatName(''); setShowCreateCat(false)
    toast.success('分类已创建')
  }

  async function confirmDeleteCat() {
    if (!confirmDelCat) return
    const moved = await deleteCategory(confirmDelCat.id)
    if (activeCat === confirmDelCat.id) setActiveCat(VIRTUAL_ALL)
    setConfirmDelCat(null)
    toast.success(`已删除分类，${moved} 张图片移入「未分类」`)
  }

  // 计数
  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) {
      const key = it.categoryId ?? VIRTUAL_NONE
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [items])

  return (
    <div className="p-4 md:p-8 h-full flex flex-col gap-3 md:gap-5">
      {/* —— 顶部操作栏 —— */}
      <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3">
        <div className="md:flex-1 md:min-w-0">
          <h1 className="text-lg md:text-2xl font-semibold">代选单库</h1>
          <p className="text-xs md:text-sm text-neutral-500 mt-0.5 md:mt-1">
            上传图片建立代选单库 · 共 {items.length} 张
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-2 md:gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="按名称搜索"
              className="w-full md:w-56 h-11 md:h-9 pl-9 pr-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
            />
          </div>
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
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files ?? [])}
        />
      </div>

      {/* —— 分类标签栏 —— */}
      <div className="flex items-center gap-2 -mx-1 px-1 overflow-x-auto thin-scroll pb-1">
        {allCats.map((c) => {
          const count = catCounts.get(c.id) ?? 0
          const active = activeCat === c.id
          const isVirtual = c.id === VIRTUAL_ALL || c.id === VIRTUAL_NONE
          return (
            <div key={c.id} className="flex items-center flex-shrink-0">
              <button
                onClick={() => setActiveCat(c.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition
                  ${active
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'}`}
              >
                {!isVirtual && <Tag size={12} />}
                {c.id === VIRTUAL_ALL && <FolderOpen size={12} />}
                <span>{c.name}</span>
                <span className={`text-[11px] ${active ? 'text-neutral-300' : 'text-neutral-400'}`}>·{count}</span>
              </button>
              {!isVirtual && active && (
                <button
                  onClick={() => setRenameCat({ id: c.id, name: c.name })}
                  className="ml-1 p-1 rounded text-neutral-400 hover:text-neutral-700"
                  title="重命名分类"
                ><Edit2 size={12} /></button>
              )}
              {!isVirtual && active && (
                <button
                  onClick={() => setConfirmDelCat(c as Category)}
                  className="p-1 rounded text-neutral-400 hover:text-red-500"
                  title="删除分类"
                ><Trash2 size={12} /></button>
              )}
            </div>
          )
        })}
        <button
          onClick={() => setShowCreateCat(true)}
          className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm border border-dashed border-neutral-300 text-neutral-500 hover:border-neutral-500 hover:text-neutral-700 transition"
        >
          <Plus size={12} /> 分类
        </button>
      </div>

      {/* —— 图片网格 / 空态 —— */}
      {filtered.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files ?? []) }}
          className={`flex-1 rounded-2xl border-2 border-dashed py-16 md:py-24 flex flex-col items-center text-center transition bg-white
            ${dragOver ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}
        >
          <div className="h-14 w-14 md:h-16 md:w-16 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 mb-3">
            <ImageIcon size={26} />
          </div>
          <div className="text-base md:text-lg font-medium">
            {items.length === 0 ? '拖拽图片到这里' : '该分类暂无图片'}
          </div>
          {items.length === 0 && (
            <div className="text-sm text-neutral-500 mt-1">支持 JPG / PNG / WEBP / HEIC / GIF / BMP</div>
          )}
          <button
            onClick={() => globalInputRef.current?.click()}
            className="mt-5 h-11 md:h-10 px-6 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 flex items-center gap-1.5"
          >
            <Upload size={15} /> {items.length === 0 ? '或点击上传' : '上传到该分类'}
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files ?? []) }}
          className={`flex-1 overflow-y-auto thin-scroll rounded-xl bg-white border border-neutral-200 p-3 md:p-4 transition
            ${dragOver ? 'border-neutral-900 bg-neutral-50' : ''}`}
        >
          <div className="grid gap-2 md:gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                onEdit={() => { setEditingId(it.id); setEditingName(it.name) }}
                onDelete={() => setConfirmDelId(it.id)}
                onMove={() => setMoveTargetId(it.id)}
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

      {/* 删除图片 */}
      <Modal open={!!confirmDelId} onClose={() => setConfirmDelId(null)} title="确认删除？"
        footer={
          <>
            <button onClick={() => setConfirmDelId(null)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button onClick={confirmDelete} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700">确认删除</button>
          </>
        }>
        <p className="text-sm text-neutral-700">该图片及其所有选择关系将一并删除。此操作无法撤销。</p>
      </Modal>

      {/* 移动到分类 */}
      <Modal open={!!moveTargetId} onClose={() => setMoveTargetId(null)} title="移动到分类"
        footer={
          <button onClick={() => setMoveTargetId(null)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
        }>
        <div className="space-y-2">
          {categories.length === 0 && (
            <div className="text-sm text-neutral-400 text-center py-4">还没有任何分类，点「+ 分类」创建</div>
          )}
          <button
            onClick={() => confirmMove(null)}
            className="w-full px-3 py-2.5 rounded-lg border border-neutral-200 hover:border-neutral-400 text-sm text-left flex items-center gap-2"
          >
            <FolderOpen size={14} className="text-neutral-400" /> 未分类
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => confirmMove(c.id)}
              className="w-full px-3 py-2.5 rounded-lg border border-neutral-200 hover:border-neutral-400 text-sm text-left flex items-center gap-2"
            >
              <Tag size={14} className="text-neutral-400" /> {c.name}
            </button>
          ))}
        </div>
      </Modal>

      {/* 创建分类 */}
      <Modal open={showCreateCat} onClose={() => setShowCreateCat(false)} title="创建分类"
        footer={
          <>
            <button onClick={() => setShowCreateCat(false)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button onClick={confirmCreateCat} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800">创建</button>
          </>
        }>
        <input
          autoFocus
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          placeholder="例如：头像款"
          className="w-full h-11 md:h-10 px-3 rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400"
        />
      </Modal>

      {/* 重命名分类 */}
      <Modal open={!!renameCat} onClose={() => setRenameCat(null)} title="重命名分类"
        footer={
          <>
            <button onClick={() => setRenameCat(null)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button
              disabled={!renameCat?.name.trim()}
              onClick={async () => {
                if (!renameCat) return
                await renameCategory(renameCat.id, renameCat.name.trim())
                setRenameCat(null); toast.success('已重命名')
              }}
              className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-40"
            >保存</button>
          </>
        }>
        {renameCat && (
          <input
            value={renameCat.name}
            onChange={(e) => setRenameCat({ ...renameCat, name: e.target.value })}
            className="w-full h-11 md:h-10 px-3 rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400"
          />
        )}
      </Modal>

      {/* 删除分类 */}
      <Modal open={!!confirmDelCat} onClose={() => setConfirmDelCat(null)} title="删除分类？"
        footer={
          <>
            <button onClick={() => setConfirmDelCat(null)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button onClick={confirmDeleteCat} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700">确认删除</button>
          </>
        }>
        {confirmDelCat && (
          <p className="text-sm text-neutral-700">
            分类「<strong>{confirmDelCat.name}</strong>」会被删除，里面的图片会自动移入「<strong>未分类</strong>」。
          </p>
        )}
      </Modal>
    </div>
  )
}

/** 卡片组件 */
function ItemCard({
  item, onEdit, onDelete, onMove,
}: {
  item: Item
  onEdit: () => void
  onDelete: () => void
  onMove: () => void
}) {
  const [catName, setCatName] = useState<string | null>(null)
  useEffect(() => {
    if (item.categoryId) {
      db.categories.get(item.categoryId).then((c) => setCatName(c?.name ?? null))
    } else {
      setCatName(null)
    }
  }, [item.categoryId])

  return (
    <div className="group rounded-lg border border-neutral-200 overflow-hidden hover:border-neutral-300 bg-white">
      <div className="aspect-square bg-neutral-50 relative">
        <ImageFromBlob blob={item.blob} />
        {/* 替换按钮：手机上始终可见，桌面 hover 显示 */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-1.5 md:p-2 flex gap-1 justify-end opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
          <button
            onClick={onMove}
            className="px-2 py-1 md:px-1.5 md:py-0.5 rounded bg-white/85 hover:bg-white text-neutral-700 text-xs md:text-[11px] font-medium"
            title="移动到分类"
          >移动</button>
        </div>
        {catName && (
          <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2 bg-black/60 text-white text-[10px] md:text-[11px] px-1.5 py-0.5 rounded">
            {catName}
          </div>
        )}
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
