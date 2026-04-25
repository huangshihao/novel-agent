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
      <div className="text-sm text-neutral-400 p-4">
        还没有置换表。在右侧对话里让 agent 生成草案（如"生成置换表"）。
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4">
      <section>
        <h3 className="font-medium mb-3 text-sm text-neutral-700">角色置换</h3>
        <table className="w-full text-sm border border-neutral-200 rounded">
          <thead className="bg-neutral-50">
            <tr>
              <th className="text-left p-2 border-b border-neutral-200">原名</th>
              <th className="text-left p-2 border-b border-neutral-200">新名</th>
              <th className="text-left p-2 border-b border-neutral-200">备注</th>
            </tr>
          </thead>
          <tbody>
            {maps.character_map.map((e) => (
              <tr key={e.source} className="border-b border-neutral-100 last:border-b-0">
                <td className="p-2 font-mono text-xs">{e.source}</td>
                <td className="p-2">{e.target}</td>
                <td className="p-2 text-neutral-500 text-xs">{e.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="font-medium mb-3 text-sm text-neutral-700">题材置换</h3>
        {maps.setting_map ? (
          <div className="rounded border border-neutral-200 p-3 space-y-2 text-sm">
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
