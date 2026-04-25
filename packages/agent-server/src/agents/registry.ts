import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { AgentRole, AgentMode } from '@novel-agent/shared'

export interface SessionEntry {
  id: string
  novelId: string
  role: AgentRole
  mode: AgentMode
  scope: { from: number; to: number }
  session: AgentSession
  requirement?: string
  feedback?: string
  createdAt: number
}

interface BatchOwner {
  dispose(): void
}

export interface BatchEntry {
  id: string
  novelId: string
  batch: BatchOwner
  createdAt: number
}

type Active =
  | { kind: 'session'; entry: SessionEntry }
  | { kind: 'batch'; entry: BatchEntry }
  | null

const activeByNovel = new Map<string, Exclude<Active, null>>()
const sessionsById = new Map<string, SessionEntry>()
const batchesById = new Map<string, BatchEntry>()

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export interface SetActiveSessionInput {
  novelId: string
  role: AgentRole
  mode: AgentMode
  scope: { from: number; to: number }
  session: AgentSession
  requirement?: string
  feedback?: string
}

export function setActiveSession(input: SetActiveSessionInput): string {
  if (activeByNovel.has(input.novelId)) {
    throw new Error('already_active')
  }
  const id = genId('sess')
  const entry: SessionEntry = {
    id,
    novelId: input.novelId,
    role: input.role,
    mode: input.mode,
    scope: input.scope,
    session: input.session,
    requirement: input.requirement,
    feedback: input.feedback,
    createdAt: Date.now(),
  }
  activeByNovel.set(input.novelId, { kind: 'session', entry })
  sessionsById.set(id, entry)
  return id
}

export interface SetActiveBatchInput {
  novelId: string
  batchId?: string
  batch: BatchOwner
}

export function setActiveBatch(input: SetActiveBatchInput): string {
  if (activeByNovel.has(input.novelId)) {
    throw new Error('already_active')
  }
  const id = input.batchId ?? genId('batch')
  const entry: BatchEntry = {
    id,
    novelId: input.novelId,
    batch: input.batch,
    createdAt: Date.now(),
  }
  activeByNovel.set(input.novelId, { kind: 'batch', entry })
  batchesById.set(id, entry)
  return id
}

export function getActiveTask(novelId: string): Active {
  return activeByNovel.get(novelId) ?? null
}

export function getSessionEntry(sessionId: string): SessionEntry | undefined {
  return sessionsById.get(sessionId)
}

export function getBatchEntry(batchId: string): BatchEntry | undefined {
  return batchesById.get(batchId)
}

export function clearActiveTask(novelId: string): void {
  const a = activeByNovel.get(novelId)
  if (!a) return
  try {
    if (a.kind === 'session') a.entry.session.dispose()
    else a.entry.batch.dispose()
  } catch {
    /* ignore */
  }
  activeByNovel.delete(novelId)
  if (a.kind === 'session') sessionsById.delete(a.entry.id)
  else batchesById.delete(a.entry.id)
}

// test-only
export function __clearAll(): void {
  activeByNovel.clear()
  sessionsById.clear()
  batchesById.clear()
}
