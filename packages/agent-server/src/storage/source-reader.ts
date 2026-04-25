import { rm } from 'node:fs/promises'
import { listFrontMatter, readMd, readMdIfExists } from './markdown.js'
import { paths } from './paths.js'
import type {
  SourceChapterRecord,
  SourceCharacterRecord,
  SourceHookRecord,
  SourceMetaRecord,
  SourceSubplotRecord,
} from './source-writer.js'

interface ChapterFrontMatter {
  number: number
  title: string
  characters_present?: string[]
  hooks_planted?: string[]
  hooks_paid?: string[]
  _hooks_planted_candidates?: { desc: string; category: string | null }[]
}

function parseChapterBody(body: string): { summary: string; key_events: string[] } {
  const summaryMatch = body.match(/##\s*摘要\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const eventsMatch = body.match(/##\s*关键事件\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const summary = summaryMatch?.[1]?.trim() ?? ''
  const eventsBlock = eventsMatch?.[1] ?? ''
  const key_events = eventsBlock
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
  return { summary, key_events }
}

export async function readSourceChapter(
  novelId: string,
  number: number,
): Promise<SourceChapterRecord | null> {
  const md = await readMdIfExists<ChapterFrontMatter>(paths.sourceChapter(novelId, number))
  if (!md) return null
  const { summary, key_events } = parseChapterBody(md.body)
  return {
    number: md.frontMatter.number,
    title: md.frontMatter.title,
    characters_present: md.frontMatter.characters_present ?? [],
    hooks_planted: md.frontMatter.hooks_planted ?? [],
    hooks_paid: md.frontMatter.hooks_paid ?? [],
    hooks_planted_candidates: md.frontMatter._hooks_planted_candidates ?? [],
    summary,
    key_events,
  }
}

export async function listSourceChapters(
  novelId: string,
): Promise<SourceChapterRecord[]> {
  const list = await listFrontMatter<ChapterFrontMatter>(paths.sourceChaptersDir(novelId))
  const out: SourceChapterRecord[] = []
  for (const item of list) {
    const md = await readMd(item.path)
    const { summary, key_events } = parseChapterBody(md.body)
    out.push({
      number: item.frontMatter.number,
      title: item.frontMatter.title,
      characters_present: item.frontMatter.characters_present ?? [],
      hooks_planted: item.frontMatter.hooks_planted ?? [],
      hooks_paid: item.frontMatter.hooks_paid ?? [],
      hooks_planted_candidates: item.frontMatter._hooks_planted_candidates ?? [],
      summary,
      key_events,
    })
  }
  return out.sort((a, b) => a.number - b.number)
}

export async function listSourceCharacters(
  novelId: string,
): Promise<SourceCharacterRecord[]> {
  const list = await listFrontMatter<Omit<SourceCharacterRecord, 'description'>>(
    paths.sourceCharactersDir(novelId),
  )
  const out: SourceCharacterRecord[] = []
  for (const item of list) {
    const md = await readMd(item.path)
    const descMatch = md.body.match(/##\s*描述\s*\n([\s\S]*?)(?=\n##\s|$)/)
    out.push({
      canonical_name: item.frontMatter.canonical_name,
      aliases: item.frontMatter.aliases ?? [],
      role: item.frontMatter.role ?? null,
      function_tags: item.frontMatter.function_tags ?? [],
      first_chapter: item.frontMatter.first_chapter,
      last_chapter: item.frontMatter.last_chapter,
      death_chapter: item.frontMatter.death_chapter ?? null,
      description: descMatch?.[1]?.trim() ?? '',
    })
  }
  return out
}

export async function readSourceSubplots(
  novelId: string,
): Promise<SourceSubplotRecord[]> {
  const md = await readMdIfExists<{ subplots: SourceSubplotRecord[] }>(
    paths.sourceSubplots(novelId),
  )
  return md?.frontMatter.subplots ?? []
}

export async function readSourceHooks(
  novelId: string,
): Promise<SourceHookRecord[]> {
  const md = await readMdIfExists<{ hooks: SourceHookRecord[] }>(
    paths.sourceHooks(novelId),
  )
  return md?.frontMatter.hooks ?? []
}

export async function readSourceMeta(
  novelId: string,
): Promise<SourceMetaRecord | null> {
  const md = await readMdIfExists(paths.sourceMeta(novelId))
  if (!md) return null
  const fm = md.frontMatter as Partial<SourceMetaRecord>
  const summaryMatch = md.body.match(/##\s*概要\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const samplesMatch = md.body.match(/##\s*风格样本\s*\n([\s\S]*?)$/)
  const samples = (samplesMatch?.[1] ?? '')
    .split(/###\s*样本\s*\d+\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    title: fm.title ?? '',
    chapter_count: fm.chapter_count ?? 0,
    genre_tags: fm.genre_tags ?? [],
    industry: fm.industry ?? '',
    era: fm.era ?? '',
    world_rules: fm.world_rules ?? [],
    key_terms: fm.key_terms ?? [],
    style_tags: fm.style_tags ?? [],
    style_samples: samples,
    summary: summaryMatch?.[1]?.trim() ?? '',
  }
}

export async function wipeSourceAggregates(novelId: string): Promise<void> {
  await Promise.all([
    rm(paths.sourceCharactersDir(novelId), { recursive: true, force: true }),
    rm(paths.sourceSubplots(novelId), { force: true }),
    rm(paths.sourceHooks(novelId), { force: true }),
    rm(paths.sourceMeta(novelId), { force: true }),
  ])
}
