import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChat, listChats, deleteChat, getChat, updateChatTitle, touchChatLastMsg } from './chat-store.js'
import { db } from './db.js'

const NOVEL_ID = 'nv-test-1'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chat-store-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
  try {
    db().exec(`DELETE FROM chat_part; DELETE FROM chat_message; DELETE FROM chat_session;`)
  } catch { /* tables may not exist on first run */ }
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('chat-store (sqlite)', () => {
  it('createChat returns metadata with id starting with cht-', async () => {
    const chat = await createChat(NOVEL_ID, '前 10 章大纲')
    expect(chat.id).toMatch(/^cht-/)
    expect(chat.title).toBe('前 10 章大纲')
    expect(chat.novel_id).toBe(NOVEL_ID)
    const list = await listChats(NOVEL_ID)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(chat.id)
  })

  it('createChat with no title defaults to "新对话"', async () => {
    const chat = await createChat(NOVEL_ID)
    expect(chat.title).toBe('新对话')
  })

  it('listChats returns empty array when no chats', async () => {
    const list = await listChats(NOVEL_ID)
    expect(list).toEqual([])
  })

  it('getChat returns null for unknown id', async () => {
    const chat = await getChat(NOVEL_ID, 'cht-nonexistent')
    expect(chat).toBeNull()
  })

  it('updateChatTitle changes title and persists', async () => {
    const chat = await createChat(NOVEL_ID, 'old')
    const updated = await updateChatTitle(NOVEL_ID, chat.id, 'new')
    expect(updated?.title).toBe('new')
    const reread = await getChat(NOVEL_ID, chat.id)
    expect(reread?.title).toBe('new')
  })

  it('touchChatLastMsg updates last_msg_at and last_user_text', async () => {
    const chat = await createChat(NOVEL_ID, 't')
    const before = chat.last_msg_at
    await new Promise((r) => setTimeout(r, 10))
    const updated = await touchChatLastMsg(NOVEL_ID, chat.id, 'hello world')
    expect(updated?.last_user_text).toBe('hello world')
    expect(updated!.last_msg_at).not.toBe(before)
  })

  it('deleteChat removes from db and removes jsonl file if exists', async () => {
    const chat = await createChat(NOVEL_ID, 't')
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { paths } = await import('./paths.js')
    mkdirSync(paths.chatsDir(NOVEL_ID), { recursive: true })
    writeFileSync(paths.chatSession(NOVEL_ID, chat.id), '')
    expect(existsSync(paths.chatSession(NOVEL_ID, chat.id))).toBe(true)
    await deleteChat(NOVEL_ID, chat.id)
    expect(existsSync(paths.chatSession(NOVEL_ID, chat.id))).toBe(false)
    expect(await getChat(NOVEL_ID, chat.id)).toBeNull()
  })

  it('listChats sorts by last_msg_at desc', async () => {
    const a = await createChat(NOVEL_ID, 'a')
    await new Promise((r) => setTimeout(r, 10))
    const b = await createChat(NOVEL_ID, 'b')
    await new Promise((r) => setTimeout(r, 10))
    await touchChatLastMsg(NOVEL_ID, a.id, 'newer touch on a')
    const list = await listChats(NOVEL_ID)
    expect(list[0]!.id).toBe(a.id)
    expect(list[1]!.id).toBe(b.id)
  })
})
