import { store } from './state'
import { toast } from './toast'

/** 对选中文本做变换并替换(空选区提示) */
function replaceSelection(transform: (s: string) => string): boolean {
  const view = store.view!
  const sel = view.state.selection.main
  const from = Math.min(sel.from, sel.to)
  const to = Math.max(sel.from, sel.to)
  if (from === to) {
    toast('请先选中要转换的内容')
    return true
  }
  const text = view.state.doc.sliceString(from, to)
  let out: string
  try {
    out = transform(text)
  } catch (e) {
    toast(`转换失败:${e instanceof Error ? e.message : e}`)
    return true
  }
  view.dispatch({ changes: { from, to, insert: out } })
  return true
}

const pad2 = (x: number) => String(x).padStart(2, '0')

/** Unix 时间戳(秒/毫秒自动识别)→ yyyy-MM-dd HH:mm:ss */
export function tsToDate(): boolean {
  return replaceSelection((s) => {
    const num = Number(s.trim())
    if (!Number.isFinite(num) || num <= 0) throw new Error('请选中 Unix 时间戳数字')
    const ms = s.trim().length >= 13 ? num : num * 1000
    const d = new Date(ms)
    if (isNaN(d.getTime())) throw new Error('无效时间戳')
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  })
}

/** 日期(yyyy-MM-dd [HH:mm:ss])→ Unix 时间戳(秒) */
export function dateToTs(): boolean {
  return replaceSelection((s) => {
    const t = s.trim().replace(/-/g, '/')
    let d = new Date(t)
    if (isNaN(d.getTime())) d = new Date(Number(s.trim()))
    if (isNaN(d.getTime())) throw new Error('无法解析日期,支持 yyyy-MM-dd HH:mm:ss')
    return String(Math.floor(d.getTime() / 1000))
  })
}

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  }
  return btoa(bin)
}

function b64decode(s: string): string {
  const bin = atob(s.trim())
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export const codecActions: Record<string, () => boolean> = {
  codec_ts_to_date: tsToDate,
  codec_date_to_ts: dateToTs,
  codec_b64_encode: () => replaceSelection(b64encode),
  codec_b64_decode: () => replaceSelection(b64decode),
  codec_url_encode: () => replaceSelection(encodeURIComponent),
  codec_url_decode: () => replaceSelection(decodeURIComponent),
}
