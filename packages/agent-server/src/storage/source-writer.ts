import { writeMd } from './markdown.js'
import { paths } from './paths.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export type CharacterRole =
  | 'protagonist'
  | 'female-lead'
  | 'antagonist'
  | 'mentor'
  | 'family'
  | 'side'
  | 'tool'

export type SubplotFunction =
  | 'create-crisis'
  | 'deliver-payoff'
  | 'establish-setting'
  | 'romance'
  | 'growth'

export type HookCategory =
  | 'suspense'
  | 'crisis'
  | 'payoff'
  | 'goal'
  | 'secret'
  | 'relation'
  | 'rule'
  | 'contrast'
  | 'emotion'

export interface SourceChapterRecord {
  number: number
  title: string
  characters_present: string[]
  hooks_planted: string[]
  hooks_paid: string[]
  hooks_planted_candidates: { desc: string; category: string | null }[]
  summary: string
  key_events: string[]
}

export interface SourceCharacterRecord {
  canonical_name: string
  aliases: string[]
  role: CharacterRole | null
  function_tags: string[]
  first_chapter: number
  last_chapter: number
  death_chapter: number | null
  description: string
}

export interface SourceSubplotRecord {
  id: string
  name: string
  function: SubplotFunction | null
  chapters: number[]
  description: string
}

export interface SourceHookRecord {
  id: string
  description: string
  category: HookCategory | null
  planted_chapter: number
  payoff_chapter: number | null
  evidence_chapters: number[]
  why?: string
}

export interface SourceMetaRecord {
  title: string
  chapter_count: number
  genre_tags: string[]
  industry: string
  era: string
  world_rules: string[]
  key_terms: string[]
  style_tags: string[]
  style_samples: string[]
  summary: string
}

// ─── Writers ───────────────────────────────────────────────────────────────

export async function writeSourceChapter(
  novelId: string,
  rec: SourceChapterRecord,
): Promise<void> {
  const fm = {
    number: rec.number,
    title: rec.title,
    characters_present: rec.characters_present,
    hooks_planted: rec.hooks_planted,
    hooks_paid: rec.hooks_paid,
    _hooks_planted_candidates: rec.hooks_planted_candidates,
  }
  const body =
    `## 摘要\n${rec.summary.trim()}\n\n` +
    `## 关键事件\n${rec.key_events.map((e) => `- ${e}`).join('\n')}\n`
  await writeMd(paths.sourceChapter(novelId, rec.number), fm, body)
}

export async function writeSourceCharacter(
  novelId: string,
  rec: SourceCharacterRecord,
): Promise<void> {
  const fm = {
    canonical_name: rec.canonical_name,
    aliases: rec.aliases,
    role: rec.role,
    function_tags: rec.function_tags,
    first_chapter: rec.first_chapter,
    last_chapter: rec.last_chapter,
    death_chapter: rec.death_chapter,
  }
  const body = `## 描述\n${rec.description.trim()}\n`
  await writeMd(paths.sourceCharacter(novelId, rec.canonical_name), fm, body)
}

export async function writeSourceSubplots(
  novelId: string,
  subplots: SourceSubplotRecord[],
): Promise<void> {
  await writeMd(paths.sourceSubplots(novelId), { subplots }, '')
}

export async function writeSourceHooks(
  novelId: string,
  hooks: SourceHookRecord[],
): Promise<void> {
  await writeMd(paths.sourceHooks(novelId), { hooks }, '')
}

export async function writeSourceMeta(
  novelId: string,
  rec: SourceMetaRecord,
): Promise<void> {
  const fm = {
    title: rec.title,
    chapter_count: rec.chapter_count,
    genre_tags: rec.genre_tags,
    industry: rec.industry,
    era: rec.era,
    world_rules: rec.world_rules,
    key_terms: rec.key_terms,
    style_tags: rec.style_tags,
  }
  const body =
    `## 概要\n${rec.summary.trim()}\n\n` +
    `## 风格样本\n${rec.style_samples.map((s, i) => `### 样本 ${i + 1}\n${s}`).join('\n\n')}\n`
  await writeMd(paths.sourceMeta(novelId), fm, body)
}
