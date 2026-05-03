export interface AnalyzedCoverageInput {
  analyzedTo: number
  chapterCount: number
}

export interface AnalyzedCoverage {
  analyzed: number
  total: number
  percent: number
  complete: boolean
}

export function getAnalyzedCoverage(input: AnalyzedCoverageInput): AnalyzedCoverage {
  const total = Math.max(0, input.chapterCount)
  const analyzed = Math.min(Math.max(0, input.analyzedTo), total)
  const percent = total > 0 ? Math.min(100, Math.round((analyzed / total) * 100)) : 0

  return {
    analyzed,
    total,
    percent,
    complete: total > 0 && analyzed >= total,
  }
}
