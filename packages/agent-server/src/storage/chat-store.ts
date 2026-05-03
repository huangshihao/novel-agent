import { rm, mkdir } from 'node:fs/promises'
import type { ChatInfo } from '@novel-agent/shared'
import { paths } from './paths.js'
import {
  createChatRow,
  listChatRows,
  getChatRow,
  updateChatTitleRow,
  touchChatRow,
  deleteChatRow,
} from './chat-db.js'

function genChatId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `cht-${ts}-${rand}`
}

export async function createChat(novelId: string, title?: string): Promise<ChatInfo> {
  await mkdir(paths.chatsDir(novelId), { recursive: true })
  const id = genChatId()
  return createChatRow(novelId, id, title?.trim() || '新对话')
}

export async function listChats(novelId: string): Promise<ChatInfo[]> {
  return listChatRows(novelId)
}

export async function getChat(novelId: string, chatId: string): Promise<ChatInfo | null> {
  return getChatRow(novelId, chatId)
}

export async function updateChatTitle(
  novelId: string,
  chatId: string,
  title: string,
): Promise<ChatInfo | null> {
  return updateChatTitleRow(novelId, chatId, title)
}

export async function touchChatLastMsg(
  novelId: string,
  chatId: string,
  lastUserText: string,
): Promise<ChatInfo | null> {
  return touchChatRow(novelId, chatId, lastUserText)
}

export async function deleteChat(novelId: string, chatId: string): Promise<boolean> {
  const removed = deleteChatRow(novelId, chatId)
  try {
    await rm(paths.chatSession(novelId, chatId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return removed
}
