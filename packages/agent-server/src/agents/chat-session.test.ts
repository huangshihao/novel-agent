import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chatSystemPrompt } from './system-prompts.js'

describe('chat agent source isolation', () => {
  it('does not register generic filesystem tools', () => {
    const source = readFileSync(new URL('./chat-session.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('readTool')
    expect(source).not.toContain('grepTool')
    expect(source).not.toContain('lsTool')
  })

  it('does not advertise source chapter files to the agent', () => {
    const prompt = chatSystemPrompt({ novelId: 'nv-test', analyzedTo: 10 })

    expect(prompt).not.toContain('/source/chapters/')
    expect(prompt).not.toContain('source/chapters/*.md')
    expect(prompt).not.toContain('/source/raw/')
  })
})
