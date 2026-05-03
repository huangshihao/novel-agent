import { useState, useRef, useCallback, useEffect } from 'react'
import {
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type AppendMessage,
} from '@assistant-ui/react'
import type { ThreadUiMessage } from '@novel-agent/shared'
import { chatApi } from './chat-api.js'

export interface ChatRuntimeOptions {
  novelId: string
  chatId: string | null
  onChatCreated?: (chatId: string) => void
}

interface ToolCallState {
  id: string
  name: string
  params?: unknown
  result?: unknown
}

type AssistantTurnPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | ({ type: 'tool-call' } & ToolCallState)

interface AssistantTurn {
  id: string
  parts: AssistantTurnPart[]
}

export function useChatRuntime(opts: ChatRuntimeOptions) {
  const { novelId, chatId, onChatCreated } = opts
  const [messages, setMessages] = useState<ThreadMessageLike[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const activeChatIdRef = useRef<string | null>(chatId)
  const onChatCreatedRef = useRef(onChatCreated)
  onChatCreatedRef.current = onChatCreated

  useEffect(() => {
    if (chatId === activeChatIdRef.current) return
    activeChatIdRef.current = chatId
    setMessages([])
    abortRef.current?.abort()
    abortRef.current = null
    setIsRunning(false)
    if (!chatId) return
    let cancelled = false
    chatApi
      .getHistory(novelId, chatId)
      .then((r) => {
        if (cancelled) return
        setMessages(historyToThreadMessages(r.messages))
      })
      .catch(() => { /* noop: leave empty */ })
    return () => { cancelled = true }
  }, [novelId, chatId])

  const send = useCallback(
    async (text: string) => {
      if (!activeChatIdRef.current) {
        try {
          const chat = await chatApi.create(novelId)
          activeChatIdRef.current = chat.id
          onChatCreatedRef.current?.(chat.id)
        } catch (err) {
          console.error('[chat-runtime] create chat failed:', err)
          return
        }
      }
      const targetChatId = activeChatIdRef.current
      if (!targetChatId) return

      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', content: [{ type: 'text', text }] },
      ])
      const assistantId = `a-${Date.now()}`
      const turn: AssistantTurn = { id: assistantId, parts: [] }
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: [{ type: 'text', text: '' }] },
      ])
      const ac = new AbortController()
      abortRef.current = ac
      setIsRunning(true)
      try {
        const resp = await fetch(chatApi.messageUrl(novelId, targetChatId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
          signal: ac.signal,
        })
        if (!resp.body) throw new Error('no stream body')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          for (const raw of events) {
            const m = raw.match(/^event: (\S+)\ndata: ([\s\S]+)$/)
            if (!m) continue
            handleEvent(m[1]!, JSON.parse(m[2]!) as Record<string, unknown>)
          }
        }
      } finally {
        setIsRunning(false)
        abortRef.current = null
      }

      function handleEvent(type: string, payload: Record<string, unknown>) {
        if (type === 'message.delta') {
          appendTextPart(turn, String(payload['content'] ?? ''))
          rerender()
        } else if (type === 'message.complete') {
          completeTextPart(turn, String(payload['content'] ?? ''))
          rerender()
        } else if (type === 'reasoning.delta') {
          appendReasoningPart(turn, String(payload['content'] ?? ''))
          rerender()
        } else if (type === 'tool.call') {
          turn.parts.push({
            type: 'tool-call',
            id: String(payload['id'] ?? '?'),
            name: String(payload['name'] ?? '?'),
            params: payload['params'],
          })
          rerender()
        } else if (type === 'tool.result') {
          const id = String(payload['id'] ?? '')
          const tc = turn.parts.find((t): t is Extract<AssistantTurnPart, { type: 'tool-call' }> =>
            t.type === 'tool-call' && t.id === id)
          if (tc) {
            tc.result = payload['result']
          }
          rerender()
        } else if (type === 'done') {
          // stream end
        } else if (type === 'error') {
          appendTextPart(turn, `\n\n[错误] ${String(payload['message'] ?? 'unknown')}`)
          rerender()
        }
      }

      function rerender() {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== turn.id) return m
            const content: Exclude<ThreadMessageLike['content'], string>[number][] = []
            for (const part of turn.parts) {
              if (part.type === 'reasoning') {
                if (part.text.trim()) content.push({ type: 'reasoning', text: part.text })
              } else if (part.type === 'tool-call') {
                content.push({
                  type: 'tool-call',
                  toolCallId: part.id,
                  toolName: part.name,
                  args: (part.params ?? {}) as never,
                  result: part.result,
                })
              } else {
                const text = stripThinkLeak(part.text)
                if (text) content.push({ type: 'text', text })
              }
            }
            return { ...m, content }
          }),
        )
      }
    },
    [novelId],
  )

  const onCancel = useCallback(async () => {
    abortRef.current?.abort()
    const cid = activeChatIdRef.current
    if (cid) {
      try {
        await chatApi.stop(novelId, cid)
      } catch { /* noop */ }
    }
  }, [novelId])

  const onNew = useCallback(async (msg: AppendMessage) => {
    if (msg.role !== 'user') return
    const text = msg.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim()
    if (!text) return
    await send(text)
  }, [send])

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    isRunning,
    messages,
    onNew,
    onCancel,
    convertMessage: (m) => m,
  })

  return { runtime, send, cancel: onCancel, isRunning }
}

function historyToThreadMessages(history: ThreadUiMessage[]): ThreadMessageLike[] {
  return history.map((m) => {
    const content: Exclude<ThreadMessageLike['content'], string>[number][] = []
    for (const part of m.parts) {
      if (part.type === 'text') {
        const text = stripThinkLeak(part.text)
        if (text) content.push({ type: 'text', text })
      } else if (part.type === 'reasoning') {
        content.push({ type: 'reasoning', text: part.text })
      } else if (part.type === 'tool-call') {
        content.push({
          type: 'tool-call',
          toolCallId: part.id,
          toolName: part.name,
          args: (part.args ?? {}) as never,
          result: part.result,
        })
      }
    }
    return { id: m.id, role: m.role, content }
  })
}

function appendReasoningPart(turn: AssistantTurn, text: string) {
  if (!text) return
  const last = turn.parts[turn.parts.length - 1]
  if (last?.type === 'reasoning') {
    last.text += text
  } else {
    turn.parts.push({ type: 'reasoning', text })
  }
}

function appendTextPart(turn: AssistantTurn, text: string) {
  if (!text) return
  const last = turn.parts[turn.parts.length - 1]
  if (last?.type === 'text') {
    last.text += text
  } else {
    turn.parts.push({ type: 'text', text })
  }
}

function completeTextPart(turn: AssistantTurn, text: string) {
  if (!text) return
  const textParts = turn.parts.filter((part): part is Extract<AssistantTurnPart, { type: 'text' }> =>
    part.type === 'text')
  if (textParts.length === 0) {
    turn.parts.push({ type: 'text', text })
    return
  }
  textParts[0]!.text = text
  for (const part of textParts.slice(1)) part.text = ''
}

function stripThinkLeak(text: string): string {
  const closeTag = '</think>'
  const index = text.lastIndexOf(closeTag)
  if (index < 0) return text
  return text.slice(index + closeTag.length).trimStart()
}
