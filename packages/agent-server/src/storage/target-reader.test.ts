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
    hooks_to_plant: [`plant-${n}`],
    hooks_to_payoff: [],
    planned_state_changes: { character_deaths: [], new_settings: [] },
    plot,
    key_events: events,
  }
}

describe('target-reader', () => {
  it('readMaps round-trips with setting_map: null', async () => {
    await writeMaps('nv-1', {
      character_map: [
        { source: '张三', target: '李四' },
        { source: '王五', target: '赵六', note: '改为女性' },
      ],
      setting_map: null,
    })
    const maps = await readMaps('nv-1')
    expect(maps).not.toBeNull()
    expect(maps!.character_map).toHaveLength(2)
    expect(maps!.character_map[0]).toEqual({ source: '张三', target: '李四' })
    expect(maps!.character_map[1]).toEqual({ source: '王五', target: '赵六', note: '改为女性' })
    expect(maps!.setting_map).toBeNull()
  })

  it('readOutline parses plot and key_events from body', async () => {
    await writeOutline('nv-1', {
      number: 3,
      source_chapter_ref: 5,
      hooks_to_plant: ['hk-1'],
      hooks_to_payoff: ['hk-2'],
      planned_state_changes: {
        character_deaths: ['某反派'],
        new_settings: ['公司总部'],
      },
      plot: '主角进入公司，遭遇神秘事件。',
      key_events: ['主角入职', '发现密室', '撞见上司'],
    })
    const o = await readOutline('nv-1', 3)
    expect(o).not.toBeNull()
    expect(o!.number).toBe(3)
    expect(o!.source_chapter_ref).toBe(5)
    expect(o!.hooks_to_plant).toEqual(['hk-1'])
    expect(o!.hooks_to_payoff).toEqual(['hk-2'])
    expect(o!.planned_state_changes).toEqual({
      character_deaths: ['某反派'],
      new_settings: ['公司总部'],
    })
    expect(o!.plot).toBe('主角进入公司，遭遇神秘事件。')
    expect(o!.key_events).toEqual(['主角入职', '发现密室', '撞见上司'])
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
    expect(list[0]!.key_events).toEqual(['e2'])
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
