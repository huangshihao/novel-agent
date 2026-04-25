import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmDialogProps } from '../components/ConfirmDialog.js'

type ConfirmOpts = Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel'>
type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>

const ConfirmCtx = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setOpts(next)
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setOpts(null)
  }, [])

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={opts !== null}
        title={opts?.title}
        message={opts?.message ?? ''}
        confirmLabel={opts?.confirmLabel}
        cancelLabel={opts?.cancelLabel}
        tone={opts?.tone}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmCtx.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>')
  return ctx
}
