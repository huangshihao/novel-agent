import assert from 'node:assert/strict'
import test from 'node:test'
import { completeAssistantText, type AssistantTurn } from '../src/lib/chat-turn.js'

test('message.complete 显示在本轮消息最下面', () => {
  const turn: AssistantTurn = {
    id: 'a-1',
    parts: [
      { type: 'text', text: '流式占位' },
      { type: 'tool-call', id: 'tool-1', name: 'read', params: {} },
      { type: 'reasoning', text: '工具后思考' },
    ],
  }

  completeAssistantText(turn, '最终正文')

  assert.deepEqual(turn.parts, [
    { type: 'tool-call', id: 'tool-1', name: 'read', params: {} },
    { type: 'reasoning', text: '工具后思考' },
    { type: 'text', text: '最终正文' },
  ])
})
