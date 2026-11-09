import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Search, Copy, Download, FileText, Archive, Trash2, Undo2,
  Check, ImageOff, Loader2, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react'
import { db, clearSelectionsByItemIds, restoreSelections, type Selection } from '@/db'
import { toast } from '@/utils/toast'
import { Modal } from '@/components/Modal'
import { exportSinglePNG, exportSinglePDF, exportMultiPDF, exportBulkPNGZip, type SummaryItem } from '@/utils/exporter'

type SortMode = 'default' | 'count-desc' | 'count-asc'

/** 反向汇总：items × selections × persons → SummaryItem */
function buildSummaries(
  items: { id: string; name: string; blob: Blob }[],
  selections: { personId: string; itemId: string }[],
  persons: { id: string; name: string }[],
): SummaryItem[] {
  const personMap = new Map(persons.map((p) => [p.id, p.name]))
  const itemMap = new Map(items.map((i) => [i.id, i]))
  const namesMap = new Map<string, string[]>()
  // 按 selections 顺序累加，自动去重
  for (const s of selections) {
    const name = personMap.get(s.personId)
    if (!name) continue
    const arr = namesMap.get(s.itemId) ?? []
    if (!arr.includes(name)) arr.push(name)
    namesMap.set(s.itemId, arr)
  }
  return items.map((i) => ({
    itemId: i.id,
    name: i.name,
    blob: i.blob,
    names: namesMap.get(i.id) ?? [],
  }))
}

export function Summary() {
  const items = useLiveQuery(() => db.items.toArray()) ?? []
  const persons = useLiveQuery(() => db.persons.toArray()) ?? []
  const selections = useLiveQuery(() => db.selections.toArray()) ?? []

  const summaries = useMemo(
    () => buildSummaries(items, selections, persons),
    [items, persons, selections],
  )

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('default')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [busyProgress, setBusyProgress] = useState<{ cur: number; total: number; name: string } | null>(null)

  // 清空功能相关状态
  const [clearAfterExport, setClearAfterExport] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<Selection[] | null>(null)
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [confirmClearItemIds, setConfirmClearItemIds] = useState<string[] | null>(null)

  const filtered = useMemo(() => {
    let arr = summaries
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      arr = arr.filter((s) => s.name.toLowerCase().includes(q))
    }
    if (sort === 'count-desc') arr = [...arr].sort((a, b) => b.names.length - a.names.length)
    else if (sort === 'count-asc') arr = [...arr].sort((a, b) => a.names.length - b.names.length)
    return arr
  }, [summaries, search, sort])

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function doClear(itemIds: string[], requireConfirm: boolean): Promise<boolean> {
    if (requireConfirm) {
      setConfirmClearItemIds(itemIds)
      return false
    }
    const affected = selections.filter((s) => itemIds.includes(s.itemId))
    const rowsBefore = affected.length > 0 ? await db.selections.where('itemId').anyOf(itemIds).toArray() : []
    if (rowsBefore.length === 0) {
      toast.info('这些图片没有选择关系可清空')
      return false
    }
    const cleared = await clearSelectionsByItemIds(itemIds)
    // 设置撤销：保留 30 秒
    setUndoSnapshot(rowsBefore)
    if (undoTimer) clearTimeout(undoTimer)
    const t = setTimeout(() => {
      setUndoSnapshot(null)
      setUndoTimer(null)
    }, 30_000)
    setUndoTimer(t)
    toast.success(`已清空 ${cleared} 条选择关系 · 30 秒内可撤销`, 5000)
    return true
  }

  async function doUndo() {
    if (!undoSnapshot) return
    await restoreSelections(undoSnapshot)
    setUndoSnapshot(null)
    if (undoTimer) { clearTimeout(undoTimer); setUndoTimer(null) }
    toast.success('已恢复被清空的名单')
  }

  function copyNames(names: string[]) {
    const text = names.join('\n')
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast.success(`已复制 ${names.length} 个名字`),
        () => fallbackCopy(text),
      )
    } else {
      fallbackCopy(text)
    }
  }

  function fallbackCopy(text: string) {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); toast.success(`已复制 ${text.split('\n').length} 个名字`) }
    catch { toast.error('复制失败') }
    document.body.removeChild(ta)
  }

  // —— 导出事件包装：执行导出 → 可选清空 ——
  async function withClearAfter(itemIds: string[], exporter: () => Promise<void>): Promise<void> {
    setBusy('export')
    try {
      await exporter()
      if (clearAfterExport) {
        await doClear(itemIds, false)
      }
    } finally {
      setBusy(null)
      setBusyProgress(null)
    }
  }

  async function handleSinglePNG(s: SummaryItem) {
    await withClearAfter([s.itemId], () => exportSinglePNG(s))
  }
  async function handleSinglePDF(s: SummaryItem) {
    await withClearAfter([s.itemId], () => exportSinglePDF(s))
  }
  async function handleAllPDF() {
    const targets = filtered
    if (targets.length === 0) { toast.info('没有图片可导出'); return }
    setBusy('pdf-all')
    try {
      const pages = await exportMultiPDF(targets)
      toast.success(`全部 PDF 已导出（${pages} 页）`)
      if (clearAfterExport) {
        await doClear(targets.map((t) => t.itemId), false)
      }
    } catch (err: any) {
      console.error('[全部PDF导出失败]', err)
      toast.error('PDF 导出失败：' + (err?.message ?? String(err)))
    } finally { setBusy(null); setBusyProgress(null) }
  }
  async function handleBulkPNG() {
    const targets = filtered
    if (targets.length === 0) { toast.info('没有图片可导出'); return }
    setBusy('zip')
    setBusyProgress({ cur: 0, total: targets.length, name: targets[0].name })
    try {
      await exportBulkPNGZip(targets, (cur, total, name) => {
        setBusyProgress({ cur, total, name })
      })
      if (clearAfterExport) {
        await doClear(targets.map((t) => t.itemId), false)
      }
    } finally { setBusy(null); setBusyProgress(null) }
  }

  return (
    <div className="p-4 md:p-8 h-full flex flex-col gap-3 md:gap-5">
      {/* —— 顶部标题 + 操作栏 —— */}
      <div className="space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3">
        <div className="md:flex-1 md:min-w-0">
          <h1 className="text-lg md:text-2xl font-semibold">图片订单汇总</h1>
          <p className="text-xs md:text-sm text-neutral-500 mt-0.5 md:mt-1">
            以图片为中心自动汇总选择名单 · 共 {summaries.length} 张图片
          </p>
        </div>

        {/* 撤销条 */}
        {undoSnapshot && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2 flex items-center gap-2">
            <Undo2 size={15} />
            <span className="flex-1">30 秒内可撤销上次清空</span>
            <button
              onClick={doUndo}
              className="ml-auto h-9 px-3 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
            >撤销</button>
          </div>
        )}

        {/* 搜索 + 排序 + 批量导出：手机换行堆叠 */}
        <div className="flex flex-col md:flex-row gap-2 md:gap-3 md:w-auto">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="按图片名称搜索"
              className="w-full md:w-56 h-11 md:h-9 pl-9 pr-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="w-full md:w-auto h-11 md:h-9 px-3 rounded-lg md:rounded-md border border-neutral-200 text-sm bg-white outline-none"
          >
            <option value="default">默认顺序</option>
            <option value="count-desc">按选择人数 · 多 → 少</option>
            <option value="count-asc">按选择人数 · 少 → 多</option>
          </select>
        </div>

        {/* 批量导出 + 清空选项 */}
        <div className="flex flex-col md:flex-row gap-2 md:gap-3 md:items-center">
          <div className="rounded-lg md:rounded-md border border-neutral-200 text-sm flex items-center gap-2 px-3 py-2 md:py-1.5 bg-white">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={clearAfterExport}
                onChange={(e) => setClearAfterExport(e.target.checked)}
                className="accent-neutral-900 w-4 h-4"
              />
              <span className="text-sm">导出后清空名单</span>
            </label>
          </div>
          <button
            onClick={handleAllPDF}
            disabled={!!busy || filtered.length === 0}
            className="h-11 md:h-9 px-4 md:px-3 rounded-lg md:rounded-md border border-neutral-200 text-sm hover:bg-neutral-50 flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <FileText size={15} /> 全部 PDF
          </button>
          <button
            onClick={handleBulkPNG}
            disabled={!!busy || filtered.length === 0}
            className="h-11 md:h-9 px-4 md:px-3 rounded-lg md:rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Archive size={15} /> 批量下载 PNG
          </button>
        </div>
      </div>

      {/* 导出进度 */}
      {busy && (
        <div className="mb-3 rounded-lg border border-neutral-200 bg-white p-3 flex items-center gap-3">
          <Loader2 size={16} className="animate-spin text-neutral-700" />
          <div className="text-sm text-neutral-700">
            正在生成…
            {busyProgress && (
              <span className="text-neutral-500 ml-2">
                {busyProgress.cur}/{busyProgress.total} · {busyProgress.name}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 汇总卡 */}
      <div className="flex-1 overflow-y-auto thin-scroll rounded-xl bg-white border border-neutral-200 p-3 md:p-4">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-neutral-400">
            {summaries.length === 0 ? '代选单库暂无图片' : '没有匹配的图片'}
          </div>
        ) : (
          <div className="grid gap-3 md:gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((s) => (
              <SummaryCard
                key={s.itemId}
                summary={s}
                expanded={expanded.has(s.itemId)}
                onToggleExpand={() => toggleExpand(s.itemId)}
                onCopy={() => copyNames(s.names)}
                onPng={() => handleSinglePNG(s)}
                onPdf={() => handleSinglePDF(s)}
                onClear={() => doClear([s.itemId], true)}
                busy={busy}
              />
            ))}
          </div>
        )}
      </div>

      {/* 清空确认 */}
      <Modal
        open={!!confirmClearItemIds}
        onClose={() => setConfirmClearItemIds(null)}
        title="确认清空名单？"
        footer={
          <>
            <button onClick={() => setConfirmClearItemIds(null)} className="px-3 py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button
              onClick={async () => {
                const ids = confirmClearItemIds!
                setConfirmClearItemIds(null)
                await doClear(ids, false)
              }}
              className="px-3 py-1.5 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
            >确认清空</button>
          </>
        }
      >
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            将清除 <strong>{confirmClearItemIds ? selections.filter((sel) => confirmClearItemIds.includes(sel.itemId)).length : 0}</strong> 条选择关系。<br />
            不会删除图片或人员资料。<br />
            操作后 30 秒内可以撤销恢复。
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SummaryCard({
  summary, expanded, onToggleExpand, onCopy, onPng, onPdf, onClear, busy,
}: {
  summary: SummaryItem
  expanded: boolean
  onToggleExpand: () => void
  onCopy: () => void
  onPng: () => void
  onPdf: () => void
  onClear: () => void
  busy: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(summary.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [summary.blob])

  const PREVIEW = 8
  const showList = expanded ? summary.names : summary.names.slice(0, PREVIEW)

  return (
    <div className="rounded-lg border border-neutral-200 overflow-hidden bg-white flex flex-col">
      <div className="aspect-square bg-neutral-50 relative">
        {url
          ? <img src={url} alt="" className="w-full h-full object-cover" />
          : <ImageOff size={24} className="absolute inset-0 m-auto text-neutral-300" />}
        <div className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 text-white text-[11px] px-2 py-0.5">
          {summary.names.length} 人
        </div>
      </div>
      <div className="p-3 border-t border-neutral-100">
        <div className="text-sm font-medium text-neutral-900 truncate" title={summary.name}>{summary.name}</div>

        {/* 名单 */}
        <div className="mt-2 min-h-[24px] max-h-40 overflow-y-auto thin-scroll text-xs text-neutral-700 space-y-0.5">
          {summary.names.length === 0 ? (
            <div className="text-neutral-400 italic">暂无选择</div>
          ) : (
            showList.map((n, i) => (
              <div key={i} className="truncate">
                <span className="text-neutral-400 mr-1">{i + 1}.</span>{n}
              </div>
            ))
          )}
        </div>
        {summary.names.length > PREVIEW && (
          <button onClick={onToggleExpand} className="mt-1 text-[11px] text-neutral-500 hover:text-neutral-800 flex items-center gap-0.5">
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {expanded ? '收起' : `展开全部 ${summary.names.length} 人`}
          </button>
        )}

        {/* 操作：手机上一行一个，触摸友好 */}
        <div className="mt-3 grid grid-cols-2 md:flex md:flex-wrap gap-2">
          <button onClick={onCopy}
            disabled={summary.names.length === 0}
            className="h-10 md:h-8 px-3 md:px-2 py-1.5 rounded-md border border-neutral-200 text-sm md:text-[11px] text-neutral-700 hover:bg-neutral-50 flex items-center justify-center gap-1 disabled:opacity-40">
            <Copy size={14} className="md:w-[11px] md:h-[11px]" />复制名单
          </button>
          <button onClick={onPng}
            disabled={!!busy}
            className="h-10 md:h-8 px-3 md:px-2 py-1.5 rounded-md border border-neutral-200 text-sm md:text-[11px] text-neutral-700 hover:bg-neutral-50 flex items-center justify-center gap-1 disabled:opacity-40">
            <Download size={14} className="md:w-[11px] md:h-[11px]" />PNG
          </button>
          <button onClick={onPdf}
            disabled={!!busy}
            className="h-10 md:h-8 px-3 md:px-2 py-1.5 rounded-md border border-neutral-200 text-sm md:text-[11px] text-neutral-700 hover:bg-neutral-50 flex items-center justify-center gap-1 disabled:opacity-40">
            <FileText size={14} className="md:w-[11px] md:h-[11px]" />PDF
          </button>
          <button onClick={onClear}
            disabled={summary.names.length === 0 || !!busy}
            className="h-10 md:h-8 px-3 md:px-2 py-1.5 rounded-md border border-red-200 text-sm md:text-[11px] text-red-500 hover:bg-red-50 flex items-center justify-center gap-1 disabled:opacity-40">
            <Trash2 size={14} className="md:w-[11px] md:h-[11px]" />清空名单
          </button>
        </div>
      </div>
    </div>
  )
}


