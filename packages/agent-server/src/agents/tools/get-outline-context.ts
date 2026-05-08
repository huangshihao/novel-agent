import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps, readOutline } from '../../storage/target-reader.js'
import { readState } from '../../storage/state.js'
import {
  readSourceChapter,
  listSourceCharacters,
  readSourceHooks,
  readSourceMeta,
  readSourceSubplots,
} from '../../storage/source-reader.js'
import { readNovelIndex } from '../../storage/novel-index.js'
import { sanitizeMapsForAgent } from './context-sanitize.js'

function needsMetaFallback(meta: Awaited<ReturnType<typeof readSourceMeta>>): boolean {
  return !meta ||
    (!meta.industry.trim() &&
      !meta.era.trim() &&
      meta.genre_tags.length === 0 &&
      meta.world_rules.length === 0)
}

async function buildEffectiveMeta(novelId: string) {
  const meta = await readSourceMeta(novelId)
  if (!needsMetaFallback(meta)) return meta

  const novel = await readNovelIndex(novelId)
  const title = `${meta?.title ?? ''} ${novel?.title ?? ''}`
  if (/195\d|196\d|年代|打猎|狩猎|深山|山/.test(title)) {
    return {
      title: meta?.title ?? novel?.title ?? '',
      chapter_count: meta?.chapter_count ?? novel?.chapter_count ?? 0,
      industry: '1950年代深山狩猎求生',
      era: '1950年代',
      genre_tags: ['重生', '种田'],
      world_rules: ['写实年代背景，不存在超自然能力或弹窗系统'],
      key_terms: ['深山', '打猎', '生产队', '供销社', '猎枪', '野物', '口粮'],
      style_tags: ['写实', '生存细节', '家庭温情', '爽点兑现'],
      style_samples: meta?.style_samples ?? [],
      summary: meta?.summary ?? '',
    }
  }
  return meta
}

export function buildGetOutlineContextTool(novelId: string): ToolDefinition {
  return {
    name: 'getOutlineContext',
    label: '获取写大纲 context 包',
    description:
      '一次性返回写本章大纲所需的全部安全信息：source 章的 dramatic_beat_blueprint（戏剧节拍蓝图）/ plot_functions / key_events[].function+can_replace+can_reorder+depends_on（**不含 desc / summary**，避免抄载体）/ similarity_signals / 涉及的 subplots / maps / state / meta（题材锚点）/ source_characters / 邻近章节的 outline。**写大纲前必须先调一次。**',
    promptSnippet: 'getOutlineContext({number}) - 写大纲前必先调',
    promptGuidelines: [
      '写**每一章**大纲前都要调一次',
      '**严禁并行调用 / 一次只调一章**：写多章时按 getOutlineContext(N) → writeChapterOutline(N) → getOutlineContext(N+1) 串行循环。一次 batch 10+ 章会让返回结果累计 50K+ token 撑爆 context，provider 静默失败',
      '返回的 source.plot_functions 是本章必须实现的剧情功能列表——你的 outline.plot_functions 直接抄过去',
      '返回的 source.dramatic_beat_blueprint 是本章真正要参考的中间层：按状态变化、压力结构、信息差、情绪曲线、爽点兑现和章末承诺设计新剧情',
      '返回的 source.key_events[].function 是每个关键事件要实现的功能；你要为每个 function 设计一个新载体（new_carrier），允许单个题材元素趋同，但不能复现原作整套事件组合',
      '返回的 source.similarity_signals 是相似风险提示，不是禁用清单；允许题材内自然趋同，但不能把这些信号组合成和原作一比一相同的事件链',
      '返回的 meta.industry / era / genre_tags / world_rules / style_tags 是题材锚点——target_industry 默认要保持一致',
      '返回的 nearby_outlines 是邻近章节已写的大纲（前后各 3 章），用来保持新载体连贯、避免和邻章重复',
      '返回的 hook_ledger 是当前钩子账本：overdue=true 或 open_chapters 过长的钩子，需要优先安排阶段性兑现',
      '**maps.character_map[i].source_meta.first_chapter / last_chapter** 限定每个角色出场区间——本章号在区间外的角色不能 referenced_characters 引用，writeChapterOutline 会硬拒',
      '本工具返回的是写大纲所需的完整安全 context；章节简介、原文、事件 desc 不属于写作 agent 输入',
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
      const meta = await buildEffectiveMeta(novelId)
      const allSubplots = await readSourceSubplots(novelId)
      const sourceCharacters = await listSourceCharacters(novelId)

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
          similarity_signals: sourceChapter.originality_risks,
          dramatic_beat_blueprint: sourceChapter.dramatic_beat_blueprint,
          writing_rhythm: sourceChapter.writing_rhythm,
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
        maps: sanitizeMapsForAgent(maps),
        source_characters: sourceCharacters
          .filter((c) => c.role !== 'tool')
          .map((c) => ({
            canonical_name: c.canonical_name,
            role: c.role,
            story_function: c.story_function,
            replaceability: c.replaceability,
            first_chapter: c.first_chapter,
            last_chapter: c.last_chapter,
          })),
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
