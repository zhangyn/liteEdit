import { getCurrentWindow } from '@tauri-apps/api/window'
import { settings, saveSettings } from './state'

export function isDark(): boolean {
  return settings.theme === 'dark'
}

/** 切换主题:CSS 变量 + 原生标题栏同步 */
export function applyTheme(dark: boolean) {
  settings.theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.theme = settings.theme
  getCurrentWindow().setTheme(settings.theme).catch(() => {})
  saveSettings()
}

export function toggleTheme() {
  applyTheme(!isDark())
}

export function initTheme() {
  const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  if (!localStorage.getItem('litedit.settings')) settings.theme = preferDark ? 'dark' : 'light'
  document.documentElement.dataset.theme = settings.theme
  getCurrentWindow().setTheme(settings.theme).catch(() => {})
}
