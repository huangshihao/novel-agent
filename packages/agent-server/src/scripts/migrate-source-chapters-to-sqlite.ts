import { readdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readMd, writeMd } from '../storage/markdown.js'
import { paths } from '../storage/paths.js'
import { writeChapterInternal, writeChapterRaw } from '../storage/chapter-internal-store.js'
import type { KeyEventEntry, WritingRhythm } from '@novel-agent/shared'

interface OldChapterFm {
  number?: number
  title?: string
  characters_present?: string[]
  hooks_planted?: string[]
  hooks_paid?: string[]
  _hooks_planted_candidates?: { desc: string; category: string | null }[]
  plot_functions?: string[]
  key_events?: (Partial<KeyEventEntry> & { desc?: string })[] | string[]
  originality_risks?: string[]
  writing_rhythm?: WritingRhythm | null
}

function normalizeOldEvents(
  raw: (Partial<KeyEventEntry> & { desc?: string })[] | string[] | undefined,
): KeyEventEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map((e) => {
    if (typeof e === 'string') {
      return { desc: e, function: '', can_replace: true, can_reorder: false, depends_on: [] }
    }
    return {
      desc: String(e.desc ?? ''),
      function: String(e.function ?? ''),
      can_replace: Boolean(e.can_replace ?? true),
      can_reorder: Boolean(e.can_reorder ?? false),
      depends_on: Array.isArray(e.depends_on) ? e.depends_on.map(String) : [],
    }
  })
}

function parseSummary(body: string): string {
  const m = body.match(/##\s*摘要\s*\n([\s\S]*?)(?=\n##\s|$)/)
  return m?.[1]?.trim() ?? ''
}

async function migrateNovel(novelId: string): Promise<{ migrated: number; skipped: number }> {
  const dir = paths.sourceChaptersDir(novelId)
  if (!existsSync(dir)) return { migrated: 0, skipped: 0 }
  const files = await readdir(dir)
  let migrated = 0
  let skipped = 0
  for (const fname of files) {
    if (!fname.endsWith('.md')) continue
    const path = `${dir}/${fname}`
    const md = await readMd<OldChapterFm>(path)
    const fm = md.frontMatter
    if (typeof fm.number !== 'number') continue

    const events = normalizeOldEvents(fm.key_events)
    const summary = parseSummary(md.body)
    const hasDescInEvents = events.some((e) => e.desc)
    const hasSummaryInBody = summary.length > 0

    if (!hasDescInEvents && !hasSummaryInBody) {
      skipped++
      continue
    }

    writeChapterInternal(novelId, fm.number, summary, events)

    const keyEventsForMd = events.map((e) => ({
      function: e.function,
      can_replace: e.can_replace,
      can_reorder: e.can_reorder,
      depends_on: e.depends_on,
    }))
    const newFm: Record<string, unknown> = {
      number: fm.number,
      title: fm.title,
      characters_present: fm.characters_present ?? [],
      hooks_planted: fm.hooks_planted ?? [],
      hooks_paid: fm.hooks_paid ?? [],
      _hooks_planted_candidates: fm._hooks_planted_candidates ?? [],
      plot_functions: fm.plot_functions ?? [],
      key_events: keyEventsForMd,
      originality_risks: fm.originality_risks ?? [],
      writing_rhythm: fm.writing_rhythm ?? null,
    }
    await writeMd(path, newFm, '')
    migrated++
  }
  return { migrated, skipped }
}

async function migrateRaw(novelId: string): Promise<number> {
  const dir = paths.sourceRawDir(novelId)
  if (!existsSync(dir)) return 0
  const files = await readdir(dir)
  let migrated = 0
  for (const fname of files) {
    if (!fname.endsWith('.txt')) continue
    const n = Number(fname.replace(/\.txt$/, ''))
    if (!Number.isFinite(n) || n < 1) continue
    const text = await readFile(`${dir}/${fname}`, 'utf8')
    writeChapterRaw(novelId, n, text)
    migrated++
  }
  await rm(dir, { recursive: true, force: true })
  return migrated
}

async function main(): Promise<void> {
  const root = paths.root()
  if (!existsSync(root)) {
    console.log(`[migrate] data root not found: ${root}`)
    return
  }
  const entries = await readdir(root, { withFileTypes: true })
  const novelDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('nv-')).map((e) => e.name)
  if (novelDirs.length === 0) {
    console.log('[migrate] no novels found')
    return
  }
  let total = 0
  let totalSkipped = 0
  for (const id of novelDirs) {
    const { migrated, skipped } = await migrateNovel(id)
    const raw = await migrateRaw(id)
    console.log(`[migrate] ${id}: migrated ${migrated}, skipped ${skipped}, raw ${raw}`)
    total += migrated
    totalSkipped += skipped
  }
  console.log(`[migrate] done. total migrated: ${total}, skipped: ${totalSkipped}`)
}

main().catch((err) => {
  console.error('[migrate] fatal:', err)
  process.exit(1)
})
