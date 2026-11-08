import { store, type EncName, type Eol, type Tab } from './state'
import { activate, getDoc, isDirty, newFile, openPath } from './tabs'

const KEY = 'litedit.session'
const DRAFT_MAX = 400_000

interface SessTab {
  p?: string
  n?: string
  d?: string
  enc: EncName
  eol: Eol
}

interface Session {
  tabs: SessTab[]
  active: number
}

/** 保存打开列表与脏文档草稿(tabs.ts 在标签变化/防抖脏检查时调用) */
export function saveSession() {
  try {
    const tabs: SessTab[] = store.tabs.map((t) => {
      const s: SessTab = { enc: t.encoding, eol: t.eol }
      if (t.path) s.p = t.path
      else s.n = t.name
      if (isDirty(t) && getDoc(t).length <= DRAFT_MAX) s.d = getDoc(t).toString()
      return s
    })
    const active = store.tabs.findIndex((t) => t.id === store.activeId)
    localStorage.setItem(KEY, JSON.stringify({ tabs, active } satisfies Session))
  } catch { /* 超出配额则跳过草稿 */ }
}

/** 启动恢复:返回是否恢复了会话 */
export async function restoreSession(): Promise<boolean> {
  let data: Session | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) data = JSON.parse(raw) as Session
  } catch { /* ignore */ }
  if (!data || data.tabs.length === 0) return false
  for (const s of data.tabs) {
    let t: Tab | null = null
    if (s.p) {
      t = await openPath(s.p, { silent: true })
      if (t) {
        t.encoding = s.enc
        t.eol = s.eol
      }
    } else if (s.n) {
      t = newFile(s.n, s.d ?? '')
      t.encoding = s.enc
      t.eol = s.eol
      if (s.d) t.clean = null // 草稿视为未保存
    }
  }
  const idx = Math.max(0, Math.min(data.active, store.tabs.length - 1))
  if (store.tabs[idx]) activate(store.tabs[idx].id)
  return true
}
