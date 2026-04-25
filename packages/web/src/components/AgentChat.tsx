import { useEffect, useState } from 'react'
import type { AgentSessionInfo } from '@novel-agent/shared'
import { agentApi } from '../lib/agent-api.js'
import { useAgentStream, type AgentMessage } from '../lib/use-agent-stream.js'
import clsx from 'clsx'

interface Props {
  session: AgentSessionInfo
  onClosed: () => void
}

export function AgentChat({ session, onClosed }: Props) {
  const sessionId = session.id
  const { messages, streaming, send, setMessages } = useAgentStream({ sessionId })
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setMessages([])
    send(agentApi.messageUrl(sessionId), '').catch(console.error)
  }, [sessionId, send, setMessages])

  const onSend = async () => {
    if (!draft.trim() || streaming) return
    const content = draft
    setDraft('')
    await send(agentApi.messageUrl(sessionId), content).catch(console.error)
  }

  const onClose = async () => {
    await agentApi.closeSession(sessionId)
    onClosed()
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between p-3 border-b border-neutral-200 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{labelFor(session)}</span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 text-xs rounded border border-neutral-300 hover:bg-neutral-50"
        >
          结束 session
        </button>
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
            placeholder={streaming ? '生成中...' : '继续追加意见（Enter 发送）'}
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

function labelFor(s: AgentSessionInfo): string {
  const role = s.role === 'outline' ? '大纲' : '正文'
  const mode = s.mode === 'generate' ? '生成' : '修改'
  if (s.scope.from === s.scope.to) return `${mode}${role} 第 ${s.scope.from} 章`
  return `${mode}${role} ${s.scope.from}-${s.scope.to}`
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
