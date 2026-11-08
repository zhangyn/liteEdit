import { ipc } from './ipc'
import { activeTab, store } from './state'
import { dirname, openPath } from './tabs'
import { detectEncoding } from './encoding'
import { toast } from './toast'

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', '__pycache__', '.svn', '.idea', '.vscode'])
const MAX_FILE = 2_000_000
const MAX_FILES = 2000
const MAX_RESULTS = 2000
const MAX_DEPTH = 12

let running = false
let cancelled = false

const el = (id: string) => document.getElementById(id)!

/** 在文件中查找:弹输入框 → 扫描活动文件所在目录 → 结果面板 */
export function openFindInFilesDialog() {
  if (running) {
    toast('正在搜索中…')
    return
  }
  const t = activeTab()
  if (!t?.path) {
    toast('请先打开一个文件(以其所在目录为搜索范围)')
    return
  }
  const scope = dirname(t.path)

  // 自绘输入对话框
  const layer = document.getElementById('modal-layer')!
  layer.innerHTML = ''
  const mask = document.createElement('div')
  mask.className = 'modal-mask'
  const box = document.createElement('div')
  box.className = 'modal-box'
  box.innerHTML = `
    <div class="modal-msg">在文件中查找</div>
    <div class="fif-scope">范围:${scope}</div>
    <input id="fif-pattern" placeholder="查找内容" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:6px 8px;font:inherit;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);outline:none">
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <input id="fif-exts" placeholder="文件类型,如 sql,txt(留空=全部)" style="flex:1;box-sizing:border-box;padding:6px 8px;font:inherit;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);outline:none">
      <label style="font-size:12px;color:var(--fg-dim);display:flex;align-items:center;gap:4px;flex:none"><input type="checkbox" id="fif-subdirs" checked> 含子目录</label>
    </div>
    <div style="display:flex;gap:16px;margin-bottom:14px;font-size:12px;color:var(--fg-dim)">
      <label><input type="checkbox" id="fif-case"> 区分大小写</label>
      <label><input type="checkbox" id="fif-regex"> 正则表达式</label>
    </div>
    <div class="modal-btns">
      <button id="fif-cancel">取消</button>
      <button id="fif-start" class="primary">开始查找</button>
    </div>`
  mask.appendChild(box)
  layer.appendChild(mask)
  layer.classList.add('visible')

  const input = box.querySelector('#fif-pattern') as HTMLInputElement
  input.focus()
  const close = () => {
    layer.classList.remove('visible')
    layer.innerHTML = ''
  }
  box.querySelector('#fif-cancel')!.addEventListener('click', close)
  const start = () => {
    const pattern = input.value
    if (!pattern) return
    const extRaw = (box.querySelector('#fif-exts') as HTMLInputElement).value.trim()
    const exts = new Set(extRaw ? extRaw.split(/[,;\s]+/).map((x) => x.replace(/^\./, '').toLowerCase()).filter(Boolean) : [])
    const subdirs = (box.querySelector('#fif-subdirs') as HTMLInputElement).checked
    close()
    void runSearch(pattern, scope, (box.querySelector('#fif-case') as HTMLInputElement).checked, (box.querySelector('#fif-regex') as HTMLInputElement).checked, exts, subdirs)
  }
  box.querySelector('#fif-start')!.addEventListener('click', start)
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') start()
    else if (ev.key === 'Escape') close()
    ev.stopPropagation()
  })
}

const tick = () => new Promise((r) => setTimeout(r, 0))

async function walk(dir: string, depth: number, maxDepth: number, exts: Set<string>, out: string[]) {
  if (depth > maxDepth || out.length >= MAX_FILES || cancelled) return
  let entries
  try {
    entries = await ipc.readDir(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (cancelled || out.length >= MAX_FILES) return
    if (e.is_dir) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(e.path, depth + 1, maxDepth, exts, out)
    } else if (exts.size === 0) {
      out.push(e.path)
    } else {
      const dot = e.name.lastIndexOf('.')
      if (dot > 0 && exts.has(e.name.slice(dot + 1).toLowerCase())) out.push(e.path)
    }
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    const st = await ipc.statFile(path)
    if (st.size === 0 || st.size > MAX_FILE) return null
    const bytes = await ipc.readFile(path)
    const probe = bytes.subarray(0, Math.min(1024, bytes.length))
    for (const b of probe) if (b === 0) return null // 二进制跳过
    return detectEncoding(bytes).text
  } catch {
    return null
  }
}

function buildRegExp(pattern: string, caseSensitive: boolean, useRegex: boolean): RegExp | null {
  const flags = caseSensitive ? 'g' : 'gi'
  try {
    return useRegex ? new RegExp(pattern, flags) : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  } catch (e) {
    toast(`正则表达式无效:${e instanceof Error ? e.message : e}`)
    return null
  }
}

function searchLine(lineText: string, re: RegExp): { col: number; len: number }[] {
  const out: { col: number; len: number }[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = re.exec(lineText)) && guard < 100) {
    if (m[0].length === 0) break
    out.push({ col: m.index, len: m[0].length })
    guard++
  }
  return out
}

async function runSearch(pattern: string, scope: string, caseSensitive: boolean, useRegex: boolean, exts: Set<string>, subdirs: boolean) {
  const re = buildRegExp(pattern, caseSensitive, useRegex)
  if (!re) return
  if (running) return
  running = true
  cancelled = false
  showPanel()
  setInfo(`正在扫描 ${scope} …`)
  clearList()

  const files: string[] = []
  await walk(scope, 0, subdirs ? MAX_DEPTH : 0, exts, files)
  if (cancelled) {
    running = false
    return
  }

  let scanned = 0
  let matches = 0
  let fileHits = 0
  const list = el('findres-list')
  const frag: DocumentFragment = document.createDocumentFragment()
  lastResults = []
  for (const f of files) {
    if (cancelled) break
    const text = await readText(f)
    scanned++
    if (text !== null) {
      const lines = text.split('\n')
      let fileAdded = false
      for (let i = 0; i < lines.length && matches < MAX_RESULTS; i++) {
        const lineText = lines[i].replace(/\r$/, '')
        for (const hit of searchLine(lineText, re)) {
          matches++
          if (!fileAdded) {
            const head = document.createElement('div')
            head.className = 'fr-file'
            head.textContent = f
            frag.appendChild(head)
            fileAdded = true
            fileHits++
          }
          const item = document.createElement('div')
          item.className = 'fr-item'
          item.textContent = `  ${i + 1}: ${lineText.trim().slice(0, 300)}`
          item.dataset.path = f
          item.dataset.line = String(i + 1)
          item.dataset.col = String(hit.col + 1)
          item.dataset.len = String(hit.len)
          frag.appendChild(item)
          lastResults.push({ path: f, line: i + 1, text: lineText.trim().slice(0, 300) })
        }
      }
    }
    if (scanned % 25 === 0) {
      setInfo(`已扫描 ${scanned}/${files.length} 个文件,${matches} 处匹配…(Esc/关闭可取消)`)
      list.appendChild(frag)
      await tick()
    }
  }
  list.appendChild(frag)
  setInfo(`完成:${scanned} 个文件 / ${fileHits} 个文件命中 / ${matches} 处匹配${cancelled ? '(已取消)' : ''}`)
  running = false
}

let lastResults: { path: string; line: number; text: string }[] = []

/** 导出结果为文本文件(path 传入则直接写盘,否则弹保存对话框) */
export async function exportFindResults(path?: string) {
  if (lastResults.length === 0) {
    toast('暂无查找结果可导出')
    return
  }
  let target: string | null | undefined = path
  if (!target) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    target = (await save({ defaultPath: '查找结果.txt', title: '导出查找结果' })) as string | null
    if (!target) return
  }
  const content = lastResults.map((r) => `${r.path}:${r.line}: ${r.text}`).join('\n')
  const [, had] = await ipc.writeText(target, content, 'utf-8')
  toast(had ? '导出完成(部分字符已替换)' : `已导出 ${lastResults.length} 条到 ${target}`)
}

/** 点击结果 → 打开文件并定位 */
async function jumpToResult(item: HTMLElement) {
  const path = item.dataset.path!
  const line = Number(item.dataset.line)
  const col = Number(item.dataset.col)
  const len = Number(item.dataset.len)
  const t = await openPath(path)
  if (!t) return
  const view = store.view!
  const l = view.state.doc.line(Math.min(line, view.state.doc.lines))
  const from = Math.min(l.from + col - 1, l.to)
  view.dispatch({ selection: { anchor: from, head: Math.min(from + len, l.to) }, scrollIntoView: true })
  view.focus()
}

export function initFindInFiles() {
  el('findres-close').addEventListener('click', () => {
    cancelled = true
    el('findres').classList.add('hidden')
  })
  el('findres-list').addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.fr-item') as HTMLElement | null
    if (item) void jumpToResult(item)
  })
}

function showPanel() {
  el('findres').classList.remove('hidden')
}
function setInfo(text: string) {
  el('findres-info').textContent = text
}
function clearList() {
  el('findres-list').innerHTML = ''
}
