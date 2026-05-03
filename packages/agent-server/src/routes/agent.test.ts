import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { ChatEntry } from '../agents/registry.js'
import { runWithStream } from './agent.js'

describe('agent route stream', () => {
  it('streams assistant thinking deltas', async () => {
    let listener: ((event: unknown) => void) | null = null
    const session = {
      subscribe: (fn: (event: unknown) => void) => {
        listener = fn
        return () => { listener = null }
      },
      sendUserMessage: async () => {
        listener?.({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'thinking_delta',
            delta: '先确认上下文',
          },
          message: { role: 'assistant', content: [] },
        })
        listener?.({ type: 'agent_end', messages: [] })
      },
      dispose: () => {},
    } as unknown as AgentSession
    const entry: ChatEntry = {
      novelId: 'nv-test',
      chatId: 'chat-test',
      session,
      isStreaming: false,
    }

    const response = runWithStream(new AbortController().signal, entry, '继续写')
    const text = await response.text()

    expect(text).toContain('event: reasoning.delta')
    expect(text).toContain('先确认上下文')
  })

  it('reports an error when the assistant only emits thinking without text or tools', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let listener: ((event: unknown) => void) | null = null
    const session = {
      subscribe: (fn: (event: unknown) => void) => {
        listener = fn
        return () => { listener = null }
      },
      sendUserMessage: async () => {
        listener?.({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'stop',
            content: [
              { type: 'thinking', thinking: '第五章需要查看上下文。继续获取第五章上下文。' },
            ],
          },
        })
        listener?.({ type: 'agent_end', messages: [] })
      },
      dispose: () => {},
    } as unknown as AgentSession
    const entry: ChatEntry = {
      novelId: 'nv-test',
      chatId: 'chat-test',
      session,
      isStreaming: false,
    }

    try {
      const response = runWithStream(new AbortController().signal, entry, '继续写')
      const text = await response.text()

      expect(text).toContain('event: error')
      expect(text).toContain('只输出了思考内容')
      expect(text).not.toContain('event: done')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('closes when agent_end contains non-json-serializable message data', async () => {
    let listener: ((event: unknown) => void) | null = null
    const session = {
      subscribe: (fn: (event: unknown) => void) => {
        listener = fn
        return () => { listener = null }
      },
      sendUserMessage: async () => {
        listener?.({ type: 'agent_end', messages: [{ value: 1n }] })
      },
      dispose: () => {},
    } as unknown as AgentSession
    const entry: ChatEntry = {
      novelId: 'nv-test',
      chatId: 'chat-test',
      session,
      isStreaming: false,
    }

    const response = runWithStream(new AbortController().signal, entry, '继续写')
    const text = await response.text()

    expect(text).toContain('event: done')
  })
})
