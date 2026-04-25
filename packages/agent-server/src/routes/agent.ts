import { Hono } from 'hono'
import type { AgentEvent, ChatInfo } from '@novel-agent/shared'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { createChatAgent } from '../agents/chat-session.js'
import {
  claimChat,
  releaseChat,
  getActiveChat,
  getChatEntry,
  setStreaming,
  setStreamCloser,
  type ChatEntry,
} from '../agents/registry.js'
import {
  createChat,
  listChats,
  getChat,
  updateChatTitle,
  touchChatLastMsg,
  deleteChat as deleteChatStorage,
} from '../storage/chat-store.js'
import { loadChatHistoryForUi } from '../storage/chat-history.js'
import { readNovelIndex } from '../storage/novel-index.js'
import { generateChatTitle } from '../lib/title-generator.js'

const app = new Hono()

// ───── Active chat ─────────────────────────────────────────────────────────

app.get('/:id/active', (c) => {
  const novelId = c.req.param('id')
  return c.json(getActiveChat(novelId))
})

// ───── Chat CRUD ───────────────────────────────────────────────────────────

app.get('/:id/chats', async (c) => {
  const novelId = c.req.param('id')
  const novel = await readNovelIndex(novelId)
  if (!novel) return c.json({ error: 'novel_not_found' }, 404)
  return c.json(await listChats(novelId))
})

app.post('/:id/chats', async (c) => {
  const novelId = c.req.param('id')
  const novel = await readNovelIndex(novelId)
  if (!novel) return c.json({ error: 'novel_not_found' }, 404)
  let title: string | undefined
  try {
    const body = await c.req.json<{ title?: string }>()
    title = body.title
  } catch { /* empty body OK */ }
  const chat = await createChat(novelId, title)
  return c.json(chat, 201)
})

app.get('/:id/chats/:cid', async (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')
  const chat = await getChat(novelId, chatId)
  if (!chat) return c.json({ error: 'chat_not_found' }, 404)
  const messages = await loadChatHistoryForUi(novelId, chatId)
  return c.json({ chat, messages })
})

app.patch('/:id/chats/:cid', async (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')
  const body = await c.req.json<{ title?: string }>()
  if (!body.title?.trim()) return c.json({ error: 'invalid_title' }, 400)
  const updated = await updateChatTitle(novelId, chatId, body.title.trim())
  if (!updated) return c.json({ error: 'chat_not_found' }, 404)
  return c.json(updated)
})

app.delete('/:id/chats/:cid', async (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')
  const active = getActiveChat(novelId)
  if (active?.chatId === chatId) releaseChat(novelId)
  await deleteChatStorage(novelId, chatId)
  return c.body(null, 204)
})

// ───── Send message (SSE) ──────────────────────────────────────────────────

app.post('/:id/chats/:cid/message', async (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')

  const chat = await getChat(novelId, chatId)
  if (!chat) return c.json({ error: 'chat_not_found' }, 404)

  // active 锁判断
  const active = getActiveChat(novelId)
  if (active && active.chatId !== chatId) {
    return c.json({ error: 'another_chat_running', activeChatId: active.chatId }, 409)
  }
  const existing = active ? getChatEntry(novelId, chatId) : null
  if (existing?.isStreaming) {
    return c.json({ error: 'chat_busy' }, 409)
  }

  let content = ''
  try {
    const body = await c.req.json<{ content?: string }>()
    content = body.content ?? ''
  } catch { /* empty OK */ }

  // 懒加载 session
  let entry: ChatEntry
  if (existing) {
    entry = existing
  } else {
    const session = await createChatAgent({ novelId, chatId })
    entry = claimChat({ novelId, chatId, session })
  }

  if (content.trim()) {
    await touchChatLastMsg(novelId, chatId, content.trim())
    if (chat.title === '新对话') {
      void generateChatTitle(content.trim())
        .then((t) => {
          if (t) return updateChatTitle(novelId, chatId, t)
          return null
        })
        .catch((e) => console.error('[auto-title]', e))
    }
  }

  return runWithStream(
    c.req.raw.signal,
    entry,
    content.trim() || null,
  )
})

app.post('/:id/chats/:cid/stop', (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')
  const entry = getChatEntry(novelId, chatId)
  if (!entry) return c.json({ error: 'chat_not_active' }, 404)
  releaseChat(novelId)
  return c.body(null, 204)
})

// ───── SSE plumbing ────────────────────────────────────────────────────────

function runWithStream(
  abortSignal: AbortSignal,
  entry: ChatEntry,
  userText: string | null,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      const write = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        } catch { /* closed */ }
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ka)
        try { unsubscribe() } catch { /* ignore */ }
        try { controller.close() } catch { /* ignore */ }
        setStreaming(entry.novelId, entry.chatId, false)
        setStreamCloser(entry.novelId, entry.chatId, undefined)
      }
      const unsubscribe = subscribeChatSession(entry.session, write, close)
      const ka = setInterval(() => {
        if (closed) return
        try { controller.enqueue(enc.encode(`: keepalive\n\n`)) } catch { /* closed */ }
      }, 15_000)
      abortSignal.addEventListener('abort', close)
      setStreaming(entry.novelId, entry.chatId, true)
      setStreamCloser(entry.novelId, entry.chatId, close)
      if (userText !== null) {
        entry.session.sendUserMessage(userText).catch((err: unknown) => {
          write({ type: 'error', message: (err as Error).message ?? String(err) })
          close()
        })
      }
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
        write({ type: 'tool.call', id: evt.toolCallId, name: evt.toolName, params: evt.args })
        return
      }
      case 'tool_execution_end': {
        write({ type: 'tool.result', id: evt.toolCallId, name: evt.toolName, result: evt.result })
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
