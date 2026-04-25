import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSourceChapter, writeSourceCharacter, writeSourceHooks, writeSourceSubplots, writeSourceMeta } from './source-writer.js'
import {
  listSourceChapters,
  readSourceChapter,
  listSourceCharacters,
  readSourceSubplots,
  readSourceHooks,
  readSourceMeta,
  wipeSourceAggregates,
} from './source-reader.js'
import { paths } from './paths.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sr-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('source-reader', () => {
  it('lists chapters by number ascending', async () => {
    await writeSourceChapter('nv-1', { number: 2, title: 'B', characters_present: [], hooks_planted: [], hooks_paid: [], hooks_planted_candidates: [], summary: 's2', key_events: [] })
    await writeSourceChapter('nv-1', { number: 1, title: 'A', characters_present: [], hooks_planted: [], hooks_paid: [], hooks_planted_candidates: [], summary: 's1', key_events: [] })
    const list = await listSourceChapters('nv-1')
    expect(list.map((c) => c.number)).toEqual([1, 2])
  })

  it('readSourceChapter returns body sections parsed', async () => {
    await writeSourceChapter('nv-1', { number: 3, title: 'X', characters_present: ['张三'], hooks_planted: [], hooks_paid: [], hooks_planted_candidates: [{ desc: 'cand', category: 'secret' }], summary: '摘要内容', key_events: ['e1', 'e2'] })
    const ch = await readSourceChapter('nv-1', 3)
    expect(ch?.summary).toBe('摘要内容')
    expect(ch?.key_events).toEqual(['e1', 'e2'])
    expect(ch?.characters_present).toEqual(['张三'])
    expect(ch?.hooks_planted_candidates).toEqual([{ desc: 'cand', category: 'secret' }])
  })

  it('readSourceChapter returns null when missing', async () => {
    expect(await readSourceChapter('nv-1', 999)).toBeNull()
  })

  it('listSourceCharacters parses description from body', async () => {
    await writeSourceCharacter('nv-1', { canonical_name: '张三', aliases: [], role: 'protagonist', function_tags: [], first_chapter: 1, last_chapter: 1, death_chapter: null, description: '一个主角' })
    const chars = await listSourceCharacters('nv-1')
    expect(chars).toHaveLength(1)
    expect(chars[0]!.role).toBe('protagonist')
    expect(chars[0]!.description).toBe('一个主角')
  })

  it('readSourceSubplots / readSourceHooks return empty arrays when missing', async () => {
    expect(await readSourceSubplots('nv-x')).toEqual([])
    expect(await readSourceHooks('nv-x')).toEqual([])
  })

  it('readSourceMeta returns null when missing', async () => {
    expect(await readSourceMeta('nv-x')).toBeNull()
  })

  it('readSourceMeta parses summary + style_samples from body', async () => {
    await writeSourceMeta('nv-1', {
      title: 't',
      chapter_count: 100,
      genre_tags: ['x'],
      industry: 'i',
      era: 'e',
      world_rules: ['r'],
      key_terms: ['k'],
      style_tags: ['s'],
      style_samples: ['段落 A', '段落 B'],
      summary: '总览',
    })
    const meta = await readSourceMeta('nv-1')
    expect(meta?.summary).toBe('总览')
    expect(meta?.style_samples).toEqual(['段落 A', '段落 B'])
    expect(meta?.industry).toBe('i')
  })

  it('wipeSourceAggregates removes characters/subplots/hooks/meta but keeps chapters', async () => {
    await writeSourceChapter('nv-1', { number: 1, title: 'A', characters_present: [], hooks_planted: [], hooks_paid: [], hooks_planted_candidates: [], summary: 's', key_events: [] })
    await writeSourceCharacter('nv-1', { canonical_name: 'X', aliases: [], role: null, function_tags: [], first_chapter: 1, last_chapter: 1, death_chapter: null, description: '' })
    await writeSourceSubplots('nv-1', [])
    await writeSourceHooks('nv-1', [])
    await writeSourceMeta('nv-1', { title: 't', chapter_count: 1, genre_tags: [], industry: '', era: '', world_rules: [], key_terms: [], style_tags: [], style_samples: [], summary: '' })
    await wipeSourceAggregates('nv-1')
    expect(existsSync(paths.sourceCharactersDir('nv-1'))).toBe(false)
    expect(existsSync(paths.sourceSubplots('nv-1'))).toBe(false)
    expect(existsSync(paths.sourceHooks('nv-1'))).toBe(false)
    expect(existsSync(paths.sourceMeta('nv-1'))).toBe(false)
    expect(existsSync(paths.sourceChapter('nv-1', 1))).toBe(true)
  })
})
