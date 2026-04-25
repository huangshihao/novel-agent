// SQLite 存储。WAL + 外键 + 原地 CREATE IF NOT EXISTS，参考 play-agent 风格。

import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = process.env['NOVEL_AGENT_DATA_DIR'] ?? join(homedir(), '.novel-agent')
const DB_PATH = join(DATA_DIR, 'data.db')

mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
db.pragma('cache_size = -64000')

db.exec(`
  CREATE TABLE IF NOT EXISTS novel (
    id             TEXT PRIMARY KEY,
    title          TEXT NOT NULL,
    status         TEXT NOT NULL,
    chapter_count  INTEGER NOT NULL DEFAULT 0,
    analyzed_count INTEGER NOT NULL DEFAULT 0,
    analysis_from  INTEGER NOT NULL DEFAULT 1,
    analysis_to    INTEGER NOT NULL DEFAULT 100,
    analyzed_to    INTEGER NOT NULL DEFAULT 0,
    error          TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chapter (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id      TEXT NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
    number        INTEGER NOT NULL,
    title         TEXT NOT NULL,
    original_text TEXT NOT NULL,
    summary       TEXT,
    UNIQUE(novel_id, number)
  );
  CREATE INDEX IF NOT EXISTS idx_chapter_novel ON chapter(novel_id, number);

  -- 每章结构化抽取（pass 1 原始输出，保留以便 re-aggregate 或调试）
  CREATE TABLE IF NOT EXISTS chapter_extract (
    chapter_id          INTEGER PRIMARY KEY REFERENCES chapter(id) ON DELETE CASCADE,
    characters_json     TEXT NOT NULL DEFAULT '[]',
    events_json         TEXT NOT NULL DEFAULT '[]',
    hooks_planted_json  TEXT NOT NULL DEFAULT '[]',
    hooks_paid_json     TEXT NOT NULL DEFAULT '[]'
  );

  -- 以下为 pass 2 聚合输出
  CREATE TABLE IF NOT EXISTS character (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id      TEXT NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    aliases_json  TEXT NOT NULL DEFAULT '[]',
    description   TEXT NOT NULL DEFAULT '',
    first_chapter INTEGER NOT NULL,
    last_chapter  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_character_novel ON character(novel_id);

  CREATE TABLE IF NOT EXISTS character_mention (
    character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
    chapter_id   INTEGER NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
    PRIMARY KEY (character_id, chapter_id)
  );

  CREATE TABLE IF NOT EXISTS subplot (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id      TEXT NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    start_chapter INTEGER NOT NULL,
    end_chapter   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_subplot_novel ON subplot(novel_id);

  CREATE TABLE IF NOT EXISTS subplot_chapter (
    subplot_id INTEGER NOT NULL REFERENCES subplot(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
    PRIMARY KEY (subplot_id, chapter_id)
  );

  CREATE TABLE IF NOT EXISTS hook (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id               TEXT NOT NULL REFERENCES novel(id) ON DELETE CASCADE,
    description            TEXT NOT NULL,
    type                   TEXT NOT NULL CHECK(type IN ('short','long')),
    category               TEXT,
    planted_chapter        INTEGER NOT NULL,
    payoff_chapter         INTEGER,
    evidence_chapters_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX IF NOT EXISTS idx_hook_novel ON hook(novel_id);
`)

// 幂等迁移：老库补上新列
function addColumnIfMissing(table: string, column: string, def: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
  }
}
addColumnIfMissing('novel', 'analysis_from', 'INTEGER NOT NULL DEFAULT 1')
addColumnIfMissing('novel', 'analysis_to', 'INTEGER NOT NULL DEFAULT 100')
addColumnIfMissing('novel', 'analyzed_to', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfMissing('hook', 'category', 'TEXT')
addColumnIfMissing('hook', 'evidence_chapters_json', `TEXT NOT NULL DEFAULT '[]'`)

// 老库数据修复：把过去已完成分析的 analyzed_to 补齐到 analysis_to
db.exec(
  `UPDATE novel SET analyzed_to = analysis_to
   WHERE analyzed_to = 0 AND status = 'ready' AND analysis_to > 0`,
)

export function closeDb() {
  try {
    db.close()
  } catch {
    /* noop */
  }
}
