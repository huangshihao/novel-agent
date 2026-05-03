import { useState } from 'react'
import clsx from 'clsx'
import { MapsPanel } from './MapsPanel.js'
import { OutlinePanel } from './OutlinePanel.js'
import { DraftsPanel } from './DraftsPanel.js'
import { StatePanel } from './StatePanel.js'

type Tab = 'maps' | 'outlines' | 'drafts' | 'state'

interface Props {
  novelId: string
}

const TABS: [Tab, string][] = [
  ['maps', '置换表'],
  ['outlines', '大纲'],
  ['drafts', '正文'],
  ['state', 'state'],
]

export function ArtifactTabs({ novelId }: Props) {
  const [tab, setTab] = useState<Tab>('maps')
  return (
    <div className="flex flex-col h-full">
      <nav className="flex gap-1 border-b ink-rule bg-[rgba(250,249,244,0.82)] px-3">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-[var(--accent)] text-[var(--ink)]'
                : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]',
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === 'maps' && <MapsPanel novelId={novelId} />}
        {tab === 'outlines' && <OutlinePanel novelId={novelId} />}
        {tab === 'drafts' && <DraftsPanel novelId={novelId} />}
        {tab === 'state' && <StatePanel novelId={novelId} />}
      </div>
    </div>
  )
}
