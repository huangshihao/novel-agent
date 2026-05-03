import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

export function MapsPanel({ novelId }: { novelId: string }) {
  const { data: maps } = useQuery({
    queryKey: ['maps', novelId],
    queryFn: () => api.getMaps(novelId),
    refetchInterval: 3_000,
  })

  if (!maps) {
    return (
      <div className="p-4 text-sm text-[var(--muted)]">
        还没有置换表。在右侧对话里让 agent 生成草案（如"生成置换表"）。
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">角色置换</h3>
        <table className="w-full overflow-hidden rounded-md border border-[var(--line)] bg-[rgba(255,255,252,0.72)] text-sm">
          <thead className="bg-[#eef3e8]">
            <tr>
              <th className="border-b border-[var(--line)] p-2 text-left">原名</th>
              <th className="border-b border-[var(--line)] p-2 text-left">新名</th>
              <th className="border-b border-[var(--line)] p-2 text-left">出场区间</th>
              <th className="border-b border-[var(--line)] p-2 text-left">源端 description / target 备注</th>
            </tr>
          </thead>
          <tbody>
            {maps.character_map.map((e) => {
              const range = e.source_meta
                ? `${e.source_meta.first_chapter ?? '?'}–${e.source_meta.last_chapter ?? '?'}`
                : '—'
              const note = e.source_meta?.description || e.target_note || '—'
              return (
                <tr key={e.target} className="border-b border-[var(--line)] last:border-b-0">
                  <td className="p-2 font-mono text-xs">{e.source ?? <em className="text-amber-600">target 自创</em>}</td>
                  <td className="p-2">{e.target}</td>
                  <td className="p-2 text-neutral-500 text-xs">{range}</td>
                  <td className="p-2 text-neutral-500 text-xs">{note}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">题材置换</h3>
        {maps.setting_map ? (
          <div className="surface-tight space-y-2 p-3 text-sm">
            <div>
              <span className="text-neutral-500 text-xs mr-2">原行业</span>
              <span>{maps.setting_map.original_industry}</span>
              <span className="text-neutral-400 mx-2">→</span>
              <span>{maps.setting_map.target_industry}</span>
            </div>
            <div>
              <div className="text-neutral-500 text-xs mb-1">关键词替换</div>
              <ul className="text-xs space-y-0.5">
                {Object.entries(maps.setting_map.key_term_replacements).map(([k, v]) => (
                  <li key={k}>
                    <code>{k}</code> → <code>{v}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-400">未设置</p>
        )}
      </section>
    </div>
  )
}
