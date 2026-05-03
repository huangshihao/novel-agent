import type { MapsRecord } from '../storage/target-writer.js'
import type { StateRecord } from '../storage/state.js'

export type IssueLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: IssueLevel
  message: string
  hits?: string[]
}

export interface ValidationContext {
  maps: MapsRecord
  state: StateRecord
}

export function validateSourceNameLeak(
  content: string,
  ctx: ValidationContext,
): ValidationIssue | null {
  const leaks: string[] = []
  for (const entry of ctx.maps.character_map) {
    if (entry.source !== null && content.includes(entry.source)) leaks.push(entry.source)
  }
  if (leaks.length === 0) return null
  return {
    level: 'error',
    message: `${leaks.length} 个原书人名未替换为 target 名`,
    hits: leaks,
  }
}

export function validateAlive(
  content: string,
  ctx: ValidationContext,
): ValidationIssue | null {
  const dead: string[] = []
  for (const [name, s] of Object.entries(ctx.state.alive_status)) {
    if (s.alive) continue
    if (content.includes(name)) dead.push(name)
  }
  if (dead.length === 0) return null
  return {
    level: 'error',
    message: `${dead.length} 个已死亡角色在正文中出现`,
    hits: dead,
  }
}

export function validateSettingTerms(
  content: string,
  ctx: ValidationContext,
): ValidationIssue | null {
  if (!ctx.maps.setting_map) return null
  const residue: string[] = []
  for (const original of Object.keys(ctx.maps.setting_map.key_term_replacements)) {
    if (content.includes(original)) residue.push(original)
  }
  if (residue.length === 0) return null
  return {
    level: 'warning',
    message: `检测到 ${residue.length} 个原行业关键词残留`,
    hits: residue,
  }
}

export function validateChapterContent(
  content: string,
  ctx: ValidationContext,
): ValidationIssue[] {
  return [
    validateSourceNameLeak(content, ctx),
    validateAlive(content, ctx),
    validateSettingTerms(content, ctx),
  ].filter((x): x is ValidationIssue => x !== null)
}
