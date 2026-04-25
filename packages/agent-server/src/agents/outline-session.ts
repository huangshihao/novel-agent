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
import type { AgentMode } from '@novel-agent/shared'
import { buildAgentModel, AGENT_PROVIDER } from './model.js'
import { buildOutlineAgentTools } from './tools/index.js'
import { outlineAgentSystemPrompt } from './system-prompts.js'

export interface OutlineAgentInit {
  novelId: string
  scope: { from: number; to: number }
  mode: AgentMode
  requirement?: string  // generate mode
  reviseChapter?: number  // revise mode
  feedback?: string  // revise mode
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
    systemPrompt: outlineAgentSystemPrompt({
      novelId: init.novelId,
      scope: init.scope,
      mode: init.mode,
      requirement: init.requirement,
      reviseChapter: init.reviseChapter,
      feedback: init.feedback,
    }),
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: [readTool, grepTool, lsTool],
    customTools: buildOutlineAgentTools(init.novelId, init.scope),
    sessionManager: SessionManager.inMemory(process.cwd()),
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
