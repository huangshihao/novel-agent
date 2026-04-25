import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { buildUpdateMapsTool } from './update-maps.js'
import { buildWriteChapterOutlineTool, type BatchRange } from './write-chapter-outline.js'
import { buildGetChapterContextTool } from './get-chapter-context.js'
import { buildWriteChapterTool } from './write-chapter.js'

/**
 * Chat agent 一次拿所有 4 个 tool。
 * scope 给 [1, analyzedTo]，表示 agent 可写任意已分析过的章节。
 */
export function buildChatAgentTools(
  novelId: string,
  scope: BatchRange,
): ToolDefinition[] {
  return [
    buildUpdateMapsTool(novelId),
    buildWriteChapterOutlineTool(novelId, scope),
    buildGetChapterContextTool(novelId),
    buildWriteChapterTool(novelId, scope),
  ]
}

export type { BatchRange } from './write-chapter-outline.js'
