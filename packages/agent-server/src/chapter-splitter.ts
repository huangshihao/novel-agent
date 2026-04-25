// 中文网文章节切分。从 analyze-novel/src/chapter_splitter.py 移植。

export interface SplitChapter {
  number: number // 1-based，过滤后的连续编号
  title: string // 命中的完整标题，如 "第一章 起因"
  content: string // 章节正文（已去噪、strip）
}

// 行首匹配 "第X章 ..."，允许前导空格/制表符/全角空格
const CHAPTER_RE = /^[ \t　]*(第[一二三四五六七八九十百千零\d\s]+章[^\n]*)/gm

// 网文常见广告/水印
const AD_PATTERNS: RegExp[] = [
  /（本章未完[^）]*）/g,
  /本书由[^\n]*?整理/g,
  /手机用户请浏览[^\n]*?阅读/g,
  /最新网址：[^\n]*\n?/g,
]

const MIN_CHAPTER_BODY = 100 // 短于此视为目录/标题噪音

function clean(text: string): string {
  let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (const pat of AD_PATTERNS) {
    t = t.replace(pat, '')
  }
  t = t.replace(/[ \t]+/g, ' ')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

export function splitChapters(
  text: string,
  pattern?: RegExp,
): SplitChapter[] {
  const cleaned = clean(text)
  const regex = pattern ? new RegExp(pattern.source, 'gm') : CHAPTER_RE
  regex.lastIndex = 0

  const matches: { title: string; start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(cleaned)) !== null) {
    const title = (m[1] ?? '').trim()
    if (title) {
      matches.push({ title, start: m.index, end: m.index + m[0].length })
    }
    // 防止零宽匹配造成死循环
    if (m.index === regex.lastIndex) regex.lastIndex++
  }

  if (matches.length === 0) return []

  const out: SplitChapter[] = []
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!
    const next = matches[i + 1]
    const bodyStart = cur.end
    const bodyEnd = next ? next.start : cleaned.length
    const body = cleaned.slice(bodyStart, bodyEnd).trim()
    if (body.length >= MIN_CHAPTER_BODY) {
      out.push({ number: out.length + 1, title: cur.title, content: body })
    }
  }
  return out
}
