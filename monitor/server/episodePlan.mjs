/**
 * Episode plan review — markdown + board stills + human comments.
 * Files live under data/projects/<id>/ (legacy: data/episode-plans/<id>/).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { fail } from './errors.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const REPO = path.resolve(ROOT, '..')
const LEGACY_ROOT = path.join(ROOT, 'data', 'episode-plans')

function dataRoot() {
  return (
    process.env.QORLITH_EPISODE_DATA ||
    process.env.QORLITH_PROJECTS ||
    path.join(ROOT, 'data', 'projects')
  )
}

function readManifestDir(dir, name, out) {
  const man = path.join(dir, 'manifest.json')
  if (!fs.existsSync(man)) return
  try {
    const raw = JSON.parse(fs.readFileSync(man, 'utf8'))
    const id = String(raw.id || name)
    if (out[id]) return
    out[id] = {
      id,
      title: String(raw.title || id),
      markdownPath: raw.markdownPath
        ? path.resolve(dir, raw.markdownPath)
        : path.join(dir, 'plan.md'),
      boardDir: raw.boardDir ? path.resolve(raw.boardDir) : path.join(dir, 'board'),
      scenes: Array.isArray(raw.scenes) ? raw.scenes : [],
    }
  } catch {
    /* skip bad manifest */
  }
}

function scanRoot(root, out) {
  if (!fs.existsSync(root)) return
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    readManifestDir(dir, name, out)
  }
}

function loadRegistry() {
  const out = {}
  const root = dataRoot()
  scanRoot(root, out)
  if (LEGACY_ROOT !== root) scanRoot(LEGACY_ROOT, out)
  return out
}

function copyMissing(src, dest) {
  if (!fs.existsSync(src)) return
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const name of fs.readdirSync(src)) {
      copyMissing(path.join(src, name), path.join(dest, name))
    }
    return
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function planDir(id) {
  const dest = path.join(dataRoot(), id)
  const legacy = path.join(LEGACY_ROOT, id)
  if (
    LEGACY_ROOT !== dataRoot() &&
    !process.env.QORLITH_EPISODE_DATA &&
    !process.env.QORLITH_PROJECTS &&
    !fs.existsSync(path.join(dest, 'manifest.json')) &&
    fs.existsSync(path.join(legacy, 'manifest.json'))
  ) {
    copyMissing(legacy, dest)
  }
  return dest
}

function commentsPath(id) {
  return path.join(planDir(id), 'comments.json')
}

function picksPath(id) {
  return path.join(planDir(id), 'picks.json')
}

export function listEpisodePlans() {
  return Object.values(loadRegistry()).map((p) => ({
    id: p.id,
    title: p.title,
    markdownPath: p.markdownPath,
    boardDir: p.boardDir,
    sceneCount: p.scenes.length,
  }))
}

export function getRegistry(id) {
  const rec = loadRegistry()[id]
  if (!rec) {
    fail(404, 'unknown_plan', `unknown episode plan: ${id}`, {
      hint: 'Pick this project from the left rail, or generate a plan first.',
    })
  }
  return rec
}

/**
 * Create or update an episode board for a studio project.
 * Does not delete existing stills.
 */
export function ensureEpisodePlan(id, { title, markdown, scenes } = {}) {
  const slug = String(id || '').trim()
  if (!slug) {
    fail(400, 'missing_id', 'episode plan id required', {
      hint: 'Open a project from the left rail.',
    })
  }
  const dir = planDir(slug)
  fs.mkdirSync(dir, { recursive: true })
  const man = path.join(dir, 'manifest.json')
  let existing = {}
  if (fs.existsSync(man)) {
    try {
      existing = JSON.parse(fs.readFileSync(man, 'utf8')) || {}
    } catch {
      existing = {}
    }
  }
  const nextScenes =
    Array.isArray(scenes) && scenes.length
      ? scenes.map((s, i) => {
          const sid = String(s.id || `S${String(i + 1).padStart(2, '0')}`)
          return {
            id: sid,
            title: String(s.title || sid),
            heading: String(s.heading || `### ${sid} — ${s.title || sid}`),
          }
        })
      : Array.isArray(existing.scenes)
        ? existing.scenes
        : []
  const rec = {
    id: slug,
    title: String(title || existing.title || slug),
    markdownPath: existing.markdownPath || 'plan.md',
    boardDir: existing.boardDir || path.join(dir, 'board'),
    scenes: nextScenes,
  }
  const mdPath = path.join(dir, 'plan.md')
  if (typeof markdown === 'string' && markdown.trim()) {
    fs.writeFileSync(mdPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8')
  } else if (!fs.existsSync(mdPath)) {
    fs.writeFileSync(mdPath, `# ${rec.title}\n\n`, 'utf8')
  }
  const boardRoot = rec.boardDir
  fs.mkdirSync(boardRoot, { recursive: true })
  for (const s of rec.scenes) {
    fs.mkdirSync(path.join(boardRoot, s.id), { recursive: true })
  }
  fs.writeFileSync(man, JSON.stringify(rec, null, 2) + '\n', 'utf8')
  return rec
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export function loadComments(id) {
  const raw = loadJson(commentsPath(id), { comments: [] })
  return Array.isArray(raw.comments) ? raw.comments : []
}

export function addComment(id, body) {
  const text = String(body.body || '').trim()
  if (!text) {
    fail(400, 'empty_comment', 'comment body required', {
      hint: 'Type a note, then post.',
    })
  }
  const comments = loadComments(id)
  const rec = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    author: String(body.author || 'human').slice(0, 32),
    anchor: String(body.anchor || 'general').slice(0, 64),
    imageRel: body.imageRel ? String(body.imageRel).slice(0, 240) : null,
    body: text.slice(0, 8000),
  }
  comments.push(rec)
  saveJson(commentsPath(id), { comments, updatedAt: rec.createdAt })
  return rec
}

export function deleteComment(id, commentId) {
  const comments = loadComments(id)
  const next = comments.filter((c) => c.id !== commentId)
  if (next.length === comments.length) {
    fail(404, 'comment_not_found', 'comment not found', {
      hint: 'Refresh the board — that comment may already be gone.',
    })
  }
  saveJson(commentsPath(id), { comments: next, updatedAt: new Date().toISOString() })
  return { ok: true, id: commentId }
}

export function loadPicks(id) {
  const raw = loadJson(picksPath(id), { picks: {} })
  return raw.picks && typeof raw.picks === 'object' ? raw.picks : {}
}

export function setPick(id, sceneId, imageRel) {
  const picks = loadPicks(id)
  picks[sceneId] = imageRel
  saveJson(picksPath(id), { picks, updatedAt: new Date().toISOString() })
  return picks
}

const STILL_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export function isPickCopyName(name) {
  return /_PICK\.[^.]+$/i.test(String(name || ''))
}

export function stillSortKey(name) {
  const m = String(name || '').match(/_v(\d+)\./i)
  if (m) return [1, Number(m[1]), name]
  return [2, 0, name]
}

export function listSceneStills(reg, sceneId) {
  const dir = path.join(reg.boardDir, sceneId)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => STILL_EXT.has(path.extname(n).toLowerCase()))
    .filter((n) => !isPickCopyName(n))
    .sort((a, b) => {
      const [ta, na, sa] = stillSortKey(a)
      const [tb, nb, sb] = stillSortKey(b)
      if (ta !== tb) return ta - tb
      if (na !== nb) return na - nb
      return String(sa).localeCompare(String(sb))
    })
    .map((name) => {
      const abs = path.join(dir, name)
      const rel = `${sceneId}/${name}`
      const st = fs.statSync(abs)
      return {
        name,
        rel,
        abs,
        bytes: st.size,
        mtime: st.mtime.toISOString(),
        url: `/api/episode-plans/${encodeURIComponent(reg.id)}/file?rel=${encodeURIComponent(rel)}`,
      }
    })
}

export function resolveBoardFile(reg, rel) {
  const clean = String(rel || '').replace(/\\/g, '/')
  if (!clean || clean.includes('..') || path.isAbsolute(clean)) {
    fail(400, 'invalid_rel', 'invalid rel', {
      hint: 'Board files are scene/name.png — paths may not contain ..',
    })
  }
  const abs = path.resolve(reg.boardDir, clean)
  const root = path.resolve(reg.boardDir)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    fail(403, 'path_forbidden', 'path not allowed', {
      hint: 'Stills must live under this project board folder.',
    })
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    fail(404, 'not_found', 'not found', {
      hint: 'That still is not on the board.',
    })
  }
  if (!STILL_EXT.has(path.extname(abs).toLowerCase())) {
    fail(400, 'not_an_image', 'not an image', {
      hint: 'Board files must be png, jpg, or webp.',
    })
  }
  return abs
}

export function loadEpisodePlan(id) {
  const reg = getRegistry(id)
  let markdown = ''
  if (fs.existsSync(reg.markdownPath)) {
    markdown = fs.readFileSync(reg.markdownPath, 'utf8')
  }
  const picks = loadPicks(id)
  const comments = loadComments(id)
  const scenes = reg.scenes.map((s) => {
    const stills = listSceneStills(reg, s.id)
    const pickRel = picks[s.id] || null
    const pick = stills.find((x) => x.rel === pickRel) || null
    return {
      ...s,
      stills,
      pickRel,
      pick,
      comments: comments.filter((c) => c.anchor === s.id || (c.imageRel && String(c.imageRel).startsWith(s.id + '/'))),
    }
  })
  return {
    ok: true,
    id: reg.id,
    title: reg.title,
    markdownPath: reg.markdownPath,
    boardDir: reg.boardDir,
    markdown,
    scenes,
    comments,
    picks,
    styleNote: '',
  }
}
