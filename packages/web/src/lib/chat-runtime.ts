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
  ok: boolean | null
  summary: string
  params?: unknown
  result?: unknown
}

interface AssistantTurn {
  id: string
  text: string
  toolCalls: ToolCallState[]
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
      const turn: AssistantTurn = { id: assistantId, text: '', toolCalls: [] }
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
          turn.text += String(payload['content'] ?? '')
          rerender()
        } else if (type === 'message.complete') {
          turn.text = String(payload['content'] ?? turn.text)
          rerender()
        } else if (type === 'tool.call') {
          turn.toolCalls.push({
            id: String(payload['id'] ?? '?'),
            name: String(payload['name'] ?? '?'),
            ok: null,
            summary: '调用中...',
            params: payload['params'],
          })
          rerender()
        } else if (type === 'tool.result') {
          const id = String(payload['id'] ?? '')
          const tc = turn.toolCalls.find((t) => t.id === id)
          if (tc) {
            const result = payload['result'] as { ok?: boolean } | undefined
            tc.ok = result?.ok !== false
            tc.summary = result?.ok === false ? '校验失败' : '完成'
            tc.result = payload['result']
          }
          rerender()
        } else if (type === 'done') {
          // stream end
        } else if (type === 'error') {
          turn.text += `\n\n[错误] ${String(payload['message'] ?? 'unknown')}`
          rerender()
        }
      }

      function rerender() {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== turn.id) return m
            const content: Exclude<ThreadMessageLike['content'], string>[number][] = []
            for (const tc of turn.toolCalls) {
              content.push({
                type: 'tool-call',
                toolCallId: tc.id,
                toolName: tc.name,
                args: (tc.params ?? {}) as never,
                result: tc.result,
              })
            }
            if (turn.text) content.push({ type: 'text', text: turn.text })
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
    const reasoning: Exclude<ThreadMessageLike['content'], string>[number][] = []
    const tools: Exclude<ThreadMessageLike['content'], string>[number][] = []
    const texts: Exclude<ThreadMessageLike['content'], string>[number][] = []
    for (const part of m.parts) {
      if (part.type === 'text') {
        texts.push({ type: 'text', text: part.text })
      } else if (part.type === 'reasoning') {
        reasoning.push({ type: 'reasoning', text: part.text })
      } else if (part.type === 'tool-call') {
        tools.push({
          type: 'tool-call',
          toolCallId: part.id,
          toolName: part.name,
          args: (part.args ?? {}) as never,
          result: part.result,
        })
      }
    }
    return { id: m.id, role: m.role, content: [...reasoning, ...tools, ...texts] }
  })
}
