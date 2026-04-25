import { writeMd } from './markdown.js'
import { paths } from './paths.js'

export interface CharacterMapEntry {
  source: string
  target: string
  note?: string
}

export interface SettingMap {
  original_industry: string
  target_industry: string
  key_term_replacements: Record<string, string>
}

export interface MapsRecord {
  character_map: CharacterMapEntry[]
  setting_map: SettingMap | null
}

export interface OutlineRecord {
  number: number
  source_chapter_ref: number
  hooks_to_plant: string[]
  hooks_to_payoff: string[]
  planned_state_changes: {
    character_deaths: string[]
    new_settings: string[]
  }
  plot: string
  key_events: string[]
}

export interface ChapterDraftRecord {
  number: number
  title: string
  word_count: number
  written_at: string
  content: string
}

export async function writeMaps(novelId: string, rec: MapsRecord): Promise<void> {
  await writeMd(paths.targetMaps(novelId), { ...rec }, '')
}

export async function writeOutline(novelId: string, rec: OutlineRecord): Promise<void> {
  const fm = {
    number: rec.number,
    source_chapter_ref: rec.source_chapter_ref,
    hooks_to_plant: rec.hooks_to_plant,
    hooks_to_payoff: rec.hooks_to_payoff,
    planned_state_changes: rec.planned_state_changes,
  }
  const body =
    `## 剧情\n${rec.plot.trim()}\n\n` +
    `## 关键事件\n${rec.key_events.map((e) => `- ${e}`).join('\n')}\n`
  await writeMd(paths.targetOutline(novelId, rec.number), fm, body)
}

export async function writeChapterDraft(
  novelId: string,
  rec: ChapterDraftRecord,
): Promise<void> {
  const fm = {
    number: rec.number,
    title: rec.title,
    word_count: rec.word_count,
    written_at: rec.written_at,
  }
  await writeMd(paths.targetChapter(novelId, rec.number), fm, rec.content)
}
