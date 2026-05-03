import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  DefaultResourceLoader,
} from '@mariozechner/pi-coding-agent'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { buildAgentModel, AGENT_PROVIDER } from './model.js'
import { buildChatAgentTools } from './tools/index.js'
import { chatSystemPrompt } from './system-prompts.js'
import { paths } from '../storage/paths.js'
import { readNovelIndex } from '../storage/novel-index.js'

export interface ChatAgentInit {
  novelId: string
  chatId: string
}

export async function createChatAgent(init: ChatAgentInit): Promise<AgentSession> {
  const novel = await readNovelIndex(init.novelId)
  if (!novel) throw new Error(`novel ${init.novelId} not found`)
  const analyzedTo = novel.analyzed_to
  if (analyzedTo < 1) {
    throw new Error(`novel ${init.novelId} has no analyzed chapters yet`)
  }

  const sessionFile = paths.chatSession(init.novelId, init.chatId)
  const sessionDir = dirname(sessionFile)
  await Promise.all([
    mkdir(sessionDir, { recursive: true }),
    mkdir(paths.targetOutlinesDir(init.novelId), { recursive: true }),
    mkdir(paths.targetChaptersDir(init.novelId), { recursive: true }),
  ])

  const sessionManager = existsSync(sessionFile)
    ? SessionManager.open(sessionFile, sessionDir)
    : SessionManager.create(process.cwd(), sessionDir)
  sessionManager.setSessionFile(sessionFile)

  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(AGENT_PROVIDER, process.env['AGENT_API_KEY'] ?? '')
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: chatSystemPrompt({ novelId: init.novelId, analyzedTo }),
  })
  await resourceLoader.reload()

  const scope = { from: 1, to: analyzedTo }
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: [],
    customTools: buildChatAgentTools(init.novelId, scope),
    sessionManager,
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
