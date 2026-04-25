import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { buildUpdateMapsTool } from './update-maps.js'
import { buildWriteChapterOutlineTool, type BatchRange } from './write-chapter-outline.js'
import { buildGetChapterContextTool } from './get-chapter-context.js'
import { buildWriteChapterTool } from './write-chapter.js'

export function buildOutlineAgentTools(novelId: string, batch: BatchRange): ToolDefinition[] {
  return [
    buildUpdateMapsTool(novelId),
    buildWriteChapterOutlineTool(novelId, batch),
  ]
}

export function buildWriterAgentTools(novelId: string, batch: BatchRange): ToolDefinition[] {
  return [
    buildGetChapterContextTool(novelId),
    buildWriteChapterTool(novelId, batch),
  ]
}

export type { BatchRange } from './write-chapter-outline.js'
