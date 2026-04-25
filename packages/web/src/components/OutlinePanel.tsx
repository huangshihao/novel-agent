import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import clsx from 'clsx'

interface Props {
  novelId: string
}

export function OutlinePanel({ novelId }: Props) {
  const { data: outlines } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.listOutlines(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex h-full">
      <aside className="w-64 border-r border-neutral-200 overflow-y-auto">
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
                'border-b border-neutral-100',
                selected === o.number ? 'bg-amber-50' : 'hover:bg-neutral-50',
              )}
            >
              <button
                onClick={() => setSelected(o.number)}
                className="w-full text-left px-3 py-2 text-sm"
              >
                第 {o.number} 章
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1 overflow-y-auto p-4">
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
    <article className="space-y-4 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-medium">第 {o.number} 章大纲</h2>
        <span className="text-xs text-neutral-500">参考原书第 {o.source_chapter_ref} 章</span>
      </header>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">剧情</h3>
        <p className="whitespace-pre-wrap leading-relaxed">{o.plot}</p>
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">关键事件</h3>
        <ul className="list-disc list-inside space-y-0.5">
          {o.key_events.map((e, i) => (
            <li key={i}>{e}</li>
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
