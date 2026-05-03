import { useState, type ReactNode } from 'react'

interface Props {
  summary: ReactNode
  defaultOpen?: boolean
  forceOpen?: boolean
  className?: string
  headerClassName?: string
  contentClassName?: string
  children: ReactNode
}

export function Collapsible({
  summary,
  defaultOpen = false,
  forceOpen,
  className = '',
  headerClassName = '',
  contentClassName = '',
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const isOpen = forceOpen ?? open

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => {
          if (forceOpen !== undefined) return
          setOpen((o) => !o)
        }}
        className={`w-full flex items-center gap-2 text-left ${headerClassName}`}
      >
        <span className="text-neutral-400 text-[10px] inline-block w-3 select-none">
          {isOpen ? '▼' : '▶'}
        </span>
        <span className="flex-1 min-w-0">{summary}</span>
      </button>
      {isOpen && <div className={contentClassName}>{children}</div>}
    </div>
  )
}
