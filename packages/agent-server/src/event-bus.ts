// 每本小说一个 EventEmitter。分析管线 emit 进度事件，SSE 路由订阅。
// 无持久化：断线/重启后客户端可拉 /api/novel/:id 的状态字段补齐。

import { EventEmitter } from 'node:events'
import type { AnalysisEvent } from '@novel-agent/shared'

const buses = new Map<string, EventEmitter>()

export function getBus(novelId: string): EventEmitter {
  let bus = buses.get(novelId)
  if (!bus) {
    bus = new EventEmitter()
    bus.setMaxListeners(50)
    buses.set(novelId, bus)
  }
  return bus
}

export function emitAnalysisEvent(novelId: string, event: AnalysisEvent): void {
  getBus(novelId).emit('event', event)
}

export function disposeBus(novelId: string): void {
  const bus = buses.get(novelId)
  if (bus) {
    bus.removeAllListeners()
    buses.delete(novelId)
  }
}
