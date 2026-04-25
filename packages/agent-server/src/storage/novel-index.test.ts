import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readNovelIndex,
  writeNovelIndex,
  listNovelIndices,
  type NovelIndex,
} from './novel-index.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nidx-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const sample: NovelIndex = {
  id: 'nv-1',
  title: '测试',
  status: 'uploaded',
  chapter_count: 100,
  analyzed_count: 0,
  analysis_from: 1,
  analysis_to: 100,
  analyzed_to: 0,
  error: null,
  created_at: 1000,
  updated_at: 1000,
}

describe('novel-index', () => {
  it('round-trips a novel index', async () => {
    await writeNovelIndex(sample)
    const got = await readNovelIndex('nv-1')
    expect(got).toEqual(sample)
  })

  it('readNovelIndex returns null for missing', async () => {
    expect(await readNovelIndex('missing')).toBeNull()
  })

  it('listNovelIndices returns all', async () => {
    await writeNovelIndex({ ...sample, id: 'nv-1' })
    await writeNovelIndex({ ...sample, id: 'nv-2', title: '二' })
    const list = await listNovelIndices()
    expect(list.map((n) => n.id).sort()).toEqual(['nv-1', 'nv-2'])
  })
})
