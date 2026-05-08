import { Children, useState, type ReactNode } from 'react'
import { makeAssistantToolUI } from '@assistant-ui/react'

interface RenderProps {
  toolName: string
  args: unknown
  argsText?: string
  result: unknown
  isError?: boolean
  status: { type: string }
  toolCallId?: string
}

interface ToolGroupProps {
  startIndex: number
  endIndex: number
  children?: ReactNode
}

interface ResultEnvelope {
  ok?: boolean
  error?: unknown
  message?: unknown
}

function shortJson(v: unknown, max = 120): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

function prettyJson(v: unknown, fallback = ''): string {
  if (v === undefined || v === null) return fallback
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function pickString(input: unknown, keys: readonly string[]): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
    if (typeof v === 'number') return String(v)
  }
  return null
}

function isCustomToolError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const r = result as ResultEnvelope
  return r.ok === false
}

function titleCaseToolName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function summaryText(name: string, args: unknown): string {
  const argObj = (args && typeof args === 'object') ? (args as Record<string, unknown>) : null

  switch (name) {
    case 'read': {
      const path = pickString(argObj, ['filePath', 'path', 'file_path'])
      return path ?? shortJson(args, 80)
    }
    case 'ls': {
      const path = pickString(argObj, ['path', 'dir'])
      return path ?? shortJson(args, 80)
    }
    case 'grep': {
      const pattern = pickString(argObj, ['pattern', 'query'])
      const path = pickString(argObj, ['path', 'include'])
      return [pattern, path].filter(Boolean).join(' · ') || shortJson(args, 80)
    }
    case 'updateMaps': {
      const cnt = argObj && Array.isArray(argObj['characterMap']) ? (argObj['characterMap'] as unknown[]).length : null
      return cnt !== null ? `character_map x${cnt}` : shortJson(args, 80)
    }
    case 'writeChapterOutline':
    case 'writeChapter':
    case 'getChapterContext':
    case 'getOutlineContext': {
      const ch = pickString(argObj, ['chapterNumber', 'chapter', 'number'])
      return ch !== null ? `ch ${ch}` : shortJson(args, 80)
    }
    default:
      return shortJson(args, 80)
  }
}

function statusLabel(running: boolean, isError: boolean): { text: string; cls: string; icon: 'running' | 'error' | 'done' } {
  if (running) return { text: '调用中', cls: 'text-amber-700', icon: 'running' }
  if (isError) return { text: '失败', cls: 'text-red-600', icon: 'error' }
  return { text: '完成', cls: 'text-emerald-700', icon: 'done' }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  )
}

function WrenchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M14.7 6.3a4.5 4.5 0 0 0 5.1 5.1l-7.6 7.6a2.8 2.8 0 1 1-4-4Z" />
      <path d="m7.5 16.5 2 2" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  )
}

function PenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function MapIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2Z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3Z" />
    </svg>
  )
}

function StatusIcon({ kind }: { kind: 'running' | 'error' | 'done' }) {
  if (kind === 'running') {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4 animate-spin text-amber-600"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      >
        <path d="M12 3a9 9 0 1 1-8.5 6" />
      </svg>
    )
  }
  if (kind === 'error') {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4 text-red-600"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 text-emerald-600"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.7 2.7L16.5 9" />
    </svg>
  )
}

function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case 'read':
      return <FileIcon />
    case 'ls':
    case 'glob':
      return <FolderIcon />
    case 'grep':
      return <SearchIcon />
    case 'updateMaps':
      return <MapIcon />
    case 'writeChapterOutline':
    case 'writeChapter':
      return <PenIcon />
    case 'getChapterContext':
    case 'getOutlineContext':
      return <BookIcon />
    default:
      return <WrenchIcon />
  }
}

function DetailBlock(props: {
  title: string
  value: string
  tone?: 'neutral' | 'error'
  dashed?: boolean
}) {
  const borderCls = props.tone === 'error'
    ? 'border-red-200 bg-red-50/70 text-red-700'
    : 'border-neutral-200 bg-white/75 text-neutral-600'
  const lineCls = props.dashed ? 'border-dashed' : 'border-solid'

  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-400">
        {props.title}
      </div>
      <pre className={`max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border ${lineCls} ${borderCls} p-3 font-mono text-[11px] leading-relaxed`}>
        {props.value}
      </pre>
    </div>
  )
}

function CardShell(props: RenderProps) {
  const { toolName, args, argsText, result, isError, status, toolCallId } = props
  const [open, setOpen] = useState(false)
  const running = status?.type === 'running' || result === undefined
  const customErr = isCustomToolError(result)
  const errored = !!isError || customErr
  const { text: statusText, cls: statusCls, icon } = statusLabel(running, errored)
  const summary = summaryText(toolName, args)
  const label = titleCaseToolName(toolName)
  const argValue = argsText && argsText.trim() ? argsText : prettyJson(args, '{}')
  const resultValue = running ? '等待返回...' : prettyJson(result, '')

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 py-2 text-left transition-colors hover:text-neutral-700"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center text-[#65758f]">
          <ToolIcon name={toolName} />
        </span>
        <span className="shrink-0 text-sm font-semibold text-neutral-900">{label}</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-[#98a2b3]">
            {summary}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <StatusIcon kind={icon} />
          <span className={`hidden min-w-[3.5rem] text-right text-sm font-medium sm:inline ${statusCls}`}>
            {statusText}
          </span>
          <span className="grid h-5 w-5 place-items-center text-[#65758f]">
            <ChevronIcon open={open} />
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-5 py-3 pl-9 pr-0">
          <div className="grid gap-3 md:grid-cols-2">
            <DetailBlock title="ARGUMENTS" value={argValue} dashed />
            <DetailBlock title="RESULT" value={resultValue} tone={errored ? 'error' : 'neutral'} />
          </div>
          {toolCallId && (
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-neutral-400">
              Call ID: {toolCallId}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolGroupUI({ startIndex, endIndex, children }: ToolGroupProps) {
  const [open, setOpen] = useState(false)
  const childCount = Children.count(children)
  const total = childCount || Math.max(0, endIndex - startIndex + 1)

  if (total <= 1) {
    return <div className="my-3">{children}</div>
  }

  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-1 text-left transition-colors hover:text-neutral-700"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center text-[#65758f]">
          <WrenchIcon />
        </span>
        <span className="text-sm font-semibold text-[#65758f]">{total} tool calls</span>
        <span className="ml-auto grid h-5 w-5 place-items-center text-[#65758f]">
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {children}
        </div>
      )}
    </div>
  )
}

function makeCard(toolName: string) {
  return makeAssistantToolUI<unknown, unknown>({
    toolName,
    render: (p) => (
      <CardShell
        toolName={toolName}
        args={p.args}
        argsText={p.argsText}
        result={p.result}
        isError={p.isError}
        status={p.status}
        toolCallId={p.toolCallId}
      />
    ),
  })
}

export const ReadToolUI = makeCard('read')
export const LsToolUI = makeCard('ls')
export const GrepToolUI = makeCard('grep')
export const UpdateMapsToolUI = makeCard('updateMaps')
export const WriteChapterOutlineToolUI = makeCard('writeChapterOutline')
export const GetChapterContextToolUI = makeCard('getChapterContext')
export const GetOutlineContextToolUI = makeCard('getOutlineContext')
export const WriteChapterToolUI = makeCard('writeChapter')
