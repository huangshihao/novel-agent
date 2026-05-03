import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { buildUpdateMapsTool } from './update-maps.js'
import { buildGetOutlineContextTool } from './get-outline-context.js'
import { buildWriteChapterOutlineTool, type BatchRange } from './write-chapter-outline.js'
import { buildGetChapterContextTool } from './get-chapter-context.js'
import { buildWriteChapterTool } from './write-chapter.js'

export function buildChatAgentTools(
  novelId: string,
  scope: BatchRange,
): ToolDefinition[] {
  return [
    buildUpdateMapsTool(novelId),
    buildGetOutlineContextTool(novelId),
    buildWriteChapterOutlineTool(novelId, scope),
    buildGetChapterContextTool(novelId),
    buildWriteChapterTool(novelId, scope),
  ]
}

export type { BatchRange } from './write-chapter-outline.js'
