import type {
  Novel,
  Chapter,
  Character,
  Subplot,
  Hook,
  MapsRecord,
  OutlineRecord,
  ChapterDraftRecord,
  ChapterDraftSummary,
  StateRecord,
} from '@novel-agent/shared'

export type ChapterListItem = Pick<
  Chapter,
  | 'id'
  | 'novel_id'
  | 'number'
  | 'title'
  | 'summary'
  | 'plot_functions'
  | 'originality_risks'
  | 'dramatic_beat_blueprint'
>

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try {
      const body = (await r.json()) as { message?: string; error?: string }
      msg = body.message || body.error || msg
    } catch {
      /* noop */
    }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export const api = {
  listNovels: () => fetch('/api/novel').then(j<Novel[]>),
  getNovel: (id: string) => fetch(`/api/novel/${id}`).then(j<Novel>),
  deleteNovel: (id: string) => fetch(`/api/novel/${id}`, { method: 'DELETE' }),
  uploadNovel: (file: File, title: string, chapterCount: number) => {
    const fd = new FormData()
    fd.append('file', file)
    if (title) fd.append('title', title)
    fd.append('chapter_count', String(chapterCount))
    return fetch('/api/novel', { method: 'POST', body: fd }).then(j<Novel>)
  },
  continueAnalysis: (id: string, more: number) =>
    fetch(`/api/novel/${id}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ more }),
    }).then(j<{ id: string; analysis_from: number; analysis_to: number }>),
  reaggregate: (id: string) =>
    fetch(`/api/novel/${id}/reaggregate`, { method: 'POST' }).then(
      j<{ id: string }>,
    ),
  listChapters: (id: string) =>
    fetch(`/api/novel/${id}/chapters`).then(j<ChapterListItem[]>),
  getChapter: (id: string, num: number) =>
    fetch(`/api/novel/${id}/chapters/${num}`).then(j<Chapter>),
  listCharacters: (id: string) =>
    fetch(`/api/novel/${id}/characters`).then(j<Character[]>),
  listSubplots: (id: string) =>
    fetch(`/api/novel/${id}/subplots`).then(j<Subplot[]>),
  listHooks: (id: string) => fetch(`/api/novel/${id}/hooks`).then(j<Hook[]>),
  deleteHook: (novelId: string, hookId: number) =>
    fetch(`/api/novel/${novelId}/hooks/${hookId}`, { method: 'DELETE' }),
  getMaps: (id: string) =>
    fetch(`/api/novel/${id}/maps`).then(j<MapsRecord | null>),
  listOutlines: (id: string) =>
    fetch(`/api/novel/${id}/outlines`).then(j<OutlineRecord[]>),
  getOutline: (id: string, n: number) =>
    fetch(`/api/novel/${id}/outlines/${n}`).then(j<OutlineRecord>),
  deleteOutlinesFrom: (id: string, n: number) =>
    fetch(`/api/novel/${id}/outlines/${n}`, { method: 'DELETE' }).then(
      j<{ deletedOutlines: number[]; deletedDrafts: number[] }>,
    ),
  listDrafts: (id: string) =>
    fetch(`/api/novel/${id}/drafts`).then(j<ChapterDraftSummary[]>),
  getDraft: (id: string, n: number) =>
    fetch(`/api/novel/${id}/drafts/${n}`).then(j<ChapterDraftRecord>),
  deleteDraftsFrom: (id: string, n: number) =>
    fetch(`/api/novel/${id}/drafts/${n}`, { method: 'DELETE' }).then(
      j<{ deletedDrafts: number[] }>,
    ),
  getState: (id: string) =>
    fetch(`/api/novel/${id}/state`).then(j<StateRecord | null>),
}
