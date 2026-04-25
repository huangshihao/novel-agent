import type { AgentEvent, BatchJobInfo, BatchJobStatus } from '@novel-agent/shared'

export interface WorkerHandle {
  dispose(): void
}

export interface WorkerFactoryArgs {
  novelId: string
  chapter: number
  requirement: string
  emit: (event: AgentEvent) => void
}

export type WorkerFactory = (args: WorkerFactoryArgs) => Promise<WorkerHandle>

export interface CreateBatchJobInput {
  novelId: string
  requirement: string
  chapters: number[]
}

export interface BatchJob {
  id: string
  novelId: string
  requirement: string
  chapters: number[]
  cursor: number
  completed: number[]
  failed: number[]
  current: number | null
  status: BatchJobStatus
  error?: string
  createdAt: number
  /** internal: true while a runBatchJob loop is actively iterating; prevents concurrent re-entry */
  _runnerActive: boolean
  emit(event: AgentEvent): void
  subscribe(listener: (event: AgentEvent) => void): () => void
  toInfo(): BatchJobInfo
  dispose(): void
}

function genId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createBatchJob(input: CreateBatchJobInput): BatchJob {
  const buffer: AgentEvent[] = []
  const listeners = new Set<(event: AgentEvent) => void>()
  const job: BatchJob = {
    id: genId(),
    novelId: input.novelId,
    requirement: input.requirement,
    chapters: [...input.chapters],
    cursor: 0,
    completed: [],
    failed: [],
    current: null,
    status: 'running',
    createdAt: Date.now(),
    _runnerActive: false,
    emit(event) {
      buffer.push(event)
      for (const fn of listeners) {
        try { fn(event) } catch { /* ignore */ }
      }
    },
    subscribe(listener) {
      for (const e of buffer) {
        try { listener(e) } catch { /* ignore */ }
      }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    toInfo() {
      return {
        id: job.id,
        novel_id: job.novelId,
        requirement: job.requirement,
        chapters: job.chapters,
        cursor: job.cursor,
        completed: job.completed,
        failed: job.failed,
        current: job.current,
        status: job.status,
        error: job.error,
        created_at: job.createdAt,
      }
    },
    dispose() {
      if (job.status === 'running' || job.status === 'paused') {
        job.status = 'aborted'
        job.emit({ type: 'batch.aborted' })
      }
      listeners.clear()
    },
  }
  return job
}

export async function runBatchJob(
  job: BatchJob,
  factory: WorkerFactory,
): Promise<void> {
  if (job._runnerActive) return  // single-flight guard
  job._runnerActive = true
  try {
    while (job.cursor < job.chapters.length) {
      if (job.status === 'aborted') break
      if (job.status === 'paused') return
      const n = job.chapters[job.cursor]!
      job.current = n
      job.emit({ type: 'batch.worker_start', chapter: n })
      try {
        const handle = await factory({
          novelId: job.novelId,
          chapter: n,
          requirement: job.requirement,
          emit: job.emit,
        })
        try {
          // factory is responsible for sending message + waiting for agent_end + emitting forwarded events
          // by the time we reach here, the worker turn is complete
        } finally {
          try { handle.dispose() } catch { /* ignore */ }
        }
        job.completed.push(n)
        job.cursor += 1
        job.emit({ type: 'batch.worker_end', chapter: n, ok: true })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        job.error = msg
        job.status = 'paused'
        job.emit({ type: 'batch.worker_end', chapter: n, ok: false, error: msg })
        job.emit({ type: 'batch.paused', chapter: n, error: msg })
        job.current = null
        return
      }
      job.emit({
        type: 'batch.progress',
        completed: job.completed.length,
        total: job.chapters.length,
        current: job.current,
      })
    }
    if (job.status === 'running') {
      job.status = 'done'
      job.current = null
      job.emit({ type: 'batch.done' })
    }
  } finally {
    job._runnerActive = false
  }
}
