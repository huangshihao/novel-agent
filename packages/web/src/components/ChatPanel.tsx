import { useState, useRef, useCallback, type ChangeEvent } from 'react'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  MessagePartPrimitive,
  ComposerPrimitive,
} from '@assistant-ui/react'
import { useChatRuntime } from '../lib/chat-runtime.js'
import { MentionPopover, type MentionItem } from './MentionPopover.js'
import {
  ReadToolUI,
  LsToolUI,
  GrepToolUI,
  UpdateMapsToolUI,
  WriteChapterOutlineToolUI,
  GetChapterContextToolUI,
  WriteChapterToolUI,
} from './tool-cards/index.js'

interface Props {
  novelId: string
  chatId: string | null
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end my-2">
      <div className="max-w-[80%] rounded-2xl bg-neutral-900 text-white px-4 py-2 text-sm whitespace-pre-wrap">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantTextPart() {
  return (
    <MessagePartPrimitive.Text
      component="div"
      className="whitespace-pre-wrap text-neutral-800 my-1"
    />
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start my-2">
      <div className="max-w-[85%] text-sm space-y-1">
        <MessagePrimitive.Parts components={{ Text: AssistantTextPart }} />
      </div>
    </MessagePrimitive.Root>
  )
}

export function ChatPanel({ novelId, chatId }: Props) {
  const runtime = useChatRuntime({ novelId, chatId })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')

  const detectMention = useCallback(
    (target: HTMLTextAreaElement) => {
      const v = target.value
      const caret = target.selectionStart ?? v.length
      const before = v.slice(0, caret)
      const lastAt = before.lastIndexOf('@')
      if (lastAt >= 0 && /^[^@\s]*$/.test(before.slice(lastAt + 1))) {
        setMentionOpen(true)
        setMentionQuery(before.slice(lastAt + 1))
      } else {
        setMentionOpen(false)
      }
    },
    [],
  )

  const onTextareaChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    detectMention(e.target)
  }
  const onTextareaKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'Home' ||
      e.key === 'End'
    ) {
      detectMention(e.currentTarget)
    }
  }

  const insertToken = (item: MentionItem) => {
    const ta = textareaRef.current
    if (!ta) return
    const v = ta.value
    const caret = ta.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const after = v.slice(caret)
    const lastAt = before.lastIndexOf('@')
    const cut = lastAt >= 0 ? lastAt : caret
    const next = v.slice(0, cut) + item.token + ' ' + after
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set
    setter?.call(ta, next)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.focus()
    const newCaret = cut + item.token.length + 1
    ta.setSelectionRange(newCaret, newCaret)
    setMentionOpen(false)
  }

  if (!chatId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-neutral-400">
        左侧选择或新建一个 chat
      </div>
    )
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ReadToolUI />
      <LsToolUI />
      <GrepToolUI />
      <UpdateMapsToolUI />
      <WriteChapterOutlineToolUI />
      <GetChapterContextToolUI />
      <WriteChapterToolUI />
      <ThreadPrimitive.Root className="flex flex-col h-full">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-3">
          <ThreadPrimitive.Empty>
            <div className="flex items-center justify-center h-full text-sm text-neutral-400">
              发条消息开始洗稿
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="border-t border-neutral-200 p-3 flex gap-2 items-end bg-white">
          <ComposerPrimitive.Input
            ref={textareaRef}
            onChange={onTextareaChange}
            onKeyUp={onTextareaKeyUp}
            placeholder="按 @ 引用产物或动作；Enter 发送"
            rows={2}
            maxRows={8}
            className="flex-1 px-3 py-2 border border-neutral-300 rounded text-sm resize-none outline-none focus:border-neutral-500"
          />
          <ComposerPrimitive.Send className="px-4 py-2 rounded bg-neutral-900 text-white text-sm disabled:opacity-50">
            发送
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
        <MentionPopover
          novelId={novelId}
          open={mentionOpen}
          query={mentionQuery}
          anchorEl={textareaRef.current}
          onSelect={insertToken}
          onClose={() => setMentionOpen(false)}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
