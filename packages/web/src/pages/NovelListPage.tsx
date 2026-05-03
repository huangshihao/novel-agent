import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { cn, statusLabel, statusStyle } from '../lib/ui'
import { useConfirm } from '../lib/use-confirm'

export function NovelListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()

  const { data: novels, isLoading, error } = useQuery({
    queryKey: ['novels'],
    queryFn: api.listNovels,
    refetchInterval: (q) => {
      const list = q.state.data ?? []
      return list.some((n) => n.status === 'analyzing' || n.status === 'splitting')
        ? 2_000
        : false
    },
  })

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [chapterCount, setChapterCount] = useState(50)
  const [upErr, setUpErr] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: () => api.uploadNovel(file!, title, chapterCount),
    onSuccess: (novel) => {
      qc.invalidateQueries({ queryKey: ['novels'] })
      navigate(`/novels/${novel.id}`)
    },
    onError: (e: Error) => setUpErr(e.message),
  })

  const del = useMutation({
    mutationFn: (id: string) => api.deleteNovel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['novels'] }),
  })

  const onUpload = (e: FormEvent) => {
    e.preventDefault()
    setUpErr(null)
    if (!file) {
      setUpErr('请选择一个 .txt 文件')
      return
    }
    if (chapterCount < 1) {
      setUpErr('分析章数必须 ≥ 1')
      return
    }
    upload.mutate()
  }

  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    if (!/\.txt$/i.test(f.name) && f.type !== 'text/plain') {
      setUpErr('只支持 .txt 文件')
      return
    }
    setUpErr(null)
    setFile(f)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragActive(false)
    pickFile(e.dataTransfer.files?.[0])
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,1fr)]">
        <div className="pt-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
            Reference Intake
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight text-[var(--ink)]">
            把参考小说拆成可复用的剧情资产。
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--muted)]">
            上传 txt 后，系统会切分章节，抽取摘要、人物、支线和钩子，再给改写 agent 作为上下文。
          </p>
          <div className="mt-6 grid max-w-xl grid-cols-3 gap-2 text-xs">
            {['章节抽取', '跨章聚合', '改写上下文'].map((label, index) => (
              <div key={label} className="surface-tight px-3 py-2">
                <div className="font-mono text-[var(--accent)]">0{index + 1}</div>
                <div className="mt-1 text-[var(--muted)]">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={onUpload} className="surface p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-semibold">上传参考小说</h2>
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--accent)]">
              .txt
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={cn(
              'cursor-pointer rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors',
              dragActive
                ? 'border-[var(--ink)] bg-[#eef3e8]'
                : 'border-[var(--line-strong)] bg-[rgba(255,255,252,0.64)] hover:border-[var(--ink)] hover:bg-[#fffefa]',
            )}
          >
            {file ? (
              <div className="text-sm">
                <div className="font-medium text-neutral-900 truncate">{file.name}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {(file.size / 1024).toFixed(1)} KB · 点击更换
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="ml-3 text-rose-600 hover:underline"
                  >
                    移除
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-neutral-500">
                <span className="text-neutral-900 font-medium">点击选择</span>
                &nbsp;或拖拽 .txt 文件到此处
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="书名（留空则取文件名）"
              className="min-w-0 rounded-md border border-[var(--line-strong)] bg-[rgba(255,255,252,0.78)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c8d7bc]"
            />
            <div className="flex items-center gap-2 text-sm text-neutral-600">
              <span>分析前</span>
              <input
                type="number"
                min={1}
                value={chapterCount}
                onChange={(e) =>
                  setChapterCount(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-20 rounded-md border border-[var(--line-strong)] bg-[rgba(255,255,252,0.78)] px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c8d7bc]"
              />
              <span>章</span>
            </div>
            <button
              type="submit"
              disabled={upload.isPending || !file}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {upload.isPending ? '分析启动中...' : '上传并开始分析'}
            </button>
          </div>
          {upErr && <p className="text-sm text-rose-600">{upErr}</p>}
          <p className="mt-3 text-xs text-[var(--muted)]">
            支持 "第X章" 格式的中文网文 .txt。上传后会自动切分 + 调用 DeepSeek 分析。
          </p>
        </form>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
              Library
            </p>
            <h2 className="mt-1 text-xl font-semibold">小说列表</h2>
          </div>
          {novels && novels.length > 0 && (
            <span className="text-xs text-[var(--muted)]">{novels.length} 部</span>
          )}
        </div>
        {isLoading && <p className="text-sm text-neutral-400">加载中...</p>}
        {error && (
          <p className="text-sm text-rose-600">加载失败: {(error as Error).message}</p>
        )}
        {novels && novels.length === 0 && (
          <p className="text-sm text-neutral-400">
            还没有上传过小说，从上面开始吧。
          </p>
        )}
        {novels && novels.length > 0 && (
          <ul className="grid gap-3 md:grid-cols-2">
            {novels.map((n) => (
              <li
                key={n.id}
                className="surface-tight p-4 transition-transform hover:-translate-y-0.5 hover:border-[var(--line-strong)]"
              >
                <Link
                  to={`/novels/${n.id}`}
                  className="block min-w-0 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{n.title}</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">
                        共 {n.chapter_count} 章 · 已分析至第 {n.analyzed_to} 章
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-1 text-xs',
                        statusStyle[n.status],
                      )}
                    >
                      {statusLabel[n.status]}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#e6e9e2]">
                    <div
                      className="h-full rounded-full bg-[var(--sage)] transition-[width] duration-500"
                      style={{
                        width: `${Math.min(100, Math.round((n.analyzed_to / Math.max(1, n.chapter_count)) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
                    <span className="truncate">
                      {n.status === 'analyzing' || n.status === 'splitting'
                        ? `本次 ${n.analysis_from}–${n.analysis_to}（${n.analyzed_count}）`
                        : n.error || '点击查看分析结果'}
                    </span>
                  </div>
                </Link>
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: '删除小说',
                      message: `确定删除《${n.title}》？此操作不可撤销。`,
                      confirmLabel: '删除',
                      tone: 'danger',
                    })
                    if (ok) del.mutate(n.id)
                  }}
                  className="mt-3 text-xs text-neutral-400 hover:text-rose-600"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
