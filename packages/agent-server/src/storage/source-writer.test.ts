import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMd } from './markdown.js'
import { paths } from './paths.js'
import { readChapterInternal } from './chapter-internal-store.js'
import {
  writeSourceChapter,
  writeSourceCharacter,
  writeSourceSubplots,
  writeSourceHooks,
  writeSourceMeta,
} from './source-writer.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sw-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('source-writer', () => {
  it('writeSourceChapter writes function-only fm and routes desc/summary to sqlite', async () => {
    await writeSourceChapter('nv-1', {
      number: 5,
      title: '觉醒',
      characters_present: ['张三'],
      hooks_planted: ['hk-1'],
      hooks_paid: [],
      hooks_planted_candidates: [{ desc: 'foo', category: 'secret' }],
      summary: '张三激活异能。',
      key_events: [
        { desc: '张三激活异能', function: '主角优势暴露', can_replace: true, can_reorder: false, depends_on: [] },
        { desc: '李四逃走', function: '压迫源退场', can_replace: true, can_reorder: true, depends_on: [] },
      ],
      plot_functions: ['主角优势首秀'],
      originality_risks: [],
      writing_rhythm: null,
      dramatic_beat_blueprint: {
        beat_function: '第一次展示主角优势机制',
        state_before: '主角被轻视且缺少可信资源',
        state_after: '主角获得初步认可',
        pressure_pattern: '质疑出现 -> 压力加重 -> 判断兑现',
        conflict_engine: '身份与资源',
        reader_expectation: '读者期待主角证明自己',
        payoff_type: ['信息差兑现'],
        reversal_point: '外界误判被结果推翻',
        resource_or_status_change: '获得初步信用',
        information_gap: '主角知道关键判断依据，旁人不知道',
        emotional_curve: '压抑 -> 紧张 -> 爽感',
        hook_promise: '更大压力即将出现',
        intensity: 3,
      },
    })
    const md = await readMd(paths.sourceChapter('nv-1', 5))
    expect(md.frontMatter['number']).toBe(5)
    expect(md.frontMatter['_hooks_planted_candidates']).toEqual([{ desc: 'foo', category: 'secret' }])
    expect(md.frontMatter['plot_functions']).toEqual(['主角优势首秀'])
    expect(md.frontMatter['dramatic_beat_blueprint']).toMatchObject({
      beat_function: '第一次展示主角优势机制',
      state_before: '主角被轻视且缺少可信资源',
      payoff_type: ['信息差兑现'],
      intensity: 3,
    })
    const events = md.frontMatter['key_events'] as Record<string, unknown>[]
    expect(events[0]?.['function']).toBe('主角优势暴露')
    expect(events[0]?.['desc']).toBeUndefined()
    expect(md.body).not.toContain('## 摘要')
    expect(md.body).not.toContain('张三激活异能')

    const internal = readChapterInternal('nv-1', 5)
    expect(internal?.summary).toBe('张三激活异能。')
    expect(internal?.key_events_with_desc[0]?.desc).toBe('张三激活异能')
    expect(internal?.key_events_with_desc[1]?.desc).toBe('李四逃走')
  })

  it('writeSourceCharacter writes role + death_chapter to front matter', async () => {
    await writeSourceCharacter('nv-1', {
      canonical_name: '张三',
      aliases: ['老张'],
      role: 'protagonist',
      function_tags: ['茶馆老板'],
      story_function: null,
      replaceability: 'low',
      first_chapter: 1,
      last_chapter: 100,
      death_chapter: null,
      description: '主角。',
    })
    const md = await readMd(paths.sourceCharacter('nv-1', '张三'))
    expect(md.frontMatter['role']).toBe('protagonist')
    expect(md.frontMatter['replaceability']).toBe('low')
    expect(md.frontMatter['death_chapter']).toBeNull()
    expect(md.body).toContain('## 描述')
    expect(md.body).toContain('主角。')
  })

  it('writeSourceSubplots writes single file with array', async () => {
    await writeSourceSubplots('nv-1', [
      {
        id: 'sp-1',
        name: '茶馆扩张',
        function: 'establish-setting',
        delivers: '给主角带来第一份外部资源',
        depends_on: [],
        reorderable: true,
        chapters: [3, 5],
        description: '主角扩张茶馆。',
      },
    ])
    const md = await readMd(paths.sourceSubplots('nv-1'))
    const subs = md.frontMatter['subplots'] as { id: string; delivers: string }[] | undefined
    expect(subs?.[0]?.id).toBe('sp-1')
    expect(subs?.[0]?.delivers).toBe('给主角带来第一份外部资源')
  })

  it('writeSourceHooks writes long-only hooks (no type field)', async () => {
    await writeSourceHooks('nv-1', [
      { id: 'hk-1', description: '主角异能来源', category: 'secret', planted_chapter: 3, payoff_chapter: 487, evidence_chapters: [3, 27, 88], why: '多章暗示' },
    ])
    const md = await readMd(paths.sourceHooks('nv-1'))
    const hooks = md.frontMatter['hooks'] as Record<string, unknown>[] | undefined
    expect(hooks?.[0]?.['type']).toBeUndefined()
    expect(hooks?.[0]?.['category']).toBe('secret')
  })

  it('writeSourceMeta writes industry / world_rules / style_tags', async () => {
    await writeSourceMeta('nv-1', {
      title: '都市修仙',
      chapter_count: 1000,
      genre_tags: ['都市', '修仙'],
      industry: '茶艺馆经营',
      era: '现代',
      world_rules: ['灵气复苏'],
      key_terms: ['茶馆', '灵茶'],
      style_tags: ['快节奏'],
      style_samples: ['示例段落 1', '示例段落 2'],
      summary: '一个普通茶馆老板的修仙故事。',
    })
    const md = await readMd(paths.sourceMeta('nv-1'))
    expect(md.frontMatter['industry']).toBe('茶艺馆经营')
    expect(md.frontMatter['world_rules']).toEqual(['灵气复苏'])
    expect(md.body).toContain('## 概要')
    expect(md.body).toContain('## 风格样本')
    expect(md.body).toContain('### 样本 1')
    expect(md.body).toContain('示例段落 1')
  })
})
