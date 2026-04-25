import { describe, it, expect } from 'vitest'
import { createBatchJob, runBatchJob, type WorkerFactory } from './batch-job.js'
import type { AgentEvent } from '@novel-agent/shared'

function fakeFactory(opts: {
  failOn?: number[]
  delayMs?: number
}): WorkerFactory {
  return async ({ chapter }) => {
    if (opts.failOn?.includes(chapter)) {
      throw new Error(`fake fail on ${chapter}`)
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
    return { dispose() {} }
  }
}

describe('BatchJob', () => {
  it('runs all chapters when no failures', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: 'X',
      chapters: [1, 2, 3],
    })
    const events: AgentEvent[] = []
    job.subscribe((e) => events.push(e))

    await runBatchJob(job, fakeFactory({}))
    expect(job.status).toBe('done')
    expect(job.completed).toEqual([1, 2, 3])
    expect(job.failed).toEqual([])
    expect(events.some((e) => e.type === 'batch.done')).toBe(true)
  })

  it('pauses on worker error and exposes which chapter', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2, 3],
    })
    await runBatchJob(job, fakeFactory({ failOn: [2] }))
    expect(job.status).toBe('paused')
    expect(job.cursor).toBe(1)
    expect(job.completed).toEqual([1])
    expect(job.error).toMatch(/fake fail/)
  })

  it('retry resumes from same cursor', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2, 3],
    })
    await runBatchJob(job, fakeFactory({ failOn: [2] }))
    expect(job.status).toBe('paused')
    job.error = undefined
    job.status = 'running'
    await runBatchJob(job, fakeFactory({}))
    expect(job.status).toBe('done')
    expect(job.completed).toEqual([1, 2, 3])
  })

  it('skip advances cursor and records failed', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2, 3],
    })
    await runBatchJob(job, fakeFactory({ failOn: [2] }))
    expect(job.status).toBe('paused')
    // simulate skip
    job.failed.push(job.chapters[job.cursor]!)
    job.cursor += 1
    job.error = undefined
    job.status = 'running'
    await runBatchJob(job, fakeFactory({}))
    expect(job.status).toBe('done')
    expect(job.completed).toEqual([1, 3])
    expect(job.failed).toEqual([2])
  })

  it('abort stops loop', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2, 3],
    })
    job.subscribe((e) => {
      if (e.type === 'batch.worker_end' && e.chapter === 1) {
        job.status = 'aborted'
      }
    })
    await runBatchJob(job, fakeFactory({}))
    expect(job.status).toBe('aborted')
    expect(job.completed).toEqual([1])
  })

  it('subscribe replays buffered events to late subscriber', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1],
    })
    await runBatchJob(job, fakeFactory({}))
    const replay: AgentEvent[] = []
    job.subscribe((e) => replay.push(e))
    expect(replay.some((e) => e.type === 'batch.done')).toBe(true)
    expect(replay.some((e) => e.type === 'batch.worker_start' && e.chapter === 1)).toBe(true)
  })

  it('toInfo returns serializable snapshot', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: 'X',
      chapters: [1, 2],
    })
    await runBatchJob(job, fakeFactory({}))
    const info = job.toInfo()
    expect(info.id).toBe(job.id)
    expect(info.novel_id).toBe('n1')
    expect(info.status).toBe('done')
    expect(info.completed).toEqual([1, 2])
    expect(info.requirement).toBe('X')
  })

  it('runBatchJob guards against concurrent re-entry', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2],
    })
    const factory = fakeFactory({ delayMs: 50 })
    // start two concurrently
    const p1 = runBatchJob(job, factory)
    const p2 = runBatchJob(job, factory)  // should immediately return (guarded)
    await Promise.all([p1, p2])
    expect(job.status).toBe('done')
    expect(job.completed).toEqual([1, 2])  // not [1,2,1,2] — no double-processing
  })
})
