import { useState } from 'react'
import { agentApi } from '../lib/agent-api.js'
import { useAgentStream, type AgentMessage } from '../lib/use-agent-stream.js'
import clsx from 'clsx'

interface Props {
  sessionId: string | null
  onClosed?: () => void
}

export function AgentChat({ sessionId, onClosed }: Props) {
  const { messages, streaming, send } = useAgentStream({ sessionId })
  const [draft, setDraft] = useState('')

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-neutral-400">
        无活动 agent session
      </div>
    )
  }

  const onSend = async () => {
    if (!draft.trim() || streaming) return
    const content = draft
    setDraft('')
    await send(agentApi.messageUrl(sessionId), content).catch(console.error)
  }

  const onRun = async () => {
    if (streaming) return
    await send(agentApi.runUrl(sessionId), null).catch(console.error)
  }

  const onClose = async () => {
    await agentApi.closeSession(sessionId)
    onClosed?.()
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between p-3 border-b border-neutral-200 text-sm">
        <span className="font-medium">Agent 对话</span>
        <div className="flex gap-2">
          <button
            onClick={onRun}
            disabled={streaming}
            className="px-3 py-1 text-xs rounded bg-amber-500 text-white disabled:opacity-50"
          >
            开始改写本批
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded border border-neutral-300"
          >
            关闭 session
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {streaming && messages.length === 0 && (
          <div className="text-neutral-400">等待 agent 开始...</div>
        )}
      </div>

      <footer className="p-3 border-t border-neutral-200">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            placeholder={streaming ? '生成中...' : '输入消息（Enter 发送）'}
            disabled={streaming}
            className="flex-1 px-3 py-2 border border-neutral-300 rounded text-sm resize-none disabled:opacity-50"
            rows={2}
          />
          <button
            onClick={onSend}
            disabled={streaming || !draft.trim()}
            className="px-4 py-2 rounded bg-neutral-900 text-white text-sm disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </footer>
    </div>
  )
}

function MessageBubble({ m }: { m: AgentMessage }) {
  return (
    <div
      className={clsx(
        'rounded-lg p-3 max-w-[85%]',
        m.role === 'user'
          ? 'bg-neutral-900 text-white ml-auto'
          : 'bg-neutral-100 text-neutral-900',
      )}
    >
      {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
      {m.tool_calls && m.tool_calls.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
          {m.tool_calls.map((t, i) => (
            <div
              key={i}
              className={clsx(
                'text-xs flex items-center gap-2',
                t.ok ? 'text-emerald-700' : 'text-rose-700',
              )}
            >
              <span className="font-mono">{t.name}</span>
              <span>—</span>
              <span>{t.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
