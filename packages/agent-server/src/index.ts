import { serve } from '@hono/node-server'
import { app } from './server.js'

const port = Number(process.env['PORT'] ?? 3100)

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[novel-agent] listening on http://localhost:${info.port}`)
})

let shuttingDown = false
function shutdown(sig: string) {
  if (shuttingDown) {
    // 第二次信号 —— 强退
    process.exit(1)
  }
  shuttingDown = true
  console.log(`[novel-agent] received ${sig}, shutting down...`)

  // 3 秒内没走完优雅关闭就强退（tsx watcher 只给 5 秒）
  const force = setTimeout(() => {
    console.log('[novel-agent] forcing exit')
    process.exit(0)
  }, 3_000)
  force.unref()

  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
