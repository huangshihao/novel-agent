import { makeAssistantToolUI } from '@assistant-ui/react'
import { Collapsible } from '../Collapsible.js'

interface RenderProps {
  toolName: string
  args: unknown
  argsText?: string
  result: unknown
  isError?: boolean
  status: { type: string }
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

function statusLabel(running: boolean, isError: boolean): { text: string; cls: string } {
  if (running) return { text: '调用中...', cls: 'text-amber-600' }
  if (isError) return { text: '失败', cls: 'text-red-600' }
  return { text: '完成', cls: 'text-emerald-700' }
}

function CardShell(props: RenderProps) {
  const { toolName, args, result, isError, status } = props
  const running = status?.type === 'running' || result === undefined
  const customErr = isCustomToolError(result)
  const errored = !!isError || customErr
  const forceOpen = running || errored ? true : undefined
  const { text: statusText, cls: statusCls } = statusLabel(running, errored)

  const summary = (
    <span className="flex items-center gap-2 px-3 py-2 text-xs">
      <span className="font-mono text-neutral-700">{toolName}</span>
      <span className="text-neutral-300">·</span>
      <span className={statusCls}>{statusText}</span>
      <span className="text-neutral-300">·</span>
      <span className="truncate text-neutral-500 font-mono text-[11px]">
        {summaryText(toolName, args)}
      </span>
    </span>
  )

  const borderCls = errored
    ? 'border-red-300 bg-red-50/60'
    : 'border-neutral-200 bg-neutral-50'

  return (
    <Collapsible
      className={`my-1 rounded border ${borderCls} text-xs overflow-hidden`}
      headerClassName="hover:bg-neutral-100/60"
      contentClassName="px-3 pb-2 space-y-1 border-t border-neutral-200"
      summary={summary}
      forceOpen={forceOpen}
    >
      <div className="text-neutral-500">
        <div className="text-neutral-400 mt-1 mb-0.5">args</div>
        <pre className="whitespace-pre-wrap break-all bg-white border border-neutral-200 rounded p-2 text-[11px] font-mono">
          {shortJson(args, 4000)}
        </pre>
      </div>
      {!running && (
        <div className="text-neutral-500">
          <div className={`mt-1 mb-0.5 ${errored ? 'text-red-600' : 'text-neutral-400'}`}>
            {errored ? 'error' : 'result'}
          </div>
          <pre
            className={`whitespace-pre-wrap break-all rounded p-2 text-[11px] font-mono ${
              errored
                ? 'bg-red-50 border border-red-200 text-red-700'
                : 'bg-white border border-neutral-200'
            }`}
          >
            {shortJson(result, 4000)}
          </pre>
        </div>
      )}
    </Collapsible>
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
