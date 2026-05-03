import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const DEFAULT_ROOT = join(homedir(), '.novel-agent', 'data')

function findRepoRoot(start: string): string {
  let dir = start
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

function root(): string {
  const envVal = process.env['NOVEL_AGENT_DATA_DIR']
  if (!envVal) return DEFAULT_ROOT
  if (isAbsolute(envVal)) return envVal
  return resolve(findRepoRoot(process.cwd()), envVal)
}

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

export const paths = {
  root,
  novel: (id: string) => join(root(), id),
  novelIndex: (id: string) => join(root(), id, 'index.md'),
  sourceDir: (id: string) => join(root(), id, 'source'),
  sourceMeta: (id: string) => join(root(), id, 'source', 'meta.md'),
  sourceCharactersDir: (id: string) => join(root(), id, 'source', 'characters'),
  sourceCharacter: (id: string, name: string) =>
    join(root(), id, 'source', 'characters', `${name}.md`),
  sourceSubplots: (id: string) => join(root(), id, 'source', 'subplots.md'),
  sourceHooks: (id: string) => join(root(), id, 'source', 'hooks.md'),
  sourceChaptersDir: (id: string) => join(root(), id, 'source', 'chapters'),
  sourceChapter: (id: string, n: number) =>
    join(root(), id, 'source', 'chapters', `${pad4(n)}.md`),
  sourceRawDir: (id: string) => join(root(), id, 'source', 'raw'),
  sourceRaw: (id: string, n: number) =>
    join(root(), id, 'source', 'raw', `${pad4(n)}.txt`),
  targetDir: (id: string) => join(root(), id, 'target'),
  targetMaps: (id: string) => join(root(), id, 'target', 'maps.md'),
  targetState: (id: string) => join(root(), id, 'target', 'state.md'),
  targetOutlinesDir: (id: string) => join(root(), id, 'target', 'outlines'),
  targetOutline: (id: string, n: number) =>
    join(root(), id, 'target', 'outlines', `${pad4(n)}.md`),
  targetChaptersDir: (id: string) => join(root(), id, 'target', 'chapters'),
  targetChapter: (id: string, n: number) =>
    join(root(), id, 'target', 'chapters', `${pad4(n)}.md`),
  chatsDir: (id: string) => join(root(), id, 'chats'),
  chatsIndex: (id: string) => join(root(), id, 'chats', 'index.md'),
  chatSession: (novelId: string, chatId: string) =>
    join(root(), novelId, 'chats', `${chatId}.jsonl`),
}
