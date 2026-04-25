import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps, readChapterDraft, readOutline } from '../../storage/target-reader.js'
import { readState } from '../../storage/state.js'
import { readSourceHooks, readSourceMeta } from '../../storage/source-reader.js'

export function buildGetChapterContextTool(novelId: string): ToolDefinition {
  return {
    name: 'getChapterContext',
    label: '获取写章 context 包',
    description:
      '一次性返回写本章正文需要的全部信息：大纲 + 置换表 + 最近 3 章 target 正文 + 涉及角色当前状态（alive/dead）+ 涉及伏笔状态。第 1 章特殊：附带 source/meta.md 的风格样本（学习文风用）。',
    promptSnippet: 'getChapterContext({number}) - 一次拿全写章所需 context',
    promptGuidelines: [
      '写每一章正文前**必须**先调用一次',
      '返回的 maps.character_map 是写正文时人名的唯一来源',
      '返回的 alive_status 里 alive===false 的角色不能在正文里有动作（writeChapter 会硬拒）',
    ],
    parameters: Type.Object({
      number: Type.Number(),
    }),
    async execute(_id, params) {
      const { number } = params as { number: number }
      const outline = await readOutline(novelId, number)
      if (!outline) {
        const result = { ok: false, error: `outline for chapter ${number} not found` }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: result,
        }
      }
      const maps = await readMaps(novelId)
      const state = await readState(novelId)
      const sourceHooks = await readSourceHooks(novelId)

      const recent: { number: number; content: string }[] = []
      for (const n of [number - 3, number - 2, number - 1].filter((n) => n >= 1)) {
        const d = await readChapterDraft(novelId, n)
        if (d) recent.push({ number: n, content: d.content })
      }

      const involved_characters = Object.entries(state?.alive_status ?? {}).map(
        ([name, s]) => ({ name, alive: s.alive, last_seen_chapter: s.last_seen_chapter }),
      )

      const hooksMap = new Map([
        ...sourceHooks.map((h) => [h.id, { id: h.id, description: h.description }] as const),
        ...(state?.new_hooks ?? []).map((h) => [h.id, { id: h.id, description: h.description }] as const),
      ])
      const involved_hooks = [
        ...outline.hooks_to_plant.map((id) => ({ ...(hooksMap.get(id) ?? { id, description: '' }), action: 'plant' as const })),
        ...outline.hooks_to_payoff.map((id) => ({ ...(hooksMap.get(id) ?? { id, description: '' }), action: 'payoff' as const })),
      ]

      const result: Record<string, unknown> = {
        outline,
        maps,
        recent_chapters: recent,
        involved_characters,
        involved_hooks,
      }

      if (number === 1 || recent.length === 0) {
        const meta = await readSourceMeta(novelId)
        result['style_samples'] = meta?.style_samples ?? []
        result['style_tags'] = meta?.style_tags ?? []
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}
