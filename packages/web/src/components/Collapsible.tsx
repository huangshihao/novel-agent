import { useState, type ReactNode } from 'react'

interface Props {
  summary: ReactNode
  defaultOpen?: boolean
  forceOpen?: boolean
  className?: string
  headerClassName?: string
  contentClassName?: string
  headerGapClassName?: string
  children: ReactNode
}

export function Collapsible({
  summary,
  defaultOpen = false,
  forceOpen,
  className = '',
  headerClassName = '',
  contentClassName = '',
  headerGapClassName = 'gap-2',
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
        className={`w-full flex items-center ${headerGapClassName} text-left ${headerClassName}`}
      >
        <span className="grid h-4 w-4 shrink-0 place-items-center text-neutral-400">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={`h-3 w-3 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </span>
        <span className="flex-1 min-w-0">{summary}</span>
      </button>
      {isOpen && <div className={contentClassName}>{children}</div>}
    </div>
  )
}
