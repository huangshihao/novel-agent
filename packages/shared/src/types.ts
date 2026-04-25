// 跨端共享类型。后端 SQLite schema 和前端组件都消费这些。

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
  analyzed_count: number // 当前/最近一次 run 中已完成的章节数
  analysis_from: number // 当前/最近一次 run 的起始章号
  analysis_to: number // 当前/最近一次 run 的终止章号
  analyzed_to: number // 高水位：累计已分析到第几章（≤ chapter_count）
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

export interface Character {
  id: number
  novel_id: string
  name: string
  aliases: string[]
  description: string
  first_chapter: number
  last_chapter: number
}

export interface Subplot {
  id: number
  novel_id: string
  name: string
  description: string
  start_chapter: number
  end_chapter: number
  chapters: number[]
}

export type HookType = 'short' | 'long'

export type HookCategory =
  | 'suspense' // 悬念：真相/为什么/是谁
  | 'crisis' // 危机：危险/惩罚/暴露/失去
  | 'payoff' // 爽点兑现：前文压迫/羞辱/轻视未被释放
  | 'goal' // 目标：主角尚未完成的明确追求
  | 'secret' // 身份/秘密：身份/过去/血脉/能力隐藏
  | 'relation' // 关系：感情/仇恨/误会/背叛未解
  | 'rule' // 规则/设定：新系统/副本/职业/限制
  | 'contrast' // 反差：表面与真实、现在与未来
  | 'emotion' // 情绪欠账：愤怒/委屈/期待未被释放

export interface Hook {
  id: number
  novel_id: string
  description: string
  type: HookType
  category: HookCategory | null
  planted_chapter: number
  payoff_chapter: number | null
  /** 证据章节列表：单章钩子是 [planted_chapter]；跨章结构性钩子则列出全部被串起来的章节。 */
  evidence_chapters: number[]
}

// SSE event payloads (server → web)
export type AnalysisEvent =
  | { type: 'split.done'; chapter_count: number }
  | { type: 'analyze.progress'; analyzed: number; total: number }
  | { type: 'analyze.chapter'; number: number; title: string }
  | { type: 'status'; status: NovelStatus }
  | { type: 'done' }
  | { type: 'error'; message: string }
