import type { LanguageSupport } from '@codemirror/language'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'

export interface LangResult {
  support: LanguageSupport | null
  label: string
}

/** 语法包按需 dynamic import —— 未打开对应文件时零加载成本 */
type Loader = () => Promise<LangResult>

const js = (opts: { jsx?: boolean; typescript?: boolean } | undefined, label = 'JavaScript'): Loader =>
  () => import('@codemirror/lang-javascript').then((m) => ({ support: m.javascript(opts), label }))

const stream = (parser: Parameters<typeof StreamLanguage.define>[0], label: string): LangResult => ({
  support: StreamLanguage.define(parser) as unknown as LanguageSupport,
  label,
})

const MAP: Record<string, Loader> = {
  js: js(undefined), mjs: js(undefined), cjs: js(undefined),
  jsx: js({ jsx: true }, 'JSX'),
  ts: js({ typescript: true }, 'TypeScript'),
  tsx: js({ typescript: true, jsx: true }, 'TSX'),
  json: () => import('@codemirror/lang-json').then((m) => ({ support: m.json(), label: 'JSON' })),
  html: () => import('@codemirror/lang-html').then((m) => ({ support: m.html(), label: 'HTML' })),
  htm: () => import('@codemirror/lang-html').then((m) => ({ support: m.html(), label: 'HTML' })),
  xml: () => import('@codemirror/lang-xml').then((m) => ({ support: m.xml(), label: 'XML' })),
  svg: () => import('@codemirror/lang-xml').then((m) => ({ support: m.xml(), label: 'SVG' })),
  css: () => import('@codemirror/lang-css').then((m) => ({ support: m.css(), label: 'CSS' })),
  scss: () => import('@codemirror/lang-css').then((m) => ({ support: m.css(), label: 'SCSS' })),
  less: () => import('@codemirror/lang-css').then((m) => ({ support: m.css(), label: 'Less' })),
  md: () => import('@codemirror/lang-markdown').then((m) => ({ support: m.markdown(), label: 'Markdown' })),
  markdown: () => import('@codemirror/lang-markdown').then((m) => ({ support: m.markdown(), label: 'Markdown' })),
  py: () => import('@codemirror/lang-python').then((m) => ({ support: m.python(), label: 'Python' })),
  c: () => import('@codemirror/lang-cpp').then((m) => ({ support: m.cpp(), label: 'C' })),
  h: () => import('@codemirror/lang-cpp').then((m) => ({ support: m.cpp(), label: 'C/C++' })),
  cpp: () => import('@codemirror/lang-cpp').then((m) => ({ support: m.cpp(), label: 'C++' })),
  hpp: () => import('@codemirror/lang-cpp').then((m) => ({ support: m.cpp(), label: 'C++' })),
  cc: () => import('@codemirror/lang-cpp').then((m) => ({ support: m.cpp(), label: 'C++' })),
  java: () => import('@codemirror/lang-java').then((m) => ({ support: m.java(), label: 'Java' })),
  rs: () => import('@codemirror/lang-rust').then((m) => ({ support: m.rust(), label: 'Rust' })),
  go: () => import('@codemirror/lang-go').then((m) => ({ support: m.go(), label: 'Go' })),
  sql: () => import('@codemirror/lang-sql').then((m) => ({ support: m.sql(), label: 'SQL' })),
  php: () => import('@codemirror/lang-php').then((m) => ({ support: m.php(), label: 'PHP' })),
  yaml: () => import('@codemirror/lang-yaml').then((m) => ({ support: m.yaml(), label: 'YAML' })),
  yml: () => import('@codemirror/lang-yaml').then((m) => ({ support: m.yaml(), label: 'YAML' })),
  sh: () => Promise.resolve(stream(shell, 'Shell')),
  bash: () => Promise.resolve(stream(shell, 'Shell')),
  ps1: () => Promise.resolve(stream(powerShell, 'PowerShell')),
  ini: () => Promise.resolve(stream(properties, 'INI')),
  cfg: () => Promise.resolve(stream(properties, 'INI')),
  conf: () => Promise.resolve(stream(properties, 'INI')),
  toml: () => Promise.resolve(stream(toml, 'TOML')),
}

/** 超过 2MB 自动禁用语法高亮(解析成本高于收益) */
const SYNTAX_MAX = 2_000_000

export async function langFor(filename: string, size: number): Promise<LangResult | null> {
  if (size > SYNTAX_MAX) return null
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return null
  const ext = filename.slice(dot + 1).toLowerCase()
  const loader = MAP[ext]
  if (!loader) return null
  try {
    return await loader()
  } catch {
    return null
  }
}
