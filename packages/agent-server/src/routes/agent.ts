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
import {
  appendUserMessage,
  appendAssistantMessage,
  appendToolResultPart,
  type AssistantPartInput,
} from '../storage/chat-db.js'
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

  // active 锁判断：只有真在 streaming 才阻塞，否则自动释放旧 chat
  const active = getActiveChat(novelId)
  if (active && active.chatId !== chatId) {
    const activeEntry = getChatEntry(novelId, active.chatId)
    if (activeEntry?.isStreaming) {
      return c.json({ error: 'another_chat_running', activeChatId: active.chatId }, 409)
    }
    releaseChat(novelId)
  }
  const existing = getChatEntry(novelId, chatId)
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
    appendUserMessage(novelId, chatId, content.trim())
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

export function runWithStream(
  abortSignal: AbortSignal,
  entry: ChatEntry,
  userText: string | null,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      let ka: ReturnType<typeof setInterval> | undefined
      let unsubscribe: (() => void) | undefined
      const write = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(serializeSseEvent(event)))
        } catch { /* closed */ }
      }
      const close = () => {
        if (closed) return
        closed = true
        if (ka) clearInterval(ka)
        abortSignal.removeEventListener('abort', close)
        try { unsubscribe?.() } catch { /* ignore */ }
        try { controller.close() } catch { /* ignore */ }
        setStreaming(entry.novelId, entry.chatId, false)
        setStreamCloser(entry.novelId, entry.chatId, undefined)
      }
      unsubscribe = subscribeChatSession(
        entry.novelId,
        entry.chatId,
        entry.session,
        write,
        close,
      )
      ka = setInterval(() => {
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
  novelId: string,
  chatId: string,
  session: AgentSession,
  write: (event: AgentEvent) => void,
  close: () => void,
): () => void {
  return session.subscribe((evt) => {
    try {
      handleChatSessionEvent(novelId, chatId, evt, write, close)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] event handler failed novel=${novelId} chat=${chatId}: ${message}`, err)
      write({ type: 'error', message })
      close()
    }
  })
}

function handleChatSessionEvent(
  novelId: string,
  chatId: string,
  evt: Parameters<AgentSession['subscribe']>[0] extends (event: infer E) => void ? E : never,
  write: (event: AgentEvent) => void,
  close: () => void,
): void {
  switch (evt.type) {
    case 'message_update': {
      const inner = evt.assistantMessageEvent
      if (inner.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
        write({ type: 'message.delta', content: inner.delta })
      } else if (inner.type === 'thinking_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
        write({ type: 'reasoning.delta', content: inner.delta })
      }
      return
    }
    case 'message_end': {
      const msg = evt.message
      if (msg && msg.role === 'assistant') {
        const textParts: string[] = []
        const persistParts: AssistantPartInput[] = []
        for (const block of msg.content ?? []) {
          if (!block || typeof block !== 'object') continue
          const b = block as { type?: string; text?: unknown; thinking?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
          if (b.type === 'text' && typeof b.text === 'string') {
            textParts.push(b.text)
            if (b.text.length > 0) persistParts.push({ type: 'text', data: { text: b.text } })
          } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
            if (b.thinking.length > 0) persistParts.push({ type: 'reasoning', data: { text: b.thinking } })
          } else if (b.type === 'toolCall') {
            persistParts.push({
              type: 'tool_call',
              data: {
                tool_call_id: typeof b.id === 'string' ? b.id : '',
                name: typeof b.name === 'string' ? b.name : '',
                args: b.arguments ?? {},
              },
            })
          }
        }
        if (persistParts.length > 0) {
          try { appendAssistantMessage(novelId, chatId, persistParts) } catch (e) { console.error('[chat-db] append assistant', e) }
        }
        if (isReasoningOnlyAssistantMessage(persistParts, msg)) {
          write({ type: 'error', message: '模型只输出了思考内容，没有给出正文或工具调用，本轮已中止。' })
          close()
          return
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
      try { appendToolResultPart(chatId, evt.toolCallId, evt.result, Boolean((evt as { isError?: boolean }).isError)) } catch (e) { console.error('[chat-db] tool result', e) }
      write({ type: 'tool.result', id: evt.toolCallId, name: evt.toolName, result: evt.result })
      return
    }
    case 'agent_end': {
      console.log(`[agent] end novel=${novelId} chat=${chatId} messages=${evt.messages.length}`)
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
        console.error(`[agent] ${t} novel=${novelId} chat=${chatId}: ${msg}`, evt)
        write({ type: 'error', message: msg })
        close()
      } else {
        console.log(`[agent] evt novel=${novelId} chat=${chatId} type=${t}`)
      }
      return
    }
  }
}

function isReasoningOnlyAssistantMessage(
  parts: AssistantPartInput[],
  msg: { stopReason?: unknown },
): boolean {
  const hasReasoning = parts.some((part) => part.type === 'reasoning')
  const hasVisibleOutput = parts.some((part) => part.type === 'text' || part.type === 'tool_call')
  const stopReason = typeof msg.stopReason === 'string' ? msg.stopReason : ''
  return hasReasoning && !hasVisibleOutput && (stopReason === 'stop' || stopReason === 'length')
}

function serializeSseEvent(event: AgentEvent): string {
  try {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const fallback: AgentEvent = { type: 'error', message: `事件序列化失败: ${message}` }
    return `event: error\ndata: ${JSON.stringify(fallback)}\n\n`
  }
}

export { app as agentRoutes }
