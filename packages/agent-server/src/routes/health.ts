import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) =>
  c.json({
    status: 'ok',
    service: 'novel-agent-server',
    ts: Date.now(),
  }),
)

export { app as healthRoutes }
