/** 工具栏:图标 + 文字按钮,按钮动作走统一 dispatchAction */
import { settings } from './state'

function svg(paths: string): string {
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

const I = {
  new: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15h6"/>',
  open: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  saveall: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>',
  find: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  replace: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
}

type Btn = { icon?: string; text?: string; title: string; action: string }
const LAYOUT: (Btn | 'sep')[] = [
  { icon: I.new, title: '新建 (Ctrl+N)', action: 'new_file' },
  { icon: I.open, title: '打开 (Ctrl+O)', action: 'open_file' },
  { icon: I.save, title: '保存 (Ctrl+S)', action: 'save' },
  { icon: I.saveall, title: '全部保存 (Ctrl+Alt+S)', action: 'save_all' },
  'sep',
  { icon: I.undo, title: '撤销 (Ctrl+Z)', action: 'undo' },
  { icon: I.redo, title: '重做 (Ctrl+Y)', action: 'redo' },
  'sep',
  { icon: I.find, title: '查找 (Ctrl+F)', action: 'find' },
  { icon: I.replace, title: '替换 (Ctrl+H)', action: 'replace' },
  'sep',
  { text: "'列表'", title: '合并为列表(单引号,SQL 转义) Ctrl+1', action: 'list_single' },
  { text: '"列表"', title: '合并为列表(双引号) Ctrl+2', action: 'list_double' },
  { text: '列表', title: '合并为列表(不加引号,整型等) Ctrl+3', action: 'list_none' },
  { text: '还原', title: '列表还原(拆分为多行) Ctrl+4', action: 'list_restore' },
  'sep',
  { text: 'JSON', title: 'JSON 格式化 Ctrl+5', action: 'json_format' },
  { text: 'JSON压', title: 'JSON 压缩 Ctrl+6', action: 'json_minify' },
  { text: 'SQL', title: 'SQL 格式化 Ctrl+7', action: 'sql_format' },
  { text: 'SQL压', title: 'SQL 压缩 Ctrl+8', action: 'sql_minify' },
  'sep',
  { text: '排序', title: '行排序(升序)', action: 'sort_asc' },
  { text: '去重', title: '删除重复行', action: 'sort_unique' },
  { text: '查重', title: '高亮重复行(点击切换)', action: 'toggle_dup' },
  'sep',
  { text: '换行', title: '自动换行(点击切换) Ctrl+Alt+W', action: 'toggle_wrap' },
]

export function initToolbar(dispatch: (id: string) => void) {
  const bar = document.getElementById('toolbar')!
  for (const item of LAYOUT) {
    if (item === 'sep') {
      const s = document.createElement('div')
      s.className = 'tsep'
      bar.appendChild(s)
      continue
    }
    const btn = document.createElement('button')
    btn.className = 'tbtn'
    btn.title = item.title
    btn.dataset.action = item.action
    if (item.icon) btn.innerHTML = svg(item.icon)
    if (item.text) {
      const t = document.createElement('span')
      t.textContent = item.text
      btn.appendChild(t)
    }
    btn.addEventListener('click', () => dispatch(item.action))
    bar.appendChild(btn)
  }
}

/** 开关型按钮的按下态(自动换行/高亮重复行) */
export function refreshToolbarStates() {
  document.querySelectorAll('#toolbar .tbtn[data-action]').forEach((b) => {
    const a = b.getAttribute('data-action')
    const on = (a === 'toggle_wrap' && settings.wrap) || (a === 'toggle_dup' && settings.dupHighlight)
    b.classList.toggle('active', on)
  })
}

export function applyToolbarVisible(visible: boolean) {
  document.getElementById('toolbar')!.classList.toggle('hidden', !visible)
}
