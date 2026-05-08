import { describe, it, expect, beforeEach } from 'vitest'
import {
  __clearAll,
  claimChat,
  releaseChat,
  stopChat,
  getActiveChat,
  getChatEntry,
  setStreamCloser,
} from './registry.js'
import type { AgentSession } from '@mariozechner/pi-coding-agent'

const fakeSession = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  abort: async () => {},
  dispose: () => {},
  subscribe: () => () => {},
  sendUserMessage: async () => {},
  ...overrides,
} as unknown as AgentSession)

beforeEach(() => __clearAll())

describe('registry (chat-keyed)', () => {
  it('claimChat sets active and getActiveChat reads it', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    expect(getActiveChat('n1')).toEqual({ chatId: 'c1' })
  })

  it('claimChat throws when another chat is active for same novel', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    expect(() => claimChat({ novelId: 'n1', chatId: 'c2', session: fakeSession() })).toThrow(/active/)
  })

  it('claimChat for same chatId is idempotent', () => {
    const s = fakeSession()
    claimChat({ novelId: 'n1', chatId: 'c1', session: s })
    expect(() => claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })).not.toThrow()
  })

  it('releaseChat removes active', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    releaseChat('n1')
    expect(getActiveChat('n1')).toBeNull()
  })

  it('different novels can each have an active chat simultaneously', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    claimChat({ novelId: 'n2', chatId: 'c2', session: fakeSession() })
    expect(getActiveChat('n1')).toEqual({ chatId: 'c1' })
    expect(getActiveChat('n2')).toEqual({ chatId: 'c2' })
  })

  it('getChatEntry returns null for unknown', () => {
    expect(getChatEntry('n1', 'c1')).toBeNull()
  })

  it('releaseChat invokes the registered stream closer', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    let closed = 0
    setStreamCloser('n1', 'c1', () => { closed++ })
    releaseChat('n1')
    expect(closed).toBe(1)
    expect(getActiveChat('n1')).toBeNull()
  })

  it('setStreamCloser is a no-op for unknown novel/chat', () => {
    expect(() => setStreamCloser('nope', 'nope', () => {})).not.toThrow()
  })

  it('stopChat aborts the active session before releasing it', async () => {
    const calls: string[] = []
    claimChat({
      novelId: 'n1',
      chatId: 'c1',
      session: fakeSession({
        abort: async () => {
          calls.push('abort')
        },
        dispose: () => {
          calls.push('dispose')
        },
      }),
    })

    const stopped = await stopChat('n1', 'c1')

    expect(stopped).toBe(true)
    expect(calls).toEqual(['abort', 'dispose'])
    expect(getActiveChat('n1')).toBeNull()
  })
})
