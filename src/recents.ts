const KEY = 'litedit.recents'
const MAX = 15

export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function addRecent(path: string) {
  const list = getRecents().filter((p) => p !== path)
  list.unshift(path)
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch { /* ignore */ }
}

export function removeRecent(path: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(getRecents().filter((p) => p !== path)))
  } catch { /* ignore */ }
}
