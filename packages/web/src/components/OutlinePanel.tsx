import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import clsx from 'clsx'
import { useConfirm } from '../lib/use-confirm.js'

interface Props {
  novelId: string
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

export function OutlinePanel({ novelId }: Props) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { data: outlines } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.listOutlines(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)
  const deleteMut = useMutation({
    mutationFn: (number: number) => api.deleteOutlinesFrom(novelId, number),
    onSuccess: async (_result, number) => {
      if (selected != null && selected >= number) setSelected(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['outlines', novelId] }),
        queryClient.invalidateQueries({ queryKey: ['drafts', novelId] }),
        queryClient.invalidateQueries({ queryKey: ['state', novelId] }),
      ])
    },
  })

  const onDelete = async (number: number) => {
    const ok = await confirm({
      title: '删除大纲',
      message: `删除第 ${number} 章及之后所有大纲？对应正文也会一起删除。`,
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (ok) await deleteMut.mutateAsync(number)
  }

  return (
    <div className="flex h-full">
      <aside className="w-64 overflow-y-auto border-r ink-rule bg-[rgba(250,249,244,0.52)]">
        <ul>
          {!outlines?.length && (
            <li className="text-xs text-neutral-400 p-4">
              还没有大纲。在右侧启动大纲 agent 生成。
            </li>
          )}
          {outlines?.map((o) => (
            <li
              key={o.number}
              className={clsx(
                'group border-b border-[var(--line)]',
                selected === o.number
                  ? 'bg-[rgba(242,223,201,0.68)] shadow-[inset_3px_0_0_var(--accent)]'
                  : 'hover:bg-[rgba(255,255,252,0.62)]',
              )}
            >
              <div className="flex items-center gap-1 pr-2">
                <button
                  onClick={() => setSelected(o.number)}
                  className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
                >
                  第 {o.number} 章
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(o.number)}
                  disabled={deleteMut.isPending}
                  title="删除"
                  aria-label={`删除第 ${o.number} 章及之后大纲`}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-400 opacity-0 transition-[opacity,color,background-color] hover:bg-red-50 hover:text-red-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 group-hover:opacity-100 disabled:opacity-40"
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1 overflow-y-auto p-5">
        {selected == null && <p className="text-sm text-neutral-400">选一章查看大纲</p>}
        {selected != null && <OutlineDetail novelId={novelId} number={selected} />}
      </section>
    </div>
  )
}

function OutlineDetail({ novelId, number }: { novelId: string; number: number }) {
  const { data: o } = useQuery({
    queryKey: ['outline', novelId, number],
    queryFn: () => api.getOutline(novelId, number),
  })
  if (!o) return <p className="text-sm text-neutral-400">加载中...</p>

  return (
    <article className="surface-tight space-y-4 p-5 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">第 {o.number} 章大纲</h2>
        <span className="text-xs text-neutral-500">参考原书第 {o.source_chapter_ref} 章</span>
      </header>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">剧情功能</h3>
        {o.plot_functions.length === 0 ? (
          <p className="text-neutral-400 text-xs">—</p>
        ) : (
          <ul className="list-disc list-inside space-y-0.5 text-xs text-neutral-700">
            {o.plot_functions.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">剧情</h3>
        <p className="whitespace-pre-wrap leading-relaxed">{o.plot}</p>
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">关键事件（function → 新载体）</h3>
        <ul className="space-y-1">
          {o.key_events.map((e, i) => (
            <li key={i} className="border-l-2 border-[var(--accent-soft)] pl-2">
              <div className="text-xs text-neutral-500">{e.function || '—'}</div>
              <div>{e.new_carrier}</div>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <h4 className="text-neutral-500 mb-1">本章新埋伏笔</h4>
          {o.hooks_to_plant.length === 0 ? <p className="text-neutral-400">—</p> : (
            <ul>{o.hooks_to_plant.map((id) => <li key={id} className="font-mono">{id}</li>)}</ul>
          )}
        </div>
        <div>
          <h4 className="text-neutral-500 mb-1">本章兑现伏笔</h4>
          {o.hooks_to_payoff.length === 0 ? <p className="text-neutral-400">—</p> : (
            <ul>{o.hooks_to_payoff.map((id) => <li key={id} className="font-mono">{id}</li>)}</ul>
          )}
        </div>
      </section>
      {o.planned_state_changes.character_deaths.length > 0 && (
        <section className="text-xs">
          <h4 className="text-neutral-500 mb-1">本章死亡声明</h4>
          <ul>{o.planned_state_changes.character_deaths.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}
    </article>
  )
}
