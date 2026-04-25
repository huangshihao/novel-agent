import type { ThreadUiMessage, ThreadUiMessagePart } from '@novel-agent/shared'
import { SessionManager } from '@mariozechner/pi-coding-agent'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './paths.js'

export async function loadChatHistoryForUi(
  novelId: string,
  chatId: string,
): Promise<ThreadUiMessage[]> {
  const file = paths.chatSession(novelId, chatId)
  if (!existsSync(file)) return []
  const mgr = SessionManager.open(file, dirname(file))
  return transform(mgr.getEntries())
}

interface UnknownEntry {
  type?: string
  message?: {
    role?: string
    content?: unknown
  }
  toolCallId?: string
  toolName?: string
  content?: unknown
}

interface AssistantBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  arguments?: unknown
}

function transform(rawEntries: unknown[]): ThreadUiMessage[] {
  const entries = rawEntries as UnknownEntry[]
  const out: ThreadUiMessage[] = []
  const toolResults = new Map<string, unknown>()

  for (const e of entries) {
    if (e.type === 'message' && e.message?.role === 'toolResult') {
      const id = e.message ? (e.message as { toolCallId?: string }).toolCallId : undefined
      if (id) toolResults.set(id, extractToolResultText(e.message.content))
    }
  }

  for (const e of entries) {
    if (e.type !== 'message' || !e.message) continue
    const role = e.message.role
    if (role !== 'user' && role !== 'assistant') continue
    const parts: ThreadUiMessagePart[] = []
    const content = e.message.content
    if (typeof content === 'string') {
      if (content) parts.push({ type: 'text', text: content })
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as AssistantBlock
        if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
          parts.push({ type: 'text', text: b.text })
        } else if (b.type === 'toolCall') {
          const id = b.id ?? '?'
          parts.push({
            type: 'tool-call',
            id,
            name: b.name ?? '?',
            args: b.arguments ?? {},
            result: toolResults.get(id),
          })
        }
      }
    }
    if (parts.length === 0) continue
    out.push({
      id: `hist-${out.length}`,
      role,
      parts,
    })
  }
  return out
}

function extractToolResultText(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  const texts: string[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
  }
  if (texts.length === 0) return content
  const joined = texts.join('')
  try {
    return JSON.parse(joined)
  } catch {
    return joined
  }
}
