import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readSourceHooks } from '../../storage/source-reader.js'
import { writeOutline, type OutlineRecord } from '../../storage/target-writer.js'
import { readState } from '../../storage/state.js'

export interface BatchRange {
  from: number
  to: number
}

export function buildWriteChapterOutlineTool(
  novelId: string,
  batch: BatchRange,
): ToolDefinition {
  return {
    name: 'writeChapterOutline',
    label: '写章节大纲',
    description:
      '写入或覆盖某章的大纲（章级）。precondition：number 必须在本批范围内；hooks_to_plant / hooks_to_payoff 引用的 id 必须存在于 source/hooks.md 或 state.new_hooks（hooks_to_plant 允许新 id，自动登记）；planned_state_changes.character_deaths 提到的角色当前必须 alive。',
    promptSnippet: 'writeChapterOutline({number, ...}) - 写章级大纲（upsert）',
    promptGuidelines: [
      `本批范围：${batch.from}-${batch.to}。number 必须在此范围内`,
      '**洗稿要求**：plot 不能照抄原书剧情。原书该章发生 X，改写要保留 X 的剧情功能（外部资源获取 / 家庭冲突 / 突破瓶颈 / 等等），但换不同的具体载体（场景、道具、对手）',
      '写 plot 前先在思考里复述原章 key_events 的剧情功能，再设计同功能的替代场景，最后落字',
      'plot 是 200-400 字大纲（中文，已应用置换表 maps.setting_map.key_term_replacements）',
      'key_events 列出本章关键事件，每条用替代场景的具体描述（不能与原章 key_events 字面相同）',
      'hooks_to_plant 列本章要新埋的长线伏笔（id 是你自定义的，nhk-001 风格）；hooks_to_payoff 列本章兑现的伏笔 id（必须已在 source/hooks 或 state.new_hooks）',
      'planned_state_changes.character_deaths 里的角色名必须用 character_map.target 形式',
      '本批已写过的章节大纲可通过 read target/outlines/<n>.md 查看',
      '**支线顺序优化**：如果本章涉及的支线和已写章节的支线无因果依赖（B 不引用 A 的结果），允许调换发生顺序——使改写顺序与原书不同',
    ],
    parameters: Type.Object({
      number: Type.Number(),
      source_chapter_ref: Type.Number(),
      plot: Type.String(),
      key_events: Type.Array(Type.String()),
      hooks_to_plant: Type.Array(Type.String()),
      hooks_to_payoff: Type.Array(Type.String()),
      planned_state_changes: Type.Object({
        character_deaths: Type.Array(Type.String()),
        new_settings: Type.Array(Type.String()),
      }),
    }),
    async execute(_id, params) {
      const p = params as OutlineRecord
      const issues: string[] = []
      if (p.number < batch.from || p.number > batch.to) {
        issues.push(`number ${p.number} 超出本批范围 ${batch.from}-${batch.to}`)
      }
      const sourceHooks = await readSourceHooks(novelId)
      const state = await readState(novelId)
      const knownHookIds = new Set([
        ...sourceHooks.map((h) => h.id),
        ...(state?.new_hooks.map((h) => h.id) ?? []),
      ])
      for (const id of p.hooks_to_payoff) {
        if (!knownHookIds.has(id)) issues.push(`hooks_to_payoff: 未知 hook id "${id}"`)
      }
      for (const dead of p.planned_state_changes.character_deaths) {
        if (state && state.alive_status[dead]?.alive === false) {
          issues.push(`character_deaths: ${dead} 已经死亡，不能再次声明`)
        }
      }
      if (issues.length > 0) {
        const result = { ok: false, issues }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: result,
        }
      }
      await writeOutline(novelId, p)
      const result = { ok: true, saved_path: `target/outlines/${String(p.number).padStart(4, '0')}.md` }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}
