import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import clsx from 'clsx'

export function DraftsPanel({ novelId }: { novelId: string }) {
  const { data: drafts } = useQuery({
    queryKey: ['drafts', novelId],
    queryFn: () => api.listDrafts(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex h-full">
      <aside className="w-48 border-r border-neutral-200 overflow-y-auto">
        {!drafts?.length && (
          <p className="text-xs text-neutral-400 p-3">
            还没有正文。先生成大纲，再启动 writer agent。
          </p>
        )}
        {drafts?.map((d) => (
          <button
            key={d.number}
            onClick={() => setSelected(d.number)}
            className={clsx(
              'w-full text-left px-3 py-2 text-sm border-b border-neutral-100',
              selected === d.number ? 'bg-amber-50 text-amber-900' : 'hover:bg-neutral-50',
            )}
          >
            <div>第 {d.number} 章</div>
            <div className="text-xs text-neutral-500">{d.word_count} 字</div>
          </button>
        ))}
      </aside>

      <section className="flex-1 overflow-y-auto p-6">
        {selected == null && (
          <p className="text-sm text-neutral-400">选一章阅读</p>
        )}
        {selected != null && (
          <DraftDetail novelId={novelId} number={selected} />
        )}
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
      <header className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">{d.title}</h1>
        <div className="text-xs text-neutral-500">
          第 {d.number} 章 · {d.word_count} 字 · {new Date(d.written_at).toLocaleString('zh-CN')}
        </div>
      </header>
      <div className="whitespace-pre-wrap leading-loose text-base">{d.content}</div>
    </article>
  )
}
