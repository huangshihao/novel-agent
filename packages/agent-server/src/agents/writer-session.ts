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
import { buildWriterAgentTools } from './tools/index.js'
import { writerAgentSystemPrompt } from './system-prompts.js'

export interface WriterAgentInit {
  novelId: string
  chapterNumber: number
  mode: AgentMode
  requirement?: string  // generate mode (per-batch global)
  feedback?: string  // revise mode
}

export async function createWriterAgent(init: WriterAgentInit): Promise<AgentSession> {
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(AGENT_PROVIDER, process.env['AGENT_API_KEY'] ?? '')
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: writerAgentSystemPrompt({
      novelId: init.novelId,
      chapterNumber: init.chapterNumber,
      mode: init.mode,
      requirement: init.requirement,
      feedback: init.feedback,
    }),
  })
  await resourceLoader.reload()
  // Tool scope is single-chapter [n,n] so writeChapter validates correctly
  const scope = { from: init.chapterNumber, to: init.chapterNumber }
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: [readTool, grepTool, lsTool],
    customTools: buildWriterAgentTools(init.novelId, scope),
    sessionManager: SessionManager.inMemory(process.cwd()),
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
