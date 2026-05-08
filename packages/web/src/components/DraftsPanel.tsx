import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import clsx from 'clsx'
import { useConfirm } from '../lib/use-confirm.js'

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

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
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
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { data: drafts } = useQuery({
    queryKey: ['drafts', novelId],
    queryFn: () => api.listDrafts(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)
  const deleteMut = useMutation({
    mutationFn: (number: number) => api.deleteDraftsFrom(novelId, number),
    onSuccess: async (_result, number) => {
      if (selected != null && selected >= number) setSelected(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drafts', novelId] }),
        queryClient.invalidateQueries({ queryKey: ['state', novelId] }),
      ])
    },
  })

  const onDelete = async (number: number) => {
    const ok = await confirm({
      title: '删除正文',
      message: `删除第 ${number} 章及之后所有正文？大纲会保留。`,
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (ok) await deleteMut.mutateAsync(number)
  }

  return (
    <div className="flex h-full">
      <aside className="w-64 overflow-y-auto border-r ink-rule bg-[rgba(250,249,244,0.52)]">
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
                'group border-b border-[var(--line)]',
                selected === d.number
                  ? 'bg-[rgba(242,223,201,0.68)] shadow-[inset_3px_0_0_var(--accent)]'
                  : 'hover:bg-[rgba(255,255,252,0.62)]',
              )}
            >
              <div className="flex items-center gap-1 pr-2">
                <button
                  onClick={() => setSelected(d.number)}
                  className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
                >
                  第 {d.number} 章 <span className="text-xs text-neutral-500">{d.word_count} 字</span>
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(d.number)}
                  disabled={deleteMut.isPending}
                  title="删除"
                  aria-label={`删除第 ${d.number} 章及之后正文`}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-400 opacity-0 transition-[opacity,color,background-color] hover:bg-red-50 hover:text-red-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 group-hover:opacity-100 disabled:opacity-40"
                >
                  <TrashIcon />
                </button>
              </div>
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
    <article className="surface-tight max-w-none p-6">
      <HoverCopy text={d.title} className="mb-6 -mx-2 px-2 py-1 rounded">
        <h1 className="mb-1 text-2xl font-semibold">{d.title}</h1>
        <div className="text-xs text-neutral-500">
          第 {d.number} 章 · {d.word_count} 字 · {new Date(d.written_at).toLocaleString('zh-CN')}
        </div>
      </HoverCopy>
      <HoverCopy text={d.content} className="-mx-2 px-2 py-1 rounded">
        <div className="whitespace-pre-wrap text-base leading-loose">{d.content}</div>
      </HoverCopy>
    </article>
  )
}
