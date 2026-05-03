import { describe, expect, it } from 'vitest'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { ChatEntry } from '../agents/registry.js'
import { runWithStream } from './agent.js'

describe('agent route stream', () => {
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
