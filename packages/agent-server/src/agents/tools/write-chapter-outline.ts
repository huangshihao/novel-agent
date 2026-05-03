import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readSourceHooks } from '../../storage/source-reader.js'
import { readMaps } from '../../storage/target-reader.js'
import { writeOutline, type OutlineRecord } from '../../storage/target-writer.js'
import { readState } from '../../storage/state.js'

const HOOK_PLAN_TYPES = [
  'suspense',
  'crisis',
  'payoff',
  'goal',
  'secret',
  'relation',
  'rule',
  'contrast',
  'emotion',
  'information',
  'identity',
  'reward',
  'punishment',
  'reversal',
] as const

export interface BatchRange {
  from: number
  to: number
}

export function buildWriteChapterOutlineTool(
  novelId: string,
  batch: BatchRange,
): ToolDefinition {
  const retentionPlanSchema = Type.Object({
    inherited_hook: Type.String(),
    chapter_goal: Type.String(),
    opening_hook: Type.String(),
    new_obstacle: Type.String(),
    midpoint_turn: Type.String(),
    payoff: Type.String(),
    ending_hook: Type.String(),
    reader_expectation: Type.String(),
    retention_risk: Type.String(),
  })
  const readerContractSchema = Type.Object({
    core_emotion: Type.String(),
    main_selling_point: Type.String(),
    protagonist_desire: Type.String(),
    main_conflict: Type.String(),
    long_term_question: Type.String(),
  })
  const goldenThreePlanSchema = Type.Object({
    chapter_role: Type.Union([
      Type.Literal('strong_situation'),
      Type.Literal('first_payoff'),
      Type.Literal('mainline_lock'),
    ]),
    reader_contract: readerContractSchema,
    diagnostic_scores: Type.Object({
      protagonist_entry_speed: Type.Number(),
      conflict_strength: Type.Number(),
      empathy: Type.Number(),
      mainline_clarity: Type.Number(),
      payoff_clarity: Type.Number(),
      ending_hook_strength: Type.Number(),
      information_density: Type.Number(),
      platform_fit: Type.Number(),
    }),
  })
  const hookPlanSchema = Type.Object({
    id: Type.String(),
    type: Type.Union([
      ...HOOK_PLAN_TYPES.map((type) => Type.Literal(type)),
    ]),
    description: Type.String(),
    expected_payoff_chapter: Type.Number(),
    payoff_plan: Type.String(),
  })
  return {
    name: 'writeChapterOutline',
    label: '写章节大纲',
    description:
      '写入或覆盖某章的大纲。**写之前必须先调 getOutlineContext({number})。** precondition：number 必须在本批范围内；plot_functions 必须非空且应等于 source 章的 plot_functions（功能槽不能丢）；每章必须给 retention_plan；前三章必须给 golden_three_plan；每个新增 hooks_to_plant 必须给 hook_plans 说明类型、描述、预计兑现章节和兑现方式；hooks_to_payoff 引用的 id 必须存在于 source/hooks.md 或 state.new_hooks；planned_state_changes.character_deaths 提到的角色当前必须 alive。',
    promptSnippet: 'writeChapterOutline({number, plot_functions, key_events:[{function,new_carrier}], ...})',
    promptGuidelines: [
      `本批范围：${batch.from}-${batch.to}。number 必须在此范围内`,
      '**调用前**：必须先调 getOutlineContext({number}) 拿 source 的 plot_functions / key_events[].function / originality_risks。按 function-level 信息从零设计新载体',
      '**plot_functions 必须 = getOutlineContext 返回的 source.plot_functions**（按数组原样抄，一个不能少）。这是本章必须实现的剧情功能槽',
      '**key_events 是 {function, new_carrier} 数组**：每个 function 字段从 source.key_events[i].function 抄过来；new_carrier 是你为这个 function 设计的**全新具体载体**（地点/动作/物件/对手身份/触发条件全换）',
      '**source.key_events[i].can_replace=false** 时：function 必须保留，载体可换但不能跳过这个事件',
      '**source.key_events[i].can_replace=true** 时：载体必须换。new_carrier 不能与原书 desc 字面相近——但你看不到 desc，只能看到 function，这是设计。按 function 从零设计载体',
      '**主动避开 source.originality_risks**：那些是标志性桥段载体，绝不能直接复刻',
      'plot 是 200-400 字的本章剧情概述（中文，已应用 maps.setting_map.key_term_replacements），写"角色为什么做这件事 + 这件事如何实现 plot_functions"，**不要**写名词替换的原剧情',
      '**同题材边界**：所有 new_carrier 必须落在 meta.industry / era / world_rules 的语境内（参考 getOutlineContext.meta），不得引入超出原书技术水位/写实度的元素',
      '**支线重排**：getOutlineContext.involved_subplots 里 reorderable=true 且无 depends_on 的支线，主动考虑挪位',
      'hooks_to_plant 列本章新埋的长线伏笔（id 是你自定义的，nhk-001 风格）；hooks_to_payoff 列本章兑现的伏笔 id',
      `**hook_plans 必须覆盖每个 hooks_to_plant**：写清 type / description / expected_payoff_chapter / payoff_plan。type 只能取：${HOOK_PLAN_TYPES.join(' / ')}。不要只埋坑不设计兑现`,
      '**retention_plan 必填**：按“承接上章钩子 → 本章目标 → 新阻碍 → 中段转折 → 小兑现 → 章末钩子 → 读者期待”写具体情节，不能写空泛词',
      '**黄金三章**：第 1 章 golden_three_plan.chapter_role=strong_situation，强处境开局；第 2 章=first_payoff，必须兑现第一个小爽点/情绪点；第 3 章=mainline_lock，必须确立主线和长线问题',
      'planned_state_changes.character_deaths 里的角色名必须用 character_map.target 形式',
      '**referenced_characters 必须列全本章 plot / key_events 出现的所有有名角色 target 名**——工具会逐个查 maps，没注册的会 reject 让你先调 updateMaps；source 端有 first_chapter / last_chapter 限制时本章号必须在区间内（防时间线穿越）',
    ],
    parameters: Type.Object({
      number: Type.Number(),
      source_chapter_ref: Type.Number(),
      plot_functions: Type.Array(Type.String()),
      plot: Type.String(),
      key_events: Type.Array(
        Type.Object({
          function: Type.String(),
          new_carrier: Type.String(),
        }),
      ),
      hooks_to_plant: Type.Array(Type.String()),
      hooks_to_payoff: Type.Array(Type.String()),
      hook_plans: Type.Array(hookPlanSchema),
      retention_plan: retentionPlanSchema,
      golden_three_plan: Type.Union([goldenThreePlanSchema, Type.Null()]),
      planned_state_changes: Type.Object({
        character_deaths: Type.Array(Type.String()),
        new_settings: Type.Array(Type.String()),
      }),
      referenced_characters: Type.Array(Type.String()),
    }),
    async execute(_id, params) {
      const p = params as OutlineRecord
      const issues: string[] = []
      if (p.number < batch.from || p.number > batch.to) {
        issues.push(`number ${p.number} 超出本批范围 ${batch.from}-${batch.to}`)
      }
      if (!p.plot_functions || p.plot_functions.length === 0) {
        issues.push('plot_functions 不能为空——必须从 getOutlineContext.source.plot_functions 抄过来')
      }
      p.key_events.forEach((e, i) => {
        if (!e.function?.trim()) issues.push(`key_events[${i}].function 不能为空`)
        if (!e.new_carrier?.trim()) issues.push(`key_events[${i}].new_carrier 不能为空`)
      })
      const retention = p.retention_plan
      if (!retention) {
        issues.push('retention_plan 不能为空——每章都必须设计留存节奏')
      } else {
        for (const [key, value] of Object.entries(retention)) {
          if (typeof value !== 'string' || value.trim().length === 0) {
            issues.push(`retention_plan.${key} 不能为空`)
          }
        }
      }
      if (p.number <= 3) {
        if (!p.golden_three_plan) {
          issues.push('黄金三章章节必须提供 golden_three_plan')
        } else {
          const expectedRole =
            p.number === 1 ? 'strong_situation' : p.number === 2 ? 'first_payoff' : 'mainline_lock'
          if (p.golden_three_plan.chapter_role !== expectedRole) {
            issues.push(`黄金三章第 ${p.number} 章 chapter_role 应为 ${expectedRole}`)
          }
        }
      }
      const hookPlans = new Map((p.hook_plans ?? []).map((h) => [h.id, h]))
      for (const id of p.hooks_to_plant) {
        const plan = hookPlans.get(id)
        if (!plan) {
          issues.push(`hook_plans 必须包含 hooks_to_plant 里的 "${id}"`)
          continue
        }
        if (!plan.description.trim()) issues.push(`hook_plans.${id}.description 不能为空`)
        if (!plan.payoff_plan.trim()) issues.push(`hook_plans.${id}.payoff_plan 不能为空`)
        if (typeof plan.expected_payoff_chapter !== 'number' || plan.expected_payoff_chapter <= p.number) {
          issues.push(`hook_plans.${id}.expected_payoff_chapter 必须大于当前章节 ${p.number}`)
        }
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

      const maps = await readMaps(novelId)
      const charByTarget = new Map(
        (maps?.character_map ?? []).map((e) => [e.target, e]),
      )
      const unregistered: string[] = []
      const timingViolations: string[] = []
      for (const ref of p.referenced_characters) {
        const entry = charByTarget.get(ref)
        if (!entry) {
          unregistered.push(ref)
          continue
        }
        const sm = entry.source_meta
        if (!sm) continue
        if (sm.first_chapter !== null && p.number < sm.first_chapter) {
          timingViolations.push(
            `${ref}（source=${entry.source}，first_chapter=${sm.first_chapter}）尚未在源端登场，不能在第 ${p.number} 章引用`,
          )
        }
        if (sm.last_chapter !== null && p.number > sm.last_chapter) {
          timingViolations.push(
            `${ref}（source=${entry.source}，last_chapter=${sm.last_chapter}）已退出源端故事，不应在第 ${p.number} 章再次引用`,
          )
        }
      }
      if (unregistered.length > 0) {
        issues.push(
          `referenced_characters 里有 ${unregistered.length} 个未注册角色：[${unregistered.join(', ')}]。请先调 updateMaps 注册（自创角色用 source: null + target_note）`,
        )
      }
      for (const v of timingViolations) issues.push(v)

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
