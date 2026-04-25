import { Hono } from 'hono'
import type {
  ActiveTask,
  AgentEvent,
  AgentSessionInfo,
  BatchJobInfo,
} from '@novel-agent/shared'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { createOutlineAgent } from '../agents/outline-session.js'
import { createWriterAgent } from '../agents/writer-session.js'
import {
  setActiveSession,
  setActiveBatch,
  getActiveTask,
  getSessionEntry,
  getBatchEntry,
  clearActiveTask,
  type SessionEntry,
} from '../agents/registry.js'
import {
  createBatchJob,
  runBatchJob,
  type BatchJob,
  type WorkerFactory,
} from '../agents/batch-job.js'
import { readNovelIndex } from '../storage/novel-index.js'
import {
  missingOutlines,
  outlineExists,
  readChapterDraft,
  readOutline,
} from '../storage/target-reader.js'

const app = new Hono()

// ─── Helpers ─────────────────────────────────────────────────────────────

function sessionToInfo(entry: SessionEntry): AgentSessionInfo {
  return {
    id: entry.id,
    novel_id: entry.novelId,
    role: entry.role,
    mode: entry.mode,
    scope: entry.scope,
    requirement: entry.requirement,
    feedback: entry.feedback,
    created_at: entry.createdAt,
  }
}

function activeTaskPayload(novelId: string): ActiveTask | null {
  const a = getActiveTask(novelId)
  if (!a) return null
  if (a.kind === 'session') {
    return { kind: 'session', session: sessionToInfo(a.entry) }
  }
  // a.kind === 'batch' — get full info from BatchJob via batchesById
  const job = (a.entry.batch as unknown as BatchJob).toInfo
    ? (a.entry.batch as unknown as BatchJob).toInfo()
    : null
  if (!job) return null
  return { kind: 'batch', batch: job }
}

async function validateRange(
  novelId: string,
  from: unknown,
  to: unknown,
): Promise<
  | { ok: true; from: number; to: number }
  | { ok: false; status: 400 | 404; error: string; details?: unknown }
> {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    (from as number) < 1 ||
    (to as number) < (from as number)
  ) {
    return { ok: false, status: 400, error: 'invalid_range' }
  }
  const novel = await readNovelIndex(novelId)
  if (!novel) return { ok: false, status: 404, error: 'novel_not_found' }
  if (novel.analyzed_to < 1) {
    return { ok: false, status: 400, error: 'no_analyzed_chapters' }
  }
  if ((to as number) > novel.analyzed_to) {
    return {
      ok: false,
      status: 400,
      error: 'range_exceeds_analyzed',
      details: { analyzed_to: novel.analyzed_to },
    }
  }
  return { ok: true, from: from as number, to: to as number }
}

function ensureNoActive(novelId: string):
  | { ok: true }
  | { ok: false; payload: { error: string; active: ActiveTask | null } } {
  if (getActiveTask(novelId)) {
    return {
      ok: false,
      payload: { error: 'has_active_session', active: activeTaskPayload(novelId) },
    }
  }
  return { ok: true }
}

// ─── Active task introspection ───────────────────────────────────────────

app.get('/:id/active', (c) => {
  const novelId = c.req.param('id')
  return c.json(activeTaskPayload(novelId))
})

// ─── Outline: start (generate) ───────────────────────────────────────────

app.post('/:id/outline/start', async (c) => {
  const novelId = c.req.param('id')
  const body = await c.req.json<{ from: number; to: number; requirement?: string }>()
  const v = await validateRange(novelId, body.from, body.to)
  if (!v.ok) return c.json({ error: v.error, ...((v.details as object) ?? {}) }, v.status)
  const noActive = ensureNoActive(novelId)
  if (!noActive.ok) return c.json(noActive.payload, 400)

  const session = await createOutlineAgent({
    novelId,
    scope: { from: v.from, to: v.to },
    mode: 'generate',
    requirement: body.requirement,
  })
  const id = setActiveSession({
    novelId,
    role: 'outline',
    mode: 'generate',
    scope: { from: v.from, to: v.to },
    session,
    requirement: body.requirement,
  })
  const info = sessionToInfo(getSessionEntry(id)!)
  return c.json(info)
})

// ─── Outline: revise single chapter ──────────────────────────────────────

app.post('/:id/outline/revise', async (c) => {
  const novelId = c.req.param('id')
  const body = await c.req.json<{ number: number; feedback: string }>()
  if (!Number.isFinite(body.number) || body.number < 1) {
    return c.json({ error: 'invalid_chapter' }, 400)
  }
  if (!body.feedback?.trim()) {
    return c.json({ error: 'empty_feedback' }, 400)
  }
  if (!(await outlineExists(novelId, body.number))) {
    return c.json({ error: 'no_existing_outline' }, 400)
  }
  const noActive = ensureNoActive(novelId)
  if (!noActive.ok) return c.json(noActive.payload, 400)

  const session = await createOutlineAgent({
    novelId,
    scope: { from: body.number, to: body.number },
    mode: 'revise',
    reviseChapter: body.number,
    feedback: body.feedback,
  })
  const id = setActiveSession({
    novelId,
    role: 'outline',
    mode: 'revise',
    scope: { from: body.number, to: body.number },
    session,
    feedback: body.feedback,
  })
  return c.json(sessionToInfo(getSessionEntry(id)!))
})

// ─── Writer: start (batch fan-out) ───────────────────────────────────────

app.post('/:id/writer/start', async (c) => {
  const novelId = c.req.param('id')
  const body = await c.req.json<{ from: number; to: number; requirement?: string }>()
  const v = await validateRange(novelId, body.from, body.to)
  if (!v.ok) return c.json({ error: v.error, ...((v.details as object) ?? {}) }, v.status)
  const missing = await missingOutlines(novelId, v.from, v.to)
  if (missing.length > 0) {
    return c.json({ error: 'missing_outlines', missing }, 400)
  }
  const noActive = ensureNoActive(novelId)
  if (!noActive.ok) return c.json(noActive.payload, 400)

  const chapters: number[] = []
  for (let n = v.from; n <= v.to; n++) chapters.push(n)
  const job = createBatchJob({
    novelId,
    requirement: body.requirement ?? '',
    chapters,
  })
  setActiveBatch({ novelId, batchId: job.id, batch: job })

  // fire-and-forget
  void runBatchJob(job, makeWriterWorkerFactory()).catch((err: unknown) => {
    job.error = err instanceof Error ? err.message : String(err)
    job.status = 'paused'
    job.emit({ type: 'batch.paused', chapter: job.chapters[job.cursor] ?? -1, error: job.error })
  })

  return c.json(job.toInfo())
})

// ─── Writer: revise single chapter ───────────────────────────────────────

app.post('/:id/writer/revise', async (c) => {
  const novelId = c.req.param('id')
  const body = await c.req.json<{ number: number; feedback: string }>()
  if (!Number.isFinite(body.number) || body.number < 1) {
    return c.json({ error: 'invalid_chapter' }, 400)
  }
  if (!body.feedback?.trim()) {
    return c.json({ error: 'empty_feedback' }, 400)
  }
  if (!(await readChapterDraft(novelId, body.number))) {
    return c.json({ error: 'no_existing_draft' }, 400)
  }
  if (!(await readOutline(novelId, body.number))) {
    return c.json({ error: 'no_existing_outline' }, 400)
  }
  const noActive = ensureNoActive(novelId)
  if (!noActive.ok) return c.json(noActive.payload, 400)

  const session = await createWriterAgent({
    novelId,
    chapterNumber: body.number,
    mode: 'revise',
    feedback: body.feedback,
  })
  const id = setActiveSession({
    novelId,
    role: 'writer',
    mode: 'revise',
    scope: { from: body.number, to: body.number },
    session,
    feedback: body.feedback,
  })
  return c.json(sessionToInfo(getSessionEntry(id)!))
})

// ─── Session: send message (chat) — SSE ──────────────────────────────────

app.post('/session/:sid/message', async (c) => {
  const sid = c.req.param('sid')
  const entry = getSessionEntry(sid)
  if (!entry) return c.json({ error: 'session_not_found' }, 404)
  const { content } = await c.req.json<{ content: string }>()
  if (!content?.trim()) return c.json({ error: 'empty_content' }, 400)
  return runWithStream(c.req.raw.signal, entry.session, content)
})

// ─── Session: explicit close ─────────────────────────────────────────────

app.delete('/session/:sid', (c) => {
  const sid = c.req.param('sid')
  const entry = getSessionEntry(sid)
  if (!entry) return c.body(null, 204)
  clearActiveTask(entry.novelId)
  return c.body(null, 204)
})

// ─── Batch: introspect ───────────────────────────────────────────────────

app.get('/job/:jid', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  return c.json((entry.batch as unknown as BatchJob).toInfo())
})

app.delete('/job/:jid', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.body(null, 204)
  clearActiveTask(entry.novelId)
  return c.body(null, 204)
})

app.post('/job/:jid/abort', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  const job = entry.batch as unknown as BatchJob
  job.status = 'aborted'
  job.emit({ type: 'batch.aborted' })
  return c.json(job.toInfo())
})

app.post('/job/:jid/retry', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  const job = entry.batch as unknown as BatchJob
  if (job.status !== 'paused') return c.json({ error: 'not_paused' }, 400)
  job.error = undefined
  job.status = 'running'
  void runBatchJob(job, makeWriterWorkerFactory()).catch((err: unknown) => {
    job.error = err instanceof Error ? err.message : String(err)
    job.status = 'paused'
    job.emit({ type: 'batch.paused', chapter: job.chapters[job.cursor] ?? -1, error: job.error })
  })
  return c.json(job.toInfo())
})

app.post('/job/:jid/skip', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  const job = entry.batch as unknown as BatchJob
  if (job.status !== 'paused') return c.json({ error: 'not_paused' }, 400)
  const ch = job.chapters[job.cursor]
  if (ch !== undefined) job.failed.push(ch)
  job.cursor += 1
  job.error = undefined
  job.status = 'running'
  void runBatchJob(job, makeWriterWorkerFactory()).catch((err: unknown) => {
    job.error = err instanceof Error ? err.message : String(err)
    job.status = 'paused'
    job.emit({ type: 'batch.paused', chapter: job.chapters[job.cursor] ?? -1, error: job.error })
  })
  return c.json(job.toInfo())
})

// ─── Batch: stream SSE ────────────────────────────────────────────────────

app.get('/job/:jid/stream', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  const job = entry.batch as unknown as BatchJob

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      const write = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        } catch {
          /* closed */
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ka)
        try { unsub() } catch { /* ignore */ }
        try { controller.close() } catch { /* ignore */ }
      }
      const unsub = job.subscribe((e) => {
        write(e)
        if (e.type === 'batch.done' || e.type === 'batch.aborted') {
          close()
        }
      })
      const ka = setInterval(() => {
        if (closed) return
        try { controller.enqueue(enc.encode(`: keepalive\n\n`)) } catch { /* closed */ }
      }, 15_000)
      c.req.raw.signal.addEventListener('abort', close)
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

// ─── Worker factory: spawn writer per chapter, forward events to job ──────

function makeWriterWorkerFactory(): WorkerFactory {
  return async ({ novelId, chapter, requirement, emit }) => {
    const session = await createWriterAgent({
      novelId,
      chapterNumber: chapter,
      mode: 'generate',
      requirement,
    })
    const unsub = pipeWorkerEventsToJob(session, emit)
    try {
      await session.sendUserMessage(`开始写第 ${chapter} 章。`)
      await waitForAgentEnd(session)
    } finally {
      unsub()
    }
    return { dispose: () => session.dispose() }
  }
}

function pipeWorkerEventsToJob(
  session: AgentSession,
  emit: (e: AgentEvent) => void,
): () => void {
  return session.subscribe((evt) => {
    switch (evt.type) {
      case 'message_update': {
        const inner = evt.assistantMessageEvent
        if (inner.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
          emit({ type: 'message.delta', content: inner.delta })
        }
        return
      }
      case 'message_end': {
        const msg = evt.message
        if (msg && msg.role === 'assistant') {
          const textParts: string[] = []
          for (const block of msg.content ?? []) {
            if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
              const t = (block as { text?: unknown }).text
              if (typeof t === 'string') textParts.push(t)
            }
          }
          const full = textParts.join('')
          if (full.length > 0) emit({ type: 'message.complete', content: full })
        }
        return
      }
      case 'tool_execution_start': {
        emit({ type: 'tool.call', name: evt.toolName, params: evt.args })
        return
      }
      case 'tool_execution_end': {
        emit({ type: 'tool.result', name: evt.toolName, result: evt.result })
        return
      }
      default:
        return
    }
  })
}

function waitForAgentEnd(session: AgentSession): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      try { unsub() } catch { /* ignore */ }
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    const unsub = session.subscribe((evt) => {
      if (evt.type === 'agent_end') {
        finish()
        return
      }
      // SDK error events — settle so the worker loop can transition to paused
      // Different SDK versions name this differently; cover the obvious shapes.
      const t = (evt as { type?: string }).type
      if (t === 'error' || t === 'agent_error') {
        const msg = (evt as { error?: { message?: string }; message?: string }).error?.message
          ?? (evt as { message?: string }).message
          ?? `agent error: ${t}`
        finish(new Error(msg))
      }
    })
    const timer = setTimeout(() => {
      finish(new Error('waitForAgentEnd timeout (15 min)'))
    }, 15 * 60 * 1000)
  })
}

// ─── SSE: chat session run ───────────────────────────────────────────────

function runWithStream(
  abortSignal: AbortSignal,
  session: AgentSession,
  userText: string,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      const write = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        } catch {
          /* closed */
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ka)
        try { unsubscribe() } catch { /* ignore */ }
        try { controller.close() } catch { /* ignore */ }
      }
      const unsubscribe = subscribeChatSession(session, write, close)
      const ka = setInterval(() => {
        if (closed) return
        try { controller.enqueue(enc.encode(`: keepalive\n\n`)) } catch { /* closed */ }
      }, 15_000)
      abortSignal.addEventListener('abort', close)
      session.sendUserMessage(userText).catch((err: unknown) => {
        write({ type: 'error', message: (err as Error).message ?? String(err) })
        close()
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
}

function subscribeChatSession(
  session: AgentSession,
  write: (event: AgentEvent) => void,
  close: () => void,
): () => void {
  return session.subscribe((evt) => {
    switch (evt.type) {
      case 'message_update': {
        const inner = evt.assistantMessageEvent
        if (inner.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
          write({ type: 'message.delta', content: inner.delta })
        }
        return
      }
      case 'message_end': {
        const msg = evt.message
        if (msg && msg.role === 'assistant') {
          const textParts: string[] = []
          for (const block of msg.content ?? []) {
            if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
              const t = (block as { text?: unknown }).text
              if (typeof t === 'string') textParts.push(t)
            }
          }
          const full = textParts.join('')
          if (full.length > 0) write({ type: 'message.complete', content: full })
        }
        return
      }
      case 'tool_execution_start': {
        write({ type: 'tool.call', name: evt.toolName, params: evt.args })
        return
      }
      case 'tool_execution_end': {
        write({ type: 'tool.result', name: evt.toolName, result: evt.result })
        return
      }
      case 'agent_end': {
        write({ type: 'done' })
        close()
        return
      }
      default: {
        const t = (evt as { type?: string }).type
        if (t === 'error' || t === 'agent_error') {
          const msg =
            (evt as { error?: { message?: string }; message?: string }).error?.message ??
            (evt as { message?: string }).message ??
            `agent error: ${t}`
          write({ type: 'error', message: msg })
          close()
        }
        return
      }
    }
  })
}

export { app as agentRoutes }
