import { readdir } from 'node:fs/promises'
import { paths } from './paths.js'
import { readMdIfExists, writeMd } from './markdown.js'

export type NovelStatus =
  | 'uploaded'
  | 'splitting'
  | 'analyzing'
  | 'ready'
  | 'failed'

export interface NovelIndex {
  id: string
  title: string
  status: NovelStatus
  chapter_count: number
  analyzed_count: number
  analysis_from: number
  analysis_to: number
  analyzed_to: number
  error: string | null
  created_at: number
  updated_at: number
}

export async function writeNovelIndex(idx: NovelIndex): Promise<void> {
  await writeMd(paths.novelIndex(idx.id), idx as unknown as Record<string, unknown>, '')
}

export async function readNovelIndex(id: string): Promise<NovelIndex | null> {
  const f = await readMdIfExists<NovelIndex>(paths.novelIndex(id))
  return f ? f.frontMatter : null
}

export async function listNovelIndices(): Promise<NovelIndex[]> {
  let dirs: string[]
  try {
    dirs = await readdir(paths.root())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: NovelIndex[] = []
  for (const d of dirs) {
    if (d.startsWith('.')) continue
    const f = await readMdIfExists<NovelIndex>(paths.novelIndex(d))
    if (f) out.push(f.frontMatter)
  }
  return out
}

export async function updateNovelIndex(
  id: string,
  patch: Partial<NovelIndex>,
): Promise<NovelIndex> {
  const current = await readNovelIndex(id)
  if (!current) throw new Error(`novel ${id} not found`)
  const updated: NovelIndex = { ...current, ...patch, updated_at: Date.now() }
  await writeNovelIndex(updated)
  return updated
}
