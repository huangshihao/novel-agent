import { rm, mkdir } from 'node:fs/promises'
import type { ChatInfo } from '@novel-agent/shared'
import { paths } from './paths.js'
import {
  appendChat,
  readChatsIndex,
  removeChat,
  updateChat,
  findChat,
} from './chat-index.js'

function genChatId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `cht-${ts}-${rand}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function createChat(novelId: string, title?: string): Promise<ChatInfo> {
  await mkdir(paths.chatsDir(novelId), { recursive: true })
  const now = nowIso()
  const chat: ChatInfo = {
    id: genChatId(),
    novel_id: novelId,
    title: title?.trim() || '新对话',
    created_at: now,
    last_msg_at: now,
    last_user_text: '',
  }
  await appendChat(novelId, chat)
  return chat
}

export async function listChats(novelId: string): Promise<ChatInfo[]> {
  const chats = await readChatsIndex(novelId)
  return [...chats].sort((a, b) =>
    b.last_msg_at.localeCompare(a.last_msg_at),
  )
}

export async function getChat(novelId: string, chatId: string): Promise<ChatInfo | null> {
  return findChat(novelId, chatId)
}

export async function updateChatTitle(
  novelId: string,
  chatId: string,
  title: string,
): Promise<ChatInfo | null> {
  return updateChat(novelId, chatId, { title })
}

export async function touchChatLastMsg(
  novelId: string,
  chatId: string,
  lastUserText: string,
): Promise<ChatInfo | null> {
  return updateChat(novelId, chatId, {
    last_msg_at: nowIso(),
    last_user_text: lastUserText.slice(0, 80),
  })
}

export async function deleteChat(novelId: string, chatId: string): Promise<boolean> {
  const removed = await removeChat(novelId, chatId)
  try {
    await rm(paths.chatSession(novelId, chatId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return removed
}
