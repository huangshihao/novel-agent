import { useState } from 'react'
import { makeAssistantToolUI } from '@assistant-ui/react'

interface CardProps {
  name: string
  args: unknown
  result: unknown
  status: { type: string }
}

function shortJson(v: unknown, max = 120): string {
  if (v === undefined) return ''
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

function CardShell({ name, args, result, status }: CardProps) {
  const running = status?.type === 'running' || result === undefined
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1 rounded border border-neutral-200 bg-neutral-50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-100"
      >
        <span className="text-neutral-400">{open ? '▾' : '▸'}</span>
        <span className="font-mono text-neutral-700">{name}</span>
        <span className="text-neutral-400">·</span>
        <span className={running ? 'text-amber-600' : 'text-emerald-700'}>
          {running ? '调用中...' : '完成'}
        </span>
        {!open && (
          <span className="ml-2 truncate text-neutral-500">
            {shortJson(args, 80)}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1 border-t border-neutral-200">
          <div className="text-neutral-500">
            <div className="text-neutral-400 mt-1 mb-0.5">args</div>
            <pre className="whitespace-pre-wrap break-all bg-white border border-neutral-200 rounded p-2 text-[11px] font-mono">
              {shortJson(args, 4000)}
            </pre>
          </div>
          {!running && (
            <div className="text-neutral-500">
              <div className="text-neutral-400 mt-1 mb-0.5">result</div>
              <pre className="whitespace-pre-wrap break-all bg-white border border-neutral-200 rounded p-2 text-[11px] font-mono">
                {shortJson(result, 4000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const ReadToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'read',
  render: (p) => (
    <CardShell name="read" args={p.args} result={p.result} status={p.status} />
  ),
})

export const LsToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'ls',
  render: (p) => (
    <CardShell name="ls" args={p.args} result={p.result} status={p.status} />
  ),
})

export const GrepToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'grep',
  render: (p) => (
    <CardShell name="grep" args={p.args} result={p.result} status={p.status} />
  ),
})

export const UpdateMapsToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'updateMaps',
  render: (p) => (
    <CardShell
      name="updateMaps"
      args={p.args}
      result={p.result}
      status={p.status}
    />
  ),
})

export const WriteChapterOutlineToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'writeChapterOutline',
  render: (p) => (
    <CardShell
      name="writeChapterOutline"
      args={p.args}
      result={p.result}
      status={p.status}
    />
  ),
})

export const GetChapterContextToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'getChapterContext',
  render: (p) => (
    <CardShell
      name="getChapterContext"
      args={p.args}
      result={p.result}
      status={p.status}
    />
  ),
})

export const WriteChapterToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'writeChapter',
  render: (p) => (
    <CardShell
      name="writeChapter"
      args={p.args}
      result={p.result}
      status={p.status}
    />
  ),
})
