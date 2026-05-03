import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeSourceChapter,
  writeSourceCharacter,
  writeSourceHooks,
  writeSourceMeta,
  writeSourceSubplots,
} from '../../storage/source-writer.js'
import { writeMaps } from '../../storage/target-writer.js'
import { buildGetOutlineContextTool } from './get-outline-context.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'goc-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const novelId = 'nv-1'

async function exec(number: number) {
  const tool = buildGetOutlineContextTool(novelId)
  return await (tool.execute as unknown as (
    id: string,
    p: { number: number },
  ) => Promise<{ details: Record<string, unknown> }>)('call-1', { number })
}

describe('buildGetOutlineContextTool', () => {
  it('returns safe source character names for map creation without descriptions', async () => {
    await writeSourceChapter(novelId, {
      number: 1,
      title: '第一章',
      characters_present: ['张三'],
      hooks_planted: [],
      hooks_paid: [],
      hooks_planted_candidates: [],
      summary: '张三偷看到了原书具体剧情。',
      key_events: [
        {
          desc: '张三偷看到账本。',
          function: '让主角获得线索',
          can_replace: true,
          can_reorder: false,
          depends_on: [],
        },
      ],
      plot_functions: ['让主角获得线索'],
      originality_risks: ['账本'],
      writing_rhythm: null,
    })
    await writeSourceCharacter(novelId, {
      canonical_name: '张三',
      aliases: [],
      role: 'protagonist',
      function_tags: [],
      story_function: 'information-source',
      replaceability: 'medium',
      first_chapter: 1,
      last_chapter: 10,
      death_chapter: null,
      description: '张三偷看到了原书具体剧情。',
    })
    await writeSourceMeta(novelId, {
      title: '原书',
      chapter_count: 1,
      genre_tags: ['现实'],
      industry: '乡村',
      era: '现代',
      world_rules: [],
      key_terms: [],
      style_tags: [],
      style_samples: [],
      summary: '全书剧情',
    })
    await writeSourceHooks(novelId, [])
    await writeSourceSubplots(novelId, [])
    await writeMaps(novelId, {
      character_map: [
        {
          source: '张三',
          target: '林青',
          source_meta: {
            role: 'protagonist',
            story_function: 'information-source',
            replaceability: 'medium',
            first_chapter: 1,
            last_chapter: 10,
            description: '张三偷看到了原书具体剧情。',
          },
          target_note: null,
        },
      ],
      setting_map: null,
    })

    const r = await exec(1)

    expect(r.details.source_characters).toEqual([
      {
        canonical_name: '张三',
        role: 'protagonist',
        story_function: 'information-source',
        replaceability: 'medium',
        first_chapter: 1,
        last_chapter: 10,
      },
    ])
    expect(JSON.stringify(r.details)).not.toContain('偷看到了原书具体剧情')
  })
})
