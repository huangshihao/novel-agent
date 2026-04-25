import { describe, it, expect, beforeEach } from 'vitest'
import { __clearAll, claimChat, releaseChat, getActiveChat, getChatEntry } from './registry.js'
import type { AgentSession } from '@mariozechner/pi-coding-agent'

const fakeSession = (): AgentSession => ({
  dispose: () => {},
  subscribe: () => () => {},
  sendUserMessage: async () => {},
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
})
