import { useState, useRef, type KeyboardEvent } from 'react'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import { useChatRuntime } from '../lib/chat-runtime.js'
import {
  ReadToolUI,
  LsToolUI,
  GrepToolUI,
  UpdateMapsToolUI,
  WriteChapterOutlineToolUI,
  GetChapterContextToolUI,
  GetOutlineContextToolUI,
  WriteChapterToolUI,
  ToolGroupUI,
} from './tool-cards/index.js'

interface Props {
  novelId: string
  chatId: string | null
  onChatCreated?: (chatId: string) => void
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end my-2">
      <div className="max-w-[80%] rounded-[18px] rounded-br-md bg-[var(--ink)] px-4 py-2 text-sm text-[var(--paper-soft)] shadow-sm whitespace-pre-wrap">
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
      className="text-[15px] leading-7 text-neutral-900 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p]:my-2 [&>ul]:my-2 [&>ul]:pl-5 [&>ul]:list-disc [&>ol]:my-2 [&>ol]:pl-5 [&>ol]:list-decimal [&>li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_del]:line-through [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_pre]:my-2 [&_pre]:rounded [&_pre]:bg-neutral-900 [&_pre]:p-3 [&_pre]:text-xs [&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_pre>code]:text-neutral-100 [&>h1]:text-lg [&>h1]:font-semibold [&>h1]:my-2 [&>h2]:text-base [&>h2]:font-semibold [&>h2]:my-2 [&>h3]:text-base [&>h3]:font-semibold [&>h3]:my-1.5 [&>blockquote]:border-l-2 [&>blockquote]:border-neutral-300 [&>blockquote]:pl-3 [&>blockquote]:text-neutral-600 [&_a]:text-blue-600 [&_a]:underline [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-neutral-200 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_hr]:my-3 [&_hr]:border-neutral-200"
    />
  )
}

function BrainIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <path d="M9.3 4.5a3.2 3.2 0 0 0-3.1 4 3.7 3.7 0 0 0-.8 6.1 3.4 3.4 0 0 0 4.5 4.3" />
      <path d="M14.7 4.5a3.2 3.2 0 0 1 3.1 4 3.7 3.7 0 0 1 .8 6.1 3.4 3.4 0 0 1-4.5 4.3" />
      <path d="M12 5.5v13" />
      <path d="M8.2 10.2c1.4-.1 2.5.5 3.8 1.6" />
      <path d="M15.8 10.2c-1.4-.1-2.5.5-3.8 1.6" />
      <path d="M8.4 14.8c1.2.2 2.3-.1 3.6-1" />
      <path d="M15.6 14.8c-1.2.2-2.3-.1-3.6-1" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

function AssistantReasoningPart(props: { text: string; status: { type: string } }) {
  const text = props.text ?? ''
  const running = props.status?.type === 'running'
  if (!running && !text.trim()) return null

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-[#65758f] transition-colors hover:text-[#4f6078] [&::-webkit-details-marker]:hidden">
        <BrainIcon />
        <span>{running ? '思考中' : '思考'}</span>
        <span className="transition-transform group-open:rotate-180">
          <ChevronDownIcon />
        </span>
      </summary>
      {text.trim() && (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-neutral-50 px-3 py-2 font-sans text-xs leading-relaxed text-neutral-600">
          {text}
        </pre>
      )}
    </details>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="my-5 flex justify-start">
      <div className="w-full max-w-[760px] space-y-4 px-1">
        <MessagePrimitive.Parts
          components={{
            Text: AssistantTextPart,
            Reasoning: AssistantReasoningPart,
            ToolGroup: ToolGroupUI,
          }}
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
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto bg-[rgba(255,255,252,0.58)] px-6 py-5">
          <ThreadPrimitive.Empty>
            <div className="flex h-full items-center justify-center">
              <div className="surface-tight max-w-sm px-5 py-4 text-center text-sm text-[var(--muted)]">
                发条消息开始改写
              </div>
            </div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />
        </ThreadPrimitive.Viewport>
        <div className="flex items-stretch gap-2 border-t ink-rule bg-[rgba(250,249,244,0.9)] p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            placeholder="Enter 发送，Shift+Enter 换行"
            rows={2}
            className="h-14 flex-1 resize-none rounded-md border border-[var(--line-strong)] bg-[rgba(255,255,252,0.86)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)]"
          />
          {isRunning ? (
            <button
              type="button"
              onClick={() => void cancel()}
              className="btn-secondary h-14 px-4 text-sm"
            >
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              className="btn-primary h-14 px-4 text-sm disabled:opacity-50"
            >
              发送
            </button>
          )}
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
