import { useState, useRef, type KeyboardEvent } from 'react'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatRuntime } from '../lib/chat-runtime.js'
import { Collapsible } from './Collapsible.js'
import {
  ReadToolUI,
  LsToolUI,
  GrepToolUI,
  UpdateMapsToolUI,
  WriteChapterOutlineToolUI,
  GetChapterContextToolUI,
  GetOutlineContextToolUI,
  WriteChapterToolUI,
} from './tool-cards/index.js'

interface Props {
  novelId: string
  chatId: string | null
  onChatCreated?: (chatId: string) => void
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
    <MarkdownTextPrimitive
      smooth
      remarkPlugins={[remarkGfm]}
      className="text-sm text-neutral-800 leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:my-1.5 [&>ul]:my-1.5 [&>ul]:pl-5 [&>ul]:list-disc [&>ol]:my-1.5 [&>ol]:pl-5 [&>ol]:list-decimal [&>li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_del]:line-through [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_pre]:my-2 [&_pre]:rounded [&_pre]:bg-neutral-900 [&_pre]:p-3 [&_pre]:text-xs [&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_pre>code]:text-neutral-100 [&>h1]:text-base [&>h1]:font-semibold [&>h1]:my-2 [&>h2]:text-sm [&>h2]:font-semibold [&>h2]:my-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:my-1.5 [&>blockquote]:border-l-2 [&>blockquote]:border-neutral-300 [&>blockquote]:pl-3 [&>blockquote]:text-neutral-600 [&_a]:text-blue-600 [&_a]:underline [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-neutral-200 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_hr]:my-3 [&_hr]:border-neutral-200"
    />
  )
}

function AssistantReasoningPart(props: { text: string; status: { type: string } }) {
  const running = props.status?.type === 'running'
  const text = props.text ?? ''
  if (!running && !text.trim()) return null
  return (
    <Collapsible
      className="my-1 rounded border border-neutral-200 bg-neutral-50 text-xs overflow-hidden"
      headerClassName="px-3 py-1.5 hover:bg-neutral-100/60"
      contentClassName="px-3 pb-2 border-t border-neutral-200"
      forceOpen={running ? true : undefined}
      summary={
        <span className="flex items-center gap-2 text-neutral-500">
          <span className="text-neutral-700">思考</span>
          {running && <span className="text-amber-600">进行中...</span>}
        </span>
      }
    >
      <pre className="whitespace-pre-wrap break-words font-sans text-[12px] text-neutral-600 leading-relaxed pt-1">
        {text}
      </pre>
    </Collapsible>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start my-2">
      <div className="max-w-[85%] text-sm space-y-1">
        <MessagePrimitive.Parts
          components={{ Text: AssistantTextPart, Reasoning: AssistantReasoningPart }}
        />
      </div>
    </MessagePrimitive.Root>
  )
}

export function ChatPanel({ novelId, chatId, onChatCreated }: Props) {
  const { runtime, send, cancel, isRunning } = useChatRuntime({
    novelId,
    chatId,
    onChatCreated,
  })
  const [draft, setDraft] = useState('')
  const composingRef = useRef(false)

  const submit = () => {
    const text = draft.trim()
    if (!text || isRunning) return
    setDraft('')
    void send(text)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composingRef.current) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ReadToolUI />
      <LsToolUI />
      <GrepToolUI />
      <UpdateMapsToolUI />
      <WriteChapterOutlineToolUI />
      <GetChapterContextToolUI />
      <GetOutlineContextToolUI />
      <WriteChapterToolUI />
      <ThreadPrimitive.Root className="flex flex-col h-full">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-3">
          <ThreadPrimitive.Empty>
            <div className="flex items-center justify-center h-full text-sm text-neutral-400">
              发条消息开始改写
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />
        </ThreadPrimitive.Viewport>
        <div className="border-t border-neutral-200 p-3 flex gap-2 items-end bg-white">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            placeholder="Enter 发送，Shift+Enter 换行"
            rows={2}
            className="flex-1 px-3 py-2 border border-neutral-300 rounded text-sm resize-none outline-none focus:border-neutral-500"
          />
          {isRunning ? (
            <button
              type="button"
              onClick={() => void cancel()}
              className="px-4 py-2 rounded bg-neutral-200 text-neutral-700 text-sm"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              className="px-4 py-2 rounded bg-neutral-900 text-white text-sm disabled:opacity-50"
            >
              发送
            </button>
          )}
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
