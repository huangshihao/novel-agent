import { describe, expect, it } from 'vitest'
import type { OutlineRecord } from '@novel-agent/shared'
import {
  buildOutlineEvaluationPrompt,
  chooseDefaultOutlineEvaluationNumbers,
  chooseDefaultOutlineEvaluationRange,
  MAX_OUTLINE_EVALUATION_CHAPTERS,
  validateOutlineEvaluationNumbers,
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
    expect(chooseDefaultOutlineEvaluationNumbers(outlines)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('单次评估上限为 20 章', () => {
    expect(MAX_OUTLINE_EVALUATION_CHAPTERS).toBe(20)
  })

  it('提示词包含番茄评估标准和目标大纲内容', () => {
    const prompt = buildOutlineEvaluationPrompt({
      novelTitle: '测试小说',
      from: 2,
      to: 3,
      outlines: [outline(2), outline(3)],
    })

    expect(prompt).toContain('番茄小说')
    expect(prompt).toContain('第 2、3 章')
    expect(prompt).toContain('第 2 章新大纲剧情')
    expect(prompt).toContain('第 3 章新大纲剧情')
  })

  it('评估中段章节时不套用黄金三章标准', () => {
    const prompt = buildOutlineEvaluationPrompt({
      novelTitle: '测试小说',
      from: 11,
      to: 20,
      outlines: Array.from({ length: 10 }, (_, i) => outline(i + 11)),
    })

    expect(prompt).not.toContain('黄金三章：主角出场速度')
    expect(prompt).toContain('阶段连载标准')
    expect(prompt).toContain('阶段目标是否明确')
  })

  it('要求模型输出短评估而不是冗长逐章报告', () => {
    const prompt = buildOutlineEvaluationPrompt({
      novelTitle: '测试小说',
      from: 11,
      to: 20,
      outlines: Array.from({ length: 10 }, (_, i) => outline(i + 11)),
    })

    expect(prompt).toContain('总字数控制在 800 字以内')
    expect(prompt).toContain('只列最关键的 3-5 条修改建议')
    expect(prompt).not.toContain('逐章修改意见')
  })

  it('支持非连续章节选择', () => {
    const outlines = [outline(11), outline(12), outline(13)]
    const checked = validateOutlineEvaluationNumbers([13, 11], outlines)

    expect(checked).toEqual({ ok: true, selected: [outline(11), outline(13)] })

    const prompt = buildOutlineEvaluationPrompt({
      novelTitle: '测试小说',
      from: 11,
      to: 13,
      chapterNumbers: [11, 13],
      outlines: [outline(11), outline(13)],
    })

    expect(prompt).toContain('第 11、13 章大纲')
    expect(prompt).toContain('第 11 章新大纲剧情')
    expect(prompt).not.toContain('第 12 章新大纲剧情')
    expect(prompt).toContain('第 13 章新大纲剧情')
  })
})
