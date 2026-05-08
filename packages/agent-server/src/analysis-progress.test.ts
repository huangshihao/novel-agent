import { describe, expect, it } from 'vitest'
import { getAnalyzedCoverage } from '@novel-agent/shared'

describe('getAnalyzedCoverage', () => {
  it('calculates analyzed chapter coverage against the whole novel', () => {
    expect(getAnalyzedCoverage({ analyzedTo: 50, chapterCount: 700 })).toEqual({
      analyzed: 50,
      total: 700,
      percent: 7,
      complete: false,
    })
  })

  it('clamps analyzed chapters to the available chapter count', () => {
    expect(getAnalyzedCoverage({ analyzedTo: 720, chapterCount: 700 })).toEqual({
      analyzed: 700,
      total: 700,
      percent: 100,
      complete: true,
    })
  })
})
