import { ipc } from './ipc'
import { store } from './state'
import { isDirty, reloadTab } from './tabs'
import { confirmModal } from './modal'
import { toast } from './toast'

/** 每 2s 轮询 mtime:干净→静默重载,脏→询问 */
export function startWatch() {
  let busy = false
  window.setInterval(async () => {
    if (busy) return
    busy = true
    try {
      for (const t of [...store.tabs]) {
        if (!t.path) continue
        try {
          const st = await ipc.statFile(t.path)
          if (st.mtime_ms === t.mtimeMs) continue
          t.mtimeMs = st.mtime_ms // 先更新基线,避免重复询问
          if (isDirty(t)) {
            const ok = await confirmModal(`「${t.name}」已被外部程序修改。\n重新加载将丢失未保存的更改,要重新加载吗?`)
            if (ok) await reloadTab(t, true)
          } else {
            await reloadTab(t, true)
            toast(`已自动重载:${t.name}`)
          }
        } catch { /* 文件被删/锁定,下轮再试 */ }
      }
    } finally {
      busy = false
    }
  }, 2000)
}
