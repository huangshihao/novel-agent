import type { KeyEventEntry } from '@novel-agent/shared'
import { db } from './db.js'

export interface ChapterInternal {
  summary: string
  key_events_with_desc: KeyEventEntry[]
}

let initialized = false
function ensureTable(): void {
  if (initialized) return
  db().exec(`
    CREATE TABLE IF NOT EXISTS chapter_internal (
      novel_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      key_events_with_desc TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (novel_id, number)
    )
  `)
  initialized = true
}

export function writeChapterInternal(
  novelId: string,
  number: number,
  summary: string,
  keyEventsWithDesc: KeyEventEntry[],
): void {
  ensureTable()
  db()
    .prepare(
      `INSERT INTO chapter_internal (novel_id, number, summary, key_events_with_desc)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(novel_id, number) DO UPDATE SET
         summary = excluded.summary,
         key_events_with_desc = excluded.key_events_with_desc`,
    )
    .run(novelId, number, summary, JSON.stringify(keyEventsWithDesc))
}

export function readChapterInternal(
  novelId: string,
  number: number,
): ChapterInternal | null {
  ensureTable()
  const row = db()
    .prepare(
      'SELECT summary, key_events_with_desc FROM chapter_internal WHERE novel_id = ? AND number = ?',
    )
    .get(novelId, number) as { summary: string; key_events_with_desc: string } | undefined
  if (!row) return null
  let parsed: KeyEventEntry[] = []
  try {
    const raw = JSON.parse(row.key_events_with_desc) as unknown
    if (Array.isArray(raw)) parsed = raw as KeyEventEntry[]
  } catch {
    parsed = []
  }
  return { summary: row.summary, key_events_with_desc: parsed }
}

export function listChapterInternal(novelId: string): Map<number, ChapterInternal> {
  ensureTable()
  const rows = db()
    .prepare(
      'SELECT number, summary, key_events_with_desc FROM chapter_internal WHERE novel_id = ? ORDER BY number ASC',
    )
    .all(novelId) as { number: number; summary: string; key_events_with_desc: string }[]
  const out = new Map<number, ChapterInternal>()
  for (const r of rows) {
    let parsed: KeyEventEntry[] = []
    try {
      const raw = JSON.parse(r.key_events_with_desc) as unknown
      if (Array.isArray(raw)) parsed = raw as KeyEventEntry[]
    } catch {
      parsed = []
    }
    out.set(r.number, { summary: r.summary, key_events_with_desc: parsed })
  }
  return out
}
