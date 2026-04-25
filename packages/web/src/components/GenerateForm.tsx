import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { agentApi } from '../lib/agent-api.js'
import { api } from '../lib/api.js'
import { useActiveTask } from '../lib/use-active-task.js'

interface Props {
  novelId: string
  role: 'outline' | 'writer'
  maxChapter: number
  onStarted: () => void
}

export function GenerateForm({ novelId, role, maxChapter, onStarted }: Props) {
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(Math.min(maxChapter, 10))
  const [requirement, setRequirement] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: outlines } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.listOutlines(novelId),
    enabled: role === 'writer',
  })
  const { data: active } = useActiveTask(novelId)

  const rangeValid = from >= 1 && to >= from && to <= maxChapter
  const missingForWriter: number[] =
    role === 'writer' && rangeValid && outlines
      ? (() => {
          const have = new Set(outlines.map((o) => o.number))
          const miss: number[] = []
          for (let n = from; n <= to; n++) if (!have.has(n)) miss.push(n)
          return miss
        })()
      : []
  const writerBlocked = role === 'writer' && missingForWriter.length > 0
  const activeBlocked = !!active

  const canSubmit = rangeValid && !writerBlocked && !activeBlocked && !submitting

  const onSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      if (role === 'outline') {
        await agentApi.startOutline(novelId, from, to, requirement)
      } else {
        await agentApi.startWriter(novelId, from, to, requirement)
      }
      onStarted()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="border border-neutral-200 rounded p-4 m-3 space-y-3 bg-neutral-50">
      <header className="flex items-center gap-2 text-sm">
        <span className="font-medium">{role === 'outline' ? '生成大纲' : '生成正文'}</span>
        <span className="text-neutral-500">| 范围 1-{maxChapter}</span>
      </header>
      <div className="flex items-center gap-2 text-sm">
        <span>第</span>
        <input
          type="number"
          min={1}
          max={maxChapter}
          value={from}
          onChange={(e) => setFrom(Number(e.target.value))}
          className="w-20 px-2 py-1 border border-neutral-300 rounded"
        />
        <span>—</span>
        <input
          type="number"
          min={1}
          max={maxChapter}
          value={to}
          onChange={(e) => setTo(Number(e.target.value))}
          className="w-20 px-2 py-1 border border-neutral-300 rounded"
        />
        <span>章</span>
      </div>
      <textarea
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        placeholder="对本批的整体需求（可选），例如：文风更口语化 / 加快节奏 / 强化悬念"
        rows={3}
        className="w-full px-3 py-2 border border-neutral-300 rounded text-sm resize-none"
      />
      {writerBlocked && (
        <p className="text-xs text-rose-600">
          区间内缺第 {missingForWriter.join('、')} 章大纲，请先去大纲 tab 生成
        </p>
      )}
      {activeBlocked && (
        <p className="text-xs text-amber-700">
          已有活跃任务，请先在右侧结束当前 session
        </p>
      )}
      {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="px-4 py-1.5 rounded bg-amber-500 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? '启动中...' : `启动 ${role === 'outline' ? '大纲' : '正文'} agent`}
      </button>
    </section>
  )
}
