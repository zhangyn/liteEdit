import { store, activeTab } from './state'
import { toast } from './toast'

export type ToolKind =
  | 'json_format' | 'json_minify' | 'sql_format' | 'sql_minify'
  | 'list_single' | 'list_double' | 'list_none' | 'list_restore'
  | 'sort_asc' | 'sort_desc' | 'sort_unique'

/** SQL 无损压缩:字符串/注释原样保留,仅折叠其外部的空白 */
function sqlCompact(sql: string): string {
  const tokens: { type: 'text' | 'lit' | 'sp'; v: string }[] = []
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      let j = i + 1
      while (j < n) {
        if (sql[j] === '\\') { j += 2; continue }
        if (sql[j] === q) {
          if (q === "'" && sql[j + 1] === "'") { j += 2; continue } // 转义单引号
          j++
          break
        }
        j++
      }
      tokens.push({ type: 'lit', v: sql.slice(i, j) })
      i = j
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i)
      const end = j === -1 ? n : j
      tokens.push({ type: 'lit', v: sql.slice(i, end) })
      i = end
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2)
      const end = j === -1 ? n : j + 2
      tokens.push({ type: 'lit', v: sql.slice(i, end) })
      i = end
      continue
    }
    if (/\s/.test(c)) {
      let j = i
      while (j < n && /\s/.test(sql[j])) j++
      tokens.push({ type: 'sp', v: ' ' })
      i = j
      continue
    }
    let j = i
    while (j < n && !/[\s'"`]/.test(sql[j]) && !(sql[j] === '-' && sql[j + 1] === '-') && !(sql[j] === '/' && sql[j + 1] === '*')) j++
    tokens.push({ type: 'text', v: sql.slice(i, j) })
    i = j
  }

  // 组装:空白归一为单空格;',' ')' ';' 前不留空格,'(' 后不留空格
  let out = ''
  const noSpaceBefore = new Set([',', ')', ';'])
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k]
    if (tk.type === 'sp') {
      const prev = out.slice(-1)
      const next = tokens[k + 1]
      if (next && next.type === 'text' && noSpaceBefore.has(next.v[0])) continue
      if (prev === '(') continue
      if (out && !out.endsWith(' ') && prev !== '(') out += ' '
      continue
    }
    if (tk.type === 'text' && tk.v.length === 1 && noSpaceBefore.has(tk.v)) {
      out = out.replace(/ $/, '') + tk.v
      continue
    }
    out += tk.v
  }
  return out.trim()
}

/** 多行文本合并为一行列表:每行 trim、去行尾逗号/分号,按需加引号(单引号做 SQL 转义),逗号连接 */
function joinToList(text: string, quote: "'" | '"' | null): string {
  const items = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/[,;]+$/, '').trim())
    .filter((l) => l.length > 0)
    .map((v) => {
      if (quote === "'") v = v.replace(/'/g, "''")
      else if (quote === '"') v = v.replace(/"/g, '""')
      return quote ? `${quote}${v}${quote}` : v
    })
  return items.join(',')
}

/** 合并列表的逆操作:按引号感知切分逗号,自动剥离单/双引号与 SQL 转义,还原为多行 */
function restoreFromList(text: string): string {
  let s = text.trim()
  // 剥离包裹的括号(如 SQL IN ('a','b'))
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim()
  const items: string[] = []
  let cur = ''
  let i = 0
  const n = s.length
  while (i < n) {
    const c = s[i]
    if (c === "'" || c === '"') {
      const q = c
      cur += c
      i++
      while (i < n) {
        if (s[i] === '\\') { cur += s[i] + (s[i + 1] ?? ''); i += 2; continue } // 反斜杠原样保留
        if (s[i] === q) {
          if (s[i + 1] === q) { cur += q + q; i += 2; continue } // 成对引号转义,原样保留
          cur += q
          i++
          break
        }
        cur += s[i]
        i++
      }
      continue
    }
    if (c === ',') {
      items.push(cur)
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  items.push(cur)
  // 每项 trim、剥配对引号并反转义
  return items
    .map((raw) => {
      const v = raw.trim()
      if (v.length >= 2) {
        const q = v[0]
        if ((q === "'" || q === '"') && v[v.length - 1] === q) {
          const inner = v.slice(1, -1)
          return q === "'" ? inner.replace(/''/g, "'") : inner.replace(/""/g, '"')
        }
      }
      return v
    })
    .filter((v) => v.length > 0)
    .join('\n')
}

/** 行排序(升/降,语言感知排序)与相邻去重 */
function sortLines(text: string, mode: 'asc' | 'desc' | 'unique'): string {
  let lines = text.split(/\r?\n/)
  if (mode === 'asc') lines = lines.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  else if (mode === 'desc') lines = lines.sort((a, b) => b.localeCompare(a, 'zh-CN'))
  else {
    const seen = new Set<string>()
    lines = lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
  }
  return lines.join('\n')
}

async function transform(kind: ToolKind, text: string): Promise<string> {
  if (kind === 'json_format') return JSON.stringify(JSON.parse(text), null, 2) + '\n'
  if (kind === 'json_minify') return JSON.stringify(JSON.parse(text))
  if (kind === 'sql_format') {
    const m = await import('sql-formatter')
    return m.format(text, { tabWidth: 4 })
  }
  if (kind === 'list_single') return joinToList(text, "'")
  if (kind === 'list_double') return joinToList(text, '"')
  if (kind === 'list_none') return joinToList(text, null)
  if (kind === 'list_restore') return restoreFromList(text)
  if (kind === 'sort_asc') return sortLines(text, 'asc')
  if (kind === 'sort_desc') return sortLines(text, 'desc')
  if (kind === 'sort_unique') return sortLines(text, 'unique')
  return sqlCompact(text)
}

const LABELS: Record<ToolKind, string> = {
  json_format: 'JSON 格式化',
  json_minify: 'JSON 压缩',
  sql_format: 'SQL 格式化',
  sql_minify: 'SQL 压缩',
  list_single: '合并为列表(单引号)',
  list_double: '合并为列表(双引号)',
  list_none: '合并为列表(不加引号)',
  list_restore: '列表还原(拆分为多行)',
  sort_asc: '行排序(升序)',
  sort_desc: '行排序(降序)',
  sort_unique: '删除重复行',
}

/** 应用工具:有选区只处理选区,否则整篇;结果作为一次可撤销的编辑替换 */
export async function applyTool(kind: ToolKind) {
  const view = store.view
  if (!view || !activeTab()) return
  const sel = view.state.selection.main
  // 防御性归一化(理论上 CM 保证 from<=to)
  const from = Math.min(sel.from, sel.to)
  const to = Math.max(sel.from, sel.to)
  const useSel = from !== to
  const start = useSel ? from : 0
  const end = useSel ? to : view.state.doc.length
  const text = view.state.doc.sliceString(start, end)
  if (!text.trim()) {
    toast(`${LABELS[kind]}:内容为空`)
    return
  }
  let out: string
  try {
    out = await transform(kind, text)
  } catch (e) {
    toast(`${LABELS[kind]}失败:${e instanceof Error ? e.message : e}`)
    return
  }
  if (out === text) {
    toast(`${LABELS[kind]}:内容未变化`)
    return
  }
  view.dispatch({ changes: { from: start, to: end, insert: out } })
  toast(`${LABELS[kind]}完成${useSel ? '(选区)' : ''}`)
}
