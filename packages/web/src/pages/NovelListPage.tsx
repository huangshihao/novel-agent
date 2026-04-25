import { useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { cn, statusLabel, statusStyle } from '../lib/ui'

export function NovelListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

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
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="font-medium mb-3">上传参考小说</h2>
        <form onSubmit={onUpload} className="space-y-3">
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
              'cursor-pointer rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors',
              dragActive
                ? 'border-neutral-900 bg-neutral-50'
                : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50',
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

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="书名（留空则取文件名）"
              className="flex-1 min-w-0 text-sm border border-neutral-300 rounded px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-400"
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
                className="w-20 text-sm border border-neutral-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-400"
              />
              <span>章</span>
            </div>
            <button
              type="submit"
              disabled={upload.isPending || !file}
              className="inline-flex items-center justify-center rounded bg-neutral-900 text-white text-sm px-4 py-1.5 disabled:opacity-50"
            >
              {upload.isPending ? '分析启动中...' : '上传并开始分析'}
            </button>
          </div>
          {upErr && <p className="text-sm text-rose-600">{upErr}</p>}
          <p className="text-xs text-neutral-400">
            支持 "第X章" 格式的中文网文 .txt。上传后会自动切分 + 调用 DeepSeek 分析。
          </p>
        </form>
      </section>

      <section>
        <h2 className="font-medium mb-3">小说列表</h2>
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
          <ul className="space-y-2">
            {novels.map((n) => (
              <li
                key={n.id}
                className="rounded-lg border border-neutral-200 bg-white p-4 flex items-center gap-4"
              >
                <Link
                  to={`/novels/${n.id}`}
                  className="flex-1 min-w-0 space-y-1 hover:underline underline-offset-4"
                >
                  <div className="font-medium truncate">{n.title}</div>
                  <div className="text-xs text-neutral-500 truncate">
                    共 {n.chapter_count} 章 · 已分析至第 {n.analyzed_to} 章
                    {n.status === 'analyzing' || n.status === 'splitting'
                      ? ` · 本次 ${n.analysis_from}–${n.analysis_to} (${n.analyzed_count})`
                      : ''}
                    {n.error ? ` · ${n.error}` : ''}
                  </div>
                </Link>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    statusStyle[n.status],
                  )}
                >
                  {statusLabel[n.status]}
                </span>
                <button
                  onClick={() => {
                    if (confirm(`删除《${n.title}》？`)) del.mutate(n.id)
                  }}
                  className="text-xs text-neutral-400 hover:text-rose-600"
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
