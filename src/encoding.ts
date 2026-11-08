import type { Eol, EncName } from './state'

export const ENC_LABELS: Record<EncName, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 BOM',
  'utf-16le': 'UTF-16 LE',
  gb18030: 'GB18030',
  big5: 'Big5',
  latin1: 'Latin-1',
}

/** TextDecoder 标签映射(utf-8 解码默认剥离 BOM) */
function labelOf(enc: EncName): string {
  return enc === 'utf-8-bom' ? 'utf-8' : enc
}

export function decodeAs(bytes: Uint8Array, enc: EncName): string {
  return new TextDecoder(labelOf(enc)).decode(bytes)
}

/**
 * 编码探测:BOM → UTF-8 严格校验 → GB18030 启发式(无替换符即认定)
 * 兜底 latin1(永不失败)
 */
export function detectEncoding(bytes: Uint8Array): { enc: EncName; text: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { enc: 'utf-8-bom', text: decodeAs(bytes, 'utf-8') }
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { enc: 'utf-16le', text: decodeAs(bytes, 'utf-16le') }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE 只读;保存时会转为 UTF-16LE
    return { enc: 'utf-16le', text: new TextDecoder('utf-16be').decode(bytes) }
  }
  try {
    return { enc: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch { /* 非 UTF-8,继续探测 */ }

  const gb = new TextDecoder('gb18030').decode(bytes)
  if (!gb.includes('\uFFFD') && /[\u4e00-\u9fff\u3000-\u303f\uff01-\uff5e]/.test(gb))
    return { enc: 'gb18030', text: gb }
  return { enc: 'latin1', text: new TextDecoder('windows-1252').decode(bytes) }
}

/** 二进制嗅探:前 4KB 含 0x00 视为二进制(UTF-16 BOM 由调用方先行排除) */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

/** 采样判断换行符(前 100KB 内多数派) */
export function detectEol(text: string): Eol {
  const s = text.slice(0, 100_000)
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/(?<!\r)\n/g) || []).length
  const cr = (s.match(/\r(?!\n)/g) || []).length
  if (crlf === 0 && lf === 0 && cr === 0) return '\r\n' // Windows 默认
  if (crlf >= lf && crlf >= cr) return '\r\n'
  if (lf >= cr) return '\n'
  return '\r'
}

export function normalizeEol(text: string, eol: Eol): string {
  if (eol === '\n') return text.replace(/\r\n?/g, '\n')
  if (eol === '\r\n') return text.replace(/\r\n?/g, '\r\n').replace(/\n/g, '\r\n')
  return text.replace(/\r\n|\n/g, '\r')
}

export const EOL_LABELS: Record<Eol, string> = { '\r\n': 'CRLF', '\n': 'LF', '\r': 'CR' }
