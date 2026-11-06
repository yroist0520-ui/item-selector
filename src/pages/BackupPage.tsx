import { useRef, useState } from 'react'
import JSZip from 'jszip'
import { useLiveQuery } from 'dexie-react-hooks'
import { Upload, Download, Loader2, AlertTriangle } from 'lucide-react'
import { db, genId, type Item, type Person, type Selection } from '@/db'
import { toast } from '@/utils/toast'
import { Modal } from '@/components/Modal'

export function BackupPage() {
  const items = useLiveQuery(() => db.items.count()) ?? 0
  const persons = useLiveQuery(() => db.persons.count()) ?? 0
  const selections = useLiveQuery(() => db.selections.count()) ?? 0

  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [confirmOpen, setConfirmOpen] = useState<null | 'skip' | 'overwrite' | 'keep'>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  async function exportZip() {
    setBusy(true)
    try {
      const allItems = await db.items.toArray()
      const allPersons = await db.persons.toArray()
      const allSels = await db.selections.toArray()

      const zip = new JSZip()
      zip.file('version.json', JSON.stringify({ v: 1, date: Date.now() }, null, 2))
      zip.file('data.json', JSON.stringify({
        items: allItems.map(({ blob, ...rest }) => rest),   // blob 走目录
        persons: allPersons,
        selections: allSels,
      }, null, 2))
      const imgs = zip.folder('images')!
      for (const it of allItems) {
        imgs.file(`${it.id}.png`, it.blob)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `代选单备份_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 500)
      toast.success('备份已导出')
    } catch (err) {
      console.error(err); toast.error('备份失败')
    } finally { setBusy(false) }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setPendingFile(f)
    setConfirmOpen('skip')
  }

  async function doImport(mode: 'skip' | 'overwrite' | 'keep') {
    if (!pendingFile) return
    setConfirmOpen(null)
    setBusy(true)
    try {
      const zip = await JSZip.loadAsync(pendingFile)
      const dataText = await zip.file('data.json')?.async('string')
      if (!dataText) throw new Error('缺少 data.json')
      const parsed = JSON.parse(dataText) as {
        items: Array<Omit<Item, 'blob'> & { _idx: number }>
        persons: Person[]
        selections: Selection[]
      }
      const itemList = parsed.items as any[]

      // 读取所有图片 blob
      const imgMap = new Map<string, Blob>()
      for (const f of Object.keys(zip.files)) {
        if (!f.startsWith('images/')) continue
        const id = f.slice('images/'.length).replace(/\.[^.]+$/, '')
        imgMap.set(id, await zip.file(f)!.async('blob'))
      }

      // 按 mode 处理 items
      let addedItems = 0
      for (const it of itemList) {
        const blob = imgMap.get(it.id)
        if (!blob) continue
        if (mode === 'overwrite') {
          const existing = await db.items.get(it.id)
          if (existing) await db.items.put({ ...it, blob } as Item)
          else await db.items.add({ ...it, blob } as Item)
          addedItems++
        } else if (mode === 'keep') {
          // keep 冲突：新生成 id
          const existing = await db.items.get(it.id)
          if (existing) {
            const newId = genId()
            await db.items.add({ ...it, id: newId, blob } as Item)
            // 同步 selections 的 itemId
            for (const s of parsed.selections) if (s.itemId === it.id) s.itemId = newId
            addedItems++
          } else {
            await db.items.add({ ...it, blob } as Item)
            addedItems++
          }
        } else {
          // skip：已存在就跳过
          const existing = await db.items.get(it.id)
          if (existing) continue
          await db.items.add({ ...it, blob } as Item)
          addedItems++
        }
      }

      // persons / selections：按 id 存在判断
      let addedPersons = 0
      for (const p of parsed.persons) {
        if (await db.persons.get(p.id)) continue
        await db.persons.add(p); addedPersons++
      }
      let addedSels = 0
      for (const s of parsed.selections) {
        const exist = await db.selections.where('[personId+itemId]').equals([s.personId, s.itemId]).first()
        if (exist) continue
        await db.selections.add(s); addedSels++
      }

      toast.success(`已导入 ${addedItems} 张图 · ${addedPersons} 人 · ${addedSels} 条选择关系`)
    } catch (err: any) {
      console.error(err); toast.error('导入失败：' + (err?.message ?? String(err)))
    } finally {
      setBusy(false); setPendingFile(null)
    }
  }

  return (
    <div className="p-5 md:p-8 h-full flex flex-col">
      <div className="mb-5">
        <h1 className="text-xl md:text-2xl font-semibold">数据备份</h1>
        <p className="text-sm text-neutral-500 mt-1">
          本地 IndexedDB 存储 · 当前 {items} 张图 · {persons} 人 · {selections} 条选择关系
        </p>
      </div>

      <div className="max-w-3xl space-y-4">
        <div className="rounded-xl bg-white border border-neutral-200 p-5">
          <div className="font-medium mb-1">导出完整备份</div>
          <div className="text-xs text-neutral-500 mb-3">
            打包 ZIP，包含所有图片原图、人员数据和选择关系。可用于跨浏览器/跨设备迁移。
          </div>
          <button
            onClick={exportZip}
            disabled={busy || items === 0}
            className="h-9 px-4 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800 flex items-center gap-1.5 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            <Download size={14} /> 导出 ZIP 备份
          </button>
        </div>

        <div className="rounded-xl bg-white border border-neutral-200 p-5">
          <div className="font-medium mb-1">从备份恢复</div>
          <div className="text-xs text-neutral-500 mb-3">
            选择之前导出的 ZIP 文件。系统中已有的数据不会自动删除，冲突时让你选择处理方式。
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="h-9 px-4 rounded-md border border-neutral-200 text-sm hover:bg-neutral-50 flex items-center gap-1.5 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            <Upload size={14} /> 选择 ZIP 文件导入
          </button>
          <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={onPickFile} />
        </div>
      </div>

      {/* 导入冲突处理 */}
      <Modal
        open={!!confirmOpen}
        onClose={() => { setConfirmOpen(null); setPendingFile(null) }}
        title="导入时遇到冲突，如何处理？"
        footer={
          <>
            <button onClick={() => { setConfirmOpen(null); setPendingFile(null) }}
              className="px-3 py-1.5 rounded-md text-sm hover:bg-neutral-100">取消</button>
            <button onClick={() => doImport('skip')}
              className="px-3 py-1.5 rounded-md border border-neutral-200 text-sm hover:bg-neutral-50">跳过已存在的</button>
            <button onClick={() => doImport('overwrite')}
              className="px-3 py-1.5 rounded-md bg-amber-500 text-white text-sm hover:bg-amber-600">覆盖同名</button>
            <button onClick={() => doImport('keep')}
              className="px-3 py-1.5 rounded-md bg-neutral-900 text-white text-sm hover:bg-neutral-800">全部保留（冲突的重命名）</button>
          </>
        }
      >
        <div className="flex items-start gap-2 text-sm text-neutral-700">
          <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            备份文件中包含的图片 ID / 人员 ID 与本地已有数据有重叠。
            <div className="mt-2 space-y-1 text-xs text-neutral-600">
              <div>• <strong>跳过已存在</strong>：已有的保留，备份中独有的新增。最安全。</div>
              <div>• <strong>覆盖同名</strong>：备份版本覆盖本地同 ID 图片。</div>
              <div>• <strong>全部保留</strong>：本地 + 备份都保留，冲突项自动分配新 ID，选择关系一并重映射。</div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
