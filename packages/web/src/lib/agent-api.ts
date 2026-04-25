import type { ActiveTask, AgentSessionInfo, BatchJobInfo } from '@novel-agent/shared'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    let extra: unknown = null
    try {
      const body = (await r.json()) as { message?: string; error?: string }
      extra = body
      msg = body.message || body.error || msg
    } catch {
      /* noop */
    }
    const err = new Error(msg) as Error & { details?: unknown; status?: number }
    err.details = extra
    err.status = r.status
    throw err
  }
  return r.json() as Promise<T>
}

export const agentApi = {
  getActive: (novelId: string) =>
    fetch(`/api/agent/${novelId}/active`).then(j<ActiveTask | null>),

  startOutline: (novelId: string, from: number, to: number, requirement: string) =>
    fetch(`/api/agent/${novelId}/outline/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, requirement }),
    }).then(j<AgentSessionInfo>),

  reviseOutline: (novelId: string, number: number, feedback: string) =>
    fetch(`/api/agent/${novelId}/outline/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, feedback }),
    }).then(j<AgentSessionInfo>),

  startWriter: (novelId: string, from: number, to: number, requirement: string) =>
    fetch(`/api/agent/${novelId}/writer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, requirement }),
    }).then(j<BatchJobInfo>),

  reviseWriter: (novelId: string, number: number, feedback: string) =>
    fetch(`/api/agent/${novelId}/writer/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, feedback }),
    }).then(j<AgentSessionInfo>),

  getJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}`).then(j<BatchJobInfo>),

  abortJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}/abort`, { method: 'POST' }).then(j<BatchJobInfo>),

  retryJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}/retry`, { method: 'POST' }).then(j<BatchJobInfo>),

  skipJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}/skip`, { method: 'POST' }).then(j<BatchJobInfo>),

  closeJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}`, { method: 'DELETE' }),

  closeSession: (sessionId: string) =>
    fetch(`/api/agent/session/${sessionId}`, { method: 'DELETE' }),

  jobStreamUrl: (jobId: string) => `/api/agent/job/${jobId}/stream`,
  messageUrl: (sessionId: string) => `/api/agent/session/${sessionId}/message`,
}
