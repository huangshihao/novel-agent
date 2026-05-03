import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  CharacterStoryFunction,
  HookCategory,
  Replaceability,
  WritingRhythm,
} from '@novel-agent/shared'
import { api } from '../lib/api'
import { cn, statusLabel, statusStyle } from '../lib/ui'
import { useConfirm } from '../lib/use-confirm'

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
        <div className="flex items-center gap-2 mt-2">
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full leading-none',
              statusStyle[novel.status],
            )}
          >
            {statusLabel[novel.status]}
          </span>
          {novel.status === 'ready' && (
            <Link
              to={`/novels/${id}/rewrite`}
              className="px-3 py-1 text-xs rounded bg-amber-500 text-white leading-none"
            >
              去改写 →
            </Link>
          )}
        </div>
      </header>

      {showTools && <ContinueAnalysisBar novelId={id} canContinue={canContinue} />}

      {analyzing && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-neutral-600">
              {novel.status === 'splitting'
                ? '正在切分...'
                : percent < 100
                  ? '正在分析章节...'
                  : '正在聚合（人物 / 支线 / 钩子 / 设定 / 风格采样）...'}
            </span>
            <span className="font-mono text-xs text-neutral-500">
              {percent < 100
                ? `${novel.analyzed_count}/${rangeTotal} · ${percent}%`
                : '聚合中'}
            </span>
          </div>
          <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full transition-[width] duration-500',
                percent < 100 ? 'bg-amber-400' : 'bg-amber-400 animate-pulse',
              )}
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
  const [expanded, setExpanded] = useState<number | null>(null)
  if (isLoading) return <p className="text-sm text-neutral-400">加载中...</p>
  if (error)
    return <p className="text-sm text-rose-600">{(error as Error).message}</p>
  if (!data || data.length === 0)
    return <p className="text-sm text-neutral-400">暂无数据</p>
  return (
    <ul className="space-y-2">
      {data.map((c) => {
        const isOpen = expanded === c.number
        return (
          <li
            key={c.id}
            className="rounded border border-neutral-200 bg-white p-3 text-sm"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  <span className="text-neutral-400 mr-2">第{c.number}章</span>
                  {c.title.replace(/^第[^章]*章\s*/, '')}
                </div>
                {(c.plot_functions?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {c.plot_functions!.map((f, i) => (
                      <span
                        key={i}
                        className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                {c.summary ? (
                  <p className="text-neutral-700 mt-2 leading-relaxed">{c.summary}</p>
                ) : (
                  <p className="text-neutral-400 mt-2 text-xs">（尚无摘要）</p>
                )}
                {(c.originality_risks?.length ?? 0) > 0 && (
                  <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded px-2 py-1.5">
                    <span className="font-medium">⚠ 标志性桥段（改写避开）：</span>
                    <ul className="list-disc list-inside mt-0.5 space-y-0.5">
                      {c.originality_risks!.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <button
                onClick={() => setExpanded(isOpen ? null : c.number)}
                className="text-xs text-neutral-500 hover:text-neutral-900 px-2 py-0.5 rounded border border-neutral-200 shrink-0 mt-0.5"
              >
                {isOpen ? '收起' : '详情'}
              </button>
            </div>
            {isOpen && <ChapterDetail novelId={novelId} number={c.number} />}
          </li>
        )
      })}
    </ul>
  )
}

function ChapterDetail({ novelId, number }: { novelId: string; number: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['chapter-detail', novelId, number],
    queryFn: () => api.getChapter(novelId, number),
  })
  if (isLoading)
    return <div className="mt-3 text-xs text-neutral-400">加载中...</div>
  if (error)
    return (
      <div className="mt-3 text-xs text-rose-600">
        {(error as Error).message}
      </div>
    )
  if (!data) return null
  return (
    <div className="mt-3 pt-3 border-t border-neutral-100 space-y-3">
      {(data.key_events?.length ?? 0) > 0 && (
        <section>
          <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
            关键事件
          </h4>
          <ul className="space-y-1.5">
            {data.key_events!.map((e, i) => (
              <li key={i} className="text-xs">
                <div className="text-neutral-800">{e.desc}</div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {e.function && (
                    <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">
                      功能：{e.function}
                    </span>
                  )}
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded',
                      e.can_replace
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-neutral-100 text-neutral-600',
                    )}
                  >
                    {e.can_replace ? '可换载体' : '不可换'}
                  </span>
                  {e.can_reorder && (
                    <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">
                      可调顺序
                    </span>
                  )}
                  {e.depends_on.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
                      依赖：{e.depends_on.join(' / ')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.writing_rhythm && <WritingRhythmView rhythm={data.writing_rhythm} />}
    </div>
  )
}

function WritingRhythmView({ rhythm }: { rhythm: WritingRhythm }) {
  const tc = rhythm.text_composition
  const pp = rhythm.pacing_profile
  const ec = rhythm.emotional_curve
  const cwp = rhythm.chapter_writing_pattern
  const rad = rhythm.reader_attention_design
  const ratios: [string, string][] = [
    ['动作', tc.action_narration_ratio],
    ['对话', tc.dialogue_ratio],
    ['心理', tc.inner_monologue_ratio],
    ['解释', tc.exposition_ratio],
    ['描写', tc.description_ratio],
    ['冲突', tc.conflict_ratio],
    ['过渡', tc.summary_transition_ratio],
  ].filter(([, v]) => v) as [string, string][]
  const emotions = [ec.opening_emotion, ec.middle_emotion, ec.climax_emotion, ec.ending_emotion].filter(Boolean)
  return (
    <section>
      <h4 className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1.5">
        写作节奏
      </h4>
      <div className="grid sm:grid-cols-2 gap-3 text-xs">
        {cwp.structure_type && (
          <div className="rounded border border-neutral-100 bg-neutral-50 p-2">
            <div className="text-neutral-500 mb-0.5">结构类型 / 核心节奏</div>
            <div className="text-neutral-800 font-medium">{cwp.structure_type}</div>
            {cwp.core_rhythm && (
              <div className="text-neutral-700 mt-0.5">{cwp.core_rhythm}</div>
            )}
          </div>
        )}
        {cwp.beat_sequence.length > 0 && (
          <div className="rounded border border-neutral-100 bg-neutral-50 p-2">
            <div className="text-neutral-500 mb-0.5">节拍顺序</div>
            <ol className="list-decimal list-inside space-y-0.5 text-neutral-700">
              {cwp.beat_sequence.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ol>
          </div>
        )}
        {ratios.length > 0 && (
          <div className="rounded border border-neutral-100 bg-neutral-50 p-2">
            <div className="text-neutral-500 mb-0.5">文本配比</div>
            <div className="flex flex-wrap gap-1">
              {ratios.map(([k, v]) => (
                <span key={k} className="px-1.5 py-0.5 rounded bg-white border border-neutral-200">
                  {k} {v}
                </span>
              ))}
            </div>
          </div>
        )}
        {(pp.opening_speed || pp.overall_rhythm) && (
          <div className="rounded border border-neutral-100 bg-neutral-50 p-2">
            <div className="text-neutral-500 mb-0.5">速度</div>
            {pp.opening_speed && (
              <div className="text-neutral-700">
                开 {pp.opening_speed} · 中 {pp.middle_speed} · 结 {pp.ending_speed}
              </div>
            )}
            {pp.overall_rhythm && <div className="text-neutral-700 mt-0.5">{pp.overall_rhythm}</div>}
          </div>
        )}
        {emotions.length > 0 && (
          <div className="rounded border border-neutral-100 bg-neutral-50 p-2">
            <div className="text-neutral-500 mb-0.5">情绪曲线</div>
            <div className="text-neutral-700">{emotions.join(' → ')}</div>
            {ec.emotion_shift_points.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-neutral-600">
                {ec.emotion_shift_points.map((p, i) => (
                  <li key={i}>
                    <span className="font-mono text-neutral-500">{p.position}</span>{' '}
                    {p.from} → {p.to}（{p.trigger}）
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(rad.opening_hook || rad.chapter_end_hook) && (
          <div className="rounded border border-neutral-100 bg-neutral-50 p-2 sm:col-span-2">
            <div className="text-neutral-500 mb-0.5">钩子设计</div>
            {rad.opening_hook && (
              <div className="text-neutral-700">开头：{rad.opening_hook}</div>
            )}
            {rad.chapter_end_hook && (
              <div className="text-neutral-700 mt-0.5">章末：{rad.chapter_end_hook}</div>
            )}
            {rad.micro_hooks.length > 0 && (
              <div className="text-neutral-700 mt-0.5">
                小钩：{rad.micro_hooks.join(' · ')}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const STORY_FUNCTION_META: Record<CharacterStoryFunction, { label: string; cls: string }> = {
  'pressure-source': { label: '压迫源', cls: 'bg-rose-100 text-rose-800' },
  benefactor: { label: '贵人', cls: 'bg-emerald-100 text-emerald-800' },
  rival: { label: '竞争者', cls: 'bg-amber-100 text-amber-800' },
  witness: { label: '见证者', cls: 'bg-sky-100 text-sky-800' },
  'resource-gateway': { label: '资源入口', cls: 'bg-teal-100 text-teal-800' },
  'emotional-anchor': { label: '情绪锚', cls: 'bg-pink-100 text-pink-800' },
  'antagonist-proxy': { label: '反派代理', cls: 'bg-rose-50 text-rose-700' },
  foil: { label: '反衬', cls: 'bg-neutral-100 text-neutral-700' },
  'information-source': { label: '信息源', cls: 'bg-indigo-100 text-indigo-800' },
  gatekeeper: { label: '守门人', cls: 'bg-violet-100 text-violet-800' },
}

const REPLACEABILITY_META: Record<Replaceability, { label: string; cls: string }> = {
  high: { label: '可换身份', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  medium: { label: '需保留关系', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  low: { label: '身份不可换', cls: 'bg-neutral-100 text-neutral-700 border border-neutral-300' },
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
      {data.map((c) => {
        const sf = c.story_function ? STORY_FUNCTION_META[c.story_function] : null
        const rep = c.replaceability ? REPLACEABILITY_META[c.replaceability] : null
        return (
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
            {(sf || rep) && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {sf && (
                  <span className={cn('text-xs px-1.5 py-0.5 rounded', sf.cls)}>
                    {sf.label}
                  </span>
                )}
                {rep && (
                  <span className={cn('text-xs px-1.5 py-0.5 rounded', rep.cls)}>
                    {rep.label}
                  </span>
                )}
              </div>
            )}
            {c.description && (
              <p className="text-neutral-700 mt-2 leading-relaxed">
                {c.description}
              </p>
            )}
          </li>
        )
      })}
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
            {s.reorderable !== undefined && (
              <span
                className={cn(
                  'text-xs px-1.5 py-0.5 rounded',
                  s.reorderable
                    ? 'bg-violet-50 text-violet-700 border border-violet-200'
                    : 'bg-neutral-100 text-neutral-600 border border-neutral-200',
                )}
              >
                {s.reorderable ? '顺序可调' : '关键节点'}
              </span>
            )}
          </div>
          {s.delivers && (
            <div className="mt-1.5 text-xs">
              <span className="text-neutral-500">交付：</span>
              <span className="text-emerald-700">{s.delivers}</span>
            </div>
          )}
          {(s.depends_on?.length ?? 0) > 0 && (
            <div className="mt-1 text-xs text-neutral-500">
              依赖支线：
              <span className="font-mono text-neutral-700">
                {s.depends_on!.join(' / ')}
              </span>
            </div>
          )}
          {s.description && (
            <p className="text-neutral-700 mt-1.5 leading-relaxed">
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
  const confirm = useConfirm()
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
              onClick={async () => {
                const ok = await confirm({
                  title: '删除钩子',
                  message: '确定删除这条钩子？',
                  confirmLabel: '删除',
                  tone: 'danger',
                })
                if (ok) del.mutate(h.id)
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
  const confirm = useConfirm()
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
        onClick={async () => {
          const ok = await confirm({
            title: '重新聚合',
            confirmLabel: '开始',
            message: (
              <div className="space-y-2">
                <p>用已有章节数据重新聚合人物 / 支线 / 钩子？</p>
                <p className="text-neutral-600">
                  不会重新读取章节原文，只会基于已抽取的摘要 / 事件 / 钩子候选：
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-neutral-600">
                  <li>人物卡：合并别名、过滤工具人、重写描述</li>
                  <li>支线：重新识别 3-10 条主支线</li>
                  <li>钩子：重新过滤 / 去重 / 匹配回收</li>
                </ul>
                <p className="text-neutral-500 text-xs">
                  速度快、不消耗每章抽取 token。适合调整聚合规则后复验。
                </p>
              </div>
            ),
          })
          if (ok) reagg.mutate()
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
