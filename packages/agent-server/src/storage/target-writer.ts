import type {
  ChapterDraftRecord,
  MapsRecord,
  OutlineRecord,
} from '@novel-agent/shared'
import { writeMd } from './markdown.js'
import { paths } from './paths.js'

export type {
  CharacterMapEntry,
  CharacterSourceMeta,
  SettingMap,
  MapsRecord,
  OutlineRecord,
  OutlineKeyEvent,
  HookPlan,
  ChapterDraftRecord,
} from '@novel-agent/shared'

export async function writeMaps(novelId: string, rec: MapsRecord): Promise<void> {
  await writeMd(paths.targetMaps(novelId), { ...rec }, '')
}

export async function writeOutline(novelId: string, rec: OutlineRecord): Promise<void> {
  const fm = {
    number: rec.number,
    source_chapter_ref: rec.source_chapter_ref,
    plot_functions: rec.plot_functions,
    key_events: rec.key_events,
    hooks_to_plant: rec.hooks_to_plant,
    hooks_to_payoff: rec.hooks_to_payoff,
    hook_plans: rec.hook_plans ?? [],
    retention_plan: rec.retention_plan ?? null,
    reader_experience_plan: rec.reader_experience_plan ?? null,
    golden_three_plan: rec.golden_three_plan ?? null,
    planned_state_changes: rec.planned_state_changes,
    referenced_characters: rec.referenced_characters,
  }
  const body = `## 剧情\n${rec.plot.trim()}\n`
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
