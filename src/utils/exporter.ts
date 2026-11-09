// jsPDF 和 JSZip 非常大（合计 ~250KB），只在用户点击导出时才加载
function loadjsPDF() {
  return import('jspdf').then((m) => m.default)
}
function loadJSZip() {
  return import('jszip').then((m) => m.default)
}

export interface SummaryItem {
  itemId: string
  name: string
  blob: Blob
  names: string[]
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('FileReader 失败'))
    r.readAsDataURL(blob)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = url
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [mime, b64] = dataUrl.split(',')
  const type = mime.match(/:(.*?);/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 800)
}

export function safeFilename(name: string): string {
  return (name || '未命名').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80)
}

/**
 * 用纯 Canvas API 画 summary card（避免 html-to-image 在 puppeteer 环境卡死）。
 * 输出 2x 高清 dataURL，直接给 jsPDF addImage 或 canvas.toBlob
 */
async function drawSummaryCard(
  summary: SummaryItem,
  imgDataUrl: string,
  pageNames?: string[],
): Promise<string> {
  const W = 1600                // 画布宽（2x 高清：800 设计 × 2）
  const H = 2400                // 画布高（足够容纳 A4 内容）
  const PAD = 80                // 内边距（2x）
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!

  // 白底
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // 名称
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 56px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText(summary.name, PAD, PAD)

  // 人数
  const names = pageNames ?? summary.names
  ctx.fillStyle = '#666666'
  ctx.font = '28px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(
    pageNames && summary.names.length !== pageNames.length
      ? `选择人数：${pageNames.length} 人（共 ${summary.names.length}）`
      : `选择人数：${names.length} 人`,
    PAD, PAD + 80,
  )

  // 图片区域
  const img = await loadImage(imgDataUrl)
  const imgMaxW = W - PAD * 2
  const imgMaxH = 1200
  const ratio = Math.min(imgMaxW / img.naturalWidth, imgMaxH / img.naturalHeight)
  const drawW = img.naturalWidth * ratio
  const drawH = img.naturalHeight * ratio
  const imgX = (W - drawW) / 2
  const imgY = PAD + 160
  ctx.drawImage(img, imgX, imgY, drawW, drawH)

  // 名单标题
  const listY = imgY + drawH + 80
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 32px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('人员名单', PAD, listY)
  // 下划线
  ctx.strokeStyle = '#111111'; ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(PAD, listY + 48); ctx.lineTo(PAD + 220, listY + 48); ctx.stroke()

  // 名单两列
  const colGap = 60
  const colW = (W - PAD * 2 - colGap) / 2
  const rowH = 44
  const listStartY = listY + 80

  if (names.length === 0) {
    ctx.fillStyle = '#999999'
    ctx.font = '26px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText('暂无选择', PAD, listStartY)
  } else {
    ctx.fillStyle = '#111111'
    ctx.font = '26px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
    const rowsPerCol = Math.ceil(names.length / 2)
    for (let i = 0; i < names.length; i++) {
      const col = Math.floor(i / rowsPerCol)
      const row = i % rowsPerCol
      const x = PAD + col * (colW + colGap)
      const y = listStartY + row * rowH
      ctx.fillText(`${i + 1}. ${names[i]}`, x, y)
    }
  }

  return canvas.toDataURL('image/png')
}

const NAMES_PER_PAGE = 40

export async function exportSinglePNG(summary: SummaryItem): Promise<void> {
  const dataUrl = await blobToDataURL(summary.blob)
  const pngUrl = await drawSummaryCard(summary, dataUrl)
  downloadBlob(dataUrlToBlob(pngUrl), `${safeFilename(summary.name)}_订单.png`)
}

export async function exportSinglePDF(summary: SummaryItem): Promise<void> {
  await exportMultiPDF([summary])
}

export async function exportMultiPDF(
  items: SummaryItem[],
  onPageRendered?: (pageIdx: number) => void,
): Promise<number> {
  const jsPDF = await loadjsPDF()
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const A4_W = 595
  const margin = 12
  const usableW = A4_W - margin * 2

  let first = true
  let totalPages = 0

  for (const summary of items) {
    const pages: string[][] = []
    if (summary.names.length === 0) pages.push([])
    else {
      for (let i = 0; i < summary.names.length; i += NAMES_PER_PAGE) {
        pages.push(summary.names.slice(i, i + NAMES_PER_PAGE))
      }
    }
    const imgDataUrl = await blobToDataURL(summary.blob)

    for (const pageNames of pages) {
      const pngUrl = await drawSummaryCard(summary, imgDataUrl, pageNames)
      // 把高清 PNG 等比缩到 A4 宽度
      const img = new Image()
      img.src = pngUrl
      await new Promise<void>((res) => {
        const t = setTimeout(res, 5000)
        img.onload = () => { clearTimeout(t); res() }
        img.onerror = () => { clearTimeout(t); res() }
      })
      const ratio = usableW / Math.max(img.width, 1)
      const drawW = usableW
      const drawH = img.height * ratio

      if (!first) pdf.addPage()
      pdf.addImage(pngUrl, 'PNG', margin, margin, drawW, drawH)
      first = false
      totalPages++
      onPageRendered?.(totalPages)
    }
  }

  downloadBlob(pdf.output('blob'), `全部订单_${new Date().toISOString().slice(0, 10)}.pdf`)
  return totalPages
}

export async function exportBulkPNGZip(
  items: SummaryItem[],
  onProgress?: (done: number, total: number, currentName: string) => void,
): Promise<void> {
  const JSZip = await loadJSZip()
  const zip = new JSZip()
  const usedNames = new Map<string, number>()
  const total = items.length

  for (let i = 0; i < items.length; i++) {
    const summary = items[i]
    onProgress?.(i, total, summary.name)
    const imgDataUrl = await blobToDataURL(summary.blob)
    const pngUrl = await drawSummaryCard(summary, imgDataUrl)

    let base = safeFilename(summary.name)
    const count = usedNames.get(base) ?? 0
    usedNames.set(base, count + 1)
    const filename = count === 0 ? `${base}.png` : `${base}_${count + 1}.png`
    zip.file(filename, dataUrlToBlob(pngUrl))
  }
  onProgress?.(total, total, '打包中...')
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(zipBlob, `图片订单_${new Date().toISOString().slice(0, 10)}.zip`)
}
