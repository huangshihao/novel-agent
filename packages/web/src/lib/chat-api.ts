import type { ChatInfo, ActiveTask, ThreadUiMessage } from '@novel-agent/shared'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    let extra: unknown = null
    try {
      const body = (await r.json()) as { message?: string; error?: string }
      extra = body
      msg = body.message || body.error || msg
    } catch { /* noop */ }
    const err = new Error(msg) as Error & { details?: unknown; status?: number }
    err.details = extra
    err.status = r.status
    throw err
  }
  return r.json() as Promise<T>
}

export const chatApi = {
  getActive: (novelId: string) =>
    fetch(`/api/agent/${novelId}/active`).then(j<ActiveTask>),

  list: (novelId: string) =>
    fetch(`/api/agent/${novelId}/chats`).then(j<ChatInfo[]>),

  getHistory: (novelId: string, chatId: string) =>
    fetch(`/api/agent/${novelId}/chats/${chatId}`).then(
      j<{ chat: ChatInfo; messages: ThreadUiMessage[] }>,
    ),

  create: (novelId: string, title?: string) =>
    fetch(`/api/agent/${novelId}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(title ? { title } : {}),
    }).then(j<ChatInfo>),

  rename: (novelId: string, chatId: string, title: string) =>
    fetch(`/api/agent/${novelId}/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).then(j<ChatInfo>),

  delete: (novelId: string, chatId: string) =>
    fetch(`/api/agent/${novelId}/chats/${chatId}`, { method: 'DELETE' }),

  stop: (novelId: string, chatId: string) =>
    fetch(`/api/agent/${novelId}/chats/${chatId}/stop`, { method: 'POST' }),

  messageUrl: (novelId: string, chatId: string) =>
    `/api/agent/${novelId}/chats/${chatId}/message`,
}
