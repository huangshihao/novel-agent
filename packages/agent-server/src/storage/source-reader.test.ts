import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSourceChapter, writeSourceCharacter, writeSourceHooks, writeSourceSubplots, writeSourceMeta } from './source-writer.js'
import {
  listSourceChapters,
  listSourceChaptersFull,
  readSourceChapter,
  readSourceChapterFull,
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

const blankChapter = {
  characters_present: [] as string[],
  hooks_planted: [] as string[],
  hooks_paid: [] as string[],
  hooks_planted_candidates: [] as { desc: string; category: string | null }[],
  summary: '',
  key_events: [] as never[],
  plot_functions: [] as string[],
  originality_risks: [] as string[],
  writing_rhythm: null,
  dramatic_beat_blueprint: null,
}

const blankCharacter = {
  aliases: [] as string[],
  function_tags: [] as string[],
  story_function: null,
  replaceability: null,
  first_chapter: 1,
  last_chapter: 1,
  death_chapter: null,
  description: '',
}

describe('source-reader', () => {
  it('lists chapters by number ascending', async () => {
    await writeSourceChapter('nv-1', { ...blankChapter, number: 2, title: 'B', summary: 's2' })
    await writeSourceChapter('nv-1', { ...blankChapter, number: 1, title: 'A', summary: 's1' })
    const list = await listSourceChapters('nv-1')
    expect(list.map((c) => c.number)).toEqual([1, 2])
  })

  it('readSourceChapter returns md-only fields with blank summary/desc', async () => {
    await writeSourceChapter('nv-1', {
      ...blankChapter,
      number: 3,
      title: 'X',
      characters_present: ['张三'],
      hooks_planted_candidates: [{ desc: 'cand', category: 'secret' }],
      summary: '摘要内容',
      key_events: [
        { desc: 'e1', function: 'f1', can_replace: true, can_reorder: false, depends_on: [] },
        { desc: 'e2', function: 'f2', can_replace: true, can_reorder: false, depends_on: [] },
      ],
      dramatic_beat_blueprint: {
        beat_function: '推动主角第一次获得外部机会',
        state_before: '主角缺少资源',
        state_after: '主角拿到机会',
        pressure_pattern: '缺资源 -> 被阻拦 -> 找到突破口',
        conflict_engine: '资源',
        reader_expectation: '期待主角拿到机会',
        payoff_type: ['获得信任'],
        reversal_point: '阻拦者误判主角能力',
        resource_or_status_change: '机会增加',
        information_gap: '主角理解机会价值，旁人误判',
        emotional_curve: '焦灼 -> 松动',
        hook_promise: '机会背后还有新风险',
        intensity: 2,
      },
    })
    const ch = await readSourceChapter('nv-1', 3)
    expect(ch?.summary).toBe('')
    expect(ch?.key_events.map((e) => e.desc)).toEqual(['', ''])
    expect(ch?.key_events.map((e) => e.function)).toEqual(['f1', 'f2'])
    expect(ch?.dramatic_beat_blueprint?.beat_function).toBe('推动主角第一次获得外部机会')
    expect(ch?.dramatic_beat_blueprint?.payoff_type).toEqual(['获得信任'])
    expect(ch?.characters_present).toEqual(['张三'])
    expect(ch?.hooks_planted_candidates).toEqual([{ desc: 'cand', category: 'secret' }])
  })

  it('readSourceChapterFull merges md + sqlite summary/desc', async () => {
    await writeSourceChapter('nv-1', {
      ...blankChapter,
      number: 4,
      title: 'Y',
      summary: '完整摘要',
      key_events: [
        { desc: 'e1', function: 'f1', can_replace: true, can_reorder: false, depends_on: [] },
        { desc: 'e2', function: 'f2', can_replace: true, can_reorder: false, depends_on: [] },
      ],
    })
    const ch = await readSourceChapterFull('nv-1', 4)
    expect(ch?.summary).toBe('完整摘要')
    expect(ch?.key_events.map((e) => e.desc)).toEqual(['e1', 'e2'])
    expect(ch?.key_events.map((e) => e.function)).toEqual(['f1', 'f2'])
  })

  it('listSourceChaptersFull returns merged data sorted', async () => {
    await writeSourceChapter('nv-1', { ...blankChapter, number: 2, title: 'B', summary: 's2' })
    await writeSourceChapter('nv-1', { ...blankChapter, number: 1, title: 'A', summary: 's1' })
    const list = await listSourceChaptersFull('nv-1')
    expect(list.map((c) => c.number)).toEqual([1, 2])
    expect(list.map((c) => c.summary)).toEqual(['s1', 's2'])
  })

  it('readSourceChapter returns null when missing', async () => {
    expect(await readSourceChapter('nv-1', 999)).toBeNull()
  })

  it('listSourceCharacters parses description from body', async () => {
    await writeSourceCharacter('nv-1', {
      ...blankCharacter,
      canonical_name: '张三',
      role: 'protagonist',
      description: '一个主角',
    })
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
    await writeSourceChapter('nv-1', { ...blankChapter, number: 1, title: 'A', summary: 's' })
    await writeSourceCharacter('nv-1', { ...blankCharacter, canonical_name: 'X', role: null })
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
