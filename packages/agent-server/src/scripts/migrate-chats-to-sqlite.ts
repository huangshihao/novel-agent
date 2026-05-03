import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { SessionManager } from '@mariozechner/pi-coding-agent'
import { paths } from '../storage/paths.js'
import { readMdIfExists } from '../storage/markdown.js'
import {
  chatExists,
  createChatRow,
  appendUserMessage,
  appendAssistantMessage,
  appendToolResultPart,
  listChatRows,
  type AssistantPartInput,
} from '../storage/chat-db.js'
import type { ChatInfo } from '@novel-agent/shared'

interface ChatsIndex { chats: ChatInfo[] }

interface UnknownEntry {
  type?: string
  message?: {
    role?: string
    content?: unknown
    toolCallId?: string
    toolName?: string
    isError?: boolean
    timestamp?: number
  }
}

interface AssistantBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  arguments?: unknown
}

function migrateOneChat(novelId: string, chat: ChatInfo): { messages: number } {
  if (chatExists(chat.id)) return { messages: 0 }

  const createdMs = Date.parse(chat.created_at) || Date.now()
  createChatRow(novelId, chat.id, chat.title, createdMs)

  const sessionFile = paths.chatSession(novelId, chat.id)
  if (!existsSync(sessionFile)) return { messages: 0 }

  const mgr = SessionManager.open(sessionFile, dirname(sessionFile))
  const entries = mgr.getEntries() as UnknownEntry[]

  let count = 0
  for (const e of entries) {
    if (e.type !== 'message' || !e.message) continue
    const role = e.message.role
    const ts = typeof e.message.timestamp === 'number' ? e.message.timestamp : Date.now()

    if (role === 'user') {
      const content = e.message.content
      let text = ''
      if (typeof content === 'string') text = content
      else if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type?: string; text?: string }
          if (b.type === 'text' && typeof b.text === 'string') text += b.text
        }
      }
      if (text.length > 0) {
        appendUserMessage(novelId, chat.id, text, ts)
        count++
      }
    } else if (role === 'assistant') {
      const parts: AssistantPartInput[] = []
      const content = e.message.content
      if (typeof content === 'string') {
        if (content.length > 0) parts.push({ type: 'text', data: { text: content } })
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as AssistantBlock
          if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
            parts.push({ type: 'text', data: { text: b.text } })
          } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.length > 0) {
            parts.push({ type: 'reasoning', data: { text: b.thinking } })
          } else if (b.type === 'toolCall') {
            parts.push({
              type: 'tool_call',
              data: {
                tool_call_id: typeof b.id === 'string' ? b.id : '',
                name: typeof b.name === 'string' ? b.name : '',
                args: b.arguments ?? {},
              },
            })
          }
        }
      }
      if (parts.length > 0) {
        appendAssistantMessage(novelId, chat.id, parts, ts)
        count++
      }
    } else if (role === 'toolResult') {
      const tcId = e.message.toolCallId
      if (typeof tcId === 'string' && tcId.length > 0) {
        const content = e.message.content
        let result: unknown = content
        if (Array.isArray(content)) {
          const texts: string[] = []
          for (const block of content) {
            const b = block as { type?: string; text?: unknown }
            if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
          }
          if (texts.length > 0) {
            const joined = texts.join('')
            try { result = JSON.parse(joined) } catch { result = joined }
          }
        }
        appendToolResultPart(chat.id, tcId, result, Boolean(e.message.isError))
      }
    }
  }
  return { messages: count }
}

async function main() {
  const dataRoot = paths.root()
  if (!existsSync(dataRoot)) {
    console.log(`[migrate] data root not found: ${dataRoot}`)
    return
  }
  listChatRows('__noop__')

  const novelDirs = readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('nv-'))
    .map((d) => d.name)

  let totalChats = 0
  let totalMessages = 0
  let skippedChats = 0

  for (const novelId of novelDirs) {
    const indexPath = paths.chatsIndex(novelId)
    if (!existsSync(indexPath)) continue
    const md = await readMdIfExists<ChatsIndex>(indexPath)
    const chats = md?.frontMatter.chats ?? []
    if (chats.length === 0) {
      try { rmSync(indexPath) } catch { /* ignore */ }
      continue
    }

    for (const chat of chats) {
      if (chatExists(chat.id)) {
        skippedChats++
        continue
      }
      const { messages } = migrateOneChat(novelId, chat)
      totalChats++
      totalMessages += messages
      console.log(`[migrate] ${novelId}/${chat.id} (${chat.title}) → ${messages} messages`)
    }

    try { rmSync(indexPath) } catch { /* ignore */ }
  }

  console.log(`[migrate] done: ${totalChats} chats migrated, ${totalMessages} messages, ${skippedChats} already existed`)
}

main().catch((err) => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
