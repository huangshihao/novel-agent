import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import matter from 'gray-matter'
import { readMd } from './markdown.js'
import { paths } from './paths.js'
import {
  writeMaps,
  writeOutline,
  writeChapterDraft,
} from './target-writer.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'tw-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('target-writer', () => {
  it('writeMaps round-trips character_map array and setting_map: null', async () => {
    await writeMaps('nv-1', {
      character_map: [
        { source: '张三', target: '李四' },
        { source: '王五', target: '赵六', note: '改为女性' },
      ],
      setting_map: null,
    })
    const raw = await readFile(paths.targetMaps('nv-1'), 'utf8')
    const parsed = matter(raw)
    const cm = parsed.data['character_map'] as { source: string; target: string; note?: string }[]
    expect(cm).toHaveLength(2)
    expect(cm[0]).toEqual({ source: '张三', target: '李四' })
    expect(cm[1]).toEqual({ source: '王五', target: '赵六', note: '改为女性' })
    expect(parsed.data['setting_map']).toBeNull()
  })

  it('writeOutline body contains 剧情 and 关键事件 sections with bullet events', async () => {
    await writeOutline('nv-1', {
      number: 3,
      source_chapter_ref: 5,
      hooks_to_plant: ['hk-1'],
      hooks_to_payoff: [],
      planned_state_changes: {
        character_deaths: [],
        new_settings: ['公司总部'],
      },
      plot: '主角进入公司，遭遇神秘事件。',
      key_events: ['主角入职', '发现密室', '撞见上司'],
    })
    const md = await readMd(paths.targetOutline('nv-1', 3))
    expect(md.frontMatter['number']).toBe(3)
    expect(md.frontMatter['source_chapter_ref']).toBe(5)
    expect(md.body).toContain('## 剧情')
    expect(md.body).toContain('主角进入公司，遭遇神秘事件。')
    expect(md.body).toContain('## 关键事件')
    expect(md.body).toContain('- 主角入职')
    expect(md.body).toContain('- 发现密室')
    expect(md.body).toContain('- 撞见上司')
  })

  it('writeChapterDraft body equals content; front matter has word_count and written_at', async () => {
    const content = '第一段内容。\n\n第二段内容。'
    await writeChapterDraft('nv-1', {
      number: 7,
      title: '入职',
      word_count: 1234,
      written_at: '2026-04-25T10:00:00Z',
      content,
    })
    const md = await readMd(paths.targetChapter('nv-1', 7))
    expect(md.frontMatter['number']).toBe(7)
    expect(md.frontMatter['title']).toBe('入职')
    expect(md.frontMatter['word_count']).toBe(1234)
    expect(md.frontMatter['written_at']).toBe('2026-04-25T10:00:00Z')
    expect(md.body.trim()).toBe(content.trim())
  })

  it('writeOutline twice for same number overwrites (upsert)', async () => {
    await writeOutline('nv-1', {
      number: 2,
      source_chapter_ref: 4,
      hooks_to_plant: ['hk-old'],
      hooks_to_payoff: [],
      planned_state_changes: { character_deaths: [], new_settings: [] },
      plot: '旧剧情。',
      key_events: ['旧事件'],
    })
    await writeOutline('nv-1', {
      number: 2,
      source_chapter_ref: 4,
      hooks_to_plant: ['hk-new'],
      hooks_to_payoff: ['hk-paid'],
      planned_state_changes: { character_deaths: ['某人'], new_settings: ['新场景'] },
      plot: '新剧情。',
      key_events: ['新事件 A', '新事件 B'],
    })
    const md = await readMd(paths.targetOutline('nv-1', 2))
    expect(md.frontMatter['hooks_to_plant']).toEqual(['hk-new'])
    expect(md.frontMatter['hooks_to_payoff']).toEqual(['hk-paid'])
    expect(md.body).toContain('新剧情。')
    expect(md.body).not.toContain('旧剧情。')
    expect(md.body).toContain('- 新事件 A')
    expect(md.body).not.toContain('- 旧事件')
  })
})
