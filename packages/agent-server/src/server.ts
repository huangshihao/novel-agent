import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { healthRoutes } from './routes/health.js'
import { novelRoutes } from './routes/novel.js'

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.route('/api/health', healthRoutes)
app.route('/api/novel', novelRoutes)

app.get('/', (c) => c.text('novel-agent server. API under /api/*'))

export { app }
