import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMaps } from '../../storage/target-writer.js'
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

function baseOutline(number: number, refs: string[]) {
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
})
