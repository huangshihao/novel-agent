import { agentApi } from '../lib/agent-api.js'
import { useBatchStream } from '../lib/use-batch-stream.js'

interface Props {
  jobId: string
  onClosed: () => void
}

export function BatchJobPanel({ jobId, onClosed }: Props) {
  const { job, currentDelta, toolEvents, done } = useBatchStream(jobId)

  if (!job) {
    return <div className="p-4 text-sm text-neutral-500">加载 batch 状态...</div>
  }

  const total = job.chapters.length
  const completed = job.completed.length
  const pct = Math.round((completed / total) * 100)

  const onAbort = async () => {
    await agentApi.abortJob(jobId)
  }
  const onRetry = async () => {
    await agentApi.retryJob(jobId)
  }
  const onSkip = async () => {
    await agentApi.skipJob(jobId)
  }
  const onClose = async () => {
    await agentApi.closeJob(jobId)
    onClosed()
  }

  return (
    <div className="flex flex-col h-full">
      <header className="p-3 border-b border-neutral-200 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">正文批量任务</span>
          <span className={`text-xs px-2 py-0.5 rounded ${badgeColor(job.status)}`}>
            {statusLabel(job.status)}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-neutral-600">
            <span>{completed}/{total} 章</span>
            <span>{job.current ? `当前：第 ${job.current} 章` : ''}</span>
          </div>
          <div className="h-1.5 bg-neutral-200 rounded overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          {job.status === 'running' && (
            <button onClick={onAbort} className="px-2 py-1 rounded border border-rose-300 text-rose-700">中止</button>
          )}
          {job.status === 'paused' && (
            <>
              <button onClick={onRetry} className="px-2 py-1 rounded bg-amber-500 text-white">重试该章</button>
              <button onClick={onSkip} className="px-2 py-1 rounded border border-neutral-300">跳过该章</button>
              <button onClick={onAbort} className="px-2 py-1 rounded border border-rose-300 text-rose-700">中止整个 job</button>
            </>
          )}
          {(job.status === 'done' || job.status === 'aborted') && (
            <button onClick={onClose} className="px-2 py-1 rounded border border-neutral-300">关闭</button>
          )}
        </div>
        {job.error && <p className="text-xs text-rose-600">⚠ {job.error}</p>}
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {job.requirement && (
          <section className="text-xs bg-neutral-50 border border-neutral-200 rounded p-2">
            <div className="text-neutral-500 mb-1">本批需求：</div>
            <div className="whitespace-pre-wrap">{job.requirement}</div>
          </section>
        )}
        {job.completed.length > 0 && (
          <section className="text-xs">
            <div className="text-neutral-500 mb-1">已完成：</div>
            <div className="flex flex-wrap gap-1">
              {job.completed.map((n) => (
                <span key={n} className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">第 {n} 章</span>
              ))}
            </div>
          </section>
        )}
        {job.failed.length > 0 && (
          <section className="text-xs">
            <div className="text-neutral-500 mb-1">已跳过：</div>
            <div className="flex flex-wrap gap-1">
              {job.failed.map((n) => (
                <span key={n} className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200">第 {n} 章</span>
              ))}
            </div>
          </section>
        )}
        {job.current && !done && (
          <section className="text-xs">
            <div className="text-neutral-500 mb-1">第 {job.current} 章 worker 实时：</div>
            {toolEvents.length > 0 && (
              <div className="space-y-0.5 mb-2">
                {toolEvents.map((t, i) => (
                  <div key={i} className={t.ok === false ? 'text-rose-700' : 'text-emerald-700'}>
                    <span className="font-mono">{t.name}</span>{' '}
                    <span>{t.ok === undefined ? '调用中...' : t.ok ? '完成' : '校验失败'}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="whitespace-pre-wrap text-neutral-600 max-h-40 overflow-y-auto">
              {currentDelta || '...'}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function badgeColor(s: string): string {
  if (s === 'running') return 'bg-emerald-100 text-emerald-800'
  if (s === 'paused') return 'bg-amber-100 text-amber-800'
  if (s === 'done') return 'bg-neutral-100 text-neutral-700'
  if (s === 'aborted') return 'bg-rose-100 text-rose-700'
  return 'bg-neutral-100 text-neutral-600'
}

function statusLabel(s: string): string {
  return ({
    running: '运行中',
    paused: '已暂停（出错）',
    done: '已完成',
    aborted: '已中止',
  } as Record<string, string>)[s] ?? s
}
