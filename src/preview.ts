import { settings, saveSettings, activeTab, store, type Tab } from './state'
import { ipc } from './ipc'
import { toast } from './toast'

const PREVIEW_MAX = 1_000_000

type MdRenderer = { render: (s: string) => string }
let mdMod: Promise<MdRenderer> | null = null
let renderTimer: ReturnType<typeof setTimeout> | undefined

const el = (id: string) => document.getElementById(id)!

function getMd(): Promise<MdRenderer> {
  mdMod ??= import('markdown-it').then((m) => {
    // markdown-it 默认导出是类,需实例化;html:false 防注入
    const Cls = (m.default ?? m) as unknown as new (o?: object) => MdRenderer
    return new Cls({ html: false, linkify: true })
  })
  return mdMod
}

/** 内容变化防抖渲染;显隐即时 */
export function refreshPreview() {
  const t = activeTab()
  const isMd = !!t && /\.(md|markdown)$/i.test(t.name)
  const isHtml = !!t && /\.x?html?$/i.test(t.name)
  const show = settings.preview && !!t && (isMd || isHtml)
  el('preview-pane').classList.toggle('visible', show)
  if (!show || !t) return
  el('preview-title').textContent = isMd ? 'Markdown 预览' : 'HTML 预览'
  clearTimeout(renderTimer)
  renderTimer = setTimeout(() => void render(t, isMd), 300)
}

async function render(t: Tab, isMd: boolean) {
  if (activeTab()?.id !== t.id) return
  const text = getDocText(t)
  const body = el('preview-body')
  if (text.length > PREVIEW_MAX) {
    body.className = ''
    body.innerHTML = '<div style="padding:16px;color:var(--fg-dim)">文件过大,预览已跳过</div>'
    return
  }
  if (isMd) {
    body.className = 'md'
    try {
      const md = await getMd()
      body.innerHTML = md.render(text)
    } catch {
      body.textContent = text
    }
  } else {
    body.className = ''
    body.innerHTML = ''
    const iframe = document.createElement('iframe')
    iframe.sandbox = '' // 全禁脚本,纯静态预览
    iframe.srcdoc = text
    body.appendChild(iframe)
  }
}

function getDocText(t: Tab): string {
  return (t.id === store.activeId ? store.view!.state.doc : t.state.doc).toString()
}

export function initPreview() {
  el('btn-preview-close').addEventListener('click', () => {
    settings.preview = false
    saveSettings()
    void ipc.setMenuChecks({ wrap: settings.wrap, whitespace: settings.whitespace, sidebar: settings.sidebar, preview: false, toolbar: settings.toolbar, tab_bottom: settings.tabsBottom, menu_hidden: settings.menuHidden })
    refreshPreview()
  })
}

/** 预览窗格因文件类型不适用时提示一次 */
export function previewHintFor(name: string) {
  if (settings.preview && !/\.(md|markdown|x?html?)$/i.test(name)) {
    toast('预览分栏仅支持 Markdown / HTML 文件')
  }
}
