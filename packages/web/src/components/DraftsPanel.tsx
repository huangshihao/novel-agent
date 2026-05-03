import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import clsx from 'clsx'

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function HoverCopy({
  text,
  children,
  className,
}: {
  text: string
  children: React.ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard 拒绝（非 https / 无权限） */
    }
  }
  return (
    <div className={clsx('group relative', className)}>
      {children}
      <button
        type="button"
        onClick={onClick}
        aria-label={copied ? '已复制' : '复制'}
        className={clsx(
          'absolute top-2 right-2 p-1.5 rounded-md',
          'bg-white/90 backdrop-blur border border-neutral-200 shadow-sm',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          copied
            ? 'text-emerald-600 border-emerald-200'
            : 'text-neutral-500 hover:text-neutral-800 hover:bg-white',
        )}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  )
}

interface Props {
  novelId: string
}

export function DraftsPanel({ novelId }: Props) {
  const { data: drafts } = useQuery({
    queryKey: ['drafts', novelId],
    queryFn: () => api.listDrafts(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex h-full">
      <aside className="w-64 border-r border-neutral-200 overflow-y-auto">
        <ul>
          {!drafts?.length && (
            <li className="text-xs text-neutral-400 p-4">
              还没有正文。在右侧启动 writer agent 生成。
            </li>
          )}
          {drafts?.map((d) => (
            <li
              key={d.number}
              className={clsx(
                'border-b border-neutral-100',
                selected === d.number ? 'bg-amber-50' : 'hover:bg-neutral-50',
              )}
            >
              <button
                onClick={() => setSelected(d.number)}
                className="w-full text-left px-3 py-2 text-sm"
              >
                第 {d.number} 章 <span className="text-xs text-neutral-500">{d.word_count} 字</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1 overflow-y-auto p-6">
        {selected == null && <p className="text-sm text-neutral-400">选一章阅读</p>}
        {selected != null && <DraftDetail novelId={novelId} number={selected} />}
      </section>
    </div>
  )
}

function DraftDetail({ novelId, number }: { novelId: string; number: number }) {
  const { data: d } = useQuery({
    queryKey: ['draft', novelId, number],
    queryFn: () => api.getDraft(novelId, number),
  })
  if (!d) return <p className="text-sm text-neutral-400">加载中...</p>

  return (
    <article className="prose prose-neutral max-w-none">
      <HoverCopy text={d.title} className="mb-6 -mx-2 px-2 py-1 rounded">
        <h1 className="text-2xl font-semibold mb-1">{d.title}</h1>
        <div className="text-xs text-neutral-500">
          第 {d.number} 章 · {d.word_count} 字 · {new Date(d.written_at).toLocaleString('zh-CN')}
        </div>
      </HoverCopy>
      <HoverCopy text={d.content} className="-mx-2 px-2 py-1 rounded">
        <div className="whitespace-pre-wrap leading-loose text-base">{d.content}</div>
      </HoverCopy>
    </article>
  )
}
