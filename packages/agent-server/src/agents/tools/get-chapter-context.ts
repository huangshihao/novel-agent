import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps, readChapterDraft, readOutline } from '../../storage/target-reader.js'
import { readState } from '../../storage/state.js'
import {
  readSourceChapter,
  readSourceHooks,
  readSourceMeta,
} from '../../storage/source-reader.js'
import { sanitizeMapsForAgent } from './context-sanitize.js'

export function buildGetChapterContextTool(novelId: string): ToolDefinition {
  return {
    name: 'getChapterContext',
    label: '获取写章 context 包',
    description:
      '一次性返回写本章正文需要的全部信息：大纲 + 置换表 + 最近 3 章 target 正文 + 涉及角色状态 + 伏笔状态 + **source 章的 writing_rhythm（节奏指引）/ plot_functions / key_events[].function / originality_risks（避雷）**。不返回原文、章节简介、事件 desc 或风格样本文本。',
    promptSnippet: 'getChapterContext({number}) - 一次拿全写章所需 context',
    promptGuidelines: [
      '写每一章正文前**必须**先调用一次',
      '**严禁并行调用 / 一次只调一章**：写多章时按 getChapterContext(N) → writeChapter(N) → getChapterContext(N+1) 串行循环。并行 batch 会撑爆 context 让 provider 静默失败',
      '返回的 maps.character_map 是写正文时人名的唯一来源',
      '返回的 alive_status 里 alive===false 的角色不能在正文里有动作（writeChapter 会硬拒）',
      '返回的 source.writing_rhythm 决定本章节奏：beat_sequence 走顺序、emotional_curve 走情绪、text_composition 走配比、reader_attention_design 走开头/章末钩子',
      '返回的 hook_ledger 是当前钩子账本：优先处理 overdue=true 的钩子，正文必须兑现 outline.hooks_to_payoff，不能新增未登记的假悬念',
      '返回的 source.originality_risks 是改写时**绝对不能照搬**的标志性桥段载体',
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
      const hook_ledger = [
        ...sourceHooks
          .filter((h) => state?.hooks[h.id]?.status !== 'paid_off')
          .map((h) => ({
            id: h.id,
            type: h.category,
            description: h.description,
            planted_chapter: h.planted_chapter,
            expected_payoff_chapter: h.payoff_chapter,
            payoff_plan: '',
            source: 'source' as const,
            open_chapters: Math.max(0, number - h.planted_chapter),
            overdue:
              typeof h.payoff_chapter === 'number' && h.payoff_chapter < number,
          })),
        ...(state?.new_hooks ?? [])
          .filter((h) => h.status === 'open')
          .map((h) => ({
            id: h.id,
            type: h.type ?? null,
            description: h.description,
            planted_chapter: h.planted_chapter,
            expected_payoff_chapter: h.expected_payoff_chapter,
            payoff_plan: h.payoff_plan ?? '',
            source: 'new' as const,
            open_chapters: Math.max(0, number - h.planted_chapter),
            overdue:
              typeof h.expected_payoff_chapter === 'number' &&
              h.expected_payoff_chapter < number,
          })),
      ]

      const sourceChapter = await readSourceChapter(novelId, outline.source_chapter_ref)

      const result: Record<string, unknown> = {
        outline,
        maps: sanitizeMapsForAgent(maps),
        recent_chapters: recent,
        involved_characters,
        involved_hooks,
        hook_ledger,
        source: sourceChapter
          ? {
              chapter_ref: sourceChapter.number,
              plot_functions: sourceChapter.plot_functions,
              key_events: sourceChapter.key_events.map((e) => ({
                function: e.function,
                can_replace: e.can_replace,
                can_reorder: e.can_reorder,
                depends_on: e.depends_on,
              })),
              originality_risks: sourceChapter.originality_risks,
              writing_rhythm: sourceChapter.writing_rhythm,
            }
          : null,
      }

      if (number === 1 || recent.length === 0) {
        const meta = await readSourceMeta(novelId)
        result['style_tags'] = meta?.style_tags ?? []
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}
