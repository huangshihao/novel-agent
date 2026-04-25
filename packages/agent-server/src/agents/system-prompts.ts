export interface OutlineSystemPromptInput {
  novelId: string
  scope: { from: number; to: number }
  mode: 'generate' | 'revise'
  requirement?: string
  reviseChapter?: number
  feedback?: string
}

export function outlineAgentSystemPrompt(input: OutlineSystemPromptInput): string {
  // FULL CONTENT IN TASK 7 — temporary stub for compile
  return `placeholder for ${input.novelId} ${input.mode}`
}

export interface WriterSystemPromptInput {
  novelId: string
  chapterNumber: number
  mode: 'generate' | 'revise'
  requirement?: string
  feedback?: string
}

export function writerAgentSystemPrompt(input: WriterSystemPromptInput): string {
  // FULL CONTENT IN TASK 7 — stub
  return `placeholder writer ${input.novelId} ${input.chapterNumber} ${input.mode}`
}
