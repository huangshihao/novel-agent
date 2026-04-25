import { useCallback, useEffect, useRef, useState } from 'react'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  tool_calls?: { name: string; ok: boolean; summary: string }[]
}

interface UseAgentStreamOpts {
  sessionId: string | null
}

export function useAgentStream({ sessionId }: UseAgentStreamOpts) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    async (url: string, content: string | null) => {
      if (!sessionId) throw new Error('no active session')
      const ac = new AbortController()
      abortRef.current = ac
      setStreaming(true)

      if (content) {
        const userMsg: AgentMessage = {
          id: `u-${Date.now()}`,
          role: 'user',
          content,
        }
        setMessages((prev) => [...prev, userMsg])
      }
      const assistantId = `a-${Date.now()}`
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', tool_calls: [] }])

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(content ? { content } : {}),
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
            const eventName = m[1]!
            let payload: unknown = {}
            try {
              payload = JSON.parse(m[2]!)
            } catch {
              /* skip */
            }
            handleEvent(eventName, payload, assistantId, setMessages)
          }
        }
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    },
    [sessionId],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { messages, streaming, send, stop, setMessages }
}

function handleEvent(
  type: string,
  payload: unknown,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>,
): void {
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== assistantId) return m
      if (type === 'message.delta') {
        const delta = (payload as { content?: string }).content ?? ''
        return { ...m, content: m.content + delta }
      }
      if (type === 'message.complete') {
        return { ...m, content: (payload as { content?: string }).content ?? m.content }
      }
      if (type === 'tool.call') {
        const p = payload as { name?: string }
        return {
          ...m,
          tool_calls: [
            ...(m.tool_calls ?? []),
            { name: p.name ?? '?', ok: false, summary: '调用中...' },
          ],
        }
      }
      if (type === 'tool.result') {
        const p = payload as { name?: string; result?: { ok?: boolean } }
        const tcs = m.tool_calls ?? []
        const last = tcs[tcs.length - 1]
        if (last && last.name === p.name) {
          last.ok = p.result?.ok !== false
          last.summary = p.result?.ok === false ? '校验失败' : '完成'
        }
        return { ...m, tool_calls: [...tcs] }
      }
      return m
    }),
  )
}
