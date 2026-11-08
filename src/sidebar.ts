import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ipc } from './ipc'
import { activeTab, type Tab } from './state'
import { showPopup } from './popup'
import { toast } from './toast'
import { confirmModal } from './modal'
import { dirname, openPath, syncRename } from './tabs'

const HIDDEN = new Set(['$RECYCLE.BIN', 'System Volume Information', 'desktop.ini'])

let root: string | null = null
const expanded = new Set<string>()
let activeFile: string | null = null

const el = (id: string) => document.getElementById(id)!

const BADGE_COLORS: Record<string, string> = {
  js: '#e8d44d', mjs: '#e8d44d', cjs: '#e8d44d', ts: '#3178c6', tsx: '#3178c6', jsx: '#e8d44d',
  json: '#8bc34a', html: '#e44d26', htm: '#e44d26', css: '#42a5f5', scss: '#c76494', less: '#2f6ea8',
  md: '#42b983', py: '#3572A5', rs: '#dea584', go: '#00ADD8', java: '#b07219', c: '#555555',
  cpp: '#f34b7d', h: '#8a6bae', sql: '#e38c00', xml: '#0060ac', svg: '#ffb13b', sh: '#89e051',
  ps1: '#012456', bat: '#c1f12e', cmd: '#c1f12e', php: '#4F5D95', rb: '#701516', lua: '#000080',
  yaml: '#cb171e', yml: '#cb171e', toml: '#9c4221', ini: '#6e7781', txt: '#6e7781', log: '#6e7781',
}

function badgeFor(name: string): { text: string; color: string } {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().slice(0, 4) : 'txt'
  return { text: ext.toUpperCase(), color: BADGE_COLORS[ext] ?? '#6e7781' }
}

/** 激活标签变化 → 根目录跟随其所在文件夹,并高亮该文件 */
export function sidebarFollow(t: Tab) {
  activeFile = t.path
  if (!t.path) return renderTree()
  const dir = dirname(t.path)
  if (!root || !t.path.toLowerCase().startsWith(root.toLowerCase())) {
    root = dir
    renderTree()
    return
  }
  // 确保祖先目录处于展开状态
  let cur = dir
  const parts: string[] = []
  while (cur.toLowerCase() !== (root ?? '').toLowerCase() && cur.length > (root?.length ?? 0)) {
    parts.push(cur)
    cur = dirname(cur)
  }
  for (const p of parts) expanded.add(p)
  renderTree()
}

export async function setRoot(p: string) {
  root = p
  expanded.clear()
  expanded.add(p)
  await renderTree()
}

export function initSidebar() {
  // 初始显隐由 settings 决定(main.ts 处理),这里只绑按钮
  el('btn-sidebar-root').addEventListener('click', async () => {
    const p = await openDialog({ directory: true, title: '选择根目录' })
    if (typeof p === 'string') await setRoot(p)
  })
  el('filetree').addEventListener('contextmenu', (e) => {
    const node = (e.target as HTMLElement).closest('.tree-node') as HTMLElement | null
    if (!node && root) {
      e.preventDefault()
      showPopup(e.clientX, e.clientY, [
        { label: '新建文件', action: () => startCreate(root!, false) },
        { label: '新建文件夹', action: () => startCreate(root!, true) },
        { sep: true },
        { label: '刷新', action: () => void renderTree() },
      ])
    }
  })
}

export async function renderTree() {
  const gen = ++renderGen
  const box = el('filetree')
  box.innerHTML = ''
  if (!root) {
    const hint = document.createElement('div')
    hint.style.cssText = 'padding:14px;color:var(--fg-dim);line-height:1.6'
    hint.textContent = '打开文件后此处显示其所在目录;或点击右上角 📂 选择根目录。'
    box.appendChild(hint)
    return
  }
  if (!expanded.has(root)) expanded.add(root)
  await renderLevel(box, root, 0, gen)
}

/** 渲染代数:并发触发时旧渲染在 await 后自行失效,避免节点重复 */
let renderGen = 0

async function renderLevel(container: HTMLElement, dir: string, depth: number, gen: number) {
  let entries
  try {
    entries = await ipc.readDir(dir)
  } catch {
    return
  }
  if (gen !== renderGen) return
  entries.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  for (const e of entries) {
    if (HIDDEN.has(e.name) || e.name.startsWith('.')) continue
    container.appendChild(makeNode(e, depth))
  }
}

function makeNode(e: { name: string; path: string; is_dir: boolean }, depth: number): HTMLElement {
  const node = document.createElement('div')
  node.className = 'tree-node'
  node.style.paddingLeft = 8 + depth * 14 + 'px'
  node.dataset.path = e.path

  const arrow = document.createElement('span')
  arrow.className = 'arrow'
  if (e.is_dir) arrow.textContent = expanded.has(e.path) ? '▾' : '▸'
  node.appendChild(arrow)

  if (e.is_dir) {
    const icon = document.createElement('span')
    icon.textContent = '📁'
    const name = document.createElement('span')
    name.textContent = e.name
    node.append(icon, name)
    node.addEventListener('click', () => toggleDir(node, e.path, depth))
    node.addEventListener('contextmenu', (ev) => {
      ev.preventDefault()
      dirMenu(ev, e)
    })
  } else {
    const badge = document.createElement('span')
    badge.className = 't-badge'
    const { text, color } = badgeFor(e.name)
    badge.textContent = text
    badge.style.background = color
    const name = document.createElement('span')
    name.textContent = e.name
    node.append(badge, name)
    if (e.path === activeFile) node.classList.add('active')
    node.addEventListener('click', () => void openPath(e.path))
    node.addEventListener('contextmenu', (ev) => {
      ev.preventDefault()
      fileMenu(ev, e)
    })
  }
  return node
}

async function toggleDir(node: HTMLElement, path: string, depth: number) {
  // 移除紧邻的兄弟子级容器(重复点击防抖)
  let next = node.nextElementSibling
  if (next && next.classList.contains('tree-children')) {
    expanded.delete(path)
    next.remove()
    node.querySelector('.arrow')!.textContent = '▸'
    return
  }
  expanded.add(path)
  node.querySelector('.arrow')!.textContent = '▾'
  const childBox = document.createElement('div')
  childBox.className = 'tree-children'
  node.after(childBox)
  await renderLevel(childBox, path, depth + 1, renderGen)
  if (!childBox.childElementCount) {
    const empty = document.createElement('div')
    empty.className = 'tree-node'
    empty.style.cssText = `padding-left:${8 + (depth + 1) * 14}px;color:var(--fg-dim)`
    empty.textContent = '(空)'
    childBox.appendChild(empty)
  }
}

// ── 右键菜单 ────────────────────────────────────────────
function dirMenu(ev: MouseEvent, e: { name: string; path: string }) {
  showPopup(ev.clientX, ev.clientY, [
    { label: '新建文件', action: () => startCreate(e.path, false) },
    { label: '新建文件夹', action: () => startCreate(e.path, true) },
    { sep: true },
    { label: '重命名', action: () => startRename(e.path, e.name, true) },
    { label: '删除(进回收站)', action: () => void deleteEntry(e.path, e.name) },
    { sep: true },
    { label: '在资源管理器中显示', action: () => void ipc.reveal(e.path) },
    { label: '刷新', action: () => void renderTree() },
  ])
}

function fileMenu(ev: MouseEvent, e: { name: string; path: string }) {
  showPopup(ev.clientX, ev.clientY, [
    { label: '打开', action: () => void openPath(e.path) },
    { sep: true },
    { label: '重命名', action: () => startRename(e.path, e.name, false) },
    { label: '删除(进回收站)', action: () => void deleteEntry(e.path, e.name) },
    { sep: true },
    { label: '在资源管理器中显示', action: () => void ipc.reveal(e.path) },
    { label: '复制文件路径', action: () => void navigator.clipboard.writeText(e.path) },
  ])
}

// ── 行内新建 / 重命名 ───────────────────────────────────
function inlineInput(node: HTMLElement, initial: string, commit: (v: string) => void) {
  const input = document.createElement('input')
  input.value = initial
  const original = Array.from(node.children) as HTMLElement[]
  original.forEach((c) => (c.style.display = 'none'))
  node.appendChild(input)
  input.focus()
  input.select()
  let done = false
  const finish = (ok: boolean) => {
    if (done) return
    done = true
    const v = input.value.trim()
    input.remove()
    original.forEach((c) => (c.style.display = ''))
    if (ok && v) commit(v)
  }
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') finish(true)
    else if (ev.key === 'Escape') finish(false)
    ev.stopPropagation()
  })
  input.addEventListener('blur', () => finish(true))
}

function startCreate(dir: string, isDir: boolean) {
  expanded.add(dir)
  void renderTree().then(() => {
    // 找到目标目录节点,在其子级容器顶部插入输入节点
    const dirNode = el('filetree').querySelector(`.tree-node[data-path="${CSS.escape(dir)}"]`) as HTMLElement | null
    if (!dirNode) return
    let container = dirNode.nextElementSibling as HTMLElement | null
    if (!container || !container.classList.contains('tree-children')) {
      void toggleDir(dirNode, dir, depthOf(dirNode))
      container = dirNode.nextElementSibling as HTMLElement | null
    }
    if (!container) return
    const holder = document.createElement('div')
    holder.className = 'tree-node'
    holder.style.paddingLeft = (depthOf(dirNode) + 1) * 14 + 8 + 'px'
    const input = document.createElement('input')
    input.placeholder = isDir ? '文件夹名称' : '文件名'
    holder.appendChild(input)
    container.insertBefore(holder, container.firstChild)
    input.focus()
    let done = false
    const finish = async (ok: boolean) => {
      if (done) return
      done = true
      const v = input.value.trim()
      holder.remove()
      if (!ok || !v) return
      const target = dir + '\\' + v
      try {
        if (isDir) await ipc.createDir(target)
        else await ipc.createFile(target)
        toast(`已创建:${v}`)
        await renderTree()
        if (!isDir) void openPath(target)
      } catch (err) {
        toast(`创建失败:${err}`)
      }
    }
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void finish(true)
      else if (ev.key === 'Escape') void finish(false)
      ev.stopPropagation()
    })
    input.addEventListener('blur', () => void finish(true))
  })
}

function depthOf(node: HTMLElement): number {
  const pl = parseInt(node.style.paddingLeft || '8', 10)
  return Math.max(0, Math.round((pl - 8) / 14))
}

function startRename(path: string, name: string, isDir: boolean) {
  const node = el('filetree').querySelector(`.tree-node[data-path="${CSS.escape(path)}"]`) as HTMLElement | null
  if (!node) return
  inlineInput(node, name, async (v) => {
    if (v === name) return
    const parent = dirname(path)
    const sep = path.slice(parent.length).startsWith('\\') ? '\\' : '/'
    const target = parent + sep + v
    try {
      await ipc.renameEntry(path, target)
      syncRename(path, target)
      toast(`已重命名:${v}`)
      await renderTree()
    } catch (err) {
      toast(`重命名失败:${err}`)
    }
    void isDir
  })
}

async function deleteEntry(path: string, name: string) {
  const ok = await confirmModal(`确定删除「${name}」吗?将移入回收站。`)
  if (!ok) return
  try {
    await ipc.trashDelete(path)
    toast(`已删除:${name}`)
    await renderTree()
  } catch (err) {
    toast(`删除失败:${err}`)
  }
}

/** main.ts 调用:按设置显隐 */
export function applySidebarVisible(v: boolean) {
  el('sidebar').classList.toggle('hidden', !v)
  if (v && !root) {
    const t = activeTab()
    if (t?.path) void setRoot(dirname(t.path))
    else void renderTree()
  }
}
