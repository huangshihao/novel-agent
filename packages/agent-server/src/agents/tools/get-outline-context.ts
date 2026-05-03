import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps, readOutline } from '../../storage/target-reader.js'
import { readState } from '../../storage/state.js'
import {
  readSourceChapter,
  readSourceHooks,
  readSourceMeta,
  readSourceSubplots,
} from '../../storage/source-reader.js'

export function buildGetOutlineContextTool(novelId: string): ToolDefinition {
  return {
    name: 'getOutlineContext',
    label: '获取写大纲 context 包',
    description:
      '一次性返回写本章大纲所需的全部 function-level 信息：source 章的 plot_functions / key_events[].function+can_replace+can_reorder+depends_on（**不含 desc / summary**，避免抄载体）/ originality_risks / 涉及的 subplots / maps / state / meta（题材锚点）/ 邻近章节的 outline。**写大纲前必须先调一次。** 不要直接 read source/chapters/*.md 看 desc——那会让你忍不住抄原剧情载体。',
    promptSnippet: 'getOutlineContext({number}) - 写大纲前必先调',
    promptGuidelines: [
      '写**每一章**大纲前都要调一次',
      '**严禁并行调用 / 一次只调一章**：写多章时按 getOutlineContext(N) → writeChapterOutline(N) → getOutlineContext(N+1) 串行循环。一次 batch 10+ 章会让返回结果累计 50K+ token 撑爆 context，provider 静默失败',
      '返回的 source.plot_functions 是本章必须实现的剧情功能列表——你的 outline.plot_functions 直接抄过去',
      '返回的 source.key_events[].function 是每个关键事件要实现的功能；你要为每个 function 设计一个**新载体**（new_carrier），载体不得与原书相似',
      '返回的 source.originality_risks 是必须主动避开的标志性桥段载体',
      '返回的 meta.industry / era / genre_tags / world_rules / style_tags 是题材锚点——target_industry 默认要保持一致',
      '返回的 nearby_outlines 是邻近章节已写的大纲（前后各 3 章），用来保持新载体连贯、避免和邻章重复',
      '返回的 hook_ledger 是当前钩子账本：overdue=true 或 open_chapters 过长的钩子，需要优先安排阶段性兑现',
      '**maps.character_map[i].source_meta.first_chapter / last_chapter** 限定每个角色出场区间——本章号在区间外的角色不能 referenced_characters 引用，writeChapterOutline 会硬拒',
      '**禁止**：调完本工具后再 read source/chapters/<n>.md。原书 desc / summary 会污染你的载体设计',
    ],
    parameters: Type.Object({
      number: Type.Number(),
    }),
    async execute(_id, params) {
      const { number } = params as { number: number }
      const sourceChapter = await readSourceChapter(novelId, number)
      if (!sourceChapter) {
        const result = { ok: false, error: `source chapter ${number} 不存在或未分析` }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: result,
        }
      }

      const maps = await readMaps(novelId)
      const state = await readState(novelId)
      const sourceHooks = await readSourceHooks(novelId)
      const meta = await readSourceMeta(novelId)
      const allSubplots = await readSourceSubplots(novelId)

      const involved_subplots = allSubplots
        .filter((s) => s.chapters.includes(number))
        .map((s) => ({
          id: s.id,
          name: s.name,
          function: s.function,
          delivers: s.delivers,
          depends_on: s.depends_on,
          reorderable: s.reorderable,
          chapters: s.chapters,
        }))

      const nearby_outlines: { number: number; plot_functions: string[]; key_events: { function: string; new_carrier: string }[] }[] = []
      for (const n of [number - 3, number - 2, number - 1, number + 1, number + 2, number + 3].filter((n) => n >= 1 && n !== number)) {
        const o = await readOutline(novelId, n)
        if (o) {
          nearby_outlines.push({
            number: o.number,
            plot_functions: o.plot_functions,
            key_events: o.key_events,
          })
        }
      }

      const open_hooks = [
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
          })),
      ]

      const hook_ledger = open_hooks.map((h) => ({
        ...h,
        open_chapters: Math.max(0, number - h.planted_chapter),
        overdue:
          typeof h.expected_payoff_chapter === 'number' &&
          h.expected_payoff_chapter < number,
      }))

      const alive_summary = Object.entries(state?.alive_status ?? {})
        .filter(([, s]) => s.alive)
        .map(([name, s]) => ({ name, last_seen_chapter: s.last_seen_chapter }))

      const result = {
        ok: true,
        source: {
          chapter_ref: sourceChapter.number,
          plot_functions: sourceChapter.plot_functions,
          key_events: sourceChapter.key_events.map((e) => ({
            function: e.function,
            can_replace: e.can_replace,
            can_reorder: e.can_reorder,
            depends_on: e.depends_on,
          })),
          originality_risks: sourceChapter.originality_risks,
        },
        meta: meta
          ? {
              industry: meta.industry,
              era: meta.era,
              genre_tags: meta.genre_tags,
              world_rules: meta.world_rules,
              style_tags: meta.style_tags,
            }
          : null,
        maps,
        involved_subplots,
        open_hooks,
        hook_ledger,
        alive_characters: alive_summary,
        nearby_outlines,
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}
