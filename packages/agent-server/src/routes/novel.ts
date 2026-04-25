import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { AnalysisEvent } from '@novel-agent/shared'
import { db } from '../db.js'
import { splitChapters } from '../chapter-splitter.js'
import { startAnalysis, reaggregate } from '../analyzer.js'
import { getBus } from '../event-bus.js'

const app = new Hono()

// ─── List / detail ─────────────────────────────────────────────────────────

const NOVEL_COLS = `id, title, status, chapter_count, analyzed_count,
  analysis_from, analysis_to, analyzed_to, error, created_at, updated_at`

app.get('/', (c) => {
  const rows = db
    .prepare(`SELECT ${NOVEL_COLS} FROM novel ORDER BY created_at DESC`)
    .all()
  return c.json(rows)
})

app.get('/:id', (c) => {
  const row = db
    .prepare(`SELECT ${NOVEL_COLS} FROM novel WHERE id = ?`)
    .get(c.req.param('id'))
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(row)
})

app.delete('/:id', (c) => {
  db.prepare(`DELETE FROM novel WHERE id = ?`).run(c.req.param('id'))
  return c.body(null, 204)
})

// ─── Upload ────────────────────────────────────────────────────────────────

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
      {
        error: 'no_chapters_detected',
        message: '未能识别到任何章节。目前仅支持"第X章"格式的中文小说。',
      },
      400,
    )
  }

  // 新接口：前端传 chapter_count（本次要分析多少章）。兼容旧的 analysis_to。
  const requestedCount = parseIntField(
    form['chapter_count'] ?? form['analysis_to'],
    100,
  )
  if (requestedCount < 1) {
    return c.json({ error: 'invalid_range', message: '分析章数必须 ≥ 1' }, 400)
  }
  const to = Math.min(requestedCount, chapters.length)
  const from = 1

  const id = `nv-${randomUUID().slice(0, 8)}`
  const title =
    providedTitle || file.name.replace(/\.(txt|TXT)$/, '').trim() || '未命名小说'
  const now = Date.now()

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO novel
       (id, title, status, chapter_count, analyzed_count, analysis_from, analysis_to, analyzed_to, created_at, updated_at)
       VALUES (?, ?, 'splitting', ?, 0, ?, ?, 0, ?, ?)`,
    ).run(id, title, chapters.length, from, to, now, now)

    const ins = db.prepare(
      `INSERT INTO chapter (novel_id, number, title, original_text) VALUES (?, ?, ?, ?)`,
    )
    for (const c of chapters) {
      ins.run(id, c.number, c.title, c.content)
    }
  })
  tx()

  startAnalysis(id)

  return c.json(
    {
      id,
      title,
      status: 'analyzing' as const,
      chapter_count: chapters.length,
      analyzed_count: 0,
      analysis_from: from,
      analysis_to: to,
      analyzed_to: 0,
    },
    201,
  )
})

// ─── Reaggregate (仅重跑 pass 2，不重新抽取) ────────────────────────────
app.post('/:id/reaggregate', (c) => {
  const novelId = c.req.param('id')
  const novel = db
    .prepare(`SELECT status FROM novel WHERE id = ?`)
    .get(novelId) as { status: string } | undefined
  if (!novel) return c.json({ error: 'not_found' }, 404)
  if (novel.status === 'analyzing' || novel.status === 'splitting') {
    return c.json({ error: 'busy', message: '当前正在分析中' }, 409)
  }
  // 同步翻状态，避免 UI 立刻刷新读到旧值
  db.prepare(
    `UPDATE novel SET status = 'analyzing', error = NULL, updated_at = ? WHERE id = ?`,
  ).run(Date.now(), novelId)
  reaggregate(novelId)
  return c.json({ id: novelId })
})

// ─── Continue analysis (incremental) ─────────────────────────────────────
app.post('/:id/continue', async (c) => {
  const novelId = c.req.param('id')
  const novel = db
    .prepare(
      `SELECT id, status, chapter_count, analyzed_to FROM novel WHERE id = ?`,
    )
    .get(novelId) as
    | { id: string; status: string; chapter_count: number; analyzed_to: number }
    | undefined
  if (!novel) return c.json({ error: 'not_found' }, 404)
  if (novel.status === 'analyzing' || novel.status === 'splitting') {
    return c.json({ error: 'busy', message: '当前正在分析中' }, 409)
  }

  let more = 50
  try {
    const body = (await c.req.json()) as { more?: unknown }
    if (body && typeof body.more !== 'undefined') {
      const n = Number(body.more)
      if (Number.isFinite(n) && Number.isInteger(n) && n > 0) more = n
    }
  } catch {
    /* 空 body 就用默认值 */
  }

  if (novel.analyzed_to >= novel.chapter_count) {
    return c.json(
      { error: 'already_done', message: '所有章节都已分析完毕' },
      400,
    )
  }

  const from = novel.analyzed_to + 1
  const to = Math.min(novel.analyzed_to + more, novel.chapter_count)

  // 同步写入新 run 范围并翻状态，避免 UI 立即刷新时读到旧值
  db.prepare(
    `UPDATE novel SET analysis_from = ?, analysis_to = ?, analyzed_count = 0, status = 'analyzing', error = NULL, updated_at = ? WHERE id = ?`,
  ).run(from, to, Date.now(), novelId)

  startAnalysis(novelId, { from, to })

  return c.json({ id: novelId, analysis_from: from, analysis_to: to })
})

function parseIntField(v: unknown, fallback: number): number {
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n) && Number.isInteger(n)) return n
  }
  return fallback
}

// ─── Sub-resources ─────────────────────────────────────────────────────────

app.get('/:id/chapters', (c) => {
  const rows = db
    .prepare(
      `SELECT id, novel_id, number, title, summary
       FROM chapter WHERE novel_id = ? ORDER BY number`,
    )
    .all(c.req.param('id'))
  return c.json(rows)
})

app.get('/:id/chapters/:num', (c) => {
  const row = db
    .prepare(
      `SELECT id, novel_id, number, title, original_text, summary
       FROM chapter WHERE novel_id = ? AND number = ?`,
    )
    .get(c.req.param('id'), Number(c.req.param('num')))
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(row)
})

app.get('/:id/characters', (c) => {
  const rows = db
    .prepare(
      `SELECT id, novel_id, name, aliases_json, description, first_chapter, last_chapter
       FROM character WHERE novel_id = ? ORDER BY first_chapter, id`,
    )
    .all(c.req.param('id')) as {
    id: number
    novel_id: string
    name: string
    aliases_json: string
    description: string
    first_chapter: number
    last_chapter: number
  }[]

  return c.json(
    rows.map((r) => ({
      id: r.id,
      novel_id: r.novel_id,
      name: r.name,
      aliases: safeParseArray<string>(r.aliases_json),
      description: r.description,
      first_chapter: r.first_chapter,
      last_chapter: r.last_chapter,
    })),
  )
})

app.get('/:id/subplots', (c) => {
  const novelId = c.req.param('id')
  const subs = db
    .prepare(
      `SELECT s.id, s.novel_id, s.name, s.description, s.start_chapter, s.end_chapter
       FROM subplot s WHERE s.novel_id = ? ORDER BY s.start_chapter, s.id`,
    )
    .all(novelId) as {
    id: number
    novel_id: string
    name: string
    description: string
    start_chapter: number
    end_chapter: number
  }[]

  const chs = db.prepare(
    `SELECT sc.subplot_id, c.number
     FROM subplot_chapter sc
     JOIN chapter c ON c.id = sc.chapter_id
     WHERE c.novel_id = ?`,
  ).all(novelId) as { subplot_id: number; number: number }[]

  const bySubplot = new Map<number, number[]>()
  for (const r of chs) {
    const arr = bySubplot.get(r.subplot_id) ?? []
    arr.push(r.number)
    bySubplot.set(r.subplot_id, arr)
  }

  return c.json(
    subs.map((s) => ({
      ...s,
      chapters: (bySubplot.get(s.id) ?? []).sort((a, b) => a - b),
    })),
  )
})

app.get('/:id/hooks', (c) => {
  const rows = db
    .prepare(
      `SELECT id, novel_id, description, type, category, planted_chapter, payoff_chapter, evidence_chapters_json
       FROM hook WHERE novel_id = ? ORDER BY planted_chapter, id`,
    )
    .all(c.req.param('id')) as {
    id: number
    novel_id: string
    description: string
    type: string
    category: string | null
    planted_chapter: number
    payoff_chapter: number | null
    evidence_chapters_json: string
  }[]
  return c.json(
    rows.map((r) => ({
      id: r.id,
      novel_id: r.novel_id,
      description: r.description,
      type: r.type,
      category: r.category,
      planted_chapter: r.planted_chapter,
      payoff_chapter: r.payoff_chapter,
      evidence_chapters: safeParseArray<number>(r.evidence_chapters_json),
    })),
  )
})

app.delete('/:id/hooks/:hookId', (c) => {
  const novelId = c.req.param('id')
  const hookId = Number(c.req.param('hookId'))
  if (!Number.isFinite(hookId)) return c.json({ error: 'invalid_id' }, 400)
  const info = db
    .prepare(`DELETE FROM hook WHERE id = ? AND novel_id = ?`)
    .run(hookId, novelId)
  if (info.changes === 0) return c.json({ error: 'not_found' }, 404)
  return c.body(null, 204)
})

// ─── SSE: analysis progress ────────────────────────────────────────────────

app.get('/:id/events', (c) => {
  const novelId = c.req.param('id')

  const novel = db
    .prepare(
      `SELECT status, chapter_count, analyzed_count, analysis_from, analysis_to FROM novel WHERE id = ?`,
    )
    .get(novelId) as
    | {
        status: string
        chapter_count: number
        analyzed_count: number
        analysis_from: number
        analysis_to: number
      }
    | undefined

  if (!novel) return c.json({ error: 'not_found' }, 404)

  // 范围内实际有多少章
  const rangeTotal = (
    db.prepare(
      `SELECT COUNT(*) AS n FROM chapter WHERE novel_id = ? AND number BETWEEN ? AND ?`,
    ).get(novelId, novel.analysis_from, novel.analysis_to) as { n: number }
  ).n

  const bus = getBus(novelId)

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (event: AnalysisEvent) => {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          )
        }

        // 先发一条当前状态快照（让断线重连的客户端立刻对齐）
        send({ type: 'status', status: novel.status as never })
        send({
          type: 'analyze.progress',
          analyzed: novel.analyzed_count,
          total: rangeTotal,
        })

        const listener = (event: AnalysisEvent) => send(event)
        bus.on('event', listener)

        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: keepalive\n\n`))
          } catch {
            /* closed */
          }
        }, 15_000)
        // 不让 keepalive 把 event loop 撑住，阻碍进程退出
        keepalive.unref()

        c.req.raw.signal.addEventListener('abort', () => {
          bus.off('event', listener)
          clearInterval(keepalive)
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        })
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    },
  )
})

// ─── utils ────────────────────────────────────────────────────────────────

function safeParseArray<T>(json: string): T[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

export { app as novelRoutes }
