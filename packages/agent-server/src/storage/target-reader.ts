import { listFrontMatter, readMdIfExists } from './markdown.js'
import { paths } from './paths.js'
import type {
  ChapterDraftRecord,
  MapsRecord,
  OutlineRecord,
} from './target-writer.js'

export async function readMaps(novelId: string): Promise<MapsRecord | null> {
  const md = await readMdIfExists<MapsRecord>(paths.targetMaps(novelId))
  return md ? md.frontMatter : null
}

export async function readOutline(
  novelId: string,
  number: number,
): Promise<OutlineRecord | null> {
  const md = await readMdIfExists(paths.targetOutline(novelId, number))
  if (!md) return null
  const fm = md.frontMatter as Partial<OutlineRecord>
  const plotMatch = md.body.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const eventsMatch = md.body.match(/##\s*关键事件\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const events = (eventsMatch?.[1] ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
  return {
    number: fm.number ?? number,
    source_chapter_ref: fm.source_chapter_ref ?? number,
    hooks_to_plant: fm.hooks_to_plant ?? [],
    hooks_to_payoff: fm.hooks_to_payoff ?? [],
    planned_state_changes: fm.planned_state_changes ?? { character_deaths: [], new_settings: [] },
    plot: plotMatch?.[1]?.trim() ?? '',
    key_events: events,
  }
}

export async function listOutlines(
  novelId: string,
  range?: { from: number; to: number },
): Promise<OutlineRecord[]> {
  const items = await listFrontMatter<OutlineRecord>(paths.targetOutlinesDir(novelId))
  const nums = items
    .map((i) => i.frontMatter.number)
    .filter((n) => !range || (n >= range.from && n <= range.to))
    .sort((a, b) => a - b)
  const out: OutlineRecord[] = []
  for (const n of nums) {
    const o = await readOutline(novelId, n)
    if (o) out.push(o)
  }
  return out
}

export async function readChapterDraft(
  novelId: string,
  number: number,
): Promise<ChapterDraftRecord | null> {
  const md = await readMdIfExists(paths.targetChapter(novelId, number))
  if (!md) return null
  const fm = md.frontMatter as Partial<ChapterDraftRecord>
  return {
    number: fm.number ?? number,
    title: fm.title ?? '',
    word_count: fm.word_count ?? 0,
    written_at: fm.written_at ?? '',
    content: md.body.trim(),
  }
}

export async function listChapterDrafts(
  novelId: string,
): Promise<ChapterDraftRecord[]> {
  const items = await listFrontMatter<ChapterDraftRecord>(
    paths.targetChaptersDir(novelId),
  )
  const out: ChapterDraftRecord[] = []
  for (const item of items) {
    const r = await readChapterDraft(novelId, item.frontMatter.number)
    if (r) out.push(r)
  }
  return out.sort((a, b) => a.number - b.number)
}
