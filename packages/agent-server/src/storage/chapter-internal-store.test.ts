import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readChapterInternal,
  readChapterRaw,
  writeChapterInternal,
  writeChapterRaw,
} from './chapter-internal-store.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cis-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('chapter-internal-store', () => {
  it('stores raw text separately from agent-visible chapter markdown', () => {
    writeChapterRaw('nv-1', 7, '原文章节正文')

    expect(readChapterRaw('nv-1', 7)).toBe('原文章节正文')
    expect(readChapterInternal('nv-1', 7)).toEqual({
      summary: '',
      key_events_with_desc: [],
    })
  })

  it('keeps raw text when analysis summary is updated later', () => {
    writeChapterRaw('nv-1', 7, '原文章节正文')
    writeChapterInternal('nv-1', 7, '剧情简介', [
      {
        desc: '具体事件',
        function: '剧情功能',
        can_replace: true,
        can_reorder: false,
        depends_on: [],
      },
    ])

    expect(readChapterRaw('nv-1', 7)).toBe('原文章节正文')
    expect(readChapterInternal('nv-1', 7)?.summary).toBe('剧情简介')
  })
})
