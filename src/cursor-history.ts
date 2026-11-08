import type { EditorView, KeyBinding } from '@codemirror/view'

/** 光标位置历史:跨行或大幅跳转时入栈,Ctrl+Shift+←/→ 后退/前进 */
const back: number[] = []
const fwd: number[] = []
const MAX = 200
let last = -1
let suppress = false

/** 在编辑器 update(selectionSet) 时调用 */
export function recordCursor(view: EditorView) {
  const pos = view.state.selection.main.head
  if (suppress) {
    suppress = false
    last = pos
    return
  }
  if (last < 0) {
    last = pos
    return
  }
  if (pos === last) return
  const lineA = view.state.doc.lineAt(Math.min(last, view.state.doc.length)).number
  const lineB = view.state.doc.lineAt(pos).number
  // 同行内小幅移动(输入/微调)不入栈
  if (lineA !== lineB || Math.abs(pos - last) > 60) {
    back.push(last)
    if (back.length > MAX) back.shift()
    fwd.length = 0
  }
  last = pos
}

export function goBack(view: EditorView): boolean {
  const cur = view.state.selection.main.head
  let target = -1
  while (back.length) {
    const p = back.pop()!
    if (p !== cur && p <= view.state.doc.length) {
      target = p
      break
    }
  }
  if (target < 0) return false
  fwd.push(cur)
  suppress = true
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true })
  return true
}

export function goForward(view: EditorView): boolean {
  const cur = view.state.selection.main.head
  let target = -1
  while (fwd.length) {
    const p = fwd.pop()!
    if (p !== cur && p <= view.state.doc.length) {
      target = p
      break
    }
  }
  if (target < 0) return false
  back.push(cur)
  suppress = true
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true })
  return true
}

export const cursorHistoryKeymap: KeyBinding[] = [
  { key: 'Mod-Shift-ArrowLeft', run: goBack },
  { key: 'Mod-Shift-ArrowRight', run: goForward },
]
