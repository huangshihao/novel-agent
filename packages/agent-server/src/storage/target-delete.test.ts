import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paths } from './paths.js'
import { readState } from './state.js'
import { deleteDraftsFrom, deleteOutlinesFrom } from './target-delete.js'
import {
  writeChapterDraft,
  writeMaps,
  writeOutline,
  type OutlineRecord,
} from './target-writer.js'
import { writeSourceHooks, type SourceHookRecord } from './source-writer.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'td-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

function makeHook(id: string): SourceHookRecord {
  return {
    id,
    description: '原书伏笔',
    category: 'suspense',
    planted_chapter: 1,
    payoff_chapter: null,
    evidence_chapters: [],
  }
}

function makeOutline(overrides: Partial<OutlineRecord>): OutlineRecord {
  return {
    number: overrides.number ?? 1,
    source_chapter_ref: overrides.source_chapter_ref ?? overrides.number ?? 1,
    plot_functions: [],
    hooks_to_plant: overrides.hooks_to_plant ?? [],
    hooks_to_payoff: overrides.hooks_to_payoff ?? [],
    planned_state_changes: overrides.planned_state_changes ?? {
      character_deaths: [],
      new_settings: [],
    },
    plot: overrides.plot ?? '剧情',
    key_events: [],
    referenced_characters: [],
    hook_plans: overrides.hook_plans ?? [],
  }
}

async function seedThreeChapters() {
  await writeMaps('nv-1', {
    character_map: [
      { source: '原A', target: '甲', source_meta: null, target_note: null },
      { source: '原B', target: '乙', source_meta: null, target_note: null },
    ],
    setting_map: null,
  })
  await writeSourceHooks('nv-1', [makeHook('hk-src')])
  await writeOutline(
    'nv-1',
    makeOutline({
      number: 1,
      hooks_to_plant: ['nh-1'],
      hook_plans: [
        {
          id: 'nh-1',
          type: 'secret',
          description: '第一章新伏笔',
          expected_payoff_chapter: 3,
          payoff_plan: '第三章兑现',
        },
      ],
    }),
  )
  await writeOutline(
    'nv-1',
    makeOutline({
      number: 2,
      hooks_to_payoff: ['hk-src'],
      planned_state_changes: { character_deaths: ['乙'], new_settings: [] },
    }),
  )
  await writeOutline(
    'nv-1',
    makeOutline({
      number: 3,
      hooks_to_plant: ['nh-3'],
    }),
  )
  for (const n of [1, 2, 3]) {
    await writeChapterDraft('nv-1', {
      number: n,
      title: `第 ${n} 章`,
      word_count: 10,
      written_at: '2026-05-04T00:00:00.000Z',
      content: n === 2 ? '乙出场。' : '甲出场。',
    })
  }
}

describe('target-delete', () => {
  it('deleteOutlinesFrom removes outlines and drafts from the chapter, then rebuilds state', async () => {
    await seedThreeChapters()

    const result = await deleteOutlinesFrom('nv-1', 2)

    expect(result).toEqual({ deletedOutlines: [2, 3], deletedDrafts: [2, 3] })
    expect(existsSync(paths.targetOutline('nv-1', 1))).toBe(true)
    expect(existsSync(paths.targetOutline('nv-1', 2))).toBe(false)
    expect(existsSync(paths.targetOutline('nv-1', 3))).toBe(false)
    expect(existsSync(paths.targetChapter('nv-1', 1))).toBe(true)
    expect(existsSync(paths.targetChapter('nv-1', 2))).toBe(false)
    expect(existsSync(paths.targetChapter('nv-1', 3))).toBe(false)

    const state = await readState('nv-1')
    expect(state).toEqual({
      alive_status: {
        甲: { alive: true, last_seen_chapter: 1 },
        乙: { alive: true, last_seen_chapter: 0 },
      },
      hooks: { 'hk-src': { status: 'open' } },
      new_hooks: [
        {
          id: 'nh-1',
          type: 'secret',
          description: '第一章新伏笔',
          planted_chapter: 1,
          expected_payoff_chapter: 3,
          payoff_plan: '第三章兑现',
          status: 'open',
        },
      ],
    })
  })

  it('deleteDraftsFrom removes drafts from the chapter, keeps outlines, then rebuilds state', async () => {
    await seedThreeChapters()

    const result = await deleteDraftsFrom('nv-1', 2)

    expect(result).toEqual({ deletedDrafts: [2, 3] })
    expect(existsSync(paths.targetOutline('nv-1', 1))).toBe(true)
    expect(existsSync(paths.targetOutline('nv-1', 2))).toBe(true)
    expect(existsSync(paths.targetOutline('nv-1', 3))).toBe(true)
    expect(existsSync(paths.targetChapter('nv-1', 1))).toBe(true)
    expect(existsSync(paths.targetChapter('nv-1', 2))).toBe(false)
    expect(existsSync(paths.targetChapter('nv-1', 3))).toBe(false)

    const state = await readState('nv-1')
    expect(state!.alive_status['甲']).toEqual({ alive: true, last_seen_chapter: 1 })
    expect(state!.alive_status['乙']).toEqual({ alive: true, last_seen_chapter: 0 })
    expect(state!.hooks['hk-src']).toEqual({ status: 'open' })
    expect(state!.new_hooks.map((h) => h.id)).toEqual(['nh-1'])
  })
})
