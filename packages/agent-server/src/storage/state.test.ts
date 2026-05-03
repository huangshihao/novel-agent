import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeMaps, writeOutline, type OutlineRecord } from './target-writer.js'
import { writeSourceHooks, type SourceHookRecord } from './source-writer.js'
import {
  initStateIfMissing,
  applyChapterStateDiff,
  readState,
  writeState,
} from './state.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'state-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

function makeHook(id: string, description: string): SourceHookRecord {
  return {
    id,
    description,
    category: 'suspense',
    planted_chapter: 1,
    payoff_chapter: null,
    evidence_chapters: [],
  }
}

function makeOutline(overrides: Partial<OutlineRecord>): OutlineRecord {
  return {
    number: overrides.number ?? 1,
    source_chapter_ref: overrides.source_chapter_ref ?? 1,
    plot_functions: overrides.plot_functions ?? [],
    hooks_to_plant: overrides.hooks_to_plant ?? [],
    hooks_to_payoff: overrides.hooks_to_payoff ?? [],
    planned_state_changes: overrides.planned_state_changes ?? {
      character_deaths: [],
      new_settings: [],
    },
    plot: overrides.plot ?? '',
    key_events: overrides.key_events ?? [],
    referenced_characters: overrides.referenced_characters ?? [],
  }
}

describe('state', () => {
  it('initStateIfMissing seeds alive_status from character_map and hooks from source hooks', async () => {
    await writeMaps('nv-1', {
      character_map: [
        { source: '张三', target: '李一', source_meta: null, target_note: null },
        { source: '王五', target: '赵二', source_meta: null, target_note: '改性别' },
      ],
      setting_map: null,
    })
    await writeSourceHooks('nv-1', [
      makeHook('hk-001', '某反派的真实身份'),
      makeHook('hk-002', '某遗物的下落'),
    ])

    const state = await initStateIfMissing('nv-1')
    expect(state.alive_status).toEqual({
      李一: { alive: true, last_seen_chapter: 0 },
      赵二: { alive: true, last_seen_chapter: 0 },
    })
    expect(state.hooks).toEqual({
      'hk-001': { status: 'open' },
      'hk-002': { status: 'open' },
    })
    expect(state.new_hooks).toEqual([])

    const persisted = await readState('nv-1')
    expect(persisted).toEqual(state)
  })

  it('initStateIfMissing returns existing state unchanged', async () => {
    await writeMaps('nv-1', {
      character_map: [{ source: 'A', target: 'B', source_meta: null, target_note: null }],
      setting_map: null,
    })
    await writeSourceHooks('nv-1', [makeHook('hk-001', 'x')])

    const seeded = {
      alive_status: { 张三: { alive: false, last_seen_chapter: 5, death_chapter: 5 } },
      hooks: { 'hk-existing': { status: 'paid_off' as const, paid_chapter: 3 } },
      new_hooks: [
        {
          id: 'nh-1',
          description: 'foo',
          planted_chapter: 2,
          expected_payoff_chapter: null,
          status: 'open' as const,
        },
      ],
    }
    await writeState('nv-1', seeded)

    const got = await initStateIfMissing('nv-1')
    expect(got).toEqual(seeded)
    expect(got.alive_status['张三']).toBeDefined()
    expect(got.alive_status['B']).toBeUndefined()
  })

  it('applyChapterStateDiff records character deaths from planned_state_changes', async () => {
    await writeMaps('nv-1', {
      character_map: [
        { source: '原A', target: '甲', source_meta: null, target_note: null },
        { source: '原B', target: '乙', source_meta: null, target_note: null },
      ],
      setting_map: null,
    })
    await writeSourceHooks('nv-1', [])
    await initStateIfMissing('nv-1')

    const outline = makeOutline({
      number: 7,
      planned_state_changes: { character_deaths: ['乙'], new_settings: [] },
    })
    await writeOutline('nv-1', outline)

    await applyChapterStateDiff('nv-1', 7, outline, ['甲', '乙'])

    const after = await readState('nv-1')
    expect(after).not.toBeNull()
    expect(after!.alive_status['甲']).toEqual({
      alive: true,
      last_seen_chapter: 7,
    })
    expect(after!.alive_status['乙']).toEqual({
      alive: false,
      last_seen_chapter: 7,
      death_chapter: 7,
    })
  })

  it('applyChapterStateDiff pays off a source hook', async () => {
    await writeMaps('nv-1', {
      character_map: [{ source: 'A', target: 'B', source_meta: null, target_note: null }],
      setting_map: null,
    })
    await writeSourceHooks('nv-1', [
      makeHook('hk-001', '伏笔1'),
      makeHook('hk-002', '伏笔2'),
    ])
    await initStateIfMissing('nv-1')

    const outline = makeOutline({
      number: 4,
      hooks_to_payoff: ['hk-002'],
    })

    await applyChapterStateDiff('nv-1', 4, outline, ['B'])

    const after = await readState('nv-1')
    expect(after!.hooks['hk-001']).toEqual({ status: 'open' })
    expect(after!.hooks['hk-002']).toEqual({ status: 'paid_off', paid_chapter: 4 })
  })

  it('applyChapterStateDiff pays off a new hook entry', async () => {
    await writeMaps('nv-1', {
      character_map: [{ source: 'A', target: 'B', source_meta: null, target_note: null }],
      setting_map: null,
    })
    await writeSourceHooks('nv-1', [])
    await initStateIfMissing('nv-1')

    const plantOutline = makeOutline({
      number: 2,
      hooks_to_plant: ['nh-x'],
    })
    await applyChapterStateDiff('nv-1', 2, plantOutline, ['B'])

    const planted = await readState('nv-1')
    expect(planted!.new_hooks).toHaveLength(1)
    expect(planted!.new_hooks[0]!).toMatchObject({
      id: 'nh-x',
      planted_chapter: 2,
      status: 'open',
    })

    const payoffOutline = makeOutline({
      number: 9,
      hooks_to_payoff: ['nh-x'],
    })
    await applyChapterStateDiff('nv-1', 9, payoffOutline, ['B'])

    const after = await readState('nv-1')
    expect(after!.new_hooks).toHaveLength(1)
    expect(after!.new_hooks[0]!.status).toBe('paid_off')
    expect(after!.new_hooks[0]!.paid_chapter).toBe(9)
  })

  it('applyChapterStateDiff plants a never-seen hook id into new_hooks as open', async () => {
    await writeMaps('nv-1', {
      character_map: [{ source: 'A', target: 'B', source_meta: null, target_note: null }],
      setting_map: null,
    })
    await writeSourceHooks('nv-1', [makeHook('hk-001', 'src')])
    await initStateIfMissing('nv-1')

    const outline = makeOutline({
      number: 5,
      hooks_to_plant: ['nh-fresh'],
    })
    await applyChapterStateDiff('nv-1', 5, outline, ['B'])

    const after = await readState('nv-1')
    expect(after!.new_hooks).toHaveLength(1)
    expect(after!.new_hooks[0]).toEqual({
      id: 'nh-fresh',
      description: '',
      planted_chapter: 5,
      expected_payoff_chapter: null,
      status: 'open',
    })
    expect(after!.hooks['nh-fresh']).toBeUndefined()
  })
})
