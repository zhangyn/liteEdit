import { ENC_LABELS, EOL_LABELS } from './encoding'
import { activeTab, store, type Eol, type EncName } from './state'
import { showPopup } from './popup'

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const el = (id: string) => document.getElementById(id)!

/** 刷新状态栏全部字段(在光标/文档/标签变化时调用) */
export function refreshStatus() {
  const tab = activeTab()
  const view = store.view
  if (!tab || !view) {
    el('st-pos').textContent = '就绪'
    el('st-sel').textContent = ''
    el('st-size').textContent = ''
    el('st-lang').textContent = '纯文本'
    el('st-eol').textContent = ''
    el('st-enc').textContent = ''
    return
  }
  if (tab.hex) {
    el('st-pos').textContent = '十六进制(只读)'
    el('st-sel').textContent = ''
    el('st-size').textContent = formatBytes(tab.fileSize)
    el('st-lang').textContent = '二进制'
    el('st-eol').textContent = '—'
    el('st-enc').textContent = '—'
    return
  }
  const state = view.state
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  el('st-pos').textContent = `行 ${line.number}, 列 ${head - line.from + 1}`
  let selChars = 0
  let hasSel = false
  for (const r of state.selection.ranges) {
    if (!r.empty) {
      hasSel = true
      selChars += r.to - r.from
    }
  }
  el('st-sel').textContent = hasSel ? `选中 ${state.selection.ranges.length} 处 / ${selChars} 字符` : ''
  el('st-size').textContent = formatBytes(tab.fileSize || state.doc.length)
  el('st-lang').textContent = tab.langLabel
  el('st-eol').textContent = EOL_LABELS[tab.eol]
  el('st-enc').textContent = ENC_LABELS[tab.encoding]
}

/** 编码 / EOL / 语言 点击弹层 */
export function initStatusbar(onEncodingChanged: () => void) {
  el('st-eol').addEventListener('click', () => {
    const tab = activeTab()
    if (!tab) return
    showPopupOn(el('st-eol'), (['CRLF', 'LF', 'CR'] as const).map((k) => ({
      label: k,
      checked: EOL_LABELS[tab.eol] === k,
      action: () => {
        tab.eol = k as Eol
        refreshStatus()
      },
    })))
  })

  el('st-enc').addEventListener('click', () => {
    const tab = activeTab()
    if (!tab) return
    const encItems = (Object.keys(ENC_LABELS) as EncName[]).map((e) => ({
      label: ENC_LABELS[e],
      checked: tab.encoding === e,
      action: () => {
        tab.encoding = e
        refreshStatus()
        onEncodingChanged()
      },
    }))
    showPopupOn(el('st-enc'), [
      ...encItems,
      { sep: true },
      { label: '以当前编码重新打开…', action: () => window.dispatchEvent(new CustomEvent('litedit:reload-as')) },
    ])
  })
}

function showPopupOn(anchor: HTMLElement, items: Parameters<typeof showPopup>[2]) {
  const r = anchor.getBoundingClientRect()
  showPopup(r.left, r.top - 6 - items.length * 26, items)
}
