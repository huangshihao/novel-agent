import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths.js'

let _db: Database.Database | null = null

export function db(): Database.Database {
  if (_db) return _db
  const root = paths.root()
  mkdirSync(root, { recursive: true })
  const file = join(root, 'novel-agent.db')
  _db = new Database(file)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  return _db
}
