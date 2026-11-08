import './styles.css'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { undo, redo, deleteLine, moveLineUp, moveLineDown } from '@codemirror/commands'
import { gotoLine, openSearchPanel, findNext, findPrevious } from '@codemirror/search'
import { createView, applyTabCompartments, hooks, duplicateLine, openLineBelow, openLineAbove, toggleBookmark, gotoBookmark, toggleDupHighlight } from './editor'
import { store, settings, saveSettings, activeTab } from './state'
import { ipc } from './ipc'
import {
  closeTab, confirmQuit, cycleTab, newFile, openPath, openFileDialog,
  reloadWithEncoding, saveActive, saveAll, dirname,
} from './tabs'
import { recordCursor } from './cursor-history'
import { applyTool } from './tools'
import { codecActions } from './codecs'
import { initFindInFiles, openFindInFilesDialog } from './findinfiles'
import { initToolbar, applyToolbarVisible, refreshToolbarStates } from './toolbar'

/** 全局快捷键兜底表(原生菜单加速键失效时也能用;同一动作 120ms 内去重防双触发) */
const KEY_ACTIONS: Record<string, string> = {
  'Ctrl+n': 'new_file', 'Ctrl+o': 'open_file', 'Ctrl+s': 'save',
  'Ctrl+Shift+s': 'save_as', 'Ctrl+Alt+s': 'save_all', 'Ctrl+w': 'close_tab',
  'Ctrl+F4': 'close_tab', 'Ctrl+Tab': 'next_tab', 'Ctrl+Shift+Tab': 'prev_tab',
  'Ctrl+z': 'undo', 'Ctrl+y': 'redo',
  'Ctrl+f': 'find', 'Ctrl+h': 'replace', 'F3': 'find_next', 'Shift+F3': 'find_prev',
  'Ctrl+Shift+f': 'find_in_files',
  'Ctrl+g': 'goto', 'Ctrl+d': 'duplicate_line', 'Ctrl+Shift+k': 'delete_line',
  'Ctrl+Alt+ArrowUp': 'move_line_up', 'Ctrl+Alt+ArrowDown': 'move_line_down',
  'Ctrl+Enter': 'open_line_below', 'Ctrl+Shift+Enter': 'open_line_above',
  'Ctrl+Shift+u': 'to_upper', 'Ctrl+u': 'to_lower', 'Ctrl+;': 'insert_datetime',
  'Ctrl+Alt+w': 'toggle_wrap', 'Ctrl+b': 'toggle_sidebar', 'Ctrl+Alt+v': 'toggle_preview',
  'Ctrl+Alt+t': 'toggle_theme', 'Ctrl+=': 'zoom_in', 'Ctrl+-': 'zoom_out', 'Ctrl+0': 'zoom_reset',
  'Ctrl+1': 'list_single', 'Ctrl+2': 'list_double', 'Ctrl+3': 'list_none', 'Ctrl+4': 'list_restore',
  'Ctrl+5': 'json_format', 'Ctrl+6': 'json_minify', 'Ctrl+7': 'sql_format', 'Ctrl+8': 'sql_minify',
  'Ctrl+m': 'toggle_menubar',
}
import { initStatusbar, refreshStatus } from './statusbar'
import { initSidebar, applySidebarVisible, setRoot, renderTree } from './sidebar'
import { initPreview, refreshPreview, previewHintFor } from './preview'
import { restoreSession } from './session'
import { startWatch } from './watch'
import { initTheme, toggleTheme } from './theme'
import { toast } from './toast'
import { showPopup } from './popup'
import { ENC_LABELS } from './encoding'
import type { EncName } from './state'

const el = (id: string) => document.getElementById(id)!

// ── 全局设置应用到界面 ──────────────────────────────────
// 切换只作用于当前视图;后台标签在下次 activate 时由 applyTabCompartments 统一挂载
function applyWrapToAll(on: boolean) {
  settings.wrap = on
  const t = activeTab()
  if (t) applyTabCompartments(store.view!, t)
}

function applyWhitespaceToAll(on: boolean) {
  settings.whitespace = on
  const t = activeTab()
  if (t) applyTabCompartments(store.view!, t)
}

function syncMenuChecks() {
  void ipc.setMenuChecks({
    wrap: settings.wrap,
    whitespace: settings.whitespace,
    sidebar: settings.sidebar,
    preview: settings.preview,
    toolbar: settings.toolbar,
    tab_bottom: settings.tabsBottom,
    menu_hidden: settings.menuHidden,
  })
}

function applyFontSize(n: number) {
  settings.fontSize = Math.max(10, Math.min(28, n))
  document.documentElement.style.setProperty('--ed-font-size', settings.fontSize + 'px')
  saveSettings()
}

/** 菜单栏显隐:原生菜单 + 标签栏上的呼回按钮 + 查看菜单勾选状态 */
function applyMenuHidden(hidden: boolean) {
  settings.menuHidden = hidden
  saveSettings()
  void ipc.setMenuVisible(!hidden)
  document.getElementById('btn-menu-restore')!.classList.toggle('hidden', !hidden)
  syncMenuChecks()
}

/** 选区(或光标处单词)大小写转换 */
function changeCase(upper: boolean): boolean {
  const view = store.view!
  const changes: { from: number; to: number; insert: string }[] = []
  for (const r of view.state.selection.ranges) {
    if (!r.empty) {
      const text = view.state.doc.sliceString(r.from, r.to)
      changes.push({ from: r.from, to: r.to, insert: upper ? text.toUpperCase() : text.toLowerCase() })
    } else {
      const w = view.state.wordAt(r.head)
      if (w) {
        const text = view.state.doc.sliceString(w.from, w.to)
        changes.push({ from: w.from, to: w.to, insert: upper ? text.toUpperCase() : text.toLowerCase() })
      }
    }
  }
  if (!changes.length) return false
  view.dispatch({ changes })
  return true
}

/** 插入当前日期时间 yyyy-MM-dd HH:mm:ss */
function insertDatetime(): boolean {
  const view = store.view!
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  view.dispatch(view.state.replaceSelection(stamp))
  return true
}

// ── 菜单动作分发 ────────────────────────────────────────
async function dispatchAction(id: string) {
  const view = store.view
  if (!view) return
  switch (id) {
    case 'new_file': {
      const t = newFile()
      if (t.path && settings.sidebar) await setRoot(dirname(t.path))
      break
    }
    case 'open_file':
      await openFileDialog()
      break
    case 'save':
      await saveActive()
      break
    case 'save_as':
      await saveActive(true)
      break
    case 'save_all':
      await saveAll()
      break
    case 'close_tab':
      if (activeTab()) await closeTab(activeTab()!.id)
      break
    case 'quit':
      if (await confirmQuit()) getCurrentWindow().destroy()
      break
    case 'undo':
      undo(view)
      break
    case 'redo':
      redo(view)
      break
    case 'duplicate_line':
      duplicateLine(view)
      break
    case 'delete_line':
      deleteLine(view)
      break
    case 'next_tab':
      cycleTab(1)
      break
    case 'prev_tab':
      cycleTab(-1)
      break
    case 'move_line_up':
      moveLineUp(view)
      break
    case 'move_line_down':
      moveLineDown(view)
      break
    case 'open_line_below':
      openLineBelow(view)
      break
    case 'open_line_above':
      openLineAbove(view)
      break
    case 'to_upper':
      changeCase(true)
      break
    case 'to_lower':
      changeCase(false)
      break
    case 'insert_datetime':
      insertDatetime()
      break
    case 'toggle_bookmark':
      toggleBookmark(view)
      break
    case 'next_bookmark':
      gotoBookmark(view, 1)
      break
    case 'prev_bookmark':
      gotoBookmark(view, -1)
      break
    case 'find':
    case 'replace':
      openSearchPanel(view)
      break
    case 'find_in_files':
      openFindInFilesDialog()
      break
    case 'find_next':
      findNext(view)
      break
    case 'find_prev':
      findPrevious(view)
      break
    case 'goto':
      gotoLine(view)
      break
    case 'toggle_wrap':
      settings.wrap = !settings.wrap
      saveSettings()
      applyWrapToAll(settings.wrap)
      refreshToolbarStates()
      syncMenuChecks()
      break
    case 'toggle_dup':
      settings.dupHighlight = !settings.dupHighlight
      saveSettings()
      toggleDupHighlight(view)
      refreshToolbarStates()
      break
    case 'toggle_whitespace':
      settings.whitespace = !settings.whitespace
      saveSettings()
      applyWhitespaceToAll(settings.whitespace)
      syncMenuChecks()
      break
    case 'toggle_sidebar':
      settings.sidebar = !settings.sidebar
      saveSettings()
      applySidebarVisible(settings.sidebar)
      syncMenuChecks()
      break
    case 'toggle_preview':
      settings.preview = !settings.preview
      saveSettings()
      refreshPreview()
      previewHintFor(activeTab()?.name ?? '')
      syncMenuChecks()
      break
    case 'toggle_toolbar':
      settings.toolbar = !settings.toolbar
      saveSettings()
      applyToolbarVisible(settings.toolbar)
      syncMenuChecks()
      break
    case 'toggle_tabs_bottom':
      settings.tabsBottom = !settings.tabsBottom
      saveSettings()
      document.body.dataset.tabs = settings.tabsBottom ? 'bottom' : 'top'
      syncMenuChecks()
      break
    case 'toggle_menubar':
      applyMenuHidden(!settings.menuHidden)
      break
    case 'zoom_in':
      applyFontSize(settings.fontSize + 1)
      break
    case 'zoom_out':
      applyFontSize(settings.fontSize - 1)
      break
    case 'zoom_reset':
      applyFontSize(14)
      break
    case 'toggle_theme':
      toggleTheme()
      break
    case 'json_format':
    case 'json_minify':
    case 'sql_format':
    case 'sql_minify':
    case 'list_single':
    case 'list_double':
    case 'list_none':
    case 'list_restore':
    case 'sort_asc':
    case 'sort_desc':
    case 'sort_unique':
      await applyTool(id)
      break
    case 'about':
      void message(await ipc.appVersion(), {
        title: '关于 LiteEdit',
        kind: 'info',
      })
      break
    default:
      if (codecActions[id]) {
        codecActions[id]()
      }
      break
  }
}

async function openThenFollow(path: string) {
  await openPath(path)
  const t = store.tabs.find((x) => x.path === path)
  if (t?.path && settings.sidebar) await setRoot(dirname(t.path))
}

// ── 以编码重新打开(状态栏触发) ─────────────────────────
function reloadAsPrompt() {
  const t = activeTab()
  if (!t) return
  if (!t.path) {
    toast('未保存的文件没有磁盘编码,保存时选择即可')
    return
  }
  showPopup(
    window.innerWidth / 2 - 110,
    window.innerHeight / 2 - 130,
    (Object.keys(ENC_LABELS) as EncName[]).map((e) => ({
      label: `以 ${ENC_LABELS[e]} 重新打开`,
      action: () => void reloadWithEncoding(t, e),
    })),
  )
}

// ── 启动 ────────────────────────────────────────────────
async function boot() {
  initTheme()
  applyFontSize(settings.fontSize)

  store.view = createView(el('editor-host'))

  // Ctrl+滚轮 缩放字体(preventDefault 阻止 WebView2 页面缩放)
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      applyFontSize(settings.fontSize + (e.deltaY < 0 ? 1 : -1))
    },
    { passive: false },
  )

  // 选中变化:刷新状态栏 + 记录光标历史(Ctrl+Shift+←/→ 消费)
  hooks.onSelChanged = () => {
    refreshStatus()
    if (store.view) recordCursor(store.view)
  }

  // 快捷键兜底:原生菜单加速键未拦截的按键在此处理
  // (已 preventDefault 的事件说明编辑器键位表处理过,跳过)
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return
    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key)
    const id = KEY_ACTIONS[parts.join('+')]
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    void dispatchAction(id)
  })

  initStatusbar(reloadAsPrompt)
  initPreview()
  initFindInFiles()
  initSidebar()
  applySidebarVisible(settings.sidebar)
  initToolbar((id) => void dispatchAction(id))
  applyToolbarVisible(settings.toolbar)
  refreshToolbarStates()
  document.body.dataset.tabs = settings.tabsBottom ? 'bottom' : 'top'
  void renderTree()
  refreshStatus()

  // 原生菜单事件
  await listen<string>('menu://action', (e) => void dispatchAction(e.payload))

  // 二次启动转发来的文件
  await listen<string[]>('open://files', (e) => {
    for (const p of e.payload) void openThenFollow(p)
  })

  // 拖放打开
  await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      for (const p of event.payload.paths) void openThenFollow(p)
    }
  })

  // 关闭窗口前确认
  getCurrentWindow().onCloseRequested(async (e) => {
    e.preventDefault()
    if (await confirmQuit()) getCurrentWindow().destroy()
  })

  // 状态栏"以编码重新打开"
  window.addEventListener('litedit:reload-as', reloadAsPrompt)
  // Ctrl+M(CM 键位表经自定义事件转发)
  window.addEventListener('litedit:toggle-menubar', () => applyMenuHidden(!settings.menuHidden))

  // 会话恢复 + 命令行文件
  const restored = await restoreSession()
  let cli: string[] = []
  try {
    cli = await ipc.cliFiles()
  } catch { /* ignore */ }
  for (const p of cli) await openPath(p, { silent: true })
  if (cli.length && settings.sidebar) await setRoot(dirname(cli[0]))

  if (!restored && cli.length === 0) newFile('未命名 1.txt')

  // 菜单栏隐藏偏好(隐藏后 Ctrl+M 或标签栏 ☰ 菜单按钮呼回)
  el('btn-menu-restore').addEventListener('click', () => applyMenuHidden(false))
  document.getElementById('btn-menu-restore')!.classList.toggle('hidden', !settings.menuHidden)
  if (settings.menuHidden) void ipc.setMenuVisible(false)

  syncMenuChecks()
  startWatch()
  store.view.focus()
}

void boot().catch((e) => {
  document.body.innerHTML = `<pre style="padding:20px;color:#c00;user-select:text">启动失败:${e}</pre>`
})

// 调试/自动化测试钩子(体积极小,便于 E2E 验证与排障)
;(window as unknown as Record<string, unknown>).__litedit = {
  view: () => store.view,
  store,
  applyTool,
  dispatch: (id: string) => dispatchAction(id),
}
