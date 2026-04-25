import { useEffect, type ReactNode } from 'react'
import clsx from 'clsx'

export interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  tone = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onConfirm, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <header className="px-5 py-3 border-b border-neutral-200 text-sm font-medium">
            {title}
          </header>
        )}
        <div className="px-5 py-4 text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">
          {message}
        </div>
        <footer className="px-5 py-3 border-t border-neutral-100 flex justify-end gap-2 bg-neutral-50/50 rounded-b-lg">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-neutral-300 hover:bg-neutral-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={clsx(
              'px-3 py-1.5 text-xs rounded text-white',
              tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-500 hover:bg-amber-600',
            )}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
