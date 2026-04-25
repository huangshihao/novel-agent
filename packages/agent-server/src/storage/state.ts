import type { AliveStatus, StateRecord } from '@novel-agent/shared'
import { readMdIfExists, writeMd } from './markdown.js'
import { paths } from './paths.js'
import { readSourceHooks } from './source-reader.js'
import { readMaps } from './target-reader.js'
import type { OutlineRecord } from './target-writer.js'

export type { AliveStatus, NewHook, StateRecord } from '@novel-agent/shared'

export async function readState(novelId: string): Promise<StateRecord | null> {
  const md = await readMdIfExists<StateRecord>(paths.targetState(novelId))
  return md ? md.frontMatter : null
}

export async function writeState(novelId: string, rec: StateRecord): Promise<void> {
  await writeMd(paths.targetState(novelId), rec as unknown as Record<string, unknown>, '')
}

export async function initStateIfMissing(novelId: string): Promise<StateRecord> {
  const existing = await readState(novelId)
  if (existing) return existing
  const maps = await readMaps(novelId)
  const sourceHooks = await readSourceHooks(novelId)
  const alive_status: Record<string, AliveStatus> = {}
  for (const e of maps?.character_map ?? []) {
    alive_status[e.target] = { alive: true, last_seen_chapter: 0 }
  }
  const hooks: StateRecord['hooks'] = {}
  for (const h of sourceHooks) {
    hooks[h.id] = { status: 'open' }
  }
  const init: StateRecord = { alive_status, hooks, new_hooks: [] }
  await writeState(novelId, init)
  return init
}

export async function applyChapterStateDiff(
  novelId: string,
  chapterNumber: number,
  outline: OutlineRecord,
  characters_appeared: string[],
): Promise<void> {
  const cur = (await readState(novelId)) ?? (await initStateIfMissing(novelId))

  for (const name of characters_appeared) {
    const s = cur.alive_status[name]
    if (s) s.last_seen_chapter = chapterNumber
  }

  for (const dead of outline.planned_state_changes.character_deaths) {
    cur.alive_status[dead] = {
      alive: false,
      last_seen_chapter: chapterNumber,
      death_chapter: chapterNumber,
    }
  }

  for (const id of outline.hooks_to_payoff) {
    if (cur.hooks[id]) {
      cur.hooks[id] = { status: 'paid_off', paid_chapter: chapterNumber }
    } else {
      const nh = cur.new_hooks.find((x) => x.id === id)
      if (nh) {
        nh.status = 'paid_off'
        nh.paid_chapter = chapterNumber
      }
    }
  }

  for (const id of outline.hooks_to_plant) {
    if (cur.hooks[id]) continue
    if (cur.new_hooks.some((x) => x.id === id)) continue
    cur.new_hooks.push({
      id,
      description: '',
      planted_chapter: chapterNumber,
      expected_payoff_chapter: null,
      status: 'open',
    })
  }

  await writeState(novelId, cur)
}
