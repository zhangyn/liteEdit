import type { EditorState, Text } from '@codemirror/state'
import type { LanguageSupport } from '@codemirror/language'

export type Eol = '\r\n' | '\n' | '\r'
export type EncName = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'gb18030' | 'big5' | 'latin1'

export interface Tab {
  id: number
  path: string | null
  name: string
  /** 非激活标签的编辑器状态;激活标签始终以 view.state 为准,切走时回写 */
  state: EditorState
  scrollTop: number
  /** 最近一次保存的文档快照;null = 从未保存(草稿),视为脏 */
  clean: Text | null
  encoding: EncName
  eol: Eol
  mtimeMs: number
  fileSize: number
  langLabel: string
  /** 已加载的语法包(激活时统一挂到 langComp) */
  langSupport?: LanguageSupport | null
  /** 二进制文件:十六进制只读模式 */
  hex?: boolean
  hexData?: Uint8Array
  hexTruncated?: boolean
  dirty: boolean
}

/** 全局可变状态(对象引用共享) */
export const store = {
  tabs: [] as Tab[],
  activeId: -1,
  view: null as import('@codemirror/view').EditorView | null,
}

export function activeTab(): Tab | undefined {
  return store.tabs.find((t) => t.id === store.activeId)
}

/** 持久化设置 */
export interface Settings {
  theme: 'light' | 'dark'
  wrap: boolean
  whitespace: boolean
  sidebar: boolean
  preview: boolean
  toolbar: boolean
  tabsBottom: boolean
  menuHidden: boolean
  dupHighlight: boolean
  fontFamily: string
  lineHeight: number
  fontSize: number
}

const SET_KEY = 'litedit.settings'

export const settings: Settings = (() => {
  const def: Settings = {
    theme: 'light', wrap: false, whitespace: false, sidebar: true,
    preview: false, toolbar: true, tabsBottom: false, menuHidden: false,
    dupHighlight: false, fontFamily: 'Consolas', lineHeight: 1.55, fontSize: 14,
  }
  try {
    const raw = localStorage.getItem(SET_KEY)
    if (raw) return { ...def, ...JSON.parse(raw) }
  } catch { /* 忽略损坏的设置 */ }
  return def
})()

export function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(settings)) } catch { /* 存储满则忽略 */ }
}
