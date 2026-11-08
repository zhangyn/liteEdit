import { EditorState } from '@codemirror/state'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ipc } from './ipc'
import { decodeAs, detectEncoding, detectEol, looksBinary, normalizeEol } from './encoding'
import { langFor } from './langs'
import { baseExtensions, applyTabCompartments, hooks } from './editor'
import { activeTab, store, type EncName, type Tab } from './state'
import { addRecent, getRecents, removeRecent } from './recents'
import { refreshStatus } from './statusbar'
import { toast } from './toast'
import { confirm3, confirmModal } from './modal'
import { showPopup } from './popup'
import { refreshPreview } from './preview'
import { saveSession } from './session'
import { sidebarFollow } from './sidebar'

let nextId = 1

const el = (id: string) => document.getElementById(id)!

export function basename(p: string): string {
  return p.replace(/^.*[\\/]/, '')
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}

// ── 标签渲染 ────────────────────────────────────────────
export function renderTabs() {
  const box = el('tabs')
  box.innerHTML = ''
  for (const t of store.tabs) {
    const div = document.createElement('div')
    div.className = 'tab' + (t.id === store.activeId ? ' active' : '') + (t.dirty ? ' dirty' : '')
    div.title = t.path ?? t.name
    const name = document.createElement('span')
    name.className = 'tab-name'
    name.textContent = t.name
    const close = document.createElement('button')
    close.className = 'tab-close'
    close.textContent = '×'
    close.title = '关闭 (Ctrl+W)'
    // 必须在 mousedown 阶段处理:click 之前 activate() 会重建标签条,
    // 原按钮被移除后 click 事件永远不会再触发
    close.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      e.preventDefault()
      void closeTab(t.id)
    })
    div.append(name, close)
    div.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault()
        void closeTab(t.id)
      } else if (e.button === 0) {
        activate(t.id)
      }
    })
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      showPopup(e.clientX, e.clientY, [
        { label: '关闭标签', action: () => void closeTab(t.id) },
        { label: '关闭其他', action: () => void closeOthers(t.id) },
        { sep: true },
        { label: '在资源管理器中显示', disabled: !t.path, action: () => t.path && void ipc.reveal(t.path) },
        { label: '复制文件路径', disabled: !t.path, action: () => t.path && void navigator.clipboard.writeText(t.path) },
      ])
    })
    box.appendChild(div)
  }
  el('empty-hint').classList.toggle('hidden', store.tabs.length > 0)
}

function updateTitle() {
  const t = activeTab()
  getCurrentWindow()
    .setTitle(t ? `${t.dirty ? '● ' : ''}${t.name} - LiteEdit` : 'LiteEdit')
    .catch(() => {})
}

// ── 状态构建(单视图 + 每标签 EditorState) ────────────────
function makeState(docText: string): EditorState {
  return EditorState.create({ doc: docText, extensions: baseExtensions() })
}

export function getDoc(t: Tab) {
  return t.id === store.activeId ? store.view!.state.doc : t.state.doc
}

export function isDirty(t: Tab): boolean {
  if (t.clean === null) return true
  return !getDoc(t).eq(t.clean)
}

// ── 打开 / 新建 ─────────────────────────────────────────
function addTab(t: Tab, activateNow = true) {
  store.tabs.push(t)
  if (activateNow) activate(t.id)
  else renderTabs()
  saveSession()
}

export function newFile(name?: string, content = ''): Tab {
  const n = store.tabs.filter((t) => !t.path).length + 1
  const st = makeState(content.replace(/\r\n?/g, '\n'))
  const t: Tab = {
    id: nextId++,
    path: null,
    name: name ?? `未命名 ${n}.txt`,
    state: st,
    scrollTop: 0,
    clean: st.doc,
    encoding: 'utf-8',
    eol: '\r\n',
    mtimeMs: 0,
    fileSize: content.length,
    langLabel: '纯文本',
    dirty: false,
  }
  addTab(t)
  void attachLang(t)
  return t
}

const BIG_FILE = 20 * 1024 * 1024

export async function openPath(path: string, opts: { silent?: boolean } = {}): Promise<Tab | null> {
  const existing = store.tabs.find((t) => t.path === path)
  if (existing) {
    activate(existing.id)
    return existing
  }
  let bytes: Uint8Array
  try {
    bytes = await ipc.readFile(path)
  } catch (e) {
    toast(`无法打开:${e}`)
    removeRecent(path)
    return null
  }
  if (bytes.length > BIG_FILE && !opts.silent) {
    const ok = await confirmModal(`文件超过 20MB(${(bytes.length / 1048576).toFixed(1)} MB),打开可能较慢。继续吗?`)
    if (!ok) return null
  }
  // 二进制检测:BOM 之外的 0x00 字节视为二进制 → 十六进制只读查看
  const hasBom = (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  if (!hasBom && looksBinary(bytes)) {
    if (!opts.silent) {
      const ok = await confirmModal(`「${basename(path)}」是二进制文件,以十六进制模式打开吗?`)
      if (!ok) return null
    }
    const HEX_CAP = 16 * 1024 * 1024
    const st = makeState('')
    const t: Tab = {
      id: nextId++,
      path,
      name: basename(path),
      state: st,
      scrollTop: 0,
      clean: st.doc,
      encoding: 'latin1',
      eol: '\n',
      mtimeMs: 0,
      fileSize: bytes.length,
      langLabel: '二进制',
      hex: true,
      hexData: bytes.length > HEX_CAP ? bytes.subarray(0, HEX_CAP) : bytes,
      hexTruncated: bytes.length > HEX_CAP,
      dirty: false,
    }
    void ipc.statFile(path).then((r) => {
      t.mtimeMs = r.mtime_ms
    }).catch(() => {})
    addTab(t)
    addRecent(path)
    return t
  }
  const { enc, text } = detectEncoding(bytes)
  const docText = text.replace(/\r\n?/g, '\n')
  const st = makeState(docText)
  const t: Tab = {
    id: nextId++,
    path,
    name: basename(path),
    state: st,
    scrollTop: 0,
    clean: st.doc,
    encoding: enc,
    eol: detectEol(text),
    mtimeMs: 0,
    fileSize: bytes.length,
    langLabel: '纯文本',
    dirty: false,
  }
  void ipc.statFile(path).then((r) => {
    t.mtimeMs = r.mtime_ms
  }).catch(() => {})
  addTab(t)
  addRecent(path)
  void attachLang(t)
  return t
}

export async function openFileDialog() {
  const p = await openDialog({
    multiple: false,
    title: '打开文件',
    filters: [{ name: '所有文件', extensions: ['*'] }],
  })
  if (typeof p === 'string') await openPath(p)
}

/** 异步加载语法包(不阻塞打开);挂载统一发生在激活时 */
async function attachLang(t: Tab) {
  const res = await langFor(t.name, t.fileSize || getDoc(t).length)
  t.langLabel = res?.label ?? '纯文本'
  t.langSupport = res?.support ?? null
  if (t.id === store.activeId) applyTabCompartments(store.view!, t)
  refreshStatus()
}

// ── 激活切换 ────────────────────────────────────────────
export function activate(id: number) {
  const prev = activeTab()
  const view = store.view!
  if (prev && prev.id !== id) {
    prev.state = view.state
    prev.scrollTop = view.scrollDOM.scrollTop
  }
  store.activeId = id
  const t = store.tabs.find((x) => x.id === id)
  if (!t) return
  view.setState(t.state)
  // 语言/换行/空白符随激活标签统一挂载(后台标签不修改 state)
  applyTabCompartments(view, t)
  view.scrollDOM.scrollTop = t.scrollTop
  // 二进制标签:切换到十六进制视图
  document.getElementById('editor-host')!.classList.toggle('hidden', !!t.hex)
  document.getElementById('hexview')!.classList.toggle('hidden', !t.hex)
  if (t.hex) renderHex(t)
  renderTabs()
  refreshStatus()
  updateTitle()
  sidebarFollow(t)
  refreshPreview()
  view.focus()
  saveSession()
}

/** 生成十六进制转储文本(超大文件截断显示) */
function renderHex(t: Tab) {
  const pre = document.getElementById('hexview-pre')!
  const bytes = t.hexData!
  const DISPLAY = 256 * 1024
  const limit = Math.min(bytes.length, DISPLAY)
  const lines: string[] = []
  for (let off = 0; off < limit; off += 16) {
    const chunk = bytes.subarray(off, Math.min(off + 16, limit))
    let hex = ''
    let ascii = ''
    for (const b of chunk) {
      hex += b.toString(16).padStart(2, '0') + ' '
      ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '·'
    }
    lines.push(off.toString(16).padStart(8, '0') + '  ' + hex.padEnd(48) + ' |' + ascii + '|')
  }
  if (t.hexTruncated) lines.push(`… 仅显示前 ${(DISPLAY / 1024) | 0} KB,共 ${bytes.length} 字节`)
  pre.textContent = lines.join('\n')
}

/** 保存前拦截:十六进制模式只读 */
// ── 保存 ────────────────────────────────────────────────
export async function saveTab(t: Tab, as = false): Promise<boolean> {
  if (t.hex) {
    toast('十六进制查看为只读')
    return false
  }
  let path = t.path
  if (!path || as) {
    const p = await saveDialog({
      defaultPath: t.path ?? t.name,
      title: '另存为',
      filters: [{ name: '所有文件', extensions: ['*'] }],
    })
    if (!p) return false
    path = p
  }
  const text = normalizeEol(getDoc(t).toString(), t.eol)
  let hadErr = false
  try {
    const [, had] = await ipc.writeText(path, text, t.encoding)
    hadErr = had
  } catch (e) {
    toast(`保存失败:${e}`)
    return false
  }
  t.path = path
  t.name = basename(path)
  t.clean = getDoc(t)
  try {
    const st = await ipc.statFile(path)
    t.mtimeMs = st.mtime_ms
    t.fileSize = st.size
  } catch { /* 刚写完的文件 stat 失败可忽略 */ }
  renderTabs()
  refreshStatus()
  updateTitle()
  addRecent(path)
  saveSession()
  sidebarFollow(t)
  if (hadErr) toast('部分字符无法用当前编码表示,已替换为近似字符')
  return true
}

export async function saveActive(as = false) {
  const t = activeTab()
  if (t) await saveTab(t, as)
}

export async function saveAll() {
  for (const t of [...store.tabs]) {
    if (isDirty(t)) await saveTab(t)
  }
}

// ── 关闭 ────────────────────────────────────────────────
export async function closeTab(id: number, skipConfirm = false): Promise<boolean> {
  const t = store.tabs.find((x) => x.id === id)
  if (!t) return true
  if (isDirty(t) && !skipConfirm) {
    const act = await confirm3(`${t.name} 有未保存的更改。`)
    if (act === 'cancel') return false
    if (act === 'save') {
      const ok = await saveTab(t)
      if (!ok) return false
    }
  }
  const idx = store.tabs.indexOf(t)
  store.tabs.splice(idx, 1)
  if (store.tabs.length === 0) {
    store.activeId = -1
    store.view!.setState(makeState(''))
    renderTabs()
    refreshStatus()
    updateTitle()
    refreshPreview()
    saveSession()
    return true
  }
  if (store.activeId === id) {
    const next = store.tabs[Math.min(idx, store.tabs.length - 1)]
    store.activeId = -1
    activate(next.id)
  } else {
    renderTabs()
  }
  saveSession()
  return true
}

async function closeOthers(keepId: number) {
  for (const t of [...store.tabs]) {
    if (t.id !== keepId && !(await closeTab(t.id))) break
  }
}

/** Ctrl+Tab / Ctrl+Shift+Tab:切换到下一个/上一个标签 */
export function cycleTab(dir: 1 | -1) {
  if (store.tabs.length < 2) return
  const idx = store.tabs.findIndex((t) => t.id === store.activeId)
  const next = store.tabs[(idx + dir + store.tabs.length) % store.tabs.length]
  activate(next.id)
}

/** 退出前检查全部脏标签 */
export async function confirmQuit(): Promise<boolean> {
  const dirty = store.tabs.filter((t) => isDirty(t))
  if (dirty.length === 0) return true
  if (dirty.length === 1) {
    const act = await confirm3(`${dirty[0].name} 有未保存的更改。`)
    if (act === 'save') return await saveTab(dirty[0])
    return act === 'discard'
  }
  return await confirmModal(`${dirty.length} 个标签有未保存的更改,仍要退出吗?未保存内容将丢失。`)
}

// ── 外部修改 / 手动重载 ─────────────────────────────────
export async function reloadTab(t: Tab, silent = false): Promise<void> {
  if (!t.path) return
  try {
    const bytes = await ipc.readFile(t.path)
    const { enc, text } = detectEncoding(bytes)
    const st = await ipc.statFile(t.path)
    const docText = text.replace(/\r\n?/g, '\n')
    if (t.id === store.activeId) {
      const view = store.view!
      const pos = Math.min(view.state.selection.main.head, docText.length)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: docText } })
      view.dispatch({ selection: { anchor: pos } })
      t.clean = view.state.doc
    } else {
      t.state = t.state.update({ changes: { from: 0, to: t.state.doc.length, insert: docText } }).state
      t.clean = t.state.doc
    }
    t.encoding = enc
    t.mtimeMs = st.mtime_ms
    t.fileSize = st.size
    if (!silent) toast('已从磁盘重新加载')
    refreshStatus()
    updateTitle()
    refreshPreview()
  } catch (e) {
    if (!silent) toast(`重新加载失败:${e}`)
  }
}

/** 以指定编码重新读取磁盘文件 */
export async function reloadWithEncoding(t: Tab, enc: EncName) {
  if (!t.path) return
  if (isDirty(t)) {
    const ok = await confirmModal('当前有未保存的更改,重新打开将丢失。继续吗?')
    if (!ok) return
  }
  try {
    const bytes = await ipc.readFile(t.path)
    const text = decodeAs(bytes, enc)
    const st = await ipc.statFile(t.path)
    const docText = text.replace(/\r\n?/g, '\n')
    t.encoding = enc
    t.eol = detectEol(text)
    if (t.id === store.activeId) {
      const view = store.view!
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: docText } })
      t.clean = view.state.doc
    } else {
      t.state = t.state.update({ changes: { from: 0, to: t.state.doc.length, insert: docText } }).state
      t.clean = t.state.doc
    }
    t.mtimeMs = st.mtime_ms
    t.fileSize = bytes.length
    refreshStatus()
    updateTitle()
    toast(`已以 ${enc} 重新打开`)
  } catch (e) {
    toast(`重新打开失败:${e}`)
  }
}

/** 侧栏重命名后同步已打开的标签 */
export function syncRename(oldPath: string, newPath: string) {
  const t = store.tabs.find((x) => x.path === oldPath)
  if (!t) return
  t.path = newPath
  t.name = basename(newPath)
  renderTabs()
  updateTitle()
  void attachLang(t)
}

// ── 脏标记(防抖精确比对 + 会话草稿) ─────────────────────
let dirtyTimer: ReturnType<typeof setTimeout> | undefined
function scheduleDirtyCheck() {
  clearTimeout(dirtyTimer)
  dirtyTimer = setTimeout(() => {
    const t = activeTab()
    if (!t) return
    const nowDirty = isDirty(t)
    if (nowDirty !== t.dirty) {
      t.dirty = nowDirty
      renderTabs()
      updateTitle()
    }
    saveSession()
  }, 600)
}

/** main.ts 调用:接线编辑器钩子 */
export function initTabs() {
  hooks.onDocChanged = () => {
    const t = activeTab()
    if (!t) return
    if (!t.dirty) {
      t.dirty = true
      renderTabs()
      updateTitle()
    }
    refreshStatus()
    refreshPreview()
    scheduleDirtyCheck()
  }
  el('btn-recents').addEventListener('click', () => showRecentsMenu(el('btn-recents')))
}

/** 最近文件下拉 */
export function showRecentsMenu(anchor: HTMLElement) {
  const list = getRecents()
  if (list.length === 0) {
    toast('暂无最近打开的文件')
    return
  }
  const r = anchor.getBoundingClientRect()
  showPopup(r.left, r.bottom + 4, [
    ...list.map((p) => ({ label: p, action: () => void openPath(p) })),
    { sep: true },
    { label: '清空最近列表', action: () => localStorage.removeItem('litedit.recents') },
  ])
}
