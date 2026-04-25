import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMd, writeMd, readMdIfExists, listFrontMatter } from './markdown.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'md-test-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('markdown', () => {
  it('writes and reads back front matter + body', async () => {
    const path = join(tmp, 'a.md')
    await writeMd(path, { number: 5, title: '测试' }, '## 摘要\n正文\n')
    const got = await readMd<{ number: number; title: string }>(path)
    expect(got.frontMatter.number).toBe(5)
    expect(got.frontMatter.title).toBe('测试')
    expect(got.body).toContain('## 摘要')
  })

  it('writeMd creates parent dir if missing', async () => {
    const path = join(tmp, 'nested/dir/a.md')
    await writeMd(path, { x: 1 }, 'body')
    expect(existsSync(path)).toBe(true)
  })

  it('writeMd is atomic (no .tmp leftover)', async () => {
    const path = join(tmp, 'a.md')
    await writeMd(path, { x: 1 }, 'body')
    expect(existsSync(path + '.tmp')).toBe(false)
  })

  it('readMdIfExists returns null when absent', async () => {
    const got = await readMdIfExists(join(tmp, 'missing.md'))
    expect(got).toBeNull()
  })

  it('listFrontMatter returns front matter for all *.md in a dir', async () => {
    await writeMd(join(tmp, 'a.md'), { id: 'a' }, '')
    await writeMd(join(tmp, 'b.md'), { id: 'b' }, '')
    // Non-MD file should be ignored
    writeFileSync(join(tmp, 'note.txt'), 'ignore me')
    const list = await listFrontMatter<{ id: string }>(tmp)
    const ids = list.map((x) => x.frontMatter.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })
})
