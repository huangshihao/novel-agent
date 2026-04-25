import matter from 'gray-matter'
import { mkdir, readFile, rename, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface MdFile<F> {
  frontMatter: F
  body: string
}

export async function writeMd(
  path: string,
  frontMatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const content = matter.stringify(body, frontMatter)
  const tmp = `${path}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

export async function readMd<F = Record<string, unknown>>(
  path: string,
): Promise<MdFile<F>> {
  const raw = await readFile(path, 'utf8')
  const parsed = matter(raw)
  return { frontMatter: parsed.data as F, body: parsed.content }
}

export async function readMdIfExists<F = Record<string, unknown>>(
  path: string,
): Promise<MdFile<F> | null> {
  try {
    return await readMd<F>(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function listFrontMatter<F = Record<string, unknown>>(
  dir: string,
): Promise<{ path: string; frontMatter: F }[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: { path: string; frontMatter: F }[] = []
  for (const e of entries) {
    if (!e.endsWith('.md')) continue
    const path = join(dir, e)
    const md = await readMd<F>(path)
    out.push({ path, frontMatter: md.frontMatter })
  }
  return out
}
