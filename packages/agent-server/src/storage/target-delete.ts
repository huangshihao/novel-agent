import { rm } from 'node:fs/promises'
import { paths } from './paths.js'
import { createInitialState, applyChapterStateDiff, writeState } from './state.js'
import { listChapterDrafts, listOutlines, readMaps, readOutline } from './target-reader.js'

export interface DeleteOutlinesResult {
  deletedOutlines: number[]
  deletedDrafts: number[]
}

export interface DeleteDraftsResult {
  deletedDrafts: number[]
}

async function removeIfExists(path: string): Promise<void> {
  await rm(path, { force: true })
}

async function deleteDraftFilesFrom(novelId: string, fromChapter: number): Promise<number[]> {
  const drafts = await listChapterDrafts(novelId)
  const deletedDrafts = drafts
    .map((d) => d.number)
    .filter((n) => n >= fromChapter)
    .sort((a, b) => a - b)

  for (const n of deletedDrafts) {
    await removeIfExists(paths.targetChapter(novelId, n))
  }
  return deletedDrafts
}

async function rebuildStateFromDrafts(novelId: string): Promise<void> {
  const init = await createInitialState(novelId)
  await writeState(novelId, init)

  const maps = (await readMaps(novelId)) ?? { character_map: [], setting_map: null }
  const drafts = await listChapterDrafts(novelId)
  for (const draft of drafts) {
    const outline = await readOutline(novelId, draft.number)
    if (!outline) continue
    const charactersAppeared = maps.character_map
      .map((e) => e.target)
      .filter((name) => draft.content.includes(name))
    await applyChapterStateDiff(novelId, draft.number, outline, charactersAppeared)
  }
}

export async function deleteDraftsFrom(
  novelId: string,
  fromChapter: number,
): Promise<DeleteDraftsResult> {
  const deletedDrafts = await deleteDraftFilesFrom(novelId, fromChapter)
  await rebuildStateFromDrafts(novelId)
  return { deletedDrafts }
}

export async function deleteOutlinesFrom(
  novelId: string,
  fromChapter: number,
): Promise<DeleteOutlinesResult> {
  const outlines = await listOutlines(novelId)
  const deletedOutlines = outlines
    .map((o) => o.number)
    .filter((n) => n >= fromChapter)
    .sort((a, b) => a - b)

  const deletedDrafts = await deleteDraftFilesFrom(novelId, fromChapter)
  for (const n of deletedOutlines) {
    await removeIfExists(paths.targetOutline(novelId, n))
  }
  await rebuildStateFromDrafts(novelId)
  return { deletedOutlines, deletedDrafts }
}
