import { useEffect, useRef, useState } from 'react'
import type { AgentEvent, BatchJobInfo } from '@novel-agent/shared'
import { agentApi } from './agent-api.js'

interface BatchStreamState {
  job: BatchJobInfo | null
  currentDelta: string  // current worker's accumulated text
  toolEvents: { name: string; ok?: boolean }[]
  done: boolean
}

export function useBatchStream(jobId: string | null) {
  const [state, setState] = useState<BatchStreamState>({
    job: null,
    currentDelta: '',
    toolEvents: [],
    done: false,
  })
  const ref = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!jobId) {
      ref.current?.close()
      ref.current = null
      setState({ job: null, currentDelta: '', toolEvents: [], done: false })
      return
    }
    const es = new EventSource(agentApi.jobStreamUrl(jobId))
    ref.current = es
    const handle = (raw: MessageEvent) => {
      let payload: AgentEvent
      try {
        payload = JSON.parse(raw.data)
      } catch {
        return
      }
      setState((prev) => applyEvent(prev, payload))
    }
    const events = [
      'message.delta',
      'message.complete',
      'tool.call',
      'tool.result',
      'batch.progress',
      'batch.worker_start',
      'batch.worker_end',
      'batch.done',
      'batch.aborted',
      'batch.paused',
      'error',
      'done',
    ]
    for (const ev of events) es.addEventListener(ev, handle as EventListener)
    es.onerror = () => { /* let UI poll re-pick state */ }

    // also fetch initial job state (events already replayed via subscribe but useful for race)
    agentApi.getJob(jobId).then((job) => {
      setState((prev) => ({ ...prev, job }))
    }).catch(() => { /* ignore */ })

    return () => {
      for (const ev of events) es.removeEventListener(ev, handle as EventListener)
      es.close()
      ref.current = null
    }
  }, [jobId])

  // poll for periodic refresh of authoritative job state
  useEffect(() => {
    if (!jobId) return
    const t = setInterval(() => {
      agentApi.getJob(jobId).then((job) => setState((prev) => ({ ...prev, job }))).catch(() => {})
    }, 3_000)
    return () => clearInterval(t)
  }, [jobId])

  return state
}

function applyEvent(prev: BatchStreamState, evt: AgentEvent): BatchStreamState {
  switch (evt.type) {
    case 'batch.worker_start':
      return { ...prev, currentDelta: '', toolEvents: [] }
    case 'batch.worker_end':
      return prev
    case 'message.delta':
      return { ...prev, currentDelta: prev.currentDelta + evt.content }
    case 'message.complete':
      return { ...prev, currentDelta: evt.content }
    case 'tool.call':
      return { ...prev, toolEvents: [...prev.toolEvents, { name: evt.name }] }
    case 'tool.result': {
      const next = [...prev.toolEvents]
      const last = next[next.length - 1]
      if (last && last.name === evt.name) {
        const r = evt.result as { ok?: boolean } | undefined
        last.ok = r?.ok !== false
      }
      return { ...prev, toolEvents: next }
    }
    case 'batch.done':
    case 'batch.aborted':
      return { ...prev, done: true }
    default:
      return prev
  }
}
