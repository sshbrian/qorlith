/**
 * Comfy output gallery: walk, sidecars, archive, allowlist.
 */
import fs from 'fs'
import path from 'path'
import { ARCHIVE_PATH } from './appConfig.mjs'
import { fail } from './errors.mjs'
import { getComfyOutput, getComfyRoot, loadStudio } from './studioConfig.mjs'
import { humanSize, safeStat, walkFiles } from './fsutil.mjs'

/** Normalize media path for archive membership (absolute, lowercased on Windows). */
export function archiveKey(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase()
}

/**
 * Gallery archive: hide media from the default gallery without deleting files.
 * Stored as absolute paths in data/gallery-archive.json.
 */
export function loadArchiveStore() {
  try {
    if (!fs.existsSync(ARCHIVE_PATH)) {
      return { paths: [], updatedAt: null }
    }
    const raw = JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8'))
    const paths = Array.isArray(raw.paths) ? raw.paths.filter((p) => typeof p === 'string') : []
    return { paths, updatedAt: raw.updatedAt || null }
  } catch {
    return { paths: [], updatedAt: null }
  }
}

export function saveArchiveStore(store) {
  fs.mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true })
  const paths = [...new Set((store.paths || []).map((p) => path.resolve(p)))].sort()
  const out = { paths, updatedAt: new Date().toISOString(), count: paths.length }
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(out, null, 2), 'utf8')
  return out
}

export function archiveKeySet(store = loadArchiveStore()) {
  return new Set((store.paths || []).map(archiveKey))
}

export function isArchivedPath(filePath, keySet = archiveKeySet()) {
  return keySet.has(archiveKey(filePath))
}

export function addArchivedPaths(paths, { roots }) {
  const store = loadArchiveStore()
  const set = new Set(store.paths.map(archiveKey))
  const added = []
  for (const p of paths) {
    if (!p || typeof p !== 'string') continue
    const resolved = path.resolve(p)
    if (!allowedUnderRoots(resolved, roots)) {
      fail(403, 'path_forbidden', `path not allowed: ${p}`, {
        hint: 'Files must live under comfy.output in qorlith.yaml.',
      })
    }
    const st = safeStat(resolved)
    if (!st || !st.isFile() || !isMediaFile(resolved)) {
      fail(404, 'media_not_found', `media not found: ${p}`, {
        hint: 'That file is gone or is not an image/video.',
      })
    }
    const key = archiveKey(resolved)
    if (!set.has(key)) {
      set.add(key)
      store.paths.push(resolved)
      added.push(resolved)
    }
  }
  const saved = saveArchiveStore(store)
  return { added, store: saved }
}

export function removeArchivedPaths(paths) {
  const store = loadArchiveStore()
  const removeKeys = new Set(
    (paths || []).filter((p) => typeof p === 'string').map((p) => archiveKey(p)),
  )
  const before = store.paths.length
  store.paths = store.paths.filter((p) => !removeKeys.has(archiveKey(p)))
  const saved = saveArchiveStore(store)
  return { removed: before - saved.paths.length, store: saved }
}
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv']
const MEDIA_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS]

export function isImageFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return IMAGE_EXTS.includes(ext)
}

export function isVideoFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return VIDEO_EXTS.includes(ext)
}

export function isMediaFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return MEDIA_EXTS.includes(ext)
}

export function mediaKind(filePath) {
  if (isVideoFile(filePath)) return 'video'
  if (isImageFile(filePath)) return 'image'
  return 'file'
}

export function allowedUnderRoots(resolved, roots) {
  const r = path.resolve(resolved).toLowerCase()
  return (roots || []).some((root) => r.startsWith(path.resolve(root).toLowerCase()))
}

export function findSidecar(imagePath) {
  const dir = path.dirname(imagePath)
  const base = path.basename(imagePath, path.extname(imagePath))
  const candidates = [
    path.join(dir, `${base}.json`),
    path.join(dir, `${base}.yaml`),
    path.join(dir, `${base}.yml`),
    path.join(dir, `${base}.meta.json`),
    `${imagePath}.json`,
    `${imagePath}.yaml`,
  ]
  for (const c of candidates) {
    const st = safeStat(c)
    if (st && st.isFile()) return c
  }
  return null
}

export function parseSidecarFile(filePath) {
  if (!filePath) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    if (/\.json$/i.test(filePath)) {
      return { format: 'json', data: JSON.parse(cleaned), raw: cleaned, path: filePath }
    }
    // lightweight yaml: key: value lines + nested lora: blocks not fully parsed
    // Prefer JSON when both exist; for yaml return structured fields we care about
    const data = { _rawYaml: true }
    for (const line of cleaned.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      } else if (/^-?\d+(\.\d+)?$/.test(v)) {
        v = Number(v)
      } else if (v === 'true' || v === 'false') {
        v = v === 'true'
      }
      data[m[1]] = v
    }
    // nested lora keys from our yaml writer
    const loraBlock = {}
    let inLora = false
    for (const line of cleaned.split(/\r?\n/)) {
      if (/^lora:\s*$/.test(line)) {
        inLora = true
        continue
      }
      if (inLora) {
        const m = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/)
        if (!m) {
          if (/^\S/.test(line)) inLora = false
          continue
        }
        let v = m[2].trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1)
        } else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v)
        loraBlock[m[1]] = v
      }
    }
    if (Object.keys(loraBlock).length) data.lora = loraBlock
    return { format: 'yaml', data, raw: cleaned, path: filePath }
  } catch {
    return null
  }
}

export function simpleHash(str) {
  if (!str) return null
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

/** Lightweight fields for client-side smart stacking (no full meta dump). */
export function stackHintsFromMeta(metaData) {
  if (!metaData || typeof metaData !== 'object') return null
  const sampler = metaData.sampler && typeof metaData.sampler === 'object' ? metaData.sampler : {}
  const seed = sampler.seed ?? metaData.seed ?? null
  const prompt = typeof metaData.prompt === 'string' ? metaData.prompt : null
  return {
    seed,
    promptHash: simpleHash(prompt),
    promptId: metaData.promptId || metaData.prompt_id || null,
    batchId: metaData.batchId || metaData.batch_id || null,
    stackId: metaData.stackId || metaData.stack_id || null,
    parentPath: metaData.parentPath || metaData.parent_path || null,
    sourceImage: metaData.sourceImage || metaData.source_image || metaData.derivedFrom || null,
  }
}

export function normalizeRelatedRef(ref, fromPath, roots) {
  if (!ref || typeof ref !== 'string') return null
  const cleaned = ref.trim().replace(/\//g, path.sep)
  // absolute
  if (/^[A-Za-z]:[\\/]/.test(cleaned) || cleaned.startsWith('\\\\')) {
    const abs = path.resolve(cleaned)
    if (allowedUnderRoots(abs, roots) && safeStat(abs)) return abs
    return null
  }
  // relative to media file
  const beside = path.resolve(path.dirname(fromPath), cleaned)
  if (allowedUnderRoots(beside, roots) && safeStat(beside)) return beside
  // match by basename under roots
  const base = path.basename(cleaned)
  for (const root of roots || []) {
    if (!safeStat(root)) continue
    for (const f of walkFiles(root, { maxDepth: 6 })) {
      if (path.basename(f).toLowerCase() === base.toLowerCase()) return f
    }
  }
  return null
}

export function extractExplicitRelated(metaData) {
  if (!metaData || typeof metaData !== 'object') return []
  const out = []
  const push = (ref, role) => {
    if (!ref) return
    if (typeof ref === 'string') out.push({ ref, role: role || 'related' })
    else if (typeof ref === 'object' && ref.path) out.push({ ref: ref.path, role: ref.role || role || 'related' })
  }
  push(metaData.sourceImage || metaData.source_image, 'source')
  push(metaData.derivedFrom || metaData.derived_from, 'derived_from')
  push(metaData.parentPath || metaData.parent_path || metaData.parentImage, 'parent')
  push(metaData.imageSource || metaData.image_source, 'source')
  if (Array.isArray(metaData.related)) {
    for (const r of metaData.related) push(r, 'related')
  }
  if (Array.isArray(metaData.relations)) {
    for (const r of metaData.relations) push(r, r.role || 'related')
  }
  return out
}

export function extractClipId(name, rel, metaData) {
  if (metaData && typeof metaData.clipId === 'string') return metaData.clipId.toUpperCase()
  if (metaData && typeof metaData.clip_id === 'string') return metaData.clip_id.toUpperCase()
  const blob = `${name} ${rel || ''}`
  // clip ids like C01 from folder names
  const m = blob.match(/\b((?:C|Y|G|S|H)\d{2})\b/i)
  return m ? m[1].toUpperCase() : null
}

export function projectFromRel(rel) {
  if (!rel) return null
  const parts = String(rel).replace(/\\/g, '/').split('/').filter(Boolean)
  // qorlith/<look>/<project>/stills/C01/...
  const mi = parts.findIndex((p) => p === 'qorlith' || p === 'video')
  if (mi >= 0 && parts[mi + 1]) {
    const look = parts[mi + 1]
    if (parts[mi + 2] && parts[mi + 2] !== 'stills' && parts[mi + 2] !== 'video') return parts[mi + 2]
    return look
  }
  return parts[0] || null
}

export function galleryMatchesQuery(item, qRaw) {
  if (!qRaw) return true
  const q = String(qRaw).trim().toLowerCase()
  if (!q) return true
  // kind:video | project:x | clip:c07 | missing:meta
  const tokens = q.split(/\s+/).filter(Boolean)
  for (const tok of tokens) {
    if (tok.startsWith('kind:')) {
      if (String(item.kind || '').toLowerCase() !== tok.slice(5)) return false
      continue
    }
    if (tok.startsWith('project:')) {
      if (String(item.project || '').toLowerCase() !== tok.slice(8)) return false
      continue
    }
    if (tok.startsWith('clip:')) {
      if (String(item.clipId || '').toLowerCase() !== tok.slice(5).toUpperCase().toLowerCase()) {
        // also allow clip:c07 vs C07
        if (String(item.clipId || '').toLowerCase() !== tok.slice(5)) return false
      }
      continue
    }
    if (tok === 'missing:meta' || tok === 'has:meta') {
      if (tok === 'missing:meta' && item.hasMeta) return false
      if (tok === 'has:meta' && !item.hasMeta) return false
      continue
    }
    if (tok === 'pick' || tok === 'is:pick') {
      if (!/pick/i.test(item.name || '')) return false
      continue
    }
    // free text
    const hay = [
      item.name,
      item.rel,
      item.path,
      item.clipId,
      item.project,
      item.promptText,
      item.tagsText,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!hay.includes(tok)) return false
  }
  return true
}

/**
 * @param {object} cfg
 * @param {{ limit?: number, offset?: number, archiveMode?: 'hide' | 'only' | 'all', q?: string, kind?: string, project?: string, clip?: string, includeFacets?: boolean }} [opts]
 * archiveMode: hide = default gallery; only = archived trash view; all = both
 *
 * Single filesystem walk. Query filters (q/kind/project/clip) apply after the walk.
 * When includeFacets=true, project/clip facet counts are built from the
 * archive-filtered pool (before query filters) so the gallery endpoint does
 * not need a second full scan.
 */
export function listGalleryMedia(
  cfg,
  {
    limit = 200,
    offset = 0,
    archiveMode = 'hide',
    q = '',
    kind = '',
    project = '',
    clip = '',
    includeFacets = false,
  } = {},
) {
  const roots = cfg.comfyOutputRoots || []
  const archivedKeys = archiveKeySet()
  const pool = []
  for (const root of roots) {
    if (!safeStat(root)) continue
    for (const f of walkFiles(root, { maxDepth: 6 })) {
      if (!isMediaFile(f)) continue
      const archived = archivedKeys.has(archiveKey(f))
      if (archiveMode === 'hide' && archived) continue
      if (archiveMode === 'only' && !archived) continue
      const st = safeStat(f)
      if (!st) continue
      const sc = findSidecar(f)
      const parsed = sc ? parseSidecarFile(sc) : null
      const metaData = parsed?.data || null
      const rel = path.relative(root, f).replace(/\\/g, '/')
      const name = path.basename(f)
      const clipId = extractClipId(name, rel, metaData)
      const projectId = projectFromRel(rel)
      const promptText =
        metaData && typeof metaData.prompt === 'string' ? metaData.prompt.slice(0, 500) : ''
      const tagsText = Array.isArray(metaData?.tags) ? metaData.tags.join(' ') : ''
      pool.push({
        id: Buffer.from(f).toString('base64url'),
        path: f,
        name,
        rel,
        root,
        kind: mediaKind(f),
        size: st.size,
        clipId,
        project: projectId,
        promptText,
        tagsText,
        isPick: /_PICK\.png$/i.test(name) || /PICK/i.test(name),
        sizeHuman: humanSize(st.size),
        mtime: st.mtimeMs,
        mtimeIso: st.mtime.toISOString(),
        hasMeta: Boolean(sc),
        metaPath: sc,
        thumbUrl: `/api/gallery/file?path=${encodeURIComponent(f)}`,
        stackHints: stackHintsFromMeta(metaData),
        archived,
        _metaData: metaData,
      })
    }
  }

  // Facets from full archive-mode pool (ignore search filters — matches prior API)
  if (includeFacets) {
    const projects = {}
    const clips = {}
    for (const im of pool) {
      if (im.project) projects[im.project] = (projects[im.project] || 0) + 1
      if (im.clipId) clips[im.clipId] = (clips[im.clipId] || 0) + 1
    }
    listGalleryMedia._lastFacets = {
      projects: Object.entries(projects)
        .map(([id, n]) => ({ id, count: n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40),
      clips: Object.entries(clips)
        .map(([id, n]) => ({ id, count: n }))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 80),
    }
  } else {
    listGalleryMedia._lastFacets = null
  }

  const items = []
  for (const item of pool) {
    if (kind && String(item.kind) !== kind) continue
    if (project && String(item.project || '').toLowerCase() !== String(project).toLowerCase()) {
      continue
    }
    if (clip && String(item.clipId || '').toUpperCase() !== String(clip).toUpperCase()) {
      continue
    }
    if (q && !galleryMatchesQuery(item, q)) continue
    items.push(item)
  }

  items.sort((a, b) => b.mtime - a.mtime)
  const totalMatched = items.length
  const sliced = items.slice(Math.max(0, offset), Math.max(0, offset) + limit)
  // stash total for API (attached on return via wrapper)
  listGalleryMedia._lastTotal = totalMatched

  // Build bidirectional related graph from sidecars
  const byPath = new Map(sliced.map((i) => [path.resolve(i.path).toLowerCase(), i]))
  const byBase = new Map()
  for (const i of sliced) {
    const b = i.name.toLowerCase()
    if (!byBase.has(b)) byBase.set(b, [])
    byBase.get(b).push(i)
  }

  const relatedMap = new Map() // pathLower -> Map(relatedPathLower -> {role, via})
  const addEdge = (fromItem, toAbs, role, via) => {
    if (!toAbs) return
    const fromKey = path.resolve(fromItem.path).toLowerCase()
    const toKey = path.resolve(toAbs).toLowerCase()
    if (fromKey === toKey) return
    if (!byPath.has(toKey)) return
    if (!relatedMap.has(fromKey)) relatedMap.set(fromKey, new Map())
    if (!relatedMap.has(toKey)) relatedMap.set(toKey, new Map())
    const inv =
      role === 'source' || role === 'parent' || role === 'derived_from'
        ? 'derived'
        : role === 'derived'
          ? 'source'
          : 'related'
    relatedMap.get(fromKey).set(toKey, { role, via })
    // reverse edge if not already set with stronger role
    if (!relatedMap.get(toKey).has(fromKey)) {
      relatedMap.get(toKey).set(fromKey, { role: inv, via })
    }
  }

  for (const item of sliced) {
    for (const { ref, role } of extractExplicitRelated(item._metaData)) {
      const abs = normalizeRelatedRef(ref, item.path, roots)
      addEdge(item, abs, role, 'meta')
    }
  }

  // Attach related summaries (strip private _metaData)
  return sliced.map((item) => {
    const key = path.resolve(item.path).toLowerCase()
    const edges = relatedMap.get(key)
    const related = []
    if (edges) {
      for (const [toKey, info] of edges) {
        const target = byPath.get(toKey)
        if (!target) continue
        related.push({
          id: target.id,
          path: target.path,
          name: target.name,
          kind: target.kind,
          role: info.role,
          via: info.via,
          thumbUrl: target.thumbUrl,
          hasMeta: target.hasMeta,
          mtimeIso: target.mtimeIso,
        })
      }
      related.sort((a, b) => (a.mtimeIso < b.mtimeIso ? 1 : -1))
    }
    const { _metaData, promptText, tagsText, ...publicItem } = item
    return {
      ...publicItem,
      relatedCount: related.length,
      related,
    }
  })
}

export function parseArchiveMode(query) {
  // ?archived=0|false|hide (default) · 1|true|only · all
  const raw = query?.archived
  if (raw == null || raw === '' || raw === '0' || raw === 'false' || raw === 'hide') return 'hide'
  if (raw === '1' || raw === 'true' || raw === 'only') return 'only'
  if (raw === 'all') return 'all'
  return 'hide'
}
export function probeImagePixelSize(filePath) {
  try {
    if (!isImageFile(filePath)) return null
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(65536)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      const data = buf.subarray(0, n)
      // PNG: 8-byte sig + IHDR chunk
      if (
        data.length >= 24 &&
        data[0] === 0x89 &&
        data[1] === 0x50 &&
        data[2] === 0x4e &&
        data[3] === 0x47
      ) {
        const width = data.readUInt32BE(16)
        const height = data.readUInt32BE(20)
        if (width > 0 && height > 0) return { width, height }
      }
      // JPEG: scan for SOF0/2 markers
      if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
        let i = 2
        while (i < data.length - 8) {
          if (data[i] !== 0xff) {
            i++
            continue
          }
          const marker = data[i + 1]
          if (marker === 0xd9 || marker === 0xda) break
          const len = data.readUInt16BE(i + 2)
          // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
          if (
            (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)
          ) {
            const height = data.readUInt16BE(i + 5)
            const width = data.readUInt16BE(i + 7)
            if (width > 0 && height > 0) return { width, height }
          }
          i += 2 + len
        }
      }
      // WebP VP8X / VP8L / VP8
      if (
        data.length > 30 &&
        data.toString('ascii', 0, 4) === 'RIFF' &&
        data.toString('ascii', 8, 12) === 'WEBP'
      ) {
        const fourcc = data.toString('ascii', 12, 16)
        if (fourcc === 'VP8X' && data.length >= 30) {
          const width = 1 + data[24] + (data[25] << 8) + (data[26] << 16)
          const height = 1 + data[27] + (data[28] << 8) + (data[29] << 16)
          return { width, height }
        }
      }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    /* ignore */
  }
  return null
}

export function pixelSizeFromMeta(metaData) {
  if (!metaData || typeof metaData !== 'object') return null
  if (typeof metaData.resolution === 'string') {
    const m = metaData.resolution.match(/(\d+)\s*[x×]\s*(\d+)/i)
    if (m) return { width: Number(m[1]), height: Number(m[2]) }
  }
  const size = metaData.size
  if (size && typeof size === 'object') {
    const w = size.width ?? size.w
    const h = size.height ?? size.h
    if (w != null && h != null) return { width: Number(w), height: Number(h) }
  }
  if (metaData.width != null && metaData.height != null) {
    return { width: Number(metaData.width), height: Number(metaData.height) }
  }
  return null
}
export function isWorkflowSnapshotFile(filePath) {
  const lower = filePath.toLowerCase().replace(/\\/g, '/')
  return (
    lower.endsWith('.workflow.json') ||
    lower.endsWith('.api.json') ||
    lower.includes('/user/default/workflows/qorlith/') || lower.includes('/user/default/workflows/qorlith/')
  )
}

export function allowedFileRoots(cfg) {
  const roots = [...(cfg.comfyOutputRoots || [])]
  const yamlRoot = getComfyRoot()
  const yamlOut = getComfyOutput()
  if (yamlRoot) roots.push(yamlRoot)
  if (yamlOut) roots.push(yamlOut)
  return roots
}
