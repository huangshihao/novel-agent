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
  plot_functions?: string[]
  key_events?: KeyEventEntry[]
  originality_risks?: string[]
  writing_rhythm?: WritingRhythm | null
}

// 每个关键事件的功能化标签 — 改写时按 function 重做载体而不是抄 desc
export interface KeyEventEntry {
  desc: string
  function: string
  can_replace: boolean
  can_reorder: boolean
  depends_on: string[]
}

// 章节写作节奏(改写正文时按此匹配 beat / 情绪曲线)
// 只保留对正文生成最有指导意义的 5 个维度,其余信息已在 key_events / meta.style_samples 里覆盖
export interface WritingRhythm {
  text_composition: {
    action_narration_ratio: string
    dialogue_ratio: string
    inner_monologue_ratio: string
    exposition_ratio: string
    description_ratio: string
    conflict_ratio: string
    summary_transition_ratio: string
  }
  pacing_profile: {
    opening_speed: string
    middle_speed: string
    ending_speed: string
    overall_rhythm: string
  }
  emotional_curve: {
    opening_emotion: string
    middle_emotion: string
    climax_emotion: string
    ending_emotion: string
    emotion_shift_points: Array<{
      position: string
      from: string
      to: string
      trigger: string
    }>
  }
  reader_attention_design: {
    opening_hook: string
    micro_hooks: string[]
    chapter_end_hook: string
  }
  chapter_writing_pattern: {
    structure_type: string
    beat_sequence: string[]
    core_rhythm: string
  }
}

export type CharacterRole =
  | 'protagonist'
  | 'female-lead'
  | 'antagonist'
  | 'mentor'
  | 'family'
  | 'side'
  | 'tool'

export type CharacterStoryFunction =
  | 'pressure-source'
  | 'benefactor'
  | 'rival'
  | 'witness'
  | 'resource-gateway'
  | 'emotional-anchor'
  | 'antagonist-proxy'
  | 'foil'
  | 'information-source'
  | 'gatekeeper'

export type Replaceability = 'high' | 'medium' | 'low'

export interface Character {
  id: number
  novel_id: string
  name: string
  aliases: string[]
  role: CharacterRole | null
  function_tags: string[]
  story_function: CharacterStoryFunction | null
  replaceability: Replaceability | null
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
  delivers: string
  depends_on: string[]
  reorderable: boolean
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

export interface ChatInfo {
  id: string
  novel_id: string
  title: string
  created_at: string
  last_msg_at: string
  last_user_text: string
}

export type ActiveTask = { chatId: string } | null

export type AgentEvent =
  | { type: 'message.delta'; content: string }
  | { type: 'message.complete'; content: string }
  | { type: 'tool.call'; id: string; name: string; params: unknown }
  | { type: 'tool.result'; id: string; name: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type ThreadUiMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown; result?: unknown }

export interface ThreadUiMessage {
  id: string
  role: 'user' | 'assistant'
  parts: ThreadUiMessagePart[]
}

// Target (rewrite) records — shared between agent-server storage and web client
export interface CharacterSourceMeta {
  role: string | null
  story_function: string | null
  replaceability: string | null
  first_chapter: number | null
  last_chapter: number | null
  description: string
}

export interface CharacterMapEntry {
  source: string | null
  target: string
  source_meta: CharacterSourceMeta | null
  target_note: string | null
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

export interface OutlineKeyEvent {
  function: string
  new_carrier: string
}

export type RetentionHookType =
  | 'crisis'
  | 'information'
  | 'identity'
  | 'relation'
  | 'goal'
  | 'reward'
  | 'punishment'
  | 'reversal'
  | 'secret'
  | 'emotion'

export interface ReaderContract {
  core_emotion: string
  main_selling_point: string
  protagonist_desire: string
  main_conflict: string
  long_term_question: string
}

export interface GoldenThreeDiagnosticScores {
  protagonist_entry_speed: number
  conflict_strength: number
  empathy: number
  mainline_clarity: number
  payoff_clarity: number
  ending_hook_strength: number
  information_density: number
  platform_fit: number
}

export interface GoldenThreePlan {
  chapter_role: 'strong_situation' | 'first_payoff' | 'mainline_lock'
  reader_contract: ReaderContract
  diagnostic_scores: GoldenThreeDiagnosticScores
}

export interface ChapterRetentionPlan {
  inherited_hook: string
  chapter_goal: string
  opening_hook: string
  new_obstacle: string
  midpoint_turn: string
  payoff: string
  ending_hook: string
  reader_expectation: string
  retention_risk: string
}

export interface HookPlan {
  id: string
  type: RetentionHookType
  description: string
  expected_payoff_chapter: number | null
  payoff_plan: string
}

export interface OutlineRecord {
  number: number
  source_chapter_ref: number
  plot_functions: string[]
  hooks_to_plant: string[]
  hooks_to_payoff: string[]
  planned_state_changes: {
    character_deaths: string[]
    new_settings: string[]
  }
  plot: string
  key_events: OutlineKeyEvent[]
  referenced_characters: string[]
  retention_plan?: ChapterRetentionPlan | null
  golden_three_plan?: GoldenThreePlan | null
  hook_plans?: HookPlan[]
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
  type?: RetentionHookType | null
  description: string
  planted_chapter: number
  expected_payoff_chapter: number | null
  payoff_plan?: string
  status: 'open' | 'paid_off'
  paid_chapter?: number
}

export interface StateRecord {
  alive_status: Record<string, AliveStatus>
  hooks: Record<string, { status: 'open' | 'paid_off'; paid_chapter?: number }>
  new_hooks: NewHook[]
}
