import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { HookCategory } from '@novel-agent/shared'
import { api } from '../lib/api'
import { cn, statusLabel, statusStyle } from '../lib/ui'

type Tab = 'chapters' | 'characters' | 'subplots' | 'hooks'

export function NovelDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('chapters')
  const qc = useQueryClient()

  const { data: novel, error } = useQuery({
    queryKey: ['novel', id],
    queryFn: () => api.getNovel(id),
    refetchInterval: (q) =>
      q.state.data?.status === 'analyzing' || q.state.data?.status === 'splitting'
        ? 2_000
        : false,
  })

  // 分析/聚合从 busy → 完成（ready/failed）时，刷新所有 tab 数据
  const prevStatus = useRef<string | undefined>(undefined)
  useEffect(() => {
    const was = prevStatus.current
    const now = novel?.status
    const wasBusy = was === 'analyzing' || was === 'splitting'
    const doneNow = now === 'ready' || now === 'failed'
    if (wasBusy && doneNow) {
      qc.invalidateQueries({ queryKey: ['chapters', id] })
      qc.invalidateQueries({ queryKey: ['characters', id] })
      qc.invalidateQueries({ queryKey: ['subplots', id] })
      qc.invalidateQueries({ queryKey: ['hooks', id] })
    }
    prevStatus.current = now
  }, [novel?.status, id, qc])

  if (error)
    return (
      <p className="text-sm text-rose-600">
        加载失败: {(error as Error).message}
      </p>
    )
  if (!novel) return <p className="text-sm text-neutral-400">加载中...</p>

  const analyzing = novel.status === 'analyzing' || novel.status === 'splitting'
  // 当前/最近一次 run 的章节数（章节号必定 1..chapter_count 连续）
  const rangeTotal = Math.max(
    0,
    Math.min(novel.analysis_to, novel.chapter_count) - novel.analysis_from + 1,
  )
  const percent =
    rangeTotal > 0
      ? Math.round((novel.analyzed_count / rangeTotal) * 100)
      : 0
  // 只要不在分析中且至少已完成 1 章，就显示工具条（包含「继续分析」和「仅重聚合」）
  const showTools = !analyzing && novel.analyzed_to > 0
  const canContinue = novel.analyzed_to < novel.chapter_count

  return (
    <div className="space-y-6">
      <div className="text-sm text-neutral-500">
        <Link to="/" className="hover:underline underline-offset-4">
          ← 返回列表
        </Link>
      </div>

      <header className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold truncate">{novel.title}</h1>
          <div className="text-sm text-neutral-500 mt-1">
            共 {novel.chapter_count} 章 · 已分析至第 {novel.analyzed_to} 章
            {analyzing &&
              ` · 本次 ${novel.analysis_from}–${Math.min(
                novel.analysis_to,
                novel.chapter_count,
              )}`}
          </div>
        </div>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded-full mt-2',
            statusStyle[novel.status],
          )}
        >
          {statusLabel[novel.status]}
        </span>
      </header>

      {showTools && <ContinueAnalysisBar novelId={id} canContinue={canContinue} />}

      {analyzing && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-neutral-600">
              {novel.status === 'splitting' ? '正在切分...' : '正在分析章节...'}
            </span>
            <span className="font-mono text-xs text-neutral-500">
              {novel.analyzed_count}/{rangeTotal} · {percent}%
            </span>
          </div>
          <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {novel.status === 'failed' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          分析失败: {novel.error ?? '未知错误'}
        </div>
      )}

      <nav className="sticky top-0 z-10 -mx-6 px-6 flex gap-1 border-b border-neutral-200 bg-neutral-50/95 backdrop-blur text-sm">
        {(
          [
            ['chapters', '章节'],
            ['characters', '人物'],
            ['subplots', '支线'],
            ['hooks', '钩子'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-3 py-2 border-b-2 -mb-px transition-colors',
              tab === key
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-900',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      <div>
        {tab === 'chapters' && <ChaptersTab novelId={id} />}
        {tab === 'characters' && <CharactersTab novelId={id} />}
        {tab === 'subplots' && <SubplotsTab novelId={id} />}
        {tab === 'hooks' && <HooksTab novelId={id} />}
      </div>

      <BackToTop />
    </div>
  )
}

function BackToTop() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <button
      type="button"
      aria-label="返回顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={cn(
        'fixed bottom-6 right-6 z-20 h-10 w-10 rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-md transition-opacity hover:text-neutral-900 hover:shadow-lg',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <svg
        viewBox="0 0 20 20"
        className="mx-auto h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12l5-5 5 5" />
      </svg>
    </button>
  )
}

function ChaptersTab({ novelId }: { novelId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.listChapters(novelId),
  })
  if (isLoading) return <p className="text-sm text-neutral-400">加载中...</p>
  if (error)
    return <p className="text-sm text-rose-600">{(error as Error).message}</p>
  if (!data || data.length === 0)
    return <p className="text-sm text-neutral-400">暂无数据</p>
  return (
    <ul className="space-y-2">
      {data.map((c) => (
        <li
          key={c.id}
          className="rounded border border-neutral-200 bg-white p-3 text-sm"
        >
          <div className="font-medium">
            <span className="text-neutral-400 mr-2">第{c.number}章</span>
            {c.title.replace(/^第[^章]*章\s*/, '')}
          </div>
          {c.summary ? (
            <p className="text-neutral-700 mt-1 leading-relaxed">{c.summary}</p>
          ) : (
            <p className="text-neutral-400 mt-1 text-xs">（尚无摘要）</p>
          )}
        </li>
      ))}
    </ul>
  )
}

function CharactersTab({ novelId }: { novelId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['characters', novelId],
    queryFn: () => api.listCharacters(novelId),
  })
  if (isLoading) return <p className="text-sm text-neutral-400">加载中...</p>
  if (error)
    return <p className="text-sm text-rose-600">{(error as Error).message}</p>
  if (!data || data.length === 0)
    return <p className="text-sm text-neutral-400">暂无数据（分析完才会有）</p>
  return (
    <ul className="grid sm:grid-cols-2 gap-3">
      {data.map((c) => (
        <li
          key={c.id}
          className="rounded border border-neutral-200 bg-white p-3 text-sm"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{c.name}</span>
            {c.aliases.length > 0 && (
              <span className="text-xs text-neutral-400">
                又名 {c.aliases.join('、')}
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            第 {c.first_chapter}–{c.last_chapter} 章
          </div>
          {c.description && (
            <p className="text-neutral-700 mt-2 leading-relaxed">
              {c.description}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function SubplotsTab({ novelId }: { novelId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['subplots', novelId],
    queryFn: () => api.listSubplots(novelId),
  })
  if (isLoading) return <p className="text-sm text-neutral-400">加载中...</p>
  if (error)
    return <p className="text-sm text-rose-600">{(error as Error).message}</p>
  if (!data || data.length === 0)
    return <p className="text-sm text-neutral-400">暂无数据</p>
  return (
    <ul className="space-y-3">
      {data.map((s) => (
        <li
          key={s.id}
          className="rounded border border-neutral-200 bg-white p-3 text-sm"
        >
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium">{s.name}</span>
            <span className="text-xs text-neutral-400">
              第 {s.start_chapter}–{s.end_chapter} 章 · {s.chapters.length} 处
            </span>
          </div>
          {s.description && (
            <p className="text-neutral-700 mt-1 leading-relaxed">
              {s.description}
            </p>
          )}
          {s.chapters.length > 0 && (
            <div className="text-xs text-neutral-500 mt-2 font-mono">
              涉及章节: {s.chapters.join(', ')}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

const HOOK_CATEGORY_META: Record<HookCategory, { label: string; cls: string }> = {
  suspense: { label: '悬念', cls: 'bg-sky-100 text-sky-800' },
  crisis: { label: '危机', cls: 'bg-rose-100 text-rose-800' },
  payoff: { label: '爽点', cls: 'bg-amber-100 text-amber-800' },
  goal: { label: '目标', cls: 'bg-emerald-100 text-emerald-800' },
  secret: { label: '秘密', cls: 'bg-indigo-100 text-indigo-800' },
  relation: { label: '关系', cls: 'bg-pink-100 text-pink-800' },
  rule: { label: '规则', cls: 'bg-teal-100 text-teal-800' },
  contrast: { label: '反差', cls: 'bg-fuchsia-100 text-fuchsia-800' },
  emotion: { label: '情绪', cls: 'bg-orange-100 text-orange-800' },
}

function HooksTab({ novelId }: { novelId: string }) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['hooks', novelId],
    queryFn: () => api.listHooks(novelId),
  })
  const del = useMutation({
    mutationFn: (hookId: number) => api.deleteHook(novelId, hookId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hooks', novelId] }),
  })
  if (isLoading) return <p className="text-sm text-neutral-400">加载中...</p>
  if (error)
    return <p className="text-sm text-rose-600">{(error as Error).message}</p>
  if (!data || data.length === 0)
    return <p className="text-sm text-neutral-400">暂无数据</p>
  return (
    <ul className="space-y-2">
      {data.map((h) => {
        const cat = h.category ? HOOK_CATEGORY_META[h.category] : null
        return (
          <li
            key={h.id}
            className="rounded border border-neutral-200 bg-white p-3 text-sm flex items-start gap-3"
          >
            <div className="flex flex-col gap-1 shrink-0 mt-0.5">
              <span
                className={cn(
                  'text-xs px-1.5 py-0.5 rounded text-center',
                  h.type === 'long'
                    ? 'bg-violet-100 text-violet-800'
                    : 'bg-sky-100 text-sky-800',
                )}
              >
                {h.type === 'long' ? '长线' : '短线'}
              </span>
              {cat && (
                <span
                  className={cn('text-xs px-1.5 py-0.5 rounded text-center', cat.cls)}
                >
                  {cat.label}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div>{h.description}</div>
              <div className="text-xs text-neutral-500 mt-1">
                第 {h.planted_chapter} 章埋下
                {h.payoff_chapter
                  ? ` · 第 ${h.payoff_chapter} 章回收`
                  : ' · 尚未回收'}
              </div>
              {h.evidence_chapters && h.evidence_chapters.length > 1 && (
                <div className="text-xs text-neutral-500 mt-1">
                  证据章节：
                  {h.evidence_chapters.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ' · '}
                      <span className="font-mono text-neutral-700">{n}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                if (confirm('删除这条钩子？')) del.mutate(h.id)
              }}
              disabled={del.isPending}
              title="删除"
              className="shrink-0 text-neutral-300 hover:text-rose-600 text-lg leading-none px-1 disabled:opacity-30"
            >
              ×
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ContinueAnalysisBar({
  novelId,
  canContinue,
}: {
  novelId: string
  canContinue: boolean
}) {
  const qc = useQueryClient()
  const [more, setMore] = useState(50)
  const [err, setErr] = useState<string | null>(null)
  const cont = useMutation({
    mutationFn: () => api.continueAnalysis(novelId, more),
    onSuccess: () => {
      setErr(null)
      qc.invalidateQueries({ queryKey: ['novel', novelId] })
    },
    onError: (e: Error) => setErr(e.message),
  })
  const reagg = useMutation({
    mutationFn: () => api.reaggregate(novelId),
    onSuccess: () => {
      setErr(null)
      qc.invalidateQueries({ queryKey: ['novel', novelId] })
    },
    onError: (e: Error) => setErr(e.message),
  })
  const busy = cont.isPending || reagg.isPending
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 flex items-center flex-wrap gap-3 text-sm">
      <span className={cn('text-neutral-600', !canContinue && 'opacity-40')}>
        继续分析
      </span>
      <input
        type="number"
        min={1}
        value={more}
        disabled={!canContinue}
        onChange={(e) => setMore(Math.max(1, Number(e.target.value) || 1))}
        className="w-20 text-sm border border-neutral-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-neutral-400 disabled:opacity-40"
      />
      <span className={cn('text-neutral-600', !canContinue && 'opacity-40')}>章</span>
      <button
        onClick={() => cont.mutate()}
        disabled={busy || !canContinue}
        title={
          !canContinue
            ? '所有章节已分析完毕'
            : '对未分析过的章节调用 LLM 抽取摘要/人物/事件/钩子候选，然后重新聚合人物、支线、钩子。消耗 LLM token。'
        }
        className="inline-flex items-center justify-center rounded bg-neutral-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
      >
        {cont.isPending ? '启动中…' : '开始'}
      </button>
      <span className="mx-1 h-4 w-px bg-neutral-200" aria-hidden />
      <button
        onClick={() => {
          if (
            confirm(
              '用已有章节数据重新聚合人物/支线/钩子？\n\n不会重新读取章节原文，只会基于已抽取的摘要/事件/钩子候选：\n• 人物卡：合并别名、过滤工具人、重写描述\n• 支线：重新识别 3-10 条主支线\n• 钩子：重新过滤/去重/匹配回收\n\n速度快、不消耗每章抽取 token。适合调整聚合规则后复验。',
            )
          )
            reagg.mutate()
        }}
        disabled={busy}
        title={
          '不重新读取章节原文，只用已抽取的数据重建：\n• 人物卡（合并别名、过滤工具人）\n• 支线（重新识别）\n• 钩子（过滤/去重/回收匹配）\n\n调整了聚合规则或对结果不满意时用。速度快、不消耗每章抽取的 token。'
        }
        className="inline-flex items-center justify-center rounded border border-neutral-300 bg-white text-neutral-700 text-sm px-3 py-1.5 hover:bg-neutral-50 disabled:opacity-50"
      >
        {reagg.isPending ? '聚合中…' : '仅重聚合'}
      </button>
      {err && <span className="text-rose-600 text-xs">{err}</span>}
      <p className="basis-full text-xs text-neutral-400 mt-1 leading-relaxed">
        <span className="text-neutral-500">继续分析</span>：扫描新章节并重建全部结果（读章节 +
        聚合，耗 token）
        <span className="mx-2">·</span>
        <span className="text-neutral-500">仅重聚合</span>：只用已抽好的数据重算人物/支线/钩子（不读章节、几乎不耗 token）
      </p>
    </div>
  )
}
