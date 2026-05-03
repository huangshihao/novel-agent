import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSourceCharacter } from '../../storage/source-writer.js'
import { readMaps } from '../../storage/target-reader.js'
import { buildUpdateMapsTool } from './update-maps.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'um-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const novelId = 'nv-1'

async function exec(params: unknown) {
  const tool = buildUpdateMapsTool(novelId)
  return await (tool.execute as unknown as (
    id: string,
    p: unknown,
  ) => Promise<{ details: { ok: boolean; issues?: { hits?: string[]; message: string }[] } }>)(
    'call-1',
    params,
  )
}

describe('buildUpdateMapsTool', () => {
  beforeEach(async () => {
    await writeSourceCharacter(novelId, {
      canonical_name: '林红霞',
      aliases: [],
      role: 'side',
      function_tags: ['女警'],
      story_function: 'benefactor',
      replaceability: 'medium',
      first_chapter: 87,
      last_chapter: 100,
      death_chapter: null,
      description: '女警，与主角合作审讯劫匪。',
    })
  })

  it('rejects phantom source name (not in source/characters)', async () => {
    const result = await exec({
      character_entries: [{ source: '李二牛', target: '张大胆' }],
    })
    expect(result.details.ok).toBe(false)
    const issue = result.details.issues?.find((i) => i.message.includes('phantom'))
    expect(issue).toBeDefined()
    expect(issue!.hits).toContain('李二牛')
  })

  it('auto-derives source_meta from source character file', async () => {
    const result = await exec({
      character_entries: [{ source: '林红霞', target: '杨柳' }],
    })
    expect(result.details.ok).toBe(true)
    const maps = await readMaps(novelId)
    expect(maps).not.toBeNull()
    const entry = maps!.character_map.find((e) => e.target === '杨柳')!
    expect(entry.source).toBe('林红霞')
    expect(entry.source_meta).not.toBeNull()
    expect(entry.source_meta!.first_chapter).toBe(87)
    expect(entry.source_meta!.last_chapter).toBe(100)
    expect(entry.source_meta!.role).toBe('side')
    expect(entry.source_meta!.story_function).toBe('benefactor')
    expect(entry.source_meta!.description).toContain('女警')
  })

  it('rejects target-only entry without target_note', async () => {
    const result = await exec({
      character_entries: [{ source: null, target: '杨建国' }],
    })
    expect(result.details.ok).toBe(false)
    const issue = result.details.issues?.find((i) => i.message.includes('target_note'))
    expect(issue).toBeDefined()
    expect(issue!.hits).toContain('杨建国')
  })

  it('upsert by source key: re-mapping same source replaces target (no duplicates)', async () => {
    await exec({
      character_entries: [{ source: '林红霞', target: '杨柳' }],
    })
    let maps = await readMaps(novelId)
    expect(maps!.character_map.filter((e) => e.source === '林红霞')).toHaveLength(1)
    expect(maps!.character_map[0]!.target).toBe('杨柳')

    // 同一 source 改成不同 target —— 应该替换不是新增
    await exec({
      character_entries: [{ source: '林红霞', target: '柳红梅' }],
    })
    maps = await readMaps(novelId)
    const linEntries = maps!.character_map.filter((e) => e.source === '林红霞')
    expect(linEntries).toHaveLength(1)
    expect(linEntries[0]!.target).toBe('柳红梅')
  })

  it('upsert by target key for source=null entries', async () => {
    await exec({
      character_entries: [{ source: null, target: '杨建国', target_note: 'v1' }],
    })
    await exec({
      character_entries: [{ source: null, target: '杨建国', target_note: 'v2' }],
    })
    const maps = await readMaps(novelId)
    expect(maps!.character_map.filter((e) => e.target === '杨建国')).toHaveLength(1)
    expect(maps!.character_map[0]!.target_note).toBe('v2')
  })

  it('accepts target-only entry with target_note', async () => {
    const result = await exec({
      character_entries: [
        { source: null, target: '杨建国', target_note: '生产队队长，杨柳之父' },
      ],
    })
    expect(result.details.ok).toBe(true)
    const maps = await readMaps(novelId)
    const entry = maps!.character_map.find((e) => e.target === '杨建国')!
    expect(entry.source).toBeNull()
    expect(entry.source_meta).toBeNull()
    expect(entry.target_note).toBe('生产队队长，杨柳之父')
  })
})
