import { Hono } from 'hono'
import type { AgentEvent, AgentSessionInfo } from '@novel-agent/shared'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { createOutlineAgent } from '../agents/outline-session.js'
import { createWriterAgent } from '../agents/writer-session.js'
import {
  registerSession,
  getSession,
  removeSession,
  listSessionsByNovel,
} from '../agents/registry.js'
import { readNovelIndex } from '../storage/novel-index.js'

const app = new Hono()

async function validateBatch(
  novelId: string,
  from: unknown,
  to: unknown,
): Promise<{ ok: true; from: number; to: number } | { ok: false; status: 400 | 404; error: string; analyzed_to?: number }> {
  if (!Number.isFinite(from) || !Number.isFinite(to) || (from as number) < 1 || (to as number) < (from as number)) {
    return { ok: false, status: 400, error: 'invalid_range' }
  }
  const novel = await readNovelIndex(novelId)
  if (!novel) return { ok: false, status: 404, error: 'novel_not_found' }
  if (novel.analyzed_to < 1) {
    return { ok: false, status: 400, error: 'no_analyzed_chapters', analyzed_to: 0 }
  }
  if ((to as number) > novel.analyzed_to) {
    return { ok: false, status: 400, error: 'range_exceeds_analyzed', analyzed_to: novel.analyzed_to }
  }
  return { ok: true, from: from as number, to: to as number }
}

// ─── Start sessions ──────────────────────────────────────────────────────

app.post('/:id/outline/start', async (c) => {
  const novelId = c.req.param('id')
  const { from, to } = await c.req.json<{ from: number; to: number }>()
  const v = await validateBatch(novelId, from, to)
  if (!v.ok) return c.json({ error: v.error, analyzed_to: v.analyzed_to }, v.status)
  const session = await createOutlineAgent({ novelId, batch: { from: v.from, to: v.to } })
  const sessionId = registerSession({ novelId, role: 'outline', batch: { from: v.from, to: v.to }, session })
  const info: AgentSessionInfo = {
    id: sessionId,
    role: 'outline',
    batch: { from: v.from, to: v.to },
    created_at: Date.now(),
  }
  return c.json(info)
})

app.post('/:id/writer/start', async (c) => {
  const novelId = c.req.param('id')
  const { from, to } = await c.req.json<{ from: number; to: number }>()
  const v = await validateBatch(novelId, from, to)
  if (!v.ok) return c.json({ error: v.error, analyzed_to: v.analyzed_to }, v.status)
  const session = await createWriterAgent({ novelId, batch: { from: v.from, to: v.to } })
  const sessionId = registerSession({ novelId, role: 'writer', batch: { from: v.from, to: v.to }, session })
  const info: AgentSessionInfo = {
    id: sessionId,
    role: 'writer',
    batch: { from: v.from, to: v.to },
    created_at: Date.now(),
  }
  return c.json(info)
})

// ─── List / delete sessions ──────────────────────────────────────────────

app.get('/:id/sessions', (c) => {
  const novelId = c.req.param('id')
  const list: AgentSessionInfo[] = listSessionsByNovel(novelId).map(({ id, entry }) => ({
    id,
    role: entry.role,
    batch: entry.batch,
    created_at: entry.createdAt,
  }))
  return c.json(list)
})

app.delete('/session/:sid', (c) => {
  const sid = c.req.param('sid')
  const entry = getSession(sid)
  if (entry) {
    try {
      entry.session.dispose()
    } catch {
      /* ignore */
    }
  }
  removeSession(sid)
  return c.body(null, 204)
})

// ─── Send message / autonomous run (both stream SSE) ─────────────────────

app.post('/session/:sid/message', async (c) => {
  const sid = c.req.param('sid')
  const entry = getSession(sid)
  if (!entry) return c.json({ error: 'session_not_found' }, 404)
  const { content } = await c.req.json<{ content: string }>()
  return runWithStream(c.req.raw.signal, entry.session, content)
})

app.post('/session/:sid/run', async (c) => {
  const sid = c.req.param('sid')
  const entry = getSession(sid)
  if (!entry) return c.json({ error: 'session_not_found' }, 404)
  const promptText =
    entry.role === 'outline'
      ? `开始为本批（第 ${entry.batch.from}-${entry.batch.to} 章）生成大纲。先按 system prompt 中的工作流执行。`
      : `开始为本批（第 ${entry.batch.from}-${entry.batch.to} 章）写正文。逐章 getChapterContext → writeChapter。`
  return runWithStream(c.req.raw.signal, entry.session, promptText)
})

// ─── Streaming helper ────────────────────────────────────────────────────

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
          controller.enqueue(
            enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          )
        } catch {
          /* closed */
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ka)
        try {
          unsubscribe()
        } catch {
          /* ignore */
        }
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      const unsubscribe = subscribeAndPipe(session, write, close)

      const ka = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`: keepalive\n\n`))
        } catch {
          /* closed */
        }
      }, 15_000)

      abortSignal.addEventListener('abort', () => {
        close()
      })

      // Fire the user message; wait for the agent's turn(s) to complete.
      // sendUserMessage resolves when the message has been queued/started — actual
      // completion is signaled via the `agent_end` event which triggers a `done`
      // SSE event and closes the stream in subscribeAndPipe.
      session
        .sendUserMessage(userText)
        .catch((err: unknown) => {
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

// Translate pi-coding-agent / pi-agent-core events into the shared AgentEvent
// SSE protocol consumed by the web client's useAgentStream hook.
//
// SDK API (verified against AgentSession.d.ts + pi-agent-core types.d.ts):
//   - session.subscribe(listener: (AgentSessionEvent) => void): () => void
//   - session.sendUserMessage(content): Promise<void>
//   - native event types: agent_start | agent_end | turn_start | turn_end |
//       message_start | message_update | message_end |
//       tool_execution_start | tool_execution_update | tool_execution_end
//   - `message_update` carries `assistantMessageEvent` from pi-ai with
//       text_delta / toolcall_delta / etc.
function subscribeAndPipe(
  session: AgentSession,
  write: (event: AgentEvent) => void,
  close: () => void,
): () => void {
  const unsub = session.subscribe((evt) => {
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
          if (full.length > 0) {
            write({ type: 'message.complete', content: full })
          }
        }
        return
      }
      case 'tool_execution_start': {
        write({
          type: 'tool.call',
          name: evt.toolName,
          params: evt.args,
        })
        return
      }
      case 'tool_execution_end': {
        write({
          type: 'tool.result',
          name: evt.toolName,
          result: evt.result,
        })
        return
      }
      case 'agent_end': {
        write({ type: 'done' })
        close()
        return
      }
      default:
        return
    }
  })
  return unsub
}

export { app as agentRoutes }
