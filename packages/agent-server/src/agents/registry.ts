import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { ActiveTask } from '@novel-agent/shared'

export interface ChatEntry {
  novelId: string
  chatId: string
  session: AgentSession
  isStreaming: boolean
  closeStream?: () => void
  stopPromise?: Promise<boolean>
}

const activeByNovel = new Map<string, ChatEntry>()

export interface ClaimChatInput {
  novelId: string
  chatId: string
  session: AgentSession
}

export function claimChat(input: ClaimChatInput): ChatEntry {
  const existing = activeByNovel.get(input.novelId)
  if (existing && existing.chatId !== input.chatId) {
    throw new Error(`another_chat_active:${existing.chatId}`)
  }
  const entry: ChatEntry = {
    novelId: input.novelId,
    chatId: input.chatId,
    session: input.session,
    isStreaming: false,
  }
  if (existing) {
    try { existing.session.dispose() } catch { /* ignore */ }
  }
  activeByNovel.set(input.novelId, entry)
  return entry
}

export function getActiveChat(novelId: string): ActiveTask {
  const e = activeByNovel.get(novelId)
  return e ? { chatId: e.chatId } : null
}

export function getChatEntry(novelId: string, chatId: string): ChatEntry | null {
  const e = activeByNovel.get(novelId)
  if (!e || e.chatId !== chatId) return null
  return e
}

export function setStreaming(novelId: string, chatId: string, value: boolean): void {
  const e = activeByNovel.get(novelId)
  if (e && e.chatId === chatId) e.isStreaming = value
}

export function setStreamCloser(
  novelId: string,
  chatId: string,
  fn: (() => void) | undefined,
): void {
  const e = activeByNovel.get(novelId)
  if (e && e.chatId === chatId) e.closeStream = fn
}

export function releaseChat(novelId: string): void {
  const e = activeByNovel.get(novelId)
  if (!e) return
  try { e.closeStream?.() } catch { /* ignore */ }
  try { e.session.dispose() } catch { /* ignore */ }
  activeByNovel.delete(novelId)
}

export function stopChat(novelId: string, chatId?: string): Promise<boolean> {
  const e = activeByNovel.get(novelId)
  if (!e) return Promise.resolve(false)
  if (chatId && e.chatId !== chatId) return Promise.resolve(false)
  if (e.stopPromise) return e.stopPromise

  e.stopPromise = (async () => {
    try {
      await e.session.abort()
    } catch { /* ignore */ }
    releaseChat(novelId)
    return true
  })()
  return e.stopPromise
}

export function __clearAll(): void {
  for (const e of activeByNovel.values()) {
    try { e.closeStream?.() } catch { /* ignore */ }
    try { e.session.dispose() } catch { /* ignore */ }
  }
  activeByNovel.clear()
}
