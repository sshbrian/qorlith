/**
 * Gallery list, archive, file serve.
 */
import path from 'path'
import fs from 'fs'
import { loadConfig } from '../appConfig.mjs'
import { ARCHIVE_PATH } from '../appConfig.mjs'
import {
  addArchivedPaths,
  allowedFileRoots,
  allowedUnderRoots,
  findSidecar,
  isArchivedPath,
  isMediaFile,
  isWorkflowSnapshotFile,
  listGalleryMedia,
  loadArchiveStore,
  mediaKind,
  parseArchiveMode,
  parseSidecarFile,
  pixelSizeFromMeta,
  probeImagePixelSize,
  removeArchivedPaths,
} from '../gallery.mjs'
import { fail, wrap } from '../errors.mjs'
import { humanSize, safeStat, walkFiles } from '../fsutil.mjs'

export function mountGallery(app) {
app.get('/api/gallery/roots', (_req, res) => {
  const cfg = loadConfig()
  const roots = (cfg.comfyOutputRoots || []).map((dir) => {
    const st = safeStat(dir)
    let count = 0
    if (st) {
      try {
        count = walkFiles(dir, { maxDepth: 6 }).filter(isMediaFile).length
      } catch {
        count = 0
      }
    }
    return { dir, exists: Boolean(st), sampleCount: count }
  })
  res.json({ roots, note: 'Recursive scan under comfyOutputRoots (images, video + sidecars)' })
})

app.get('/api/gallery', (req, res) => {
  const cfg = loadConfig()
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 400))
  const offset = Math.max(0, Number(req.query.offset) || 0)
  const archiveMode = parseArchiveMode(req.query)
  const q = typeof req.query.q === 'string' ? req.query.q : ''
  const kind = typeof req.query.kind === 'string' ? req.query.kind : ''
  const project = typeof req.query.project === 'string' ? req.query.project : ''
  const clip = typeof req.query.clip === 'string' ? req.query.clip : ''
  // Single walk: images (filtered) + facets (archive-pool) together
  const images = listGalleryMedia(cfg, {
    limit,
    offset,
    archiveMode,
    q,
    kind,
    project,
    clip,
    includeFacets: true,
  })
  const store = loadArchiveStore()
  const facets = listGalleryMedia._lastFacets || { projects: [], clips: [] }
  res.json({
    images,
    count: images.length,
    totalMatched: listGalleryMedia._lastTotal ?? images.length,
    offset,
    limit,
    archivedTotal: store.paths.length,
    archiveMode,
    facets,
    query: { q, kind, project, clip },
    polledAt: new Date().toISOString(),
  })
})


app.get('/api/gallery/archive', (_req, res) => {
  const store = loadArchiveStore()
  res.json({
    paths: store.paths,
    count: store.paths.length,
    updatedAt: store.updatedAt,
    storePath: ARCHIVE_PATH,
  })
})

app.post(
  '/api/gallery/archive',
  wrap(async (req, res) => {
    const cfg = loadConfig()
    const body = req.body || {}
    const paths = Array.isArray(body.paths) ? body.paths : body.path ? [body.path] : []
    if (!paths.length) {
      fail(400, 'missing_paths', 'paths[] or path required', {
        hint: 'Select media in Gallery, then archive.',
      })
    }
    const result = addArchivedPaths(paths, { roots: cfg.comfyOutputRoots || [] })
    res.json({
      ok: true,
      added: result.added,
      addedCount: result.added.length,
      archivedTotal: result.store.count,
      updatedAt: result.store.updatedAt,
    })
  }),
)

app.post(
  '/api/gallery/unarchive',
  wrap(async (req, res) => {
    const body = req.body || {}
    const paths = Array.isArray(body.paths) ? body.paths : body.path ? [body.path] : []
    if (!paths.length) {
      fail(400, 'missing_paths', 'paths[] or path required', {
        hint: 'Select archived media, then restore.',
      })
    }
    const result = removeArchivedPaths(paths)
    res.json({
      ok: true,
      removedCount: result.removed,
      archivedTotal: result.store.count,
      updatedAt: result.store.updatedAt,
    })
  }),
)

/** Read PNG IHDR or JPEG SOF dimensions (no deps). Returns null if unknown. */

app.get('/api/gallery/item', wrap(async (req, res) => {
  const file = req.query.path
  if (!file || typeof file !== 'string') {
    fail(400, 'missing_path', 'path query required', {
      hint: 'Pass ?path= to a file under comfy.output.',
    })
  }
  const cfg = loadConfig()
  const resolved = path.resolve(file)
  if (!allowedUnderRoots(resolved, cfg.comfyOutputRoots)) {
    fail(403, 'path_forbidden', 'path not allowed', {
      hint: 'Files must live under comfy.output in qorlith.yaml.',
    })
  }
  const st = safeStat(resolved)
  if (!st || !st.isFile() || !isMediaFile(resolved)) {
    fail(404, 'media_not_found', 'media not found', {
      hint: 'The file is gone or is not an image/video.',
    })
  }
  const sc = findSidecar(resolved)
  const meta = parseSidecarFile(sc)
  // Recompute related against full gallery index (capped; include archived for graph)
  const all = listGalleryMedia(cfg, { limit: 500, archiveMode: 'all' })
  const self = all.find((i) => path.resolve(i.path).toLowerCase() === resolved.toLowerCase())
  const pixelSize = pixelSizeFromMeta(meta?.data) || probeImagePixelSize(resolved)
  // Ensure nested size in meta for UI consumers that only look at meta
  let metaOut = meta?.data || null
  if (metaOut && pixelSize && !(metaOut.size && metaOut.size.width)) {
    metaOut = { ...metaOut, size: { width: pixelSize.width, height: pixelSize.height } }
  }
  const archived = isArchivedPath(resolved)
  res.json({
    path: resolved,
    name: path.basename(resolved),
    kind: mediaKind(resolved),
    size: st.size,
    sizeHuman: humanSize(st.size),
    mtimeIso: st.mtime.toISOString(),
    thumbUrl: `/api/gallery/file?path=${encodeURIComponent(resolved)}`,
    hasMeta: Boolean(meta),
    meta: metaOut,
    metaFormat: meta?.format || null,
    metaPath: meta?.path || null,
    metaRaw: meta?.raw || null,
    related: self?.related || [],
    relatedCount: self?.relatedCount || 0,
    pixelSize,
    archived,
  })
}))

app.get('/api/gallery/file', wrap(async (req, res) => {
  const file = req.query.path
  if (!file || typeof file !== 'string') {
    fail(400, 'missing_path', 'path query required', {
      hint: 'Pass ?path= to a file under comfy.output.',
    })
  }
  const cfg = loadConfig()
  const resolved = path.resolve(file)
  const roots = allowedFileRoots(cfg)
  if (!allowedUnderRoots(resolved, roots)) {
    fail(403, 'path_forbidden', 'path not allowed', {
      hint: 'Files must live under comfy.output in qorlith.yaml.',
    })
  }
  const st = safeStat(resolved)
  const allow =
    st &&
    st.isFile() &&
    (isMediaFile(resolved) || isWorkflowSnapshotFile(resolved) || path.extname(resolved).toLowerCase() === '.json')
  // Only allow free .json if it sits next to media under output roots or is a workflow snapshot
  if (!allow) {
    fail(404, 'not_found', 'not found', {
      hint: 'Only media and workflow JSON under comfy.output can be served.',
    })
  }
  if (
    path.extname(resolved).toLowerCase() === '.json' &&
    !isWorkflowSnapshotFile(resolved) &&
    !isMediaFile(resolved)
  ) {
    if (!allowedUnderRoots(resolved, cfg.comfyOutputRoots || [])) {
      fail(403, 'path_forbidden', 'path not allowed', {
        hint: 'Sidecar JSON must sit next to media under comfy.output.',
      })
    }
  }
  const ext = path.extname(resolved).toLowerCase()
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.json': 'application/json',
  }
  // double-ext .workflow.json → .json
  const contentType =
    types[ext] ||
    (resolved.toLowerCase().endsWith('.json') ? 'application/json' : 'application/octet-stream')
  res.setHeader('Content-Type', contentType)
  if (contentType === 'application/json') {
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${path.basename(resolved).replace(/"/g, '')}"`,
    )
  }
  res.setHeader('Cache-Control', 'private, max-age=60')
  fs.createReadStream(resolved).pipe(res)
}))

}
