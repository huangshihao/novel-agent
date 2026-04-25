import type { ChatInfo } from '@novel-agent/shared'
import { paths } from './paths.js'
import { readMdIfExists, writeMd } from './markdown.js'

interface ChatsIndex {
  chats: ChatInfo[]
}

export async function readChatsIndex(novelId: string): Promise<ChatInfo[]> {
  const f = await readMdIfExists<ChatsIndex>(paths.chatsIndex(novelId))
  return f?.frontMatter.chats ?? []
}

export async function writeChatsIndex(
  novelId: string,
  chats: ChatInfo[],
): Promise<void> {
  await writeMd(
    paths.chatsIndex(novelId),
    { chats } as unknown as Record<string, unknown>,
    '',
  )
}

export async function appendChat(novelId: string, chat: ChatInfo): Promise<void> {
  const chats = await readChatsIndex(novelId)
  chats.push(chat)
  await writeChatsIndex(novelId, chats)
}

export async function updateChat(
  novelId: string,
  chatId: string,
  patch: Partial<ChatInfo>,
): Promise<ChatInfo | null> {
  const chats = await readChatsIndex(novelId)
  const idx = chats.findIndex((c) => c.id === chatId)
  if (idx < 0) return null
  const updated: ChatInfo = { ...chats[idx]!, ...patch }
  chats[idx] = updated
  await writeChatsIndex(novelId, chats)
  return updated
}

export async function removeChat(novelId: string, chatId: string): Promise<boolean> {
  const chats = await readChatsIndex(novelId)
  const next = chats.filter((c) => c.id !== chatId)
  if (next.length === chats.length) return false
  await writeChatsIndex(novelId, next)
  return true
}

export async function findChat(
  novelId: string,
  chatId: string,
): Promise<ChatInfo | null> {
  const chats = await readChatsIndex(novelId)
  return chats.find((c) => c.id === chatId) ?? null
}
