import type { AgentSessionInfo } from '@novel-agent/shared'

interface StartSessionResponse {
  session_id: string
  novel_id: string
  role: 'outline' | 'writer'
  batch: { from: number; to: number }
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try {
      const body = (await r.json()) as { message?: string; error?: string }
      msg = body.message || body.error || msg
    } catch {
      /* noop */
    }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export const agentApi = {
  startOutline: (novelId: string, from: number, to: number) =>
    fetch(`/api/agent/${novelId}/outline/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }).then(j<StartSessionResponse>),

  startWriter: (novelId: string, from: number, to: number) =>
    fetch(`/api/agent/${novelId}/writer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }).then(j<StartSessionResponse>),

  listSessions: (novelId: string) =>
    fetch(`/api/agent/${novelId}/sessions`).then(j<AgentSessionInfo[]>),

  closeSession: (sessionId: string) =>
    fetch(`/api/agent/session/${sessionId}`, { method: 'DELETE' }),

  messageUrl: (sessionId: string) =>
    `/api/agent/session/${sessionId}/message`,
  runUrl: (sessionId: string) => `/api/agent/session/${sessionId}/run`,
}
