import { describe, expect, it } from 'vitest'
import { paths } from './paths.js'

describe('paths', () => {
  it('builds novel root from id', () => {
    expect(paths.novel('nv-abc')).toMatch(/data\/nv-abc$/)
  })

  it('builds source/chapters/<n>.md with zero-padded number', () => {
    const p = paths.sourceChapter('nv-abc', 5)
    expect(p).toMatch(/nv-abc\/source\/chapters\/0005\.md$/)
  })

  it('zero-pads to 4 digits', () => {
    expect(paths.sourceChapter('nv-x', 1)).toMatch(/0001\.md$/)
    expect(paths.sourceChapter('nv-x', 999)).toMatch(/0999\.md$/)
    expect(paths.sourceChapter('nv-x', 1234)).toMatch(/1234\.md$/)
  })

  it('builds source raw txt path', () => {
    expect(paths.sourceRaw('nv-x', 5)).toMatch(/nv-x\/source\/raw\/0005\.txt$/)
  })

  it('character path uses canonical name', () => {
    expect(paths.sourceCharacter('nv-x', '张三')).toMatch(/张三\.md$/)
  })

  it('honors NOVEL_AGENT_DATA_DIR env', () => {
    process.env['NOVEL_AGENT_DATA_DIR'] = '/tmp/novel-test'
    return import('./paths.js?reload=' + Date.now()).then((m) => {
      expect(m.paths.root()).toBe('/tmp/novel-test')
    })
  })

  it('builds target dir', () => {
    expect(paths.targetDir('nv-1')).toMatch(/nv-1\/target$/)
  })

  it('builds target maps.md', () => {
    expect(paths.targetMaps('nv-1')).toMatch(/nv-1\/target\/maps\.md$/)
  })

  it('builds target state.md', () => {
    expect(paths.targetState('nv-1')).toMatch(/nv-1\/target\/state\.md$/)
  })

  it('builds target outlines dir', () => {
    expect(paths.targetOutlinesDir('nv-1')).toMatch(/nv-1\/target\/outlines$/)
  })

  it('builds target outline path with zero-padded number', () => {
    expect(paths.targetOutline('nv-1', 7)).toMatch(
      /nv-1\/target\/outlines\/0007\.md$/,
    )
  })

  it('builds target chapters dir', () => {
    expect(paths.targetChaptersDir('nv-1')).toMatch(/nv-1\/target\/chapters$/)
  })

  it('builds target chapter path with zero-padded number', () => {
    expect(paths.targetChapter('nv-1', 42)).toMatch(
      /nv-1\/target\/chapters\/0042\.md$/,
    )
  })
})
