import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { paths } from '../../storage/paths.js'
import {
  writeMaps,
  writeOutline,
  type OutlineRecord,
} from '../../storage/target-writer.js'
import {
  writeState,
  readState,
  type StateRecord,
} from '../../storage/state.js'
import { buildWriteChapterTool } from './write-chapter.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wc-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const novelId = 'nv-1'

function makeOutline(overrides: Partial<OutlineRecord> = {}): OutlineRecord {
  return {
    number: overrides.number ?? 1,
    source_chapter_ref: overrides.source_chapter_ref ?? 1,
    hooks_to_plant: overrides.hooks_to_plant ?? [],
    hooks_to_payoff: overrides.hooks_to_payoff ?? [],
    planned_state_changes: overrides.planned_state_changes ?? {
      character_deaths: [],
      new_settings: [],
    },
    plot: overrides.plot ?? '剧情简述',
    key_events: overrides.key_events ?? [],
  }
}

async function execTool(
  novel: string,
  batch: { from: number; to: number },
  params: { number: number; title: string; content: string },
) {
  const tool = buildWriteChapterTool(novel, batch)
  return await (tool.execute as unknown as (
    id: string,
    p: typeof params,
  ) => Promise<{ details: unknown }>)('call-1', params)
}

describe('buildWriteChapterTool', () => {
  it('hard-rejects when content mentions a dead character; file is NOT written', async () => {
    await writeMaps(novelId, {
      character_map: [{ source: '原主角', target: '林清月' }],
      setting_map: null,
    })
    const seeded: StateRecord = {
      alive_status: {
        林清月: { alive: true, last_seen_chapter: 0 },
        王浩: { alive: false, last_seen_chapter: 2, death_chapter: 2 },
      },
      hooks: {},
      new_hooks: [],
    }
    await writeState(novelId, seeded)
    await writeOutline(novelId, makeOutline({ number: 3 }))

    const longContent = `王浩说：“我又回来了。”${'风掠过山岗。'.repeat(200)}`
    const result = await execTool(
      novelId,
      { from: 1, to: 10 },
      { number: 3, title: '诡异重逢', content: longContent },
    )

    const details = result.details as {
      ok: boolean
      issues: { level: string; message: string; hits?: string[] }[]
    }
    expect(details.ok).toBe(false)
    const aliveIssue = details.issues.find((i) => i.hits?.includes('王浩'))
    expect(aliveIssue).toBeDefined()
    expect(aliveIssue!.level).toBe('error')

    expect(existsSync(paths.targetChapter(novelId, 3))).toBe(false)
  })

  it('soft-warns on short content but still writes the chapter', async () => {
    await writeMaps(novelId, {
      character_map: [{ source: '原主角', target: '林清月' }],
      setting_map: null,
    })
    await writeState(novelId, {
      alive_status: { 林清月: { alive: true, last_seen_chapter: 0 } },
      hooks: {},
      new_hooks: [],
    })
    await writeOutline(novelId, makeOutline({ number: 1 }))

    const shortContent = '林清月推开门，' + '风轻轻地吹过。'.repeat(40)
    expect(shortContent.length).toBeLessThan(1000)

    const result = await execTool(
      novelId,
      { from: 1, to: 5 },
      { number: 1, title: '开篇', content: shortContent },
    )

    const details = result.details as {
      ok: boolean
      saved_path: string
      warnings: { level: string; message: string }[]
    }
    expect(details.ok).toBe(true)
    expect(details.warnings.length).toBeGreaterThan(0)
    expect(details.warnings.some((w) => w.message.includes('字数偏离合理范围'))).toBe(true)

    expect(existsSync(paths.targetChapter(novelId, 1))).toBe(true)
  })

  it('happy path: writes the chapter and mutates state (last_seen_chapter advanced)', async () => {
    await writeMaps(novelId, {
      character_map: [
        { source: '原主角', target: '林清月' },
        { source: '原配角', target: '苏景行' },
      ],
      setting_map: null,
    })
    await writeState(novelId, {
      alive_status: {
        林清月: { alive: true, last_seen_chapter: 0 },
        苏景行: { alive: true, last_seen_chapter: 0 },
      },
      hooks: {},
      new_hooks: [],
    })
    await writeOutline(novelId, makeOutline({ number: 2 }))

    const goodContent =
      '林清月推开窗，望向远山。苏景行站在她身后。' +
      '夜风掠过竹林，远处传来悠长的钟声。'.repeat(220)
    expect(goodContent.length).toBeGreaterThanOrEqual(3000)
    expect(goodContent.length).toBeLessThanOrEqual(5000)

    const result = await execTool(
      novelId,
      { from: 1, to: 10 },
      { number: 2, title: '夜望', content: goodContent },
    )

    const details = result.details as {
      ok: boolean
      saved_path: string
      warnings: unknown[]
    }
    expect(details.ok).toBe(true)
    expect(details.warnings).toEqual([])

    expect(existsSync(paths.targetChapter(novelId, 2))).toBe(true)

    const after = await readState(novelId)
    expect(after).not.toBeNull()
    expect(after!.alive_status['林清月']!.last_seen_chapter).toBe(2)
    expect(after!.alive_status['苏景行']!.last_seen_chapter).toBe(2)
  })
})
