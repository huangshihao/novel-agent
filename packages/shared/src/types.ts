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
