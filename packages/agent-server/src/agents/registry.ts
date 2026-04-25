import type { AgentSession } from '@mariozechner/pi-coding-agent'

interface SessionEntry {
  novelId: string
  role: 'outline' | 'writer'
  batch: { from: number; to: number }
  session: AgentSession
  createdAt: number
}

const sessions = new Map<string, SessionEntry>()

function genId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function registerSession(entry: Omit<SessionEntry, 'createdAt'>): string {
  const id = genId()
  sessions.set(id, { ...entry, createdAt: Date.now() })
  return id
}

export function getSession(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId)
}

export function listSessionsByNovel(novelId: string): { id: string; entry: SessionEntry }[] {
  const out: { id: string; entry: SessionEntry }[] = []
  for (const [id, entry] of sessions) {
    if (entry.novelId === novelId) out.push({ id, entry })
  }
  return out
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId)
}
