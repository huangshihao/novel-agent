import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  MessagePartPrimitive,
  ComposerPrimitive,
} from '@assistant-ui/react'
import { useChatRuntime } from '../lib/chat-runtime.js'
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

export function ChatPanel({ novelId, chatId, onChatCreated }: Props) {
  const runtime = useChatRuntime({ novelId, chatId, onChatCreated })

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
            placeholder="Enter 发送，Shift+Enter 换行"
            rows={2}
            maxRows={8}
            className="flex-1 px-3 py-2 border border-neutral-300 rounded text-sm resize-none outline-none focus:border-neutral-500"
          />
          <ComposerPrimitive.Send className="px-4 py-2 rounded bg-neutral-900 text-white text-sm disabled:opacity-50">
            发送
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
