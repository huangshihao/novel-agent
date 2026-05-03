import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMaps, type OutlineRecord } from '../../storage/target-writer.js'
import { writeSourceHooks } from '../../storage/source-writer.js'
import { writeState } from '../../storage/state.js'
import { buildWriteChapterOutlineTool } from './write-chapter-outline.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wco-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const novelId = 'nv-1'

async function exec(batch: { from: number; to: number }, params: unknown) {
  const tool = buildWriteChapterOutlineTool(novelId, batch)
  return await (tool.execute as unknown as (
    id: string,
    p: unknown,
  ) => Promise<{ details: { ok: boolean; issues?: string[] } }>)('call-1', params)
}

function baseOutline(number: number, refs: string[]): OutlineRecord {
  return {
    number,
    source_chapter_ref: number,
    plot_functions: ['推动主角'],
    plot: '本章剧情。',
    key_events: [{ function: '推动主角', new_carrier: '具体载体' }],
    hooks_to_plant: [],
    hooks_to_payoff: [],
    planned_state_changes: { character_deaths: [], new_settings: [] },
    referenced_characters: refs,
    retention_plan: {
      inherited_hook: number === 1 ? '无' : '上一章留下的具体问题',
      chapter_goal: '推动主角做出选择',
      opening_hook: '开头立刻出现压力',
      new_obstacle: '对手加码',
      midpoint_turn: '局势反转',
      payoff: '兑现一个小期待',
      ending_hook: '留下下一章明确问题',
      reader_expectation: '读者想看主角如何处理新问题',
      retention_risk: '无',
    },
    golden_three_plan:
      number <= 3
        ? {
            chapter_role: number === 1 ? 'strong_situation' : number === 2 ? 'first_payoff' : 'mainline_lock',
            reader_contract: {
              core_emotion: '压迫后的反击',
              main_selling_point: '主角用信息差破局',
              protagonist_desire: '夺回主动权',
              main_conflict: '对手持续压迫主角',
              long_term_question: '幕后黑手是谁',
            },
            diagnostic_scores: {
              protagonist_entry_speed: 8,
              conflict_strength: 8,
              empathy: 8,
              mainline_clarity: 8,
              payoff_clarity: 8,
              ending_hook_strength: 8,
              information_density: 7,
              platform_fit: 8,
            },
          }
        : null,
    hook_plans: [],
  }
}

describe('buildWriteChapterOutlineTool', () => {
  beforeEach(async () => {
    await writeSourceHooks(novelId, [])
    await writeState(novelId, {
      alive_status: { 陈峰: { alive: true, last_seen_chapter: 0 } },
      hooks: {},
      new_hooks: [],
    })
  })

  it('rejects unregistered referenced_character', async () => {
    await writeMaps(novelId, {
      character_map: [
        { source: '主角原名', target: '陈峰', source_meta: null, target_note: null },
      ],
      setting_map: null,
    })
    const r = await exec({ from: 1, to: 60 }, baseOutline(31, ['陈峰', '杨建国']))
    expect(r.details.ok).toBe(false)
    expect(r.details.issues?.some((s) => s.includes('未注册') && s.includes('杨建国'))).toBe(true)
  })

  it('rejects character used before source.first_chapter', async () => {
    await writeMaps(novelId, {
      character_map: [
        {
          source: '林红霞',
          target: '杨柳',
          source_meta: {
            role: 'side',
            story_function: 'benefactor',
            replaceability: 'medium',
            first_chapter: 87,
            last_chapter: 100,
            description: '女警',
          },
          target_note: null,
        },
      ],
      setting_map: null,
    })
    const r = await exec({ from: 1, to: 60 }, baseOutline(31, ['杨柳']))
    expect(r.details.ok).toBe(false)
    expect(r.details.issues?.some((s) => s.includes('first_chapter=87'))).toBe(true)
  })

  it('passes when chapter is within source range', async () => {
    await writeMaps(novelId, {
      character_map: [
        {
          source: '林红霞',
          target: '杨柳',
          source_meta: {
            role: 'side',
            story_function: 'benefactor',
            replaceability: 'medium',
            first_chapter: 87,
            last_chapter: 100,
            description: '女警',
          },
          target_note: null,
        },
      ],
      setting_map: null,
    })
    const r = await exec({ from: 80, to: 100 }, baseOutline(90, ['杨柳']))
    expect(r.details.ok).toBe(true)
  })

  it('passes target-only character (source_meta=null) at any chapter', async () => {
    await writeMaps(novelId, {
      character_map: [
        { source: null, target: '杨建国', source_meta: null, target_note: '生产队队长' },
      ],
      setting_map: null,
    })
    const r = await exec({ from: 1, to: 60 }, baseOutline(5, ['杨建国']))
    expect(r.details.ok).toBe(true)
  })

  it('requires golden three plan for the first three chapters', async () => {
    await writeMaps(novelId, {
      character_map: [
        { source: '主角原名', target: '陈峰', source_meta: null, target_note: null },
      ],
      setting_map: null,
    })
    const outline = baseOutline(2, ['陈峰'])
    outline.golden_three_plan = null

    const r = await exec({ from: 1, to: 3 }, outline)

    expect(r.details.ok).toBe(false)
    expect(r.details.issues?.some((s) => s.includes('黄金三章'))).toBe(true)
  })

  it('requires every planted hook to have a concrete hook plan', async () => {
    await writeMaps(novelId, {
      character_map: [
        { source: '主角原名', target: '陈峰', source_meta: null, target_note: null },
      ],
      setting_map: null,
    })
    const outline = baseOutline(4, ['陈峰'])
    outline.hooks_to_plant = ['nhk-001']

    const r = await exec({ from: 1, to: 10 }, outline)

    expect(r.details.ok).toBe(false)
    expect(r.details.issues?.some((s) => s.includes('hook_plans') && s.includes('nhk-001'))).toBe(true)
  })

  it('accepts source hook categories in hook_plans schema', () => {
    const tool = buildWriteChapterOutlineTool(novelId, { from: 1, to: 10 })
    const outline = baseOutline(4, ['陈峰'])
    outline.hooks_to_plant = ['nhk-001']
    const params = {
      ...outline,
      hook_plans: [
        {
          id: 'nhk-001',
          type: 'suspense',
          description: '某个山中白影的真实身份',
          expected_payoff_chapter: 8,
          payoff_plan: '第 8 章揭示白影只是山兽留下的误导线索',
        },
      ],
    }

    expect(Value.Check(tool.parameters, params)).toBe(true)
  })

  it('lists allowed hook plan types in prompt guidelines', () => {
    const tool = buildWriteChapterOutlineTool(novelId, { from: 1, to: 10 })

    expect(tool.promptGuidelines?.join('\n')).toContain(
      'type 只能取：suspense / crisis / payoff / goal / secret / relation / rule / contrast / emotion / information / identity / reward / punishment / reversal',
    )
  })
})
