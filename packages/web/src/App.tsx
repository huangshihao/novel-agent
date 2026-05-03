import { Link, Outlet, useLocation } from 'react-router-dom'
import { ConfirmProvider } from './lib/use-confirm.js'

export function App() {
  const { pathname } = useLocation()
  const fullBleed = pathname.endsWith('/rewrite')

  if (fullBleed) {
    return (
      <ConfirmProvider>
        <div className="h-screen bg-neutral-50 text-neutral-900">
          <Outlet />
        </div>
      </ConfirmProvider>
    )
  }

  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 bg-white">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
            <Link to="/" className="font-semibold text-lg">
              novel-agent
            </Link>
            <span className="text-xs text-neutral-400">M1 · reference analysis</span>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-6">
          <Outlet />
        </main>
      </div>
    </ConfirmProvider>
  )
}
