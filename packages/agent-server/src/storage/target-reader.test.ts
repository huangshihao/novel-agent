import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeMaps,
  writeOutline,
  writeChapterDraft,
  type OutlineRecord,
} from './target-writer.js'
import {
  readMaps,
  readOutline,
  listOutlines,
  readChapterDraft,
  listChapterDrafts,
  outlineExists,
  missingOutlines,
} from './target-reader.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tr-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

function makeOutline(n: number, plot: string, events: string[]): OutlineRecord {
  return {
    number: n,
    source_chapter_ref: n + 1,
    plot_functions: [],
    hooks_to_plant: [`plant-${n}`],
    hooks_to_payoff: [],
    planned_state_changes: { character_deaths: [], new_settings: [] },
    plot,
    key_events: events.map((e) => ({ function: '', new_carrier: e })),
    referenced_characters: [],
    retention_plan: null,
    golden_three_plan: null,
    hook_plans: [],
  }
}

describe('target-reader', () => {
  it('readMaps round-trips with setting_map: null', async () => {
    await writeMaps('nv-1', {
      character_map: [
        { source: '张三', target: '李四', source_meta: null, target_note: null },
        { source: '王五', target: '赵六', source_meta: null, target_note: '改为女性' },
      ],
      setting_map: null,
    })
    const maps = await readMaps('nv-1')
    expect(maps).not.toBeNull()
    expect(maps!.character_map).toHaveLength(2)
    expect(maps!.character_map[0]).toEqual({ source: '张三', target: '李四', source_meta: null, target_note: null })
    expect(maps!.character_map[1]).toEqual({ source: '王五', target: '赵六', source_meta: null, target_note: '改为女性' })
    expect(maps!.setting_map).toBeNull()
  })

  it('readOutline round-trips plot, plot_functions and structured key_events', async () => {
    await writeOutline('nv-1', {
      number: 3,
      source_chapter_ref: 5,
      plot_functions: ['建立环境压力', '推动主角主动出击'],
      hooks_to_plant: ['hk-1'],
      hooks_to_payoff: ['hk-2'],
      planned_state_changes: {
        character_deaths: ['某反派'],
        new_settings: ['公司总部'],
      },
      plot: '主角进入公司，遭遇神秘事件。',
      key_events: [
        { function: '主角进入新场域', new_carrier: '主角入职' },
        { function: '埋下悬念', new_carrier: '发现密室' },
        { function: '建立反派对抗关系', new_carrier: '撞见上司' },
      ],
      referenced_characters: [],
      retention_plan: {
        inherited_hook: '第二章末的账本被调包',
        chapter_goal: '让主角锁定第一阶段目标',
        opening_hook: '账本在众人面前缺页',
        new_obstacle: '负责保管账本的人反咬主角',
        midpoint_turn: '缺页内容其实被主角提前拍下',
        payoff: '主角当场逼出第一个同谋',
        ending_hook: '缺页背面出现父亲旧印',
        reader_expectation: '读者想看主角查清父亲旧案',
        retention_risk: '信息量偏大，需要压缩解释',
      },
      golden_three_plan: {
        chapter_role: 'mainline_lock',
        reader_contract: {
          core_emotion: '压迫后的反击',
          main_selling_point: '主角用证据链打脸',
          protagonist_desire: '查清父亲旧案',
          main_conflict: '旧案相关势力不断灭口',
          long_term_question: '父亲到底藏了什么证据',
        },
        diagnostic_scores: {
          protagonist_entry_speed: 9,
          conflict_strength: 8,
          empathy: 8,
          mainline_clarity: 9,
          payoff_clarity: 8,
          ending_hook_strength: 9,
          information_density: 7,
          platform_fit: 8,
        },
      },
      hook_plans: [
        {
          id: 'nhk-001',
          type: 'secret',
          description: '父亲旧印对应一份失踪档案',
          expected_payoff_chapter: 6,
          payoff_plan: '第六章让主角拿到档案副本',
        },
      ],
    })
    const o = await readOutline('nv-1', 3)
    expect(o).not.toBeNull()
    expect(o!.number).toBe(3)
    expect(o!.source_chapter_ref).toBe(5)
    expect(o!.plot_functions).toEqual(['建立环境压力', '推动主角主动出击'])
    expect(o!.hooks_to_plant).toEqual(['hk-1'])
    expect(o!.hooks_to_payoff).toEqual(['hk-2'])
    expect(o!.planned_state_changes).toEqual({
      character_deaths: ['某反派'],
      new_settings: ['公司总部'],
    })
    expect(o!.plot).toBe('主角进入公司，遭遇神秘事件。')
    expect(o!.key_events).toEqual([
      { function: '主角进入新场域', new_carrier: '主角入职' },
      { function: '埋下悬念', new_carrier: '发现密室' },
      { function: '建立反派对抗关系', new_carrier: '撞见上司' },
    ])
    expect(o!.retention_plan?.midpoint_turn).toBe('缺页内容其实被主角提前拍下')
    expect(o!.golden_three_plan?.chapter_role).toBe('mainline_lock')
    expect(o!.hook_plans?.[0]?.expected_payoff_chapter).toBe(6)
  })

  it('listOutlines with range filters and sorts', async () => {
    await writeOutline('nv-1', makeOutline(1, '一', ['e1']))
    await writeOutline('nv-1', makeOutline(5, '五', ['e5']))
    await writeOutline('nv-1', makeOutline(3, '三', ['e3']))
    await writeOutline('nv-1', makeOutline(2, '二', ['e2']))
    await writeOutline('nv-1', makeOutline(4, '四', ['e4']))
    const list = await listOutlines('nv-1', { from: 2, to: 4 })
    expect(list.map((o) => o.number)).toEqual([2, 3, 4])
    expect(list[0]!.plot).toBe('二')
    expect(list[1]!.plot).toBe('三')
    expect(list[2]!.plot).toBe('四')
    expect(list[0]!.key_events).toEqual([{ function: '', new_carrier: 'e2' }])
  })

  it('listChapterDrafts sorts by number', async () => {
    await writeChapterDraft('nv-1', {
      number: 2,
      title: 'B',
      word_count: 10,
      written_at: '2026-04-25T01:00:00Z',
      content: 'body B',
    })
    await writeChapterDraft('nv-1', {
      number: 1,
      title: 'A',
      word_count: 20,
      written_at: '2026-04-25T00:00:00Z',
      content: 'body A',
    })
    const drafts = await listChapterDrafts('nv-1')
    expect(drafts.map((d) => d.number)).toEqual([1, 2])
    expect(drafts[0]!.title).toBe('A')
    expect(drafts[0]!.content).toBe('body A')
    expect(drafts[1]!.title).toBe('B')
  })

  it('all readers return null/empty when missing', async () => {
    expect(await readMaps('nv-x')).toBeNull()
    expect(await readOutline('nv-x', 1)).toBeNull()
    expect(await readChapterDraft('nv-x', 1)).toBeNull()
    expect(await listOutlines('nv-x')).toEqual([])
    expect(await listChapterDrafts('nv-x')).toEqual([])
  })
})

describe('outlineExists / missingOutlines', () => {
  it('returns true when outline file exists', async () => {
    await writeOutline('oe-test', makeOutline(1, 'p', ['e']))
    await writeOutline('oe-test', makeOutline(3, 'p', ['e']))
    expect(await outlineExists('oe-test', 1)).toBe(true)
    expect(await outlineExists('oe-test', 2)).toBe(false)
    expect(await outlineExists('oe-test', 3)).toBe(true)
  })

  it('missingOutlines returns empty when range fully covered', async () => {
    for (const n of [1, 2, 3, 4, 5]) await writeOutline('mo-1', makeOutline(n, 'p', ['e']))
    expect(await missingOutlines('mo-1', 1, 5)).toEqual([])
  })

  it('missingOutlines lists gaps', async () => {
    await writeOutline('mo-2', makeOutline(1, 'p', ['e']))
    await writeOutline('mo-2', makeOutline(3, 'p', ['e']))
    expect(await missingOutlines('mo-2', 1, 5)).toEqual([2, 4, 5])
  })
})
