import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  keymap,
  lineNumbers,
  gutter,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle, foldGutter, foldKeymap, type LanguageSupport } from '@codemirror/language'
import { history, historyKeymap, defaultKeymap, indentWithTab, moveLineUp, moveLineDown } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, search, searchKeymap, selectNextOccurrence } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { cursorHistoryKeymap } from './cursor-history'
import { settings } from './state'

// ── 书签(F2 系) ────────────────────────────────────────
const setBookmarksEffect = StateEffect.define<number[]>()
const bookmarksField = StateField.define<number[]>({
  create: () => [],
  update(value, tr) {
    const eff = tr.effects.find((e) => e.is(setBookmarksEffect))
    if (eff) return eff.value
    return value.map((p) => tr.changes.mapPos(p, -1)).filter((p) => p >= 0 && p <= tr.state.doc.length)
  },
})

class BookmarkMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-bookmark'
    el.textContent = '▶'
    return el
  }
}
const bookmarkMarker = new BookmarkMarker()

function bookmarkGutter() {
  return gutter({
    class: 'cm-bookmark-gutter',
    markers: (view) => {
      const builder = new RangeSetBuilder<GutterMarker>()
      for (const pos of view.state.field(bookmarksField)) builder.add(pos, pos, bookmarkMarker)
      return builder.finish()
    },
  })
}

/** 切换当前行书签 */
export function toggleBookmark(view: EditorView): boolean {
  const lineFrom = view.state.doc.lineAt(view.state.selection.main.head).from
  const cur = view.state.field(bookmarksField)
  const next = cur.includes(lineFrom) ? cur.filter((p) => p !== lineFrom) : [...cur, lineFrom].sort((a, b) => a - b)
  view.dispatch({ effects: setBookmarksEffect.of(next) })
  return true
}

/** 跳转上一个/下一个书签(循环) */
export function gotoBookmark(view: EditorView, dir: 1 | -1): boolean {
  const list = view.state.field(bookmarksField)
  if (!list.length) return false
  const pos = view.state.selection.main.head
  let target: number
  if (dir === 1) target = list.find((p) => p > pos) ?? list[0]
  else {
    const smaller = list.filter((p) => p < pos)
    target = smaller.length ? smaller[smaller.length - 1] : list[list.length - 1]
  }
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true })
  return true
}

// ── 重复行高亮(工具栏"查重") ───────────────────────────
const toggleDupEffect = StateEffect.define<boolean>()
const dupEnabledField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => {
    const eff = tr.effects.find((e) => e.is(toggleDupEffect))
    return eff ? eff.value : v
  },
})
const dupPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none
    update(update: ViewUpdate) {
      const toggled = update.transactions.some((tr) => tr.effects.some((e) => e.is(toggleDupEffect)))
      if (update.docChanged || toggled) this.decorations = this.compute(update.view)
    }
    compute(view: EditorView): DecorationSet {
      if (!view.state.field(dupEnabledField, false)) return Decoration.none
      const counts = new Map<string, number>()
      const n = view.state.doc.lines
      for (let i = 1; i <= n; i++) {
        const t = view.state.doc.line(i).text.trim()
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
      }
      const b = new RangeSetBuilder<Decoration>()
      for (let i = 1; i <= n; i++) {
        const line = view.state.doc.line(i)
        const t = line.text.trim()
        if (t && (counts.get(t) ?? 0) > 1) b.add(line.from, line.from, Decoration.line({ class: 'cm-dup-line' }))
      }
      return b.finish()
    }
  },
  { decorations: (v) => v.decorations },
)

/** 切换重复行高亮(当前视图) */
export function toggleDupHighlight(view: EditorView): boolean {
  view.dispatch({ effects: toggleDupEffect.of(!view.state.field(dupEnabledField, false)) })
  return true
}

// ── 行编辑命令 ──────────────────────────────────────────
/** 重复当前行(光标移到新行同位置) */
export function duplicateLine(view: EditorView): boolean {
  const sel = view.state.selection.main
  const line = view.state.doc.lineAt(sel.head)
  const text = view.state.doc.sliceString(line.from, line.to)
  const cursorOffset = sel.head - line.from
  view.dispatch({
    changes: { from: line.to, insert: '\n' + text },
    selection: { anchor: line.to + 1 + cursorOffset },
  })
  return true
}

/** 在下方/上方打开新行,继承当前行缩进 */
export function openLineBelow(view: EditorView): boolean {
  const sel = view.state.selection.main
  const line = view.state.doc.lineAt(sel.head)
  const indent = /^\s*/.exec(line.text)![0]
  view.dispatch({
    changes: { from: line.to, insert: '\n' + indent },
    selection: { anchor: line.to + 1 + indent.length },
  })
  return true
}

export function openLineAbove(view: EditorView): boolean {
  const sel = view.state.selection.main
  const line = view.state.doc.lineAt(sel.head)
  const indent = /^\s*/.exec(line.text)![0]
  view.dispatch({
    changes: { from: line.from, insert: indent + '\n' },
    selection: { anchor: line.from + indent.length },
  })
  return true
}

/** 空选区时按 Ctrl+C/X:先扩选到整行,交给原生复制/剪切(剪切=剪切行) */
function expandToLine(view: EditorView): boolean {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const line = view.state.doc.lineAt(sel.head)
  view.dispatch({ selection: { anchor: line.from, head: line.to } })
  return false // 不阻止默认行为,原生复制/剪切接管
}

/** 切换行注释(读取语言包提供的 commentTokens,如 js=// html=<!-- -->) */
function toggleComment(view: EditorView): boolean {
  const tokens = view.state.languageDataAt<{ open: string; close?: string }>('commentTokens', view.state.selection.main.head)[0]
  if (!tokens) return false
  const close = tokens.close ?? ''
  const changes: { from: number; to?: number; insert?: string }[] = []
  const seen = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const fromLine = view.state.doc.lineAt(range.from)
    const toLine = view.state.doc.lineAt(range.to)
    for (let l = fromLine.number; l <= toLine.number; l++) {
      const line = view.state.doc.line(l)
      if (seen.has(l)) continue
      seen.add(l)
      const text = line.text
      const trimmed = text.trimStart()
      const indent = text.length - trimmed.length
      if (trimmed.startsWith(tokens.open)) {
        // 取消注释
        const openEnd = line.from + indent + tokens.open.length
        let to = openEnd
        if (close && trimmed.slice(-close.length) === close) to = line.to - close.length
        changes.push({ from: line.from + indent, to, insert: '' })
      } else if (text.length) {
        changes.push({ from: line.from + indent, insert: tokens.open })
        if (close) changes.push({ from: line.to, insert: close })
      }
    }
  }
  if (!changes.length) return false
  view.dispatch({ changes })
  return true
}

const commentKeymap: import('@codemirror/view').KeyBinding[] = [
  { key: 'Mod-/', run: toggleComment },
]

/** 语法/换行/空白符 用 Compartment 支持运行时重配 */
export const langComp = new Compartment()
export const wrapComp = new Compartment()
export const whitespaceComp = new Compartment()

/** 编辑器事件钩子(main.ts 注入) */
export const hooks: {
  onDocChanged?: () => void
  onSelChanged?: () => void
  onScroll?: () => void
} = {}

/** 界面文案中文化(CodeMirror 面板) */
const phrases = EditorState.phrases.of({
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  regexp: '正则表达式',
  'by word': '整词匹配',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 处',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'on line': '位于第 $ 行',
  'Go to line': '转到行',
  'go to line': '转到行',
  Line: '行号',
  'Use %v to jump between occurrences': '用 %v 在匹配之间跳转',
})

const cmTheme = EditorView.theme({
  '&': { color: 'var(--fg)', backgroundColor: 'var(--bg)', height: '100%' },
  '.cm-content': {
    caretColor: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--ed-font-size)',
    lineHeight: 'var(--ed-line-height, 1.55)',
  },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'var(--bg-gutter)', color: 'var(--fg-dim)', border: 'none', fontSize: '12px' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-active)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--sel) !important' },
  '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--sel) !important' },
  // 选区匹配:其余出现处用 --match;当前选区(main)被 CM 默认设为透明,显式覆盖为醒目色
  '.cm-selectionMatch': { backgroundColor: 'var(--match)' },
  '.cm-selectionMatch.cm-selectionMatch-main': { backgroundColor: 'var(--match-sel) !important' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-panels': { backgroundColor: 'var(--bg-panel)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-searchMatch': { backgroundColor: 'var(--match)', outline: '1px solid transparent' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--match-sel)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--fg)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    fontFamily: 'var(--font-ui)',
    background: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    padding: '1px 4px',
    outline: 'none',
  },
  '.cm-panel label': { fontSize: '12px' },
  '.cm-foldPlaceholder': { background: 'var(--bg-active)', border: 'none', color: 'var(--fg-dim)' },
})

/** 语法配色全部走 CSS 变量,深浅主题自动生效,无需重配扩展 */
const hlStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-kw)' },
  { tag: [t.comment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-str)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-num)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--syn-fn)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--syn-prop)' },
  { tag: [t.tagName], color: 'var(--syn-kw)' },
  { tag: [t.operator, t.operatorKeyword], color: 'var(--syn-op)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--syn-meta)' },
  { tag: [t.heading, t.strong], color: 'var(--syn-kw)', fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--syn-str)', textDecoration: 'underline' },
  { tag: [t.invalid], color: '#f00' },
])

export function baseExtensions(): Extension[] {
  return [
    phrases,
    lineNumbers(),
    foldGutter(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    closeBrackets(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of('\t'),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    bookmarkGutter(),
    bookmarksField,
    dupEnabledField,
    dupPlugin,
    keymap.of([
      // 必须先于 CM 内置键表:Mod-d 被 searchKeymap 占用,Mod-Enter/Mod-Alt-Arrow 也有内置绑定
      ...cursorHistoryKeymap,
      { key: 'Mod-d', run: duplicateLine },
      { key: 'Mod-Alt-d', run: selectNextOccurrence },
      { key: 'Mod-Alt-ArrowUp', run: moveLineUp },
      { key: 'Mod-Alt-ArrowDown', run: moveLineDown },
      { key: 'Mod-Enter', run: openLineBelow },
      { key: 'Mod-Shift-Enter', run: openLineAbove },
      { key: 'Mod-F2', run: toggleBookmark },
      { key: 'F2', run: (v) => gotoBookmark(v, 1) },
      { key: 'Shift-F2', run: (v) => gotoBookmark(v, -1) },
      { key: 'Mod-c', run: expandToLine },
      { key: 'Mod-x', run: expandToLine },
      // Ctrl+M 切换菜单栏:经自定义事件交给 main(main 持有 applyMenuHidden)
      { key: 'Mod-m', run: () => { window.dispatchEvent(new CustomEvent('litedit:toggle-menubar')); return true } },
      ...closeBracketsKeymap,
      ...foldKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...commentKeymap,
      indentWithTab,
    ]),
    cmTheme,
    syntaxHighlighting(hlStyle, { fallback: true }),
    langComp.of([]),
    wrapComp.of(settings.wrap ? EditorView.lineWrapping : []),
    whitespaceComp.of(settings.whitespace ? highlightWhitespace() : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) hooks.onDocChanged?.()
      if (u.selectionSet || u.docChanged) hooks.onSelChanged?.()
    }),
    EditorView.domEventHandlers({
      scroll: () => {
        hooks.onScroll?.()
        return false
      },
    }),
  ]
}

/** 创建编辑器实例(单实例 + 多 EditorState 模式,内存最省) */
export function createView(parent: HTMLElement, doc = ''): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: baseExtensions() }),
    parent,
  })
  return view
}

/** 激活标签时统一重配(语言 / 换行 / 空白符 / 重复行高亮跟随全局设置)。
 *  后台标签一律不改 state,避免 state.update 与视图状态脱节 */
export function applyTabCompartments(view: EditorView, t: { langSupport?: LanguageSupport | null }) {
  const effects = [
    langComp.reconfigure(t.langSupport ?? []),
    wrapComp.reconfigure(settings.wrap ? EditorView.lineWrapping : []),
    whitespaceComp.reconfigure(settings.whitespace ? highlightWhitespace() : []),
  ]
  if (view.state.field(dupEnabledField, false) !== settings.dupHighlight) {
    effects.push(toggleDupEffect.of(settings.dupHighlight))
  }
  view.dispatch({ effects })
}
