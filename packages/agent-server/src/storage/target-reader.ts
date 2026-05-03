import { existsSync } from 'node:fs'
import { listFrontMatter, readMdIfExists } from './markdown.js'
import { paths } from './paths.js'
import type {
  ChapterDraftRecord,
  CharacterMapEntry,
  MapsRecord,
  OutlineKeyEvent,
  OutlineRecord,
} from './target-writer.js'

interface LegacyCharacterMapEntry {
  source?: unknown
  target?: unknown
  note?: unknown
  target_note?: unknown
  source_meta?: unknown
}

function normalizeCharacterEntry(raw: unknown): CharacterMapEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as LegacyCharacterMapEntry
  const target = typeof r.target === 'string' ? r.target : null
  if (!target) return null
  const source = typeof r.source === 'string' && r.source.length > 0 ? r.source : null
  const target_note =
    typeof r.target_note === 'string'
      ? r.target_note
      : typeof r.note === 'string'
        ? r.note
        : null
  const sm = r.source_meta && typeof r.source_meta === 'object'
    ? (r.source_meta as Record<string, unknown>)
    : null
  const source_meta = sm
    ? {
        role: typeof sm['role'] === 'string' ? (sm['role'] as string) : null,
        story_function:
          typeof sm['story_function'] === 'string' ? (sm['story_function'] as string) : null,
        replaceability:
          typeof sm['replaceability'] === 'string' ? (sm['replaceability'] as string) : null,
        first_chapter:
          typeof sm['first_chapter'] === 'number' ? (sm['first_chapter'] as number) : null,
        last_chapter:
          typeof sm['last_chapter'] === 'number' ? (sm['last_chapter'] as number) : null,
        description: typeof sm['description'] === 'string' ? (sm['description'] as string) : '',
      }
    : null
  return { source, target, source_meta, target_note }
}

export async function readMaps(novelId: string): Promise<MapsRecord | null> {
  const md = await readMdIfExists<{
    character_map?: unknown[]
    setting_map?: MapsRecord['setting_map']
  }>(paths.targetMaps(novelId))
  if (!md) return null
  const rawList = Array.isArray(md.frontMatter.character_map) ? md.frontMatter.character_map : []
  const character_map = rawList
    .map(normalizeCharacterEntry)
    .filter((e): e is CharacterMapEntry => e !== null)
  return {
    character_map,
    setting_map: md.frontMatter.setting_map ?? null,
  }
}

function normalizeOutlineKeyEvents(
  raw: OutlineKeyEvent[] | string[] | undefined,
): OutlineKeyEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.map((e) => {
    if (typeof e === 'string') return { function: '', new_carrier: e }
    return { function: String(e.function ?? ''), new_carrier: String(e.new_carrier ?? '') }
  })
}

export async function readOutline(
  novelId: string,
  number: number,
): Promise<OutlineRecord | null> {
  const md = await readMdIfExists(paths.targetOutline(novelId, number))
  if (!md) return null
  const fm = md.frontMatter as Partial<OutlineRecord> & {
    key_events?: OutlineKeyEvent[] | string[]
  }
  const plotMatch = md.body.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s|$)/)
  return {
    number: fm.number ?? number,
    source_chapter_ref: fm.source_chapter_ref ?? number,
    plot_functions: fm.plot_functions ?? [],
    hooks_to_plant: fm.hooks_to_plant ?? [],
    hooks_to_payoff: fm.hooks_to_payoff ?? [],
    planned_state_changes: fm.planned_state_changes ?? { character_deaths: [], new_settings: [] },
    plot: plotMatch?.[1]?.trim() ?? '',
    key_events: normalizeOutlineKeyEvents(fm.key_events),
    referenced_characters: Array.isArray(fm.referenced_characters)
      ? fm.referenced_characters.filter((s): s is string => typeof s === 'string')
      : [],
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

export async function outlineExists(novelId: string, n: number): Promise<boolean> {
  return existsSync(paths.targetOutline(novelId, n))
}

export async function missingOutlines(
  novelId: string,
  from: number,
  to: number,
): Promise<number[]> {
  const out: number[] = []
  for (let n = from; n <= to; n++) {
    if (!(await outlineExists(novelId, n))) out.push(n)
  }
  return out
}
