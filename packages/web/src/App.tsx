import { Link, Outlet, useLocation } from 'react-router-dom'
import { ConfirmProvider } from './lib/use-confirm.js'

export function App() {
  const { pathname } = useLocation()
  const fullBleed = pathname.endsWith('/rewrite')

  if (fullBleed) {
    return (
      <ConfirmProvider>
        <div className="h-screen paper-grid text-[var(--ink)]">
          <Outlet />
        </div>
      </ConfirmProvider>
    )
  }

  return (
    <ConfirmProvider>
      <div className="min-h-screen paper-grid text-[var(--ink)]">
        <header className="border-b ink-rule bg-[rgba(250,249,244,0.88)] backdrop-blur">
          <div className="max-w-6xl mx-auto px-5 sm:px-6 py-4 flex items-center justify-between gap-4">
            <Link to="/" className="group flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-[var(--ink)] text-sm font-semibold text-[var(--paper-soft)] shadow-sm">
                NA
              </span>
              <span className="leading-tight">
                <span className="block text-base font-semibold tracking-[0.02em]">
                  novel-agent
                </span>
                <span className="block text-xs text-[var(--muted)]">
                  参考分析与改写工作台
                </span>
              </span>
            </Link>
            <span className="hidden sm:inline-flex rounded-full border border-[var(--line)] bg-[rgba(255,255,252,0.72)] px-3 py-1 text-xs text-[var(--muted)]">
              M1 · reference analysis
            </span>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-5 sm:px-6 py-7">
          <Outlet />
        </main>
      </div>
    </ConfirmProvider>
  )
}
