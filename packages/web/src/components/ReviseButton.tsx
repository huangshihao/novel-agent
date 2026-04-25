import { useState } from 'react'
import { agentApi } from '../lib/agent-api.js'
import { useActiveTask } from '../lib/use-active-task.js'
import clsx from 'clsx'

interface Props {
  novelId: string
  role: 'outline' | 'writer'
  number: number
  onStarted: () => void
}

export function ReviseButton({ novelId, role, number, onStarted }: Props) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const { data: active } = useActiveTask(novelId)

  const isBatchActive = active?.kind === 'batch'
  const disabled = isBatchActive

  const onSubmit = async () => {
    if (!feedback.trim()) return
    if (active) {
      const ok = window.confirm('将关闭当前活跃 session 并启动单章修改，是否继续？')
      if (!ok) return
      // backend rejects, so close first
      if (active.kind === 'session') {
        await agentApi.closeSession(active.session.id)
      } else {
        await agentApi.closeJob(active.batch.id)
      }
    }
    setSubmitting(true)
    setErrorMsg(null)
    try {
      if (role === 'outline') {
        await agentApi.reviseOutline(novelId, number, feedback)
      } else {
        await agentApi.reviseWriter(novelId, number, feedback)
      }
      setOpen(false)
      setFeedback('')
      onStarted()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        disabled={disabled}
        title={disabled ? '批量正文跑中，无法启动单章修改' : '提修改意见'}
        className={clsx(
          'text-xs px-2 py-0.5 rounded border',
          disabled
            ? 'border-neutral-200 text-neutral-300 cursor-not-allowed'
            : 'border-neutral-300 text-neutral-600 hover:bg-amber-50 hover:border-amber-400',
        )}
      >
        ✎ 改
      </button>
    )
  }

  return (
    <div className="space-y-2 mt-2 p-2 border border-amber-200 rounded bg-amber-50/40" onClick={(e) => e.stopPropagation()}>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={`第 ${number} 章修改意见...`}
        rows={3}
        autoFocus
        className="w-full px-2 py-1 border border-neutral-300 rounded text-xs resize-none"
      />
      {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={!feedback.trim() || submitting}
          className="px-3 py-1 rounded bg-amber-500 text-white text-xs disabled:opacity-40"
        >
          {submitting ? '启动中...' : '提交'}
        </button>
        <button
          onClick={() => { setOpen(false); setFeedback(''); setErrorMsg(null) }}
          className="px-3 py-1 rounded border border-neutral-300 text-xs"
        >
          取消
        </button>
      </div>
    </div>
  )
}
