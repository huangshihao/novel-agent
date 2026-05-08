import { describe, expect, it } from 'vitest'
import type { OutlineRecord } from '@novel-agent/shared'
import {
  buildOutlineEvaluationPrompt,
  chooseDefaultOutlineEvaluationRange,
  MAX_OUTLINE_EVALUATION_CHAPTERS,
} from './outline-evaluator.js'

function outline(number: number): OutlineRecord {
  return {
    number,
    source_chapter_ref: number,
    plot_functions: [`功能 ${number}`],
    hooks_to_plant: [],
    hooks_to_payoff: [],
    planned_state_changes: { character_deaths: [], new_settings: [] },
    plot: `第 ${number} 章新大纲剧情`,
    key_events: [{ function: `事件功能 ${number}`, new_carrier: `新载体 ${number}` }],
    referenced_characters: ['主角'],
    retention_plan: null,
    reader_experience_plan: null,
    golden_three_plan: null,
    hook_plans: [],
  }
}

describe('outline evaluator', () => {
  it('默认评估从首章开始且最多覆盖 10 章', () => {
    const outlines = Array.from({ length: 30 }, (_, i) => outline(i + 1))

    expect(chooseDefaultOutlineEvaluationRange(outlines)).toEqual({ from: 1, to: 10 })
  })

  it('单次评估上限为 20 章', () => {
    expect(MAX_OUTLINE_EVALUATION_CHAPTERS).toBe(20)
  })

  it('提示词包含番茄评估标准和可转发给 agent 的修改意见要求', () => {
    const prompt = buildOutlineEvaluationPrompt({
      novelTitle: '测试小说',
      from: 2,
      to: 3,
      outlines: [outline(2), outline(3)],
    })

    expect(prompt).toContain('番茄小说')
    expect(prompt).toContain('第 2-3 章')
    expect(prompt).toContain('可直接发给写作 agent')
    expect(prompt).toContain('第 2 章新大纲剧情')
    expect(prompt).toContain('第 3 章新大纲剧情')
  })
})
