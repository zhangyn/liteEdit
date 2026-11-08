import { invoke } from '@tauri-apps/api/core'
import type { EncName } from './state'

export interface StatInfo {
  mtime_ms: number
  size: number
}

export interface DirEntry {
  name: string
  path: string
  is_dir: boolean
}

/** read_file 返回二进制 Response,invoke 解析为 ArrayBuffer */
export const ipc = {
  readFile: (path: string) =>
    invoke<ArrayBuffer>('read_file', { path }).then((b) => new Uint8Array(b)),
  statFile: (path: string) => invoke<StatInfo>('stat_file', { path }),
  writeText: (path: string, text: string, encoding: EncName) =>
    invoke<[number, boolean]>('write_text', { path, text, encoding }),
  readDir: (path: string) => invoke<DirEntry[]>('read_dir', { path }),
  createFile: (path: string) => invoke<void>('create_file', { path }),
  createDir: (path: string) => invoke<void>('create_dir', { path }),
  renameEntry: (from: string, to: string) => invoke<void>('rename_entry', { from, to }),
  trashDelete: (path: string) => invoke<void>('trash_delete', { path }),
  reveal: (path: string) => invoke<void>('reveal_in_explorer', { path }),
  cliFiles: () => invoke<string[]>('get_cli_files'),
  appVersion: () => invoke<string>('app_version'),
  setMenuChecks: (v: {
    wrap: boolean
    whitespace: boolean
    sidebar: boolean
    preview: boolean
    toolbar: boolean
    tab_bottom: boolean
    menu_hidden: boolean
  }) => invoke<void>('set_menu_checks', v),
  setMenuVisible: (visible: boolean) => invoke<void>('set_menu_visible', { visible }),
}
