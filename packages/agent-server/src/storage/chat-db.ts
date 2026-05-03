import type {
  ChatInfo,
  ThreadUiMessage,
  ThreadUiMessagePart,
} from '@novel-agent/shared'
import { db } from './db.js'

let initialized = false

function init(): void {
  if (initialized) return
  const d = db()
  d.exec(`
    CREATE TABLE IF NOT EXISTS chat_session (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_user_text TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session_novel ON chat_session(novel_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_session(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ord INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_message_session ON chat_message(session_id, ord);

    CREATE TABLE IF NOT EXISTS chat_part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES chat_message(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      ord INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_part_message ON chat_part(message_id, ord);
  `)
  initialized = true
}

function conn() {
  init()
  return db()
}

interface SessionRow {
  id: string
  novel_id: string
  title: string
  created_at: number
  updated_at: number
  last_user_text: string
}

interface MessageRow {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  created_at: number
  ord: number
}

interface PartRow {
  id: string
  message_id: string
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_result'
  ord: number
  data: string
}

function toChatInfo(row: SessionRow): ChatInfo {
  return {
    id: row.id,
    novel_id: row.novel_id,
    title: row.title,
    created_at: new Date(row.created_at).toISOString(),
    last_msg_at: new Date(row.updated_at).toISOString(),
    last_user_text: row.last_user_text,
  }
}

function genId(prefix: string): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${ts}-${rand}`
}

export function chatExists(chatId: string): boolean {
  const row = conn()
    .prepare(`SELECT 1 FROM chat_session WHERE id = ?`)
    .get(chatId) as { 1: number } | undefined
  return Boolean(row)
}

export function createChatRow(
  novelId: string,
  chatId: string,
  title: string,
  createdAtMs: number = Date.now(),
): ChatInfo {
  conn()
    .prepare(
      `INSERT INTO chat_session (id, novel_id, title, created_at, updated_at, last_user_text)
       VALUES (?, ?, ?, ?, ?, '')`,
    )
    .run(chatId, novelId, title, createdAtMs, createdAtMs)
  return {
    id: chatId,
    novel_id: novelId,
    title,
    created_at: new Date(createdAtMs).toISOString(),
    last_msg_at: new Date(createdAtMs).toISOString(),
    last_user_text: '',
  }
}

export function listChatRows(novelId: string): ChatInfo[] {
  const rows = conn()
    .prepare(
      `SELECT id, novel_id, title, created_at, updated_at, last_user_text
       FROM chat_session WHERE novel_id = ? ORDER BY updated_at DESC`,
    )
    .all(novelId) as SessionRow[]
  return rows.map(toChatInfo)
}

export function getChatRow(novelId: string, chatId: string): ChatInfo | null {
  const row = conn()
    .prepare(
      `SELECT id, novel_id, title, created_at, updated_at, last_user_text
       FROM chat_session WHERE novel_id = ? AND id = ?`,
    )
    .get(novelId, chatId) as SessionRow | undefined
  return row ? toChatInfo(row) : null
}

export function updateChatTitleRow(
  novelId: string,
  chatId: string,
  title: string,
): ChatInfo | null {
  const info = conn()
    .prepare(
      `UPDATE chat_session SET title = ?, updated_at = ?
       WHERE novel_id = ? AND id = ?`,
    )
    .run(title, Date.now(), novelId, chatId)
  if (info.changes === 0) return null
  return getChatRow(novelId, chatId)
}

export function touchChatRow(
  novelId: string,
  chatId: string,
  lastUserText: string,
): ChatInfo | null {
  const info = conn()
    .prepare(
      `UPDATE chat_session SET updated_at = ?, last_user_text = ?
       WHERE novel_id = ? AND id = ?`,
    )
    .run(Date.now(), lastUserText.slice(0, 80), novelId, chatId)
  if (info.changes === 0) return null
  return getChatRow(novelId, chatId)
}

export function deleteChatRow(novelId: string, chatId: string): boolean {
  const info = conn()
    .prepare(`DELETE FROM chat_session WHERE novel_id = ? AND id = ?`)
    .run(novelId, chatId)
  return info.changes > 0
}

function nextMessageOrd(sessionId: string): number {
  const row = conn()
    .prepare(`SELECT COALESCE(MAX(ord), -1) AS m FROM chat_message WHERE session_id = ?`)
    .get(sessionId) as { m: number }
  return row.m + 1
}

export function appendUserMessage(
  novelId: string,
  chatId: string,
  text: string,
  createdAtMs: number = Date.now(),
): string {
  const messageId = genId('msg')
  const ord = nextMessageOrd(chatId)
  const d = conn()
  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO chat_message (id, session_id, role, created_at, ord)
       VALUES (?, ?, 'user', ?, ?)`,
    ).run(messageId, chatId, createdAtMs, ord)
    d.prepare(
      `INSERT INTO chat_part (id, message_id, type, ord, data)
       VALUES (?, ?, 'text', 0, ?)`,
    ).run(genId('prt'), messageId, JSON.stringify({ text }))
  })
  tx()
  void novelId
  return messageId
}

export interface AssistantPartInput {
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_result'
  data: Record<string, unknown>
}

export function appendAssistantMessage(
  novelId: string,
  chatId: string,
  parts: AssistantPartInput[],
  createdAtMs: number = Date.now(),
): string {
  const messageId = genId('msg')
  const ord = nextMessageOrd(chatId)
  const d = conn()
  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO chat_message (id, session_id, role, created_at, ord)
       VALUES (?, ?, 'assistant', ?, ?)`,
    ).run(messageId, chatId, createdAtMs, ord)
    const stmt = d.prepare(
      `INSERT INTO chat_part (id, message_id, type, ord, data)
       VALUES (?, ?, ?, ?, ?)`,
    )
    parts.forEach((p, i) => {
      stmt.run(genId('prt'), messageId, p.type, i, JSON.stringify(p.data))
    })
  })
  tx()
  void novelId
  return messageId
}

export function appendToolResultPart(
  chatId: string,
  toolCallId: string,
  result: unknown,
  isError: boolean,
): void {
  const d = conn()
  const callRow = d
    .prepare(
      `SELECT p.id AS id, p.message_id AS message_id, p.data AS data
       FROM chat_part p
       JOIN chat_message m ON m.id = p.message_id
       WHERE m.session_id = ? AND p.type = 'tool_call'
       ORDER BY m.ord DESC, p.ord DESC`,
    )
    .all(chatId) as { id: string; message_id: string; data: string }[]

  const target = callRow.find((r) => {
    try {
      const parsed = JSON.parse(r.data) as { tool_call_id?: string }
      return parsed.tool_call_id === toolCallId
    } catch {
      return false
    }
  })
  if (!target) return
  const parsed = JSON.parse(target.data) as Record<string, unknown>
  parsed['result'] = result
  parsed['is_error'] = isError
  d.prepare(`UPDATE chat_part SET data = ? WHERE id = ?`).run(
    JSON.stringify(parsed),
    target.id,
  )
}

export function loadHistoryForUi(
  novelId: string,
  chatId: string,
): ThreadUiMessage[] {
  const d = conn()
  const exists = d
    .prepare(`SELECT 1 FROM chat_session WHERE novel_id = ? AND id = ?`)
    .get(novelId, chatId)
  if (!exists) return []
  const messages = d
    .prepare(
      `SELECT id, session_id, role, created_at, ord
       FROM chat_message WHERE session_id = ? ORDER BY ord ASC`,
    )
    .all(chatId) as MessageRow[]
  if (messages.length === 0) return []
  const ids = messages.map((m) => m.id)
  const placeholders = ids.map(() => '?').join(',')
  const parts = d
    .prepare(
      `SELECT id, message_id, type, ord, data FROM chat_part
       WHERE message_id IN (${placeholders}) ORDER BY ord ASC`,
    )
    .all(...ids) as PartRow[]
  const partsByMsg = new Map<string, PartRow[]>()
  for (const p of parts) {
    const arr = partsByMsg.get(p.message_id) ?? []
    arr.push(p)
    partsByMsg.set(p.message_id, arr)
  }
  const out: ThreadUiMessage[] = []
  for (const m of messages) {
    const ps = partsByMsg.get(m.id) ?? []
    const uiParts: ThreadUiMessagePart[] = []
    for (const p of ps) {
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(p.data) as Record<string, unknown> } catch { /* keep empty */ }
      if (p.type === 'text') {
        const text = typeof data['text'] === 'string' ? (data['text'] as string) : ''
        if (text.length > 0) uiParts.push({ type: 'text', text })
      } else if (p.type === 'reasoning') {
        const text = typeof data['text'] === 'string' ? (data['text'] as string) : ''
        if (text.length > 0) uiParts.push({ type: 'reasoning', text })
      } else if (p.type === 'tool_call') {
        const id = typeof data['tool_call_id'] === 'string' ? (data['tool_call_id'] as string) : '?'
        const name = typeof data['name'] === 'string' ? (data['name'] as string) : '?'
        const args = data['args'] ?? {}
        const result = 'result' in data ? data['result'] : undefined
        uiParts.push({ type: 'tool-call', id, name, args, result })
      }
    }
    if (uiParts.length === 0) continue
    out.push({ id: m.id, role: m.role, parts: uiParts })
  }
  return out
}
