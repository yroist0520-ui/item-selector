import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Search, Copy, Download, FileText, Archive, Trash2, Undo2,
  Check, ImageOff, Loader2, ChevronDown, ChevronRight, AlertTriangle,
  Calendar, Clock, RotateCcw,
} from 'lucide-react'
import { db, clearSelectionsByItemIds, restoreSelections, type Selection } from '@/db'
import { toast } from '@/utils/toast'
import { Modal } from '@/components/Modal'
import { exportSinglePNG, exportSinglePDF, exportMultiPDF, exportBulkPNGZip, type SummaryItem } from '@/utils/exporter'

type SortMode = 'default' | 'count-desc' | 'count-asc'
type TimePreset = 'all' | 'since-clear' | 'today' | '7d' | '30d' | 'month' | 'custom'

const LS_LAST_CLEAR = 'item-selector:lastClearTime'

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function buildSummaries(
  items: { id: string; name: string; blob: Blob }[],
  selections: { personId: string; itemId: string }[],
  persons: { id: string; name: string }[],
): SummaryItem[] {
  const personMap = new Map(persons.map((p) => [p.id, p.name]))
  const itemMap = new Map(items.map((i) => [i.id, i]))
  const namesMap = new Map<string, string[]>()
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

/** 根据预设计算时间范围 [from, to] ms */
function resolveTimeRange(
  preset: TimePreset,
  customFrom: string,
  customTo: string,
  lastClearTime: number | null,
): { from: number | null; to: number | null; label: string } {
  const now = Date.now()
  const startOfDay = () => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const startOfMonth = () => {
    const d = new Date()
    d.setDate(1); d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  switch (preset) {
    case 'all': return { from: null, to: null, label: '全部时间' }
    case 'since-clear': {
      if (!lastClearTime) return { from: null, to: null, label: '全部时间（尚未清除过）' }
      return { from: lastClearTime, to: null, label: `上次清除后 (${fmtDateTime(lastClearTime)} 起)` }
    }
    case 'today': return { from: startOfDay(), to: null, label: '今天' }
    case '7d': return { from: now - 7 * 86_400_000, to: null, label: '最近 7 天' }
    case '30d': return { from: now - 30 * 86_400_000, to: null, label: '最近 30 天' }
    case 'month': return { from: startOfMonth(), to: null, label: '本月' }
    case 'custom': {
      const f = customFrom ? new Date(customFrom + 'T00:00:00').getTime() : null
      const t = customTo ? new Date(customTo + 'T23:59:59').getTime() : null
      if (!f && !t) return { from: null, to: null, label: '全部时间' }
      return { from: f, to: t, label: `${f ? fmtDate(f) : '最早'} ~ ${t ? fmtDate(t) : '至今'}` }
    }
  }
}

export function Summary() {
  const items = useLiveQuery(() => db.items.toArray()) ?? []
  const persons = useLiveQuery(() => db.persons.toArray()) ?? []
  const selections = useLiveQuery(() => db.selections.toArray()) ?? []

  // —— 时间过滤状态 ——
  const [preset, setPreset] = useState<TimePreset>('since-clear')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [lastClearTime, setLastClearTime] = useState<number | null>(() => {
    const raw = localStorage.getItem(LS_LAST_CLEAR)
    return raw ? Number(raw) : null
  })

  // —— 其他状态 ——
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('default')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [busyProgress, setBusyProgress] = useState<{ cur: number; total: number; name: string } | null>(null)

  const [clearAfterExport, setClearAfterExport] = useState(false)
  const [undoSnapshot, setUndoSnapshot] = useState<Selection[] | null>(null)
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [confirmClearItemIds, setConfirmClearItemIds] = useState<string[] | null>(null)
  const [onlyWithSelections, setOnlyWithSelections] = useState(true) // 默认只显示有名单的图
  const [showExportMenu, setShowExportMenu] = useState(false) // 批量导出下拉

  // —— 根据时间范围过滤 selections ——
  const timeRange = useMemo(
    () => resolveTimeRange(preset, customFrom, customTo, lastClearTime),
    [preset, customFrom, customTo, lastClearTime],
  )

  const filteredSelections = useMemo(() => {
    return selections.filter((s) => {
      if (timeRange.from !== null && s.createdAt < timeRange.from) return false
      if (timeRange.to !== null && s.createdAt > timeRange.to) return false
      return true
    })
  }, [selections, timeRange])

  const summaries = useMemo(
    () => buildSummaries(items, filteredSelections, persons),
    [items, persons, filteredSelections],
  )

  const filtered = useMemo(() => {
    let arr = summaries
    if (onlyWithSelections) arr = arr.filter((s) => s.names.length > 0)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      arr = arr.filter((s) => s.name.toLowerCase().includes(q))
    }
    if (sort === 'count-desc') arr = [...arr].sort((a, b) => b.names.length - a.names.length)
    else if (sort === 'count-asc') arr = [...arr].sort((a, b) => a.names.length - b.names.length)
    return arr
  }, [summaries, search, sort, onlyWithSelections])

  // 显示在顶部的统计
  const totalSelectionsInRange = filteredSelections.length
  const totalUniqueItemsInRange = new Set(filteredSelections.map((s) => s.itemId)).size

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 记录"本次清空时间" */
  function markCleared() {
    const ts = Date.now()
    localStorage.setItem(LS_LAST_CLEAR, String(ts))
    setLastClearTime(ts)
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
    markCleared() // ← 记住这次清空时间
    setUndoSnapshot(rowsBefore)
    if (undoTimer) clearTimeout(undoTimer)
    const t = setTimeout(() => {
      setUndoSnapshot(null); setUndoTimer(null)
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
    } else fallbackCopy(text)
  }
  function fallbackCopy(text: string) {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); toast.success(`已复制 ${text.split('\n').length} 个名字`) }
    catch { toast.error('复制失败') }
    document.body.removeChild(ta)
  }

  async function withClearAfter(itemIds: string[], exporter: () => Promise<void>): Promise<void> {
    setBusy('export')
    try {
      await exporter()
      if (clearAfterExport) {
        await doClear(itemIds, false)
      }
    } finally { setBusy(null); setBusyProgress(null) }
  }

  async function handleSinglePNG(s: SummaryItem) { await withClearAfter([s.itemId], () => exportSinglePNG(s)) }
  async function handleSinglePDF(s: SummaryItem) { await withClearAfter([s.itemId], () => exportSinglePDF(s)) }
  async function handleAllPDF() {
    const targets = filtered
    if (targets.length === 0) { toast.info('当前时间范围内没有图片可导出'); return }
    setBusy('pdf-all')
    try {
      const pages = await exportMultiPDF(targets)
      toast.success(`全部 PDF 已导出（${pages} 页）· ${timeRange.label}`)
      if (clearAfterExport) await doClear(targets.map((t) => t.itemId), false)
    } catch (err: any) {
      console.error('[全部PDF导出失败]', err)
      toast.error('PDF 导出失败：' + (err?.message ?? String(err)))
    } finally { setBusy(null); setBusyProgress(null) }
  }
  async function handleBulkPNG() {
    const targets = filtered
    if (targets.length === 0) { toast.info('当前时间范围内没有图片可导出'); return }
    setBusy('zip')
    setBusyProgress({ cur: 0, total: targets.length, name: targets[0].name })
    try {
      await exportBulkPNGZip(targets, (cur, total, name) => setBusyProgress({ cur, total, name }))
      toast.success(`ZIP 已导出 · ${timeRange.label}`)
      if (clearAfterExport) await doClear(targets.map((t) => t.itemId), false)
    } finally { setBusy(null); setBusyProgress(null) }
  }

  return (
    <div className="p-4 md:p-8 h-full flex flex-col gap-3 md:gap-5">
      {/* —— 顶部标题 —— */}
      <div className="space-y-2 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3">
        <div className="md:flex-1 md:min-w-0">
          <h1 className="text-lg md:text-2xl font-semibold">图片订单汇总</h1>
          <p className="text-xs md:text-sm text-neutral-500 mt-0.5 md:mt-1">
            以图片为中心汇总选择名单 · 时间范围内 <strong>{totalUniqueItemsInRange}</strong> 张图片 / <strong>{totalSelectionsInRange}</strong> 条选择
          </p>
        </div>

        {undoSnapshot && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2 flex items-center gap-2">
            <Undo2 size={15} />
            <span className="flex-1">30 秒内可撤销上次清空</span>
            <button onClick={doUndo}
              className="ml-auto h-9 px-3 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700">撤销</button>
          </div>
        )}
      </div>

      {/* —— 时间范围过滤器 —— */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3 md:p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <Clock size={15} className="text-neutral-400" />
          导出时间范围
          <span className="ml-auto text-xs font-normal text-neutral-500">
            当前: <span className="text-neutral-900 font-medium">{timeRange.label}</span>
          </span>
        </div>

        {/* 快捷预设按钮 */}
        <div className="flex gap-1.5 md:gap-2 overflow-x-auto thin-scroll -mx-1 px-1 pb-1">
          {([
            { key: 'since-clear', label: '上次清除后', icon: <RotateCcw size={12} />,
              disabled: !lastClearTime,
              hint: lastClearTime ? fmtDateTime(lastClearTime) : '尚未清除过' },
            { key: 'today', label: '今天', icon: <Clock size={12} /> },
            { key: '7d', label: '最近7天', icon: <Clock size={12} /> },
            { key: '30d', label: '最近30天', icon: <Clock size={12} /> },
            { key: 'month', label: '本月', icon: <Calendar size={12} /> },
            { key: 'custom', label: '自定义', icon: <Calendar size={12} /> },
            { key: 'all', label: '全部时间', icon: <Calendar size={12} /> },
          ] as const).map((p) => {
            const active = preset === p.key
            const dis = 'disabled' in p && p.disabled
            return (
              <button
                key={p.key}
                disabled={dis}
                onClick={() => setPreset(p.key as TimePreset)}
                title={'hint' in p && p.hint ? p.hint : undefined}
                className={`flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm border transition
                  ${active
                    ? 'bg-neutral-900 text-white border-neutral-900'
                    : dis
                    ? 'bg-neutral-50 text-neutral-400 border-neutral-200 cursor-not-allowed'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'}`}
              >
                {p.icon}
                <span>{p.label}</span>
              </button>
            )
          })}
        </div>

        {/* 自定义日期输入 */}
        {preset === 'custom' && (
          <div className="flex flex-col md:flex-row gap-2 md:gap-3 items-start md:items-center">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500">从</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-10 md:h-9 px-2 rounded-md border border-neutral-200 text-sm bg-white outline-none focus:border-neutral-400"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500">到</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-10 md:h-9 px-2 rounded-md border border-neutral-200 text-sm bg-white outline-none focus:border-neutral-400"
              />
            </div>
            {(customFrom || customTo) && (
              <button
                onClick={() => { setCustomFrom(''); setCustomTo('') }}
                className="text-xs text-neutral-500 hover:text-neutral-800"
              >清除日期</button>
            )}
          </div>
        )}
      </div>

      {/* —— 搜索 + 排序 + 批量导出 —— */}
      <div className="flex flex-col md:flex-wrap md:flex-row gap-2 md:gap-3 md:items-center">
        <div className="relative md:w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="按图片名称搜索"
            className="w-full h-11 md:h-9 pl-9 pr-3 rounded-lg md:rounded-md border border-neutral-200 text-sm outline-none focus:border-neutral-400 bg-white"
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

        <div className="md:ml-auto flex flex-col md:flex-row gap-2 md:gap-3 md:items-center">
          {/* 只显示有名单的图 */}
          <label className="flex items-center gap-1.5 cursor-pointer text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={onlyWithSelections}
              onChange={(e) => setOnlyWithSelections(e.target.checked)}
              className="accent-neutral-900 w-4 h-4"
            />
            <span>只显示有名单</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={clearAfterExport}
              onChange={(e) => setClearAfterExport(e.target.checked)}
              className="accent-neutral-900 w-4 h-4"
            />
            <span>导出后清空</span>
          </label>

          {/* 批量导出：下拉菜单选 ZIP 或 PDF */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu((v) => !v)}
              disabled={!!busy || filtered.length === 0}
              className="h-11 md:h-9 px-4 md:px-3 rounded-lg md:rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 flex items-center justify-center gap-1 disabled:opacity-40"
            >
              <Download size={15} /> 批量导出
              <ChevronDown size={14} className={`transition ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>
            {showExportMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 mt-1 w-44 rounded-lg border border-neutral-200 bg-white shadow-lg z-20 overflow-hidden">
                  <button
                    onClick={() => { setShowExportMenu(false); handleAllPDF() }}
                    disabled={!!busy || filtered.length === 0}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 flex items-center gap-2 disabled:opacity-40"
                  >
                    <FileText size={14} className="text-neutral-500" /> 全部 PDF（一份长文档）
                  </button>
                  <button
                    onClick={() => { setShowExportMenu(false); handleBulkPNG() }}
                    disabled={!!busy || filtered.length === 0}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 flex items-center gap-2 disabled:opacity-40"
                  >
                    <Archive size={14} className="text-neutral-500" /> ZIP 压缩包（每张 PNG）
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 导出进度 */}
      {busy && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3 flex items-center gap-3">
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
            {selections.length === 0
              ? '还没有任何选择关系'
              : `在「${timeRange.label}」范围内没有选择记录`}
          </div>
        ) : (
          <div className="grid gap-2 md:gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
            <strong>清空后「上次清除后」计时会重置</strong>，之后只导出新的选择记录。<br />
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
