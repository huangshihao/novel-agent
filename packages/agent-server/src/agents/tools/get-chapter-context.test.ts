import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSourceChapter, writeSourceHooks, writeSourceMeta } from '../../storage/source-writer.js'
import { writeMaps, writeOutline } from '../../storage/target-writer.js'
import { writeState } from '../../storage/state.js'
import { buildGetChapterContextTool } from './get-chapter-context.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'gcc-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const novelId = 'nv-1'

async function exec(number: number) {
  const tool = buildGetChapterContextTool(novelId)
  return await (tool.execute as unknown as (
    id: string,
    p: { number: number },
  ) => Promise<{ details: Record<string, unknown> }>)('call-1', { number })
}

describe('buildGetChapterContextTool', () => {
  it('does not expose raw style samples or source character descriptions', async () => {
    await writeSourceChapter(novelId, {
      number: 1,
      title: '第一章',
      characters_present: [],
      hooks_planted: [],
      hooks_paid: [],
      hooks_planted_candidates: [],
      summary: '原书剧情简介',
      key_events: [
        {
          desc: '原书具体事件',
          function: '建立压力',
          can_replace: true,
          can_reorder: false,
          depends_on: [],
        },
      ],
      plot_functions: ['建立压力'],
      originality_risks: ['原书标志桥段'],
      writing_rhythm: null,
    })
    await writeSourceMeta(novelId, {
      title: '原书',
      chapter_count: 1,
      genre_tags: [],
      industry: '行业',
      era: '年代',
      world_rules: [],
      key_terms: [],
      style_tags: ['短句'],
      style_samples: ['这是一段原文风格样本'],
      summary: '全书总览',
    })
    await writeSourceHooks(novelId, [])
    await writeMaps(novelId, {
      character_map: [
        {
          source: '张三',
          target: '林青',
          source_meta: {
            role: 'protagonist',
            story_function: 'pressure-source',
            replaceability: 'medium',
            first_chapter: 1,
            last_chapter: 10,
            description: '原书角色具体经历',
          },
          target_note: null,
        },
      ],
      setting_map: null,
    })
    await writeState(novelId, { alive_status: {}, hooks: {}, new_hooks: [] })
    await writeOutline(novelId, {
      number: 1,
      source_chapter_ref: 1,
      plot_functions: ['建立压力'],
      hooks_to_plant: [],
      hooks_to_payoff: [],
      planned_state_changes: { character_deaths: [], new_settings: [] },
      plot: '新书剧情',
      key_events: [{ function: '建立压力', new_carrier: '新载体' }],
      referenced_characters: [],
      retention_plan: null,
      golden_three_plan: null,
      hook_plans: [],
    })

    const r = await exec(1)
    const json = JSON.stringify(r.details)

    expect(json).not.toContain('这是一段原文风格样本')
    expect(json).not.toContain('原书角色具体经历')
    expect(r.details.style_tags).toEqual(['短句'])
  })
})
