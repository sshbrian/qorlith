import type { GalleryImage } from './api'

export type GalleryStack = {
  /** Stable group id */
  id: string
  /** How we grouped these */
  reason: string
  /** Newest-first members */
  items: GalleryImage[]
  cover: GalleryImage
  count: number
}

/**
 * Normalize a filename stem into a "family" key for Comfy-style batches.
 * Examples:
 *   style_v1_test_00001_  -> style_v1_test
 *   ComfyUI_00002_           -> ComfyUI
 *   shot_01                  -> shot
 *   foo-000008               -> foo
 */
export function familyStem(name: string): string {
  let stem = name.replace(/\.[^.]+$/, '')
  // Comfy SaveImage: name_00001_ or name_00001
  stem = stem.replace(/_\d{3,5}_?$/i, '')
  // Kohya/epoch style -000001
  stem = stem.replace(/-\d{4,6}$/i, '')
  // trailing _01 / _1
  stem = stem.replace(/_0*\d{1,3}$/i, '')
  // collapse leftover trailing separators
  stem = stem.replace(/[_-]+$/g, '')
  return stem || name
}

/** Directory + family stem — primary filename stack key */
export function filenameStackKey(img: Pick<GalleryImage, 'rel' | 'name' | 'root'>): string {
  const dir = img.rel.includes('/') ? img.rel.slice(0, img.rel.lastIndexOf('/')) : ''
  const fam = familyStem(img.name)
  return `file:${img.root}|${dir}|${fam}`.toLowerCase()
}

export type StackHints = {
  seed?: number | string | null
  promptHash?: string | null
  promptId?: string | null
  batchId?: string | null
  stackId?: string | null
  parentPath?: string | null
  sourceImage?: string | null
}

function metaStackKey(img: GalleryImage & { stackHints?: StackHints | null }): string | null {
  const h = img.stackHints
  if (!h) return null
  if (h.stackId) return `stack:${h.stackId}`
  if (h.batchId) return `batch:${h.batchId}`
  if (h.promptId) return `prompt:${h.promptId}`
  if (h.seed != null && h.promptHash) return `seedprompt:${h.seed}:${h.promptHash}`
  return null
}

/** Prefer project+clip super-stack (all C07 stills + videos together). */
function clipStackKey(img: GalleryImage): string | null {
  if (!img.clipId) return null
  const proj = img.project || 'any'
  return `clip:${proj}|${img.clipId}`.toLowerCase()
}

function reasonForKey(key: string): string {
  if (key.startsWith('clip:')) return 'clip id'
  if (key.startsWith('stack:')) return 'stack id'
  if (key.startsWith('batch:')) return 'batch id'
  if (key.startsWith('prompt:')) return 'prompt id'
  if (key.startsWith('seedprompt:')) return 'seed + prompt'
  if (key.startsWith('file:')) return 'filename family'
  return 'related'
}

/**
 * Group images into smart stacks. Prefer meta-based keys; fall back to filename family.
 * Singleton stacks are still returned (count=1) so the UI can flatten/stack uniformly.
 */
export function buildSmartStacks(
  images: (GalleryImage & { stackHints?: StackHints | null })[],
): GalleryStack[] {
  const buckets = new Map<string, GalleryImage[]>()

  for (const img of images) {
    const key = clipStackKey(img) || metaStackKey(img) || filenameStackKey(img)
    const list = buckets.get(key) || []
    list.push(img)
    buckets.set(key, list)
  }

  const stacks: GalleryStack[] = []
  for (const [key, items] of buckets) {
    const sorted = [...items].sort((a, b) => b.mtime - a.mtime)
    stacks.push({
      id: key,
      reason: reasonForKey(key),
      items: sorted,
      cover: sorted[0],
      count: sorted.length,
    })
  }

  // Newest stack first (by cover mtime)
  stacks.sort((a, b) => b.cover.mtime - a.cover.mtime)
  return stacks
}
