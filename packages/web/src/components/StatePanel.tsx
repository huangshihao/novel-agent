import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

export function StatePanel({ novelId }: { novelId: string }) {
  const { data: state } = useQuery({
    queryKey: ['state', novelId],
    queryFn: () => api.getState(novelId),
    refetchInterval: 3_000,
  })

  if (!state) {
    return <p className="p-3 text-xs text-[var(--muted)]">state 未初始化（先 updateMaps）</p>
  }

  const aliveEntries = Object.entries(state.alive_status)
  const dead = aliveEntries.filter(([, s]) => !s.alive)
  const alive = aliveEntries.filter(([, s]) => s.alive)
  const openHooks = Object.entries(state.hooks).filter(([, h]) => h.status === 'open')
  const paidHooks = Object.entries(state.hooks).filter(([, h]) => h.status === 'paid_off')

  return (
    <div className="space-y-3 p-4 text-xs">
      <section className="surface-tight p-3">
        <h4 className="text-neutral-500 mb-1">角色状态</h4>
        <div className="text-emerald-700">活 {alive.length}</div>
        <div className="text-rose-700">死 {dead.length}{dead.length > 0 && `：${dead.map(([n]) => n).join(' / ')}`}</div>
      </section>
      <section className="surface-tight p-3">
        <h4 className="text-neutral-500 mb-1">长线伏笔</h4>
        <div>open {openHooks.length}</div>
        <div>paid {paidHooks.length}</div>
      </section>
      {state.new_hooks.length > 0 && (
        <section className="surface-tight p-3">
          <h4 className="text-neutral-500 mb-1">新埋伏笔（{state.new_hooks.length}）</h4>
          <ul className="font-mono">
            {state.new_hooks.map((h) => (
              <li key={h.id} className={h.status === 'open' ? '' : 'text-emerald-700'}>
                {h.id} · 第 {h.planted_chapter} 章 · {h.status}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
