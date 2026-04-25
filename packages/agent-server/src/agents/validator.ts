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

export function validateNames(
  content: string,
  ctx: ValidationContext,
): ValidationIssue | null {
  const known = new Set(ctx.maps.character_map.map((e) => e.target))
  const unregistered: Set<string> = new Set()
  const re = /([一-龥]{2,4})(?=说|笑|看|走|站|坐|回头|拿|抬头|皱眉|开口)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const name = m[1]!
    if (!known.has(name) && name.length >= 2) unregistered.add(name)
  }
  if (unregistered.size === 0) return null
  return {
    level: 'error',
    message: `检测到 ${unregistered.size} 个未在 character_map 注册的疑似人名`,
    hits: [...unregistered],
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
    validateNames(content, ctx),
    validateAlive(content, ctx),
    validateSettingTerms(content, ctx),
  ].filter((x): x is ValidationIssue => x !== null)
}
