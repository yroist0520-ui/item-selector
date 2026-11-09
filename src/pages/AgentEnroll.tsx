import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  UserPlus, Users, Search, Trash2, Check, CheckCircle,
  ChevronLeft, ChevronRight, FileText, Pencil, X, ImageOff, Sparkles,
} from 'lucide-react'
import { db, genId, addPerson, deletePerson, selectItem, unselectItem, renamePerson, type Item } from '@/db'
import { toast } from '@/utils/toast'
import { Modal } from '@/components/Modal'

type Mode = 'single' | 'batch' | 'manage'

/** 批量粘贴文本 → 按行拆分 → 每行清洗垃圾 → 过滤 */
export function cleanBatchNames(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/\r?\n/)                       // 先按行拆！
    .map((line) => line
      .replace(/<img[^>]*>.*?<\/img>/gi, ' ')  // <img>...</img> 垃圾
      .replace(/<[^>]+>/g, ' ')                // 其他 HTML 标签
      .replace(/\[图片\]/g, ' ')               // [图片] 占位符
      .replace(/https?:\/\/\S+/g, ' ')         // URL
      .replace(/^[a-f0-9]{16,}$/i, '')        // 纯 hex hash（img 里残留）
      .replace(/[<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    )
    .filter((s) => s && s.length >= 1)
}

export function AgentEnroll() {
  const items = useLiveQuery(() => db.items.orderBy('createdAt').reverse().toArray()) ?? []
  const persons = useLiveQuery(() => db.persons.orderBy('createdAt').reverse().toArray()) ?? []
  const selections = useLiveQuery(() => db.selections.toArray()) ?? []

  const [mode, setMode] = useState<Mode>('single')

  const [singleName, setSingleName] = useState('')
  const [pickingPersonId, setPickingPersonId] = useState<string | null>(null)

  const [batchRaw, setBatchRaw] = useState('')
  const [batchPreview, setBatchPreview] = useState<string[]>([])
  const [batchStep, setBatchStep] = useState<'input' | 'preview'>('input')

  // —— 批量同时选单状态 ——
  const [batchPickIds, setBatchPickIds] = useState<string[]>([])
  const [batchPickPendingPersons, setBatchPickPendingPersons] = useState<string[]>([])

  const [searchP, setSearchP] = useState('')
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null)
  const [confirmDelPerson, setConfirmDelPerson] = useState<string | null>(null)

  const filteredPersons = persons.filter((p) =>
    !searchP.trim() ? true : p.name.toLowerCase().includes(searchP.trim().toLowerCase()),
  )

  const selMap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const s of selections) {
      const set = m.get(s.personId) ?? new Set<string>()
      set.add(s.itemId)
      m.set(s.personId, set)
    }
    return m
  }, [selections])

  async function handlePickStart() {
    const n = singleName.trim()
    if (!n) { toast.error('请输入姓名'); return }
    let p = persons.find((x) => x.name === n)
    if (!p) p = await addPerson(n)
    setPickingPersonId(p.id)
    setSingleName('')
  }

  async function toggleItemForPick(itemId: string) {
    if (!pickingPersonId) return
    const has = selMap.get(pickingPersonId)?.has(itemId)
    if (has) await unselectItem(pickingPersonId, itemId)
    else await selectItem(pickingPersonId, itemId)
  }

  function nextBatchStep() {
    const cleaned = cleanBatchNames(batchRaw)
    if (cleaned.length === 0) { toast.info('没有有效姓名'); return }
    setBatchPreview(cleaned)
    setBatchStep('preview')
  }

  async function confirmBatch() {
    const unique: string[] = []
    const seen = new Set<string>()
    let dupWarn = 0
    for (const n of batchPreview) {
      if (!seen.has(n)) { unique.push(n); seen.add(n) } else dupWarn++
    }
    await db.persons.bulkAdd(unique.map((n) => ({ id: genId(), name: n, createdAt: Date.now() })))
    toast.success(`已批量创建 ${unique.length} 人${dupWarn ? ` · ${dupWarn} 个重复被去除` : ''}`)
    setBatchRaw(''); setBatchPreview([]); setBatchStep('input')
    // 自动准备批量选单
    setBatchPickPendingPersons(unique)
  }

  async function confirmDeletePerson() {
    if (!confirmDelPerson) return
    const count = await deletePerson(confirmDelPerson)
    setConfirmDelPerson(null)
    toast.success(count > 0 ? '已删除该人员及其选择关系' : '已删除该人员')
  }

  // —— 单人选单界面 ——
  if (pickingPersonId) {
    const p = persons.find((x) => x.id === pickingPersonId)
    const picked = selMap.get(pickingPersonId) ?? new Set()
    return (
      <PickGrid
        items={items}
        picked={picked}
        personName={p?.name ?? ''}
        onBack={() => { setPickingPersonId(null) }}
        onToggle={toggleItemForPick}
        onConfirmDone={() => {
          const c = picked.size
          setPickingPersonId(null)
          toast.success(`已完成 ${p?.name ?? ''} 选单 · 共 ${c} 张`)
        }}
        onCancelClear={async () => {
          if (!pickingPersonId) return
          const count = await db.selections.where('personId').equals(pickingPersonId).delete()
          setPickingPersonId(null)
          toast.success(`已清空 ${p?.name ?? ''} 的 ${count} 张选择`)
        }}
      />
    )
  }

  // —— 批量同时选单界面 ——
  if (batchPickIds.length > 0) {
    const pickedCounts = new Map<string, number>()
    for (const item of items) {
      let c = 0
      for (const pid of batchPickIds) {
        if (selMap.get(pid)?.has(item.id)) c++
      }
      pickedCounts.set(item.id, c)
    }
    const anyPickedCount = items.reduce((acc, it) => acc + (pickedCounts.get(it.id)! > 0 ? 1 : 0), 0)

    return (
      <BatchPickGrid
        items={items}
        persons={persons.filter((p) => batchPickIds.includes(p.id))}
        selMap={selMap}
        pickedCounts={pickedCounts}
        anyPickedCount={anyPickedCount}
        totalPicks={batchPickIds.reduce((acc, pid) => acc + (selMap.get(pid)?.size ?? 0), 0)}
        onBack={() => setBatchPickIds([])}
        onToggleForAll={async (itemId) => {
          const allPicked = batchPickIds.every((pid) => selMap.get(pid)?.has(itemId))
          if (allPicked) {
            for (const pid of batchPickIds) await unselectItem(pid, itemId)
          } else {
            for (const pid of batchPickIds) await selectItem(pid, itemId)
          }
        }}
        onTogglePerson={(pid) => {
          setBatchPickIds((prev) =>
            prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid],
          )
        }}
        onConfirmDone={(names, total) => {
          setBatchPickIds([])
          toast.success(`已完成 ${names.length} 人批量选单 · 共 ${total} 条选择关系`)
        }}
        onCancelClear={async (names) => {
          if (batchPickIds.length === 0) return
          const count = await db.selections.where('personId').anyOf(batchPickIds).delete()
          setBatchPickIds([])
          toast.success(`已清空 ${names.length} 人共 ${count} 条选择关系`)
        }}
      />
    )
  }

  return (
    <div className="p-4 md:p-8 h-full flex flex-col gap-3 md:gap-5">
      {/* —— 顶部标题 + Tab —— */}
      <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3">
        <div className="md:flex-1 md:min-w-0">
          <h1 className="text-lg md:text-2xl font-semibold">代理录入</h1>
          <p className="text-xs md:text-sm text-neutral-500 mt-0.5 md:mt-1">
            共 {persons.length} 人 · 选单图片 {items.length} 张
          </p>
        </div>
        {/* Tab 切换 */}
        <div className="flex rounded-lg md:rounded-md border border-neutral-200 overflow-hidden text-[13px] md:text-sm bg-white">
          <button
            onClick={() => setMode('single')}
            className={`flex-1 md:flex-none md:px-3 py-2.5 md:py-1.5 font-medium transition
              ${mode === 'single' ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50 text-neutral-700'}`}
          >单人录入</button>
          <button
            onClick={() => { setMode('batch'); setBatchStep('input') }}
            className={`flex-1 md:flex-none md:px-3 py-2.5 md:py-1.5 font-medium transition border-x border-neutral-200
              ${mode === 'batch' ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50 text-neutral-700'}`}
          >批量导入</button>
          <button
            onClick={() => setMode('manage')}
            className={`flex-1 md:flex-none md:px-3 py-2.5 md:py-1.5 font-medium transition
              ${mode === 'manage' ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50 text-neutral-700'}`}
          >人员管理</button>
        </div>
      </div>

      {/* —— 内容区 —— */}
      <div className="flex-1 overflow-y-auto thin-scroll rounded-xl bg-white border border-neutral-200 p-3 md:p-5">
        {/* 单人录入 */}
        {mode === 'single' && (
          <div className="max-w-xl space-y-5">
            <div className="text-sm font-medium text-neutral-700">
              输入人员姓名，进入选单界面
            </div>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                value={singleName}
                onChange={(e) => setSingleName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handlePickStart() }}
                placeholder="例如：张三"
                className="flex-1 h-11 md:h-10 px-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400"
              />
              <button
                onClick={handlePickStart}
                className="h-11 md:h-10 px-5 md:px-4 rounded-lg md:rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 flex items-center justify-center gap-1.5"
              >
                <UserPlus size={15} /> 开始选单
              </button>
            </div>
            {items.length === 0 && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                代选单库暂无图片，请先到「代选单库」上传图片。
              </div>
            )}
            {persons.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-neutral-500">已录入（点击进入选单）</div>
                  {persons.length >= 2 && (
                    <button
                      onClick={() => {
                        const ids = persons.map((p) => p.id)
                        setBatchPickIds(ids)
                      }}
                      className="text-xs text-neutral-900 font-medium hover:text-neutral-700 flex items-center gap-1 px-2.5 py-1 rounded-full bg-neutral-100 hover:bg-neutral-200 transition"
                    >
                      <Sparkles size={12} /> 批量选单（所有人一起）
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {persons.slice(0, 20).map((p) => {
                    const c = selMap.get(p.id)?.size ?? 0
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPickingPersonId(p.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:border-neutral-400 active:bg-neutral-100"
                      >
                        {p.name}
                        <span className="text-neutral-400">· {c} 张</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 批量导入 */}
        {mode === 'batch' && (
          <div className="max-w-3xl">
            {batchStep === 'input' ? (
              <>
                <div className="text-sm font-medium text-neutral-700 mb-1">
                  粘贴人员姓名，每行一个
                </div>
                <div className="text-xs text-neutral-500 mb-3">
                  自动清理 <code className="bg-neutral-100 rounded px-1">[图片]</code>、
                  <code className="bg-neutral-100 rounded px-1">{'<img>...</img>'}</code>、
                  URL 等聊天记录垃圾
                </div>
                <textarea
                  value={batchRaw}
                  onChange={(e) => setBatchRaw(e.target.value)}
                  placeholder={`马雨晴\n鑫念[图片]\n张三\n李四\n王五`}
                  className="w-full h-56 md:h-48 p-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 font-mono"
                />
                <div className="mt-3 flex flex-col md:flex-row justify-end gap-2">
                  <button
                    onClick={() => { setBatchRaw(''); setBatchPreview([]) }}
                    className="h-11 md:h-9 px-4 rounded-lg md:rounded-md text-sm hover:bg-neutral-100"
                  >清空</button>
                  <button
                    onClick={nextBatchStep}
                    className="h-11 md:h-9 px-5 md:px-4 rounded-lg md:rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 flex items-center justify-center gap-1"
                  >下一步<ChevronRight size={15} /></button>
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-neutral-700 mb-3">
                  清洗后将导入 <strong>{batchPreview.length}</strong> 人（可手动增删改）
                </div>
                <div className="rounded-lg md:rounded-md border border-neutral-200 max-h-80 overflow-y-auto thin-scroll divide-y">
                  {batchPreview.map((n, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="text-neutral-400 w-8 font-mono text-right flex-shrink-0">{i + 1}.</span>
                      <input
                        value={n}
                        onChange={(e) => {
                          const next = [...batchPreview]
                          next[i] = e.target.value
                          setBatchPreview(next)
                        }}
                        className="flex-1 bg-transparent outline-none"
                      />
                      <button
                        onClick={() => setBatchPreview(batchPreview.filter((_, j) => j !== i))}
                        className="p-1.5 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500"
                        aria-label="删除此行"
                      ><X size={15} /></button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
                  <button onClick={() => setBatchStep('input')} className="h-11 md:h-auto text-sm text-neutral-500 hover:text-neutral-800 flex items-center justify-center md:justify-start gap-1">
                    <ChevronLeft size={15} /> 返回修改
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => { setBatchRaw(''); setBatchPreview([]); setBatchStep('input') }}
                      className="flex-1 md:flex-none h-11 md:h-9 px-4 rounded-lg md:rounded-md text-sm hover:bg-neutral-100">取消</button>
                    <button onClick={confirmBatch}
                      className="flex-1 md:flex-none h-11 md:h-9 px-5 rounded-lg md:rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 flex items-center justify-center gap-1">
                      <CheckCircle size={15} /> 确认导入
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 人员管理 */}
        {mode === 'manage' && (
          <div>
            <div className="flex gap-2 mb-3 max-w-full">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  value={searchP}
                  onChange={(e) => setSearchP(e.target.value)}
                  placeholder="搜索人员"
                  className="w-full h-11 md:h-9 pl-9 pr-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
                />
              </div>
            </div>
            {filteredPersons.length === 0 ? (
              <div className="text-sm text-neutral-400 text-center py-10">暂无人员</div>
            ) : (
              <div className="divide-y -mx-3 md:-mx-5">
                {filteredPersons.map((p) => {
                  const pickedCount = selMap.get(p.id)?.size ?? 0
                  return (
                    <div key={p.id} className="flex items-center gap-2 md:gap-3 px-3 md:px-5 py-3 md:py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-neutral-900 font-medium truncate">{p.name}</div>
                        <div className="text-xs text-neutral-400 mt-0.5">
                          已选 {pickedCount} 张图片
                        </div>
                      </div>
                      <button
                        onClick={() => setPickingPersonId(p.id)}
                        className="h-10 md:h-auto px-2.5 py-2 md:py-1.5 rounded-md text-sm md:text-xs text-neutral-700 hover:bg-neutral-100 flex items-center gap-1"
                      ><Check size={14} />选单</button>
                      <button
                        onClick={() => setRenameTarget({ id: p.id, name: p.name })}
                        className="h-10 md:h-auto px-2.5 py-2 md:py-1.5 rounded-md text-sm md:text-xs text-neutral-700 hover:bg-neutral-100 flex items-center gap-1"
                      ><Pencil size={14} />改名</button>
                      <button
                        onClick={() => setConfirmDelPerson(p.id)}
                        className="h-10 md:h-auto px-2.5 py-2 md:py-1.5 rounded-md text-sm md:text-xs text-red-500 hover:bg-red-50 flex items-center gap-1"
                      ><Trash2 size={14} />删</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 改名 */}
      <Modal open={!!renameTarget} onClose={() => setRenameTarget(null)} title="修改姓名"
        footer={
          <>
            <button onClick={() => setRenameTarget(null)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button
              disabled={!renameTarget?.name.trim()}
              onClick={async () => {
                if (!renameTarget) return
                await renamePerson(renameTarget.id, renameTarget.name.trim())
                setRenameTarget(null); toast.success('已修改')
              }}
              className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 disabled:opacity-40"
            >保存</button>
          </>
        }>
        {renameTarget && (
          <input
            value={renameTarget.name}
            onChange={(e) => setRenameTarget({ ...renameTarget, name: e.target.value })}
            className="w-full h-11 md:h-10 px-3 rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400"
          />
        )}
      </Modal>

      {/* 删除人员 */}
      <Modal open={!!confirmDelPerson} onClose={() => setConfirmDelPerson(null)} title="删除人员记录？"
        footer={
          <>
            <button onClick={() => setConfirmDelPerson(null)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button onClick={confirmDeletePerson} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700">确认删除</button>
          </>
        }>
        <p className="text-sm text-neutral-700">
          仅删除该人员与其图片之间的选择关系，不会删除代选单库中的图片。
        </p>
      </Modal>

      {/* 批量导入后问是否进入批量选单 */}
      <Modal
        open={batchPickPendingPersons.length > 0}
        onClose={() => setBatchPickPendingPersons([])}
        title={`已创建 ${batchPickPendingPersons.length} 人`}
        footer={
          <>
            <button
              onClick={() => setBatchPickPendingPersons([])}
              className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100"
            >完成</button>
            <button
              onClick={async () => {
                const names = batchPickPendingPersons
                const allNew = await db.persons.where('name').anyOf(names).toArray()
                setBatchPickIds(allNew.map((p) => p.id))
                setBatchPickPendingPersons([])
              }}
              className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 flex items-center gap-1"
            >
              <Sparkles size={14} /> 批量选单（同时给所有人选图）
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-700 mb-3">
          是否要让这 {batchPickPendingPersons.length} 人一起选单？
          批量选单模式下，点击一张图片就是给<strong>所有人同时加上这张</strong>。
        </p>
        <div className="flex flex-wrap gap-1.5">
          {batchPickPendingPersons.slice(0, 20).map((n) => (
            <span key={n} className="text-xs rounded-full border border-neutral-200 px-2.5 py-0.5">{n}</span>
          ))}
          {batchPickPendingPersons.length > 20 && (
            <span className="text-xs text-neutral-400 self-center">+{batchPickPendingPersons.length - 20}</span>
          )}
        </div>
      </Modal>
    </div>
  )
}

/** 单人选单网格 */
function PickGrid({
  items, picked, personName, onBack, onToggle, onConfirmDone, onCancelClear,
}: {
  items: Item[]
  picked: Set<string>
  personName: string
  onBack: () => void
  onToggle: (itemId: string) => void
  onConfirmDone: () => void
  onCancelClear: () => void
}) {
  const [search, setSearch] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const filtered = items.filter((i) => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()))
  const pickedCount = picked.size

  return (
    <div className="p-4 md:p-8 h-full flex flex-col gap-3 md:gap-5 relative">
      {/* 顶部 */}
      <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3">
        <button onClick={onBack} className="h-11 md:h-9 px-4 md:px-3 rounded-lg md:rounded-md border border-neutral-200 text-sm hover:bg-neutral-50 flex items-center gap-1 flex-shrink-0">
          <ChevronLeft size={15} /> 返回
        </button>
        <div className="md:flex-1 md:min-w-0">
          <div className="text-base md:text-lg font-semibold text-neutral-900">
            正在为 <strong>{personName}</strong> 选单
          </div>
          <div className="text-xs md:text-sm text-neutral-500 mt-0.5">
            已选择 <span className="text-neutral-900 font-medium">{pickedCount}</span> 张图片
          </div>
        </div>
        <div className="relative md:w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索图片"
            className="w-full h-11 md:h-9 pl-9 pr-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
          />
        </div>
      </div>

      {/* 网格 */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 flex-1 flex flex-col items-center justify-center text-center text-sm text-neutral-400">
          <FileText size={26} className="mb-2 text-neutral-300" />
          代选单库暂无图片
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll rounded-xl bg-white border border-neutral-200 p-3 md:p-4 pb-24 md:pb-4">
          <div className="grid gap-2 md:gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((it) => {
              const isPicked = picked.has(it.id)
              return (
                <button
                  key={it.id}
                  onClick={() => onToggle(it.id)}
                  className={`relative text-left rounded-lg border-2 overflow-hidden transition active:scale-[0.97]
                    ${isPicked
                      ? 'border-neutral-900 ring-2 ring-neutral-900/10'
                      : 'border-neutral-200 hover:border-neutral-400'}`}
                >
                  <div className="aspect-square bg-neutral-50 relative">
                    {isPicked && (
                      <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2 bg-neutral-900 text-white rounded-full p-1 z-10">
                        <CheckCircle size={16} />
                      </div>
                    )}
                    <ImgView blob={it.blob} />
                  </div>
                  <div className="px-2 py-1.5 text-[12px] md:text-xs truncate" title={it.name}>{it.name}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 底部固定操作栏 */}
      <div className="fixed bottom-0 left-0 right-0 z-20 p-3 md:p-0 md:static md:flex-shrink-0">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white/95 backdrop-blur border-t border-neutral-200 md:border md:rounded-xl shadow-lg md:shadow-none flex gap-2 md:gap-3 p-3">
            <button
              onClick={() => setShowCancel(true)}
              className="flex-1 md:flex-none md:px-6 h-12 md:h-11 rounded-lg md:rounded-md border border-neutral-200 text-sm font-medium hover:bg-neutral-50 text-neutral-700 active:bg-neutral-100 flex items-center justify-center gap-1"
            >
              <X size={15} /> 取消（清空）
            </button>
            <button
              disabled={pickedCount === 0}
              onClick={onConfirmDone}
              className={`flex-[1.5] md:flex-none md:px-8 h-12 md:h-11 rounded-lg md:rounded-md text-sm font-medium flex items-center justify-center gap-1 transition
                ${pickedCount > 0
                  ? 'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-700'
                  : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'}`}
            >
              <CheckCircle size={15} />
              确认完成 {pickedCount > 0 && `· ${pickedCount} 张`}
            </button>
          </div>
        </div>
      </div>

      {/* 取消清空确认 */}
      <Modal open={showCancel} onClose={() => setShowCancel(false)} title="取消本次选单？"
        footer={
          <>
            <button onClick={() => setShowCancel(false)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">再看看</button>
            <button
              onClick={() => { setShowCancel(false); onCancelClear() }}
              className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
            >确认清空 {pickedCount} 张</button>
          </>
        }>
        <p className="text-sm text-neutral-700">
          会清掉 <strong>{personName}</strong> 已经选中的 <strong>{pickedCount}</strong> 张图片，<br/>
          <span className="text-neutral-500">已选中的图片需要重新选。</span>
        </p>
      </Modal>
    </div>
  )
}

/** 批量同时选单网格 */
function BatchPickGrid({
  items, persons, selMap, pickedCounts, anyPickedCount, totalPicks,
  onBack, onToggleForAll, onTogglePerson, onConfirmDone, onCancelClear,
}: {
  items: Item[]
  persons: { id: string; name: string }[]
  selMap: Map<string, Set<string>>
  pickedCounts: Map<string, number>
  anyPickedCount: number
  totalPicks: number
  onBack: () => void
  onToggleForAll: (itemId: string) => void
  onTogglePerson: (pid: string) => void
  onConfirmDone: (names: string[], total: number) => void
  onCancelClear: (names: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const filtered = items.filter((i) => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="p-4 md:p-8 h-full flex flex-col gap-3 md:gap-5 relative">
      {/* 顶部 */}
      <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3">
        <button onClick={onBack} className="h-11 md:h-9 px-4 md:px-3 rounded-lg md:rounded-md border border-neutral-200 text-sm hover:bg-neutral-50 flex items-center gap-1 flex-shrink-0">
          <ChevronLeft size={15} /> 返回
        </button>
        <div className="md:flex-1 md:min-w-0">
          <div className="text-base md:text-lg font-semibold text-neutral-900 flex items-center gap-2">
            <Sparkles size={18} className="text-amber-500" />
            批量选单 · 点击一张图 = 给所有人同时选上
          </div>
          <div className="text-xs md:text-sm text-neutral-500 mt-0.5">
            {persons.length} 人 · 已选 {anyPickedCount} 张图 · 共 {totalPicks} 条选择关系
          </div>
        </div>
        <div className="relative md:w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索图片"
            className="w-full h-11 md:h-9 pl-9 pr-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
          />
        </div>
      </div>

      {/* 参与人员选择条（横向滚动） */}
      <div className="rounded-xl bg-white border border-neutral-200 p-3">
        <div className="text-xs text-neutral-500 mb-2 flex items-center gap-1">
          <Users size={12} /> 参与选单的人员（点击可移除）
        </div>
        <div className="flex gap-2 overflow-x-auto thin-scroll pb-1">
          {persons.map((p) => {
            const picked = selMap.get(p.id)?.size ?? 0
            return (
              <button
                key={p.id}
                onClick={() => onTogglePerson(p.id)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-neutral-900 text-white px-3 py-1.5 text-sm"
              >
                <span>{p.name}</span>
                <span className="text-neutral-400 text-xs">·{picked}</span>
                <X size={12} className="opacity-70" />
              </button>
            )
          })}
        </div>
      </div>

      {/* 网格 */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 flex-1 flex flex-col items-center justify-center text-center text-sm text-neutral-400">
          <FileText size={26} className="mb-2 text-neutral-300" />
          代选单库暂无图片
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll rounded-xl bg-white border border-neutral-200 p-3 md:p-4 pb-24 md:pb-4">
          <div className="grid gap-2 md:gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((it) => {
              const count = pickedCounts.get(it.id) ?? 0
              const allPicked = count === persons.length && persons.length > 0
              const somePicked = count > 0 && !allPicked
              return (
                <button
                  key={it.id}
                  onClick={() => onToggleForAll(it.id)}
                  className={`relative text-left rounded-lg border-2 overflow-hidden transition active:scale-[0.97]
                    ${allPicked
                      ? 'border-neutral-900 ring-2 ring-neutral-900/10'
                      : somePicked
                      ? 'border-amber-500 ring-2 ring-amber-500/20'
                      : 'border-neutral-200 hover:border-neutral-400'}`}
                >
                  <div className="aspect-square bg-neutral-50 relative">
                    {allPicked && (
                      <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2 bg-neutral-900 text-white rounded-full p-1 z-10">
                        <CheckCircle size={16} />
                      </div>
                    )}
                    {somePicked && (
                      <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2 bg-amber-500 text-white text-[11px] font-medium rounded-full px-1.5 py-0.5 z-10">
                        {count}/{persons.length}
                      </div>
                    )}
                    <ImgView blob={it.blob} />
                  </div>
                  <div className="px-2 py-1.5 text-[12px] md:text-xs truncate flex items-center justify-between" title={it.name}>
                    <span className="truncate">{it.name}</span>
                    {count > 0 && !allPicked && (
                      <span className="text-amber-600 ml-1 font-medium flex-shrink-0">{count}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 底部固定操作栏 */}
      <div className="fixed bottom-0 left-0 right-0 z-20 p-3 md:p-0 md:static md:flex-shrink-0">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white/95 backdrop-blur border-t border-neutral-200 md:border md:rounded-xl shadow-lg md:shadow-none flex gap-2 md:gap-3 p-3">
            <button
              onClick={() => setShowCancel(true)}
              className="flex-1 md:flex-none md:px-6 h-12 md:h-11 rounded-lg md:rounded-md border border-neutral-200 text-sm font-medium hover:bg-neutral-50 text-neutral-700 active:bg-neutral-100 flex items-center justify-center gap-1"
            >
              <X size={15} /> 取消（清空）
            </button>
            <button
              disabled={totalPicks === 0}
              onClick={() => onConfirmDone(persons.map((p) => p.name), totalPicks)}
              className={`flex-[1.5] md:flex-none md:px-8 h-12 md:h-11 rounded-lg md:rounded-md text-sm font-medium flex items-center justify-center gap-1 transition
                ${totalPicks > 0
                  ? 'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-700'
                  : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'}`}
            >
              <CheckCircle size={15} />
              确认完成 {totalPicks > 0 && `· ${totalPicks} 条`}
            </button>
          </div>
        </div>
      </div>

      {/* 取消清空确认 */}
      <Modal open={showCancel} onClose={() => setShowCancel(false)} title="取消批量选单？"
        footer={
          <>
            <button onClick={() => setShowCancel(false)} className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md text-sm hover:bg-neutral-100">再看看</button>
            <button
              onClick={() => {
                setShowCancel(false)
                onCancelClear(persons.map((p) => p.name))
              }}
              className="px-4 py-2.5 md:px-3 md:py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
            >确认清空 {totalPicks} 条</button>
          </>
        }>
        <p className="text-sm text-neutral-700">
          会清掉 <strong>{persons.length}</strong> 人共 <strong>{totalPicks}</strong> 条选择关系：
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {persons.map((p) => {
            const c = selMap.get(p.id)?.size ?? 0
            return (
              <span key={p.id} className="text-xs rounded-full border border-neutral-200 px-2 py-0.5">
                {p.name} · {c} 张
              </span>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}

function ImgView({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u); setErr(false)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  if (err || !url) return <ImageOff size={20} className="absolute inset-0 m-auto text-neutral-300" />
  return <img src={url} alt="" onError={() => setErr(true)} className="w-full h-full object-cover" loading="lazy" />
}
