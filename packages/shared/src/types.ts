// 跨端共享类型。后端 MD 存储和前端组件都消费这些。

export type NovelStatus =
  | 'uploaded'
  | 'splitting'
  | 'analyzing'
  | 'ready'
  | 'failed'

export interface Novel {
  id: string
  title: string
  status: NovelStatus
  chapter_count: number
  analyzed_count: number
  analysis_from: number
  analysis_to: number
  analyzed_to: number
  error?: string | null
  created_at: number
  updated_at: number
}

export interface Chapter {
  id: number
  novel_id: string
  number: number
  title: string
  original_text: string
  summary: string | null
}

export type CharacterRole =
  | 'protagonist'
  | 'female-lead'
  | 'antagonist'
  | 'mentor'
  | 'family'
  | 'side'
  | 'tool'

export interface Character {
  id: number
  novel_id: string
  name: string
  aliases: string[]
  role: CharacterRole | null
  function_tags: string[]
  death_chapter: number | null
  description: string
  first_chapter: number
  last_chapter: number
}

export type SubplotFunction =
  | 'create-crisis'
  | 'deliver-payoff'
  | 'establish-setting'
  | 'romance'
  | 'growth'

export interface Subplot {
  id: number
  novel_id: string
  name: string
  function: SubplotFunction | null
  description: string
  start_chapter: number
  end_chapter: number
  chapters: number[]
}

export type HookCategory =
  | 'suspense'
  | 'crisis'
  | 'payoff'
  | 'goal'
  | 'secret'
  | 'relation'
  | 'rule'
  | 'contrast'
  | 'emotion'

export interface Hook {
  id: number
  novel_id: string
  description: string
  category: HookCategory | null
  planted_chapter: number
  payoff_chapter: number | null
  evidence_chapters: number[]
}

// SSE event payloads
export type AnalysisEvent =
  | { type: 'split.done'; chapter_count: number }
  | { type: 'analyze.progress'; analyzed: number; total: number }
  | { type: 'analyze.chapter'; number: number; title: string }
  | { type: 'status'; status: NovelStatus }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type AgentRole = 'outline' | 'writer'
export type AgentMode = 'generate' | 'revise'

export interface AgentSessionInfo {
  id: string
  novel_id: string
  role: AgentRole
  mode: AgentMode
  scope: { from: number; to: number }
  requirement?: string
  feedback?: string
  created_at: number
}

export type BatchJobStatus = 'running' | 'paused' | 'done' | 'aborted'

export interface BatchJobInfo {
  id: string
  novel_id: string
  requirement: string
  chapters: number[]
  cursor: number
  completed: number[]
  failed: number[]
  current: number | null
  status: BatchJobStatus
  error?: string
  created_at: number
}

export type ActiveTask =
  | { kind: 'session'; session: AgentSessionInfo }
  | { kind: 'batch'; batch: BatchJobInfo }

export type AgentEvent =
  | { type: 'message.delta'; content: string }
  | { type: 'message.complete'; content: string }
  | { type: 'tool.call'; name: string; params: unknown }
  | { type: 'tool.result'; name: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'batch.progress'; completed: number; total: number; current: number | null }
  | { type: 'batch.worker_start'; chapter: number }
  | { type: 'batch.worker_end'; chapter: number; ok: boolean; error?: string }
  | { type: 'batch.done' }
  | { type: 'batch.aborted' }
  | { type: 'batch.paused'; chapter: number; error: string }

// Target (rewrite) records — shared between agent-server storage and web client
export interface CharacterMapEntry {
  source: string
  target: string
  note?: string
}

export interface SettingMap {
  original_industry: string
  target_industry: string
  key_term_replacements: Record<string, string>
}

export interface MapsRecord {
  character_map: CharacterMapEntry[]
  setting_map: SettingMap | null
}

export interface OutlineRecord {
  number: number
  source_chapter_ref: number
  hooks_to_plant: string[]
  hooks_to_payoff: string[]
  planned_state_changes: {
    character_deaths: string[]
    new_settings: string[]
  }
  plot: string
  key_events: string[]
}

export interface ChapterDraftRecord {
  number: number
  title: string
  word_count: number
  written_at: string
  content: string
}

export type ChapterDraftSummary = Omit<ChapterDraftRecord, 'content'>

// State (alive status + hook progression) record
export interface AliveStatus {
  alive: boolean
  last_seen_chapter: number
  death_chapter?: number
}

export interface NewHook {
  id: string
  description: string
  planted_chapter: number
  expected_payoff_chapter: number | null
  status: 'open' | 'paid_off'
  paid_chapter?: number
}

export interface StateRecord {
  alive_status: Record<string, AliveStatus>
  hooks: Record<string, { status: 'open' | 'paid_off'; paid_chapter?: number }>
  new_hooks: NewHook[]
}
