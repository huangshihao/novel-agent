import { describe, it, expect, beforeEach } from 'vitest'
import {
  setActiveSession,
  setActiveBatch,
  getActiveTask,
  clearActiveTask,
  getSessionEntry,
  getBatchEntry,
  __clearAll,
} from './registry.js'
import type { AgentSession } from '@mariozechner/pi-coding-agent'

const fakeSession = { dispose() {} } as unknown as AgentSession
const fakeBatch = { dispose() {} } as { dispose(): void }

beforeEach(() => __clearAll())

describe('registry single-active', () => {
  it('sets and gets active session', () => {
    const id = setActiveSession({
      novelId: 'n1',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session: fakeSession,
    })
    const active = getActiveTask('n1')
    expect(active?.kind).toBe('session')
    expect(active?.kind === 'session' && active.entry.role).toBe('outline')
    expect(getSessionEntry(id)?.novelId).toBe('n1')
  })

  it('rejects new active when one exists', () => {
    setActiveSession({
      novelId: 'n1',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session: fakeSession,
    })
    expect(() =>
      setActiveSession({
        novelId: 'n1',
        role: 'writer',
        mode: 'generate',
        scope: { from: 1, to: 1 },
        session: fakeSession,
      }),
    ).toThrow(/already_active/)
    expect(() =>
      setActiveBatch({ novelId: 'n1', batchId: 'b1', batch: fakeBatch }),
    ).toThrow(/already_active/)
  })

  it('different novels are independent', () => {
    setActiveSession({
      novelId: 'n1',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session: fakeSession,
    })
    setActiveSession({
      novelId: 'n2',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session: fakeSession,
    })
    expect(getActiveTask('n1')).toBeTruthy()
    expect(getActiveTask('n2')).toBeTruthy()
  })

  it('clearActiveTask disposes session', () => {
    let disposed = false
    const session = { dispose() { disposed = true } } as unknown as AgentSession
    setActiveSession({
      novelId: 'n1',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session,
    })
    clearActiveTask('n1')
    expect(disposed).toBe(true)
    expect(getActiveTask('n1')).toBeNull()
  })

  it('clearActiveTask disposes batch', () => {
    let disposed = false
    const batch = { dispose() { disposed = true } }
    setActiveBatch({ novelId: 'n2', batchId: 'b1', batch })
    clearActiveTask('n2')
    expect(disposed).toBe(true)
    expect(getActiveTask('n2')).toBeNull()
    expect(getBatchEntry('b1')).toBeUndefined()
  })
})
