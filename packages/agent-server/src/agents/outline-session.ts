import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  DefaultResourceLoader,
  readTool,
  grepTool,
  lsTool,
} from '@mariozechner/pi-coding-agent'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { buildAgentModel, AGENT_PROVIDER } from './model.js'
import { buildOutlineAgentTools } from './tools/index.js'
import { outlineAgentSystemPrompt } from './system-prompts.js'
import type { BatchRange } from './tools/write-chapter-outline.js'

export interface OutlineAgentInit {
  novelId: string
  batch: BatchRange
}

export async function createOutlineAgent(init: OutlineAgentInit): Promise<AgentSession> {
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(AGENT_PROVIDER, process.env['AGENT_API_KEY'] ?? '')
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: outlineAgentSystemPrompt(init.novelId, init.batch),
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: [readTool, grepTool, lsTool],
    customTools: buildOutlineAgentTools(init.novelId, init.batch),
    sessionManager: SessionManager.inMemory(process.cwd()),
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
