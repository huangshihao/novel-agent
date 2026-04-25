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
      <nav className="flex gap-1 border-b border-neutral-200 bg-neutral-50 px-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'px-4 py-2 text-sm border-b-2 -mb-px',
              tab === key
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-neutral-500 hover:text-neutral-700',
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
