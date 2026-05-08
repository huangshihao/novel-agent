export interface ToolCallState {
  id: string
  name: string
  params?: unknown
  result?: unknown
}

export type AssistantTurnPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | ({ type: 'tool-call' } & ToolCallState)

export interface AssistantTurn {
  id: string
  parts: AssistantTurnPart[]
}

export function appendAssistantReasoning(turn: AssistantTurn, text: string) {
  if (!text) return
  const last = turn.parts[turn.parts.length - 1]
  if (last?.type === 'reasoning') {
    last.text += text
  } else {
    turn.parts.push({ type: 'reasoning', text })
  }
}

export function appendAssistantText(turn: AssistantTurn, text: string) {
  if (!text) return
  const last = turn.parts[turn.parts.length - 1]
  if (last?.type === 'text') {
    last.text += text
  } else {
    turn.parts.push({ type: 'text', text })
  }
}

export function completeAssistantText(turn: AssistantTurn, text: string) {
  if (!text) return
  turn.parts = turn.parts.filter((part) => part.type !== 'text')
  turn.parts.push({ type: 'text', text })
}
