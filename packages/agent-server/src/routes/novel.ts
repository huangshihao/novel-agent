import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { AnalysisEvent } from '@novel-agent/shared'
import { splitChapters } from '../chapter-splitter.js'
import { startAnalysis, reaggregate } from '../analyzer.js'
import { getBus } from '../event-bus.js'
import {
  listNovelIndices,
  readNovelIndex,
  writeNovelIndex,
  updateNovelIndex,
} from '../storage/novel-index.js'
import {
  listSourceChaptersFull,
  readSourceChapterFull,
  listSourceCharacters,
  readSourceSubplots,
  readSourceHooks,
} from '../storage/source-reader.js'
import {
  listChapterDrafts,
  listOutlines,
  readChapterDraft,
  readMaps,
  readOutline,
} from '../storage/target-reader.js'
import { deleteDraftsFrom, deleteOutlinesFrom } from '../storage/target-delete.js'
import { readState } from '../storage/state.js'
import { paths } from '../storage/paths.js'
import { readChapterRaw, writeChapterRaw } from '../storage/chapter-internal-store.js'

const app = new Hono()

// ─── List / detail / delete ─────────────────────────────────────────────

app.get('/', async (c) => {
  const novels = await listNovelIndices()
  novels.sort((a, b) => b.created_at - a.created_at)
  return c.json(novels)
})

app.get('/:id', async (c) => {
  const novel = await readNovelIndex(c.req.param('id'))
  if (!novel) return c.json({ error: 'not_found' }, 404)
  return c.json(novel)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await rm(paths.novel(id), { recursive: true, force: true })
  return c.body(null, 204)
})

// ─── Upload ──────────────────────────────────────────────────────────────

function parseIntField(v: unknown, fallback: number): number {
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}

app.post('/', async (c) => {
  const form = await c.req.parseBody()
  const file = form['file']
  const providedTitle = typeof form['title'] === 'string' ? form['title'].trim() : ''

  if (!(file instanceof File)) {
    return c.json({ error: 'file is required (multipart field "file")' }, 400)
  }

  const text = await file.text()
  const chapters = splitChapters(text)
  if (chapters.length === 0) {
    return c.json(
      { error: 'no_chapters_detected', message: '未能识别到任何章节。目前仅支持"第X章"格式的中文小说。' },
      400,
    )
  }

  const requestedCount = parseIntField(form['chapter_count'] ?? form['analysis_to'], 100)
  if (requestedCount < 1) {
    return c.json({ error: 'invalid_range', message: '分析章数必须 ≥ 1' }, 400)
  }
  const to = Math.min(requestedCount, chapters.length)
  const from = 1

  const id = `nv-${randomUUID().slice(0, 8)}`
  const title = providedTitle || file.name.replace(/\.(txt|TXT)$/, '').trim() || '未命名小说'
  const now = Date.now()

  for (const ch of chapters) {
    writeChapterRaw(id, ch.number, ch.content)
  }

  await writeNovelIndex({
    id,
    title,
    status: 'splitting',
    chapter_count: chapters.length,
    analyzed_count: 0,
    analysis_from: from,
    analysis_to: to,
    analyzed_to: 0,
    error: null,
    created_at: now,
    updated_at: now,
  })

  startAnalysis(id, { from, to })
  return c.json(await readNovelIndex(id))
})

// ─── Chapters ────────────────────────────────────────────────────────────

app.get('/:id/chapters', async (c) => {
  const id = c.req.param('id')
  const list = await listSourceChaptersFull(id)
  return c.json(
    list.map((ch) => ({
      id: ch.number,
      novel_id: id,
      number: ch.number,
      title: ch.title,
      summary: ch.summary,
      plot_functions: ch.plot_functions,
      originality_risks: ch.originality_risks,
      dramatic_beat_blueprint: ch.dramatic_beat_blueprint,
    })),
  )
})

app.get('/:id/chapters/:n', async (c) => {
  const id = c.req.param('id')
  const n = Number(c.req.param('n'))
  if (!Number.isFinite(n) || n < 1) {
    return c.json({ error: 'invalid_chapter' }, 400)
  }
  const ch = await readSourceChapterFull(id, n)
  if (!ch) return c.json({ error: 'not_found' }, 404)
  const raw = readChapterRaw(id, n)
  return c.json({
    id: n,
    novel_id: id,
    number: n,
    title: ch.title,
    original_text: raw,
    summary: ch.summary,
    plot_functions: ch.plot_functions,
    key_events: ch.key_events,
    originality_risks: ch.originality_risks,
    writing_rhythm: ch.writing_rhythm,
    dramatic_beat_blueprint: ch.dramatic_beat_blueprint,
  })
})

// ─── Characters / Subplots / Hooks ───────────────────────────────────────

app.get('/:id/characters', async (c) => {
  const id = c.req.param('id')
  const chars = await listSourceCharacters(id)
  return c.json(
    chars.map((ch, i) => ({
      id: i + 1,
      novel_id: id,
      name: ch.canonical_name,
      aliases: ch.aliases,
      role: ch.role,
      function_tags: ch.function_tags,
      story_function: ch.story_function,
      replaceability: ch.replaceability,
      death_chapter: ch.death_chapter,
      description: ch.description,
      first_chapter: ch.first_chapter,
      last_chapter: ch.last_chapter,
    })),
  )
})

app.get('/:id/subplots', async (c) => {
  const id = c.req.param('id')
  const subs = await readSourceSubplots(id)
  return c.json(
    subs.map((sp, i) => ({
      id: i + 1,
      novel_id: id,
      name: sp.name,
      function: sp.function,
      delivers: sp.delivers,
      depends_on: sp.depends_on,
      reorderable: sp.reorderable,
      description: sp.description,
      start_chapter: sp.chapters[0] ?? 0,
      end_chapter: sp.chapters[sp.chapters.length - 1] ?? 0,
      chapters: sp.chapters,
    })),
  )
})

app.get('/:id/hooks', async (c) => {
  const id = c.req.param('id')
  const hooks = await readSourceHooks(id)
  return c.json(
    hooks.map((h, i) => ({
      id: i + 1,
      novel_id: id,
      description: h.description,
      category: h.category,
      planted_chapter: h.planted_chapter,
      payoff_chapter: h.payoff_chapter,
      evidence_chapters: h.evidence_chapters,
    })),
  )
})

app.delete('/:id/hooks/:hookId', (c) => {
  return c.json({ error: 'not_implemented_v1', message: '当前不支持单条删除 hook' }, 501)
})

// ─── Continue / Reaggregate ──────────────────────────────────────────────

app.post('/:id/continue', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ more?: number }>().catch(() => ({ more: undefined }))
  const more = Number(body?.more ?? 0)
  if (!Number.isFinite(more) || more < 1) {
    return c.json({ error: 'invalid_more' }, 400)
  }
  const cur = await readNovelIndex(id)
  if (!cur) return c.json({ error: 'not_found' }, 404)
  const from = cur.analyzed_to + 1
  const to = Math.min(cur.analyzed_to + more, cur.chapter_count)
  if (from > cur.chapter_count) {
    return c.json({ error: 'already_complete' }, 400)
  }
  await updateNovelIndex(id, { analysis_from: from, analysis_to: to })
  startAnalysis(id, { from, to })
  return c.json({ id, analysis_from: from, analysis_to: to })
})

app.post('/:id/reaggregate', (c) => {
  const id = c.req.param('id')
  reaggregate(id)
  return c.json({ id })
})

// ─── Maps / Outlines / Drafts / State ───────────────────────────────────

app.get('/:id/maps', async (c) => c.json(await readMaps(c.req.param('id'))))

app.get('/:id/state', async (c) => c.json(await readState(c.req.param('id'))))

app.get('/:id/outlines', async (c) => c.json(await listOutlines(c.req.param('id'))))

app.get('/:id/outlines/:n', async (c) => {
  const o = await readOutline(c.req.param('id'), Number(c.req.param('n')))
  return o ? c.json(o) : c.json({ error: 'not_found' }, 404)
})

app.delete('/:id/outlines/:n', async (c) => {
  const n = Number(c.req.param('n'))
  if (!Number.isInteger(n) || n < 1) {
    return c.json({ error: 'invalid_chapter' }, 400)
  }
  return c.json(await deleteOutlinesFrom(c.req.param('id'), n))
})

app.get('/:id/drafts', async (c) => {
  const list = await listChapterDrafts(c.req.param('id'))
  return c.json(list.map(({ content: _content, ...rest }) => rest))
})

app.get('/:id/drafts/:n', async (c) => {
  const d = await readChapterDraft(c.req.param('id'), Number(c.req.param('n')))
  return d ? c.json(d) : c.json({ error: 'not_found' }, 404)
})

app.delete('/:id/drafts/:n', async (c) => {
  const n = Number(c.req.param('n'))
  if (!Number.isInteger(n) || n < 1) {
    return c.json({ error: 'invalid_chapter' }, 400)
  }
  return c.json(await deleteDraftsFrom(c.req.param('id'), n))
})

// ─── SSE ─────────────────────────────────────────────────────────────────

app.get('/:id/events', (c) => {
  const id = c.req.param('id')
  const bus = getBus(id)
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const send = (event: AnalysisEvent) => {
        controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
      }
      const listener = (event: AnalysisEvent) => send(event)
      bus.on('event', listener)
      const ka = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: keepalive\n\n`))
        } catch {
          /* closed */
        }
      }, 15_000)
      c.req.raw.signal.addEventListener('abort', () => {
        bus.off('event', listener)
        clearInterval(ka)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      })
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

export { app as novelRoutes }
