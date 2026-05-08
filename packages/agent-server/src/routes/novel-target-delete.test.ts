import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { novelRoutes } from './novel.js'
import { paths } from '../storage/paths.js'
import { writeSourceHooks } from '../storage/source-writer.js'
import { writeChapterDraft, writeMaps, writeOutline } from '../storage/target-writer.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'route-target-delete-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

async function seedTargetFiles() {
  await writeMaps('nv-1', {
    character_map: [{ source: '原A', target: '甲', source_meta: null, target_note: null }],
    setting_map: null,
  })
  await writeSourceHooks('nv-1', [])
  for (const n of [1, 2, 3]) {
    await writeOutline('nv-1', {
      number: n,
      source_chapter_ref: n,
      plot_functions: [],
      hooks_to_plant: [],
      hooks_to_payoff: [],
      planned_state_changes: { character_deaths: [], new_settings: [] },
      plot: `第 ${n} 章大纲`,
      key_events: [],
      referenced_characters: [],
    })
    await writeChapterDraft('nv-1', {
      number: n,
      title: `第 ${n} 章`,
      word_count: 10,
      written_at: '2026-05-04T00:00:00.000Z',
      content: '甲出场。',
    })
  }
}

describe('novel target delete routes', () => {
  it('DELETE /:id/outlines/:n truncates outlines and drafts from n', async () => {
    await seedTargetFiles()

    const res = await novelRoutes.request('/nv-1/outlines/2', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deletedOutlines: [2, 3], deletedDrafts: [2, 3] })
    expect(existsSync(paths.targetOutline('nv-1', 1))).toBe(true)
    expect(existsSync(paths.targetOutline('nv-1', 2))).toBe(false)
    expect(existsSync(paths.targetChapter('nv-1', 2))).toBe(false)
  })

  it('DELETE /:id/drafts/:n truncates drafts from n but keeps outlines', async () => {
    await seedTargetFiles()

    const res = await novelRoutes.request('/nv-1/drafts/2', { method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deletedDrafts: [2, 3] })
    expect(existsSync(paths.targetOutline('nv-1', 2))).toBe(true)
    expect(existsSync(paths.targetChapter('nv-1', 2))).toBe(false)
  })
})
