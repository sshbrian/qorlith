/**
 * Produce pipelines — overnight stills/video status for the UI.
 * Pipelines come from monitor config / planner registry, never from hardcoded packs.
 * Read-only against status JSON + shotlist + filesystem. Does not touch Comfy.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { info as logInfo } from './log.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const REPO = path.resolve(ROOT, '..')
function dataDir() {
  return process.env.QORLITH_DATA || path.join(ROOT, 'data')
}
/** Approved studio packs. Tests may inject producePipelines on the cfg object. */
export function produceRegistryPath() {
  return process.env.QORLITH_PRODUCE_REGISTRY || path.join(dataDir(), 'produce_pipelines_studio.json')
}
/** Pipeline ids hidden from Produce after Archive (files kept; gallery archive separate). */
function archivedPipelinesPath() {
  return path.join(dataDir(), 'produce_archived.json')
}

function exists(p) {
  try {
    return Boolean(p && fs.existsSync(p))
  } catch {
    return false
  }
}

function readJson(p) {
  try {
    if (!exists(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function safeStat(p) {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

function listFiles(dir, { maxDepth = 3 } = {}) {
  const out = []
  if (!exists(dir)) return out
  function walk(d, depth) {
    if (depth > maxDepth) return
    let ents
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (e.isFile()) out.push(full)
    }
  }
  walk(dir, 0)
  return out
}

function mediaUrl(absPath) {
  if (!absPath) return null
  return `/api/gallery/file?path=${encodeURIComponent(absPath)}`
}

const MEDIA_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
])

function isMediaPath(filePath) {
  return MEDIA_EXT.has(path.extname(String(filePath || '')).toLowerCase())
}

/**
 * Collect still/video media under a Produce pipeline's stillRoot + videoRoot.
 */
export function collectPipelineMediaPaths(pipelineId, cfg = {}) {
  const id = String(pipelineId || '')
  const pipes = resolvePipelines(cfg)
  const p = pipes.find((x) => x.id === id)
  if (!p) return null

  const roots = []
  if (p.stillRoot) roots.push(p.stillRoot)
  if (p.videoRoot) roots.push(p.videoRoot)
  // parent project folder when stills/video are siblings
  if (p.stillRoot) {
    const parent = path.dirname(p.stillRoot)
    if (parent && !roots.includes(parent)) roots.push(parent)
  }

  const media = []
  const seen = new Set()
  for (const root of roots) {
    for (const f of listFiles(root, { maxDepth: 8 })) {
      if (!isMediaPath(f)) continue
      const key = path.resolve(f).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      media.push(path.resolve(f))
    }
  }
  return {
    pipelineId: p.id,
    name: p.name,
    stillRoot: p.stillRoot,
    videoRoot: p.videoRoot,
    statusPath: p.statusPath,
    logPath: p.logPath,
    roots,
    media,
  }
}

export function loadStudioProducePipelines() {
  try {
    const regPath = produceRegistryPath()
    if (!fs.existsSync(regPath)) return []
    const j = JSON.parse(fs.readFileSync(regPath, 'utf8'))
    return Array.isArray(j.pipelines) ? j.pipelines : []
  } catch {
    return []
  }
}

export function saveStudioProducePipelines(pipelines) {
  const regPath = produceRegistryPath()
  fs.mkdirSync(path.dirname(regPath), { recursive: true })
  fs.writeFileSync(
    regPath,
    JSON.stringify({ updatedAt: new Date().toISOString(), pipelines }, null, 2),
    'utf8',
  )
}

export function resolvePipelines(cfg = {}) {
  const fromCfg = Array.isArray(cfg.producePipelines) ? cfg.producePipelines : null
  const base = fromCfg && fromCfg.length ? fromCfg : []
  const studio = loadStudioProducePipelines()
  const byId = new Map()
  for (const p of base) byId.set(p.id, p)
  for (const p of studio) byId.set(p.id, p)
  return [...byId.values()].map((p) => ({
    ...p,
    statusPath: path.resolve(p.statusPath),
    logPath: p.logPath ? path.resolve(p.logPath) : null,
    shotlistPath: p.shotlistPath ? path.resolve(p.shotlistPath) : null,
    stillRoot: p.stillRoot ? path.resolve(p.stillRoot) : null,
    videoRoot: p.videoRoot ? path.resolve(p.videoRoot) : null,
  }))
}

export function loadArchivedPipelineIds() {
  try {
    if (!exists(archivedPipelinesPath())) return new Set()
    const j = JSON.parse(fs.readFileSync(archivedPipelinesPath(), 'utf8'))
    const ids = Array.isArray(j.ids) ? j.ids : Array.isArray(j) ? j : []
    return new Set(ids.map((x) => String(x)))
  } catch {
    return new Set()
  }
}

/** Persist archive so default pipelines disappear from Produce list. */
export function markPipelineArchivedInRegistry(pipelineId, meta = {}) {
  const id = String(pipelineId || '')
  if (!id) return loadArchivedPipelineIds()
  const ids = loadArchivedPipelineIds()
  logInfo('produce.archive', { projectId: id, ...meta })
  ids.add(id)
  const prev = readJson(archivedPipelinesPath()) || {}
  const entries = typeof prev.entries === 'object' && prev.entries ? { ...prev.entries } : {}
  entries[id] = {
    ...(entries[id] || {}),
    ...meta,
    id,
    archivedAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(archivedPipelinesPath()), { recursive: true })
  fs.writeFileSync(
    archivedPipelinesPath(),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        ids: [...ids].sort(),
        entries,
      },
      null,
      2,
    ),
    'utf8',
  )
  return ids
}

export function isPipelineHiddenFromProduce(pipelineId, status = null) {
  const id = String(pipelineId || '')
  if (!id) return false
  if (loadArchivedPipelineIds().has(id)) return true
  if (status?.archived) return true
  return false
}

/**
 * Count unique clip IDs with a successful video entry in status.done.
 * Keys may be multi-pass (`p1:C01`, `p2:C01`) — do not count each pass separately.
 * When `shotlistIds` is provided, only those clip IDs count toward okCount
 * (extras like G01 land in extraOkCount).
 */
export function summarizeDoneMap(doneMap, shotlistIds = null) {
  const okClips = new Set()
  const failClips = new Set()
  for (const [k, v] of Object.entries(doneMap || {})) {
    if (!v || typeof v !== 'object') continue
    const id = String(k.includes(':') ? k.split(':').pop() : k).toUpperCase()
    if (!id) continue
    if (v.ok && v.video) okClips.add(id)
    else if (v.ok === false && v.error) failClips.add(id)
  }
  const shot =
    Array.isArray(shotlistIds) && shotlistIds.length
      ? new Set(shotlistIds.map((x) => String(x).toUpperCase()))
      : null
  const okInShot = shot ? [...okClips].filter((id) => shot.has(id)) : [...okClips]
  const failInShot = shot ? [...failClips].filter((id) => shot.has(id) && !okClips.has(id)) : [...failClips]
  const extraOk = shot ? [...okClips].filter((id) => !shot.has(id)) : []
  return {
    okCount: okInShot.length,
    failCount: failInShot.length,
    uniqueOkClips: [...okClips].sort(),
    extraOkCount: extraOk.length,
    extraOkClips: extraOk.sort(),
    passEntries: Object.keys(doneMap || {}).length,
  }
}

/**
 * Whether a pack is currently generating (not merely recently touched by archive/UI).
 * Do not use log mtime alone — archive/UI appends would show false "Running".
 */
export function isPipelineActive({
  status,
  logStat: _logStat,
  okCount = 0,
  clipTotal = null,
  hasRunningClip = false,
} = {}) {
  if (status?.archived) return false
  // Full video completion
  if (clipTotal != null && clipTotal > 0 && okCount >= clipTotal) return false
  // Stills board pause — not running overnight
  if (status?.stillsPhaseComplete && status?.pausedForStoryReview) return false
  // Explicit finishedAt with no incomplete work signal
  if (status?.finishedAt && !hasRunningClip) {
    if (clipTotal == null || okCount >= clipTotal) return false
  }

  // Clip state from FS/status says stills or video in progress
  if (hasRunningClip) return true

  // Fresh heartbeat from runner (ignore boot / archive-only status bumps)
  const hb = status?.heartbeat
  if (hb?.ts && hb.phase && hb.phase !== 'boot') {
    const age = Date.now() - new Date(hb.ts).getTime()
    if (Number.isFinite(age) && age >= 0 && age < 25 * 60 * 1000) {
      // wait_history / stills / i2va = live
      if (!/^(done|idle|exit)$/i.test(String(hb.phase))) return true
    }
  }

  return false
}

export function listPipelines(cfg = {}, { includeArchived = false } = {}) {
  const hidden = loadArchivedPipelineIds()
  return resolvePipelines(cfg)
    .map((p) => {
      const st = readJson(p.statusPath)
      const done = st?.done || {}
      const shotlist = p.shotlistPath ? readJson(p.shotlistPath) : null
      const clipTotal = Array.isArray(shotlist?.clips) ? shotlist.clips.length : null
      const shotIds = Array.isArray(shotlist?.clips) ? shotlist.clips.map((c) => c.id) : null
      const summary = summarizeDoneMap(done, shotIds)
      const logSt = p.logPath ? safeStat(p.logPath) : null
      const archived = Boolean(st?.archived) || hidden.has(p.id)
      const active = isPipelineActive({
        status: st,
        logStat: logSt,
        okCount: summary.okCount,
        clipTotal,
        hasRunningClip: false,
      })
      return {
        id: p.id,
        name: p.name,
        song: p.song || null,
        okCount: summary.okCount,
        failCount: summary.failCount,
        extraOkCount: summary.extraOkCount,
        passEntries: summary.passEntries,
        clipTotal,
        active,
        archived,
        statusExists: exists(p.statusPath),
        logExists: exists(p.logPath),
        updatedAt: st?.updatedAt || (logSt ? new Date(logSt.mtimeMs).toISOString() : null),
        startedAt: st?.startedAt || null,
        config: st?.config || null,
      }
    })
    .filter((p) => includeArchived || !p.archived)
}

function findPick(stillDir, clipId) {
  if (!stillDir || !exists(stillDir)) return null
  const pick = path.join(stillDir, `${clipId}_PICK.png`)
  if (exists(pick)) return pick
  const cand = path.join(stillDir, `${clipId}_CANDIDATE.png`)
  if (exists(cand)) return cand
  // latest hires
  const files = listFiles(stillDir, { maxDepth: 1 })
    .filter((f) => /hires/i.test(f) && f.toLowerCase().endsWith('.png'))
    .map((f) => ({ f, m: safeStat(f)?.mtimeMs || 0 }))
    .sort((a, b) => b.m - a.m)
  return files[0]?.f || null
}

function findVideos(videoRoot, clipId) {
  if (!videoRoot || !exists(videoRoot)) return []
  return listFiles(videoRoot, { maxDepth: 2 })
    .filter((f) => f.toLowerCase().endsWith('.mp4') && f.toUpperCase().includes(clipId))
    .map((f) => ({ f, m: safeStat(f)?.mtimeMs || 0 }))
    .sort((a, b) => b.m - a.m)
    .map((x) => x.f)
}

function findStillCandidates(stillDir, clipId) {
  if (!stillDir || !exists(stillDir)) return []
  return listFiles(stillDir, { maxDepth: 1 })
    .filter(
      (f) =>
        f.toLowerCase().endsWith('.png') &&
        (f.includes('hires') || f.includes('PICK') || f.includes('CANDIDATE')),
    )
    .map((f) => ({ f, m: safeStat(f)?.mtimeMs || 0 }))
    .sort((a, b) => b.m - a.m)
    .slice(0, 12)
    .map((x) => x.f)
}

function stateForClip(clipId, doneMap, hasPick, hasVideo, hasStills) {
  // keys like p1:C01, p2:C04
  const entries = Object.entries(doneMap || {}).filter(([k]) => k.endsWith(`:${clipId}`))
  const best = entries.find(([, v]) => v?.ok && v?.video) || entries[0]?.[1]
  if (best?.ok && (best.video || hasVideo)) return 'done'
  if (best?.error || best?.ok === false) {
    if (best.awaiting_face_qa) return hasPick || hasStills ? 'face_qa' : 'stills'
    if (best.error) return 'fail'
  }
  if (hasVideo) return 'done'
  // Pick ready but no video yet = waiting for Phase C / I2VA — not "running"
  if (hasPick && !hasVideo) return 'pending'
  if (hasStills) return 'stills'
  if (best?.awaiting_face_qa) return 'face_qa'
  return 'pending'
}

function logTail(logPath, lines = 60) {
  if (!exists(logPath)) return []
  try {
    const text = fs.readFileSync(logPath, 'utf8')
    const arr = text.split(/\r?\n/)
    return arr.slice(-Math.max(10, lines)).filter((l) => l.length)
  } catch {
    return []
  }
}

/** Infer current clip from log tail */
const CLIP_ID_RE = String.raw`(?:C|Y|G|S|H)\d{2}`

function currentFromLog(lines) {
  // clip ids like C01
  const head = new RegExp(String.raw`===\s*(?:p\d:)?(${CLIP_ID_RE})\b`, 'i')
  const i2va = new RegExp(String.raw`I2VA\s+(${CLIP_ID_RE})\b`, 'i')
  const hero = new RegExp(String.raw`hero\s+\[(\d+)\/(\d+)\].*\b(${CLIP_ID_RE})`, 'i')
  const skip = new RegExp(String.raw`SKIP done p\d:(${CLIP_ID_RE})`, 'i')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    let m = l.match(head)
    if (m) return m[1].toUpperCase()
    m = l.match(i2va)
    if (m) return m[1].toUpperCase()
    m = l.match(hero)
    if (m) return null
    m = l.match(skip)
    if (m) continue
  }
  // second pass for hero under clip header
  let lastClip = null
  for (const l of lines) {
    const m = l.match(head)
    if (m) lastClip = m[1].toUpperCase()
  }
  return lastClip
}

export function getPipelineDetail(pipelineId, cfg = {}, { includeArchived = false } = {}) {
  const pipes = resolvePipelines(cfg)
  const p = pipes.find((x) => x.id === pipelineId)
  if (!p) return null

  const status = readJson(p.statusPath) || {}
  if (!includeArchived && isPipelineHiddenFromProduce(pipelineId, status)) {
    return null
  }
  const shotlist = p.shotlistPath ? readJson(p.shotlistPath) : null
  const clipsSpec = Array.isArray(shotlist?.clips) ? shotlist.clips : []
  const doneMap = status.done || {}
  const lines = logTail(p.logPath, 80)
  const currentClip = currentFromLog(lines)

  // If no shotlist, invent clips from done keys + filesystem
  let clipIds = clipsSpec.map((c) => c.id)
  if (!clipIds.length) {
    const fromDone = Object.keys(doneMap)
      .map((k) => k.split(':').pop())
      .filter(Boolean)
    clipIds = [...new Set(fromDone)]
  }

  const clips = clipIds.map((id) => {
    const spec = clipsSpec.find((c) => c.id === id) || { id }
    const stillDir = p.stillRoot ? path.join(p.stillRoot, id) : null
    const pickPath = findPick(stillDir, id)
    const candidates = findStillCandidates(stillDir, id)
    const videos = findVideos(p.videoRoot, id)
    const videoPath = videos[0] || null
    // status entries
    const p1 = doneMap[`p1:${id}`]
    const anyOk = Object.entries(doneMap).find(
      ([k, v]) => k.endsWith(`:${id}`) && v?.ok && v?.video,
    )
    const doneEntry = anyOk?.[1] || p1
    const hasStills = candidates.length > 0 || Boolean(pickPath)
    const state = stateForClip(
      id,
      doneMap,
      Boolean(pickPath),
      Boolean(videoPath || doneEntry?.video),
      hasStills,
    )
    // refine: if log says this clip and I2VA waiting → video
    let finalState = state
    if (currentClip === id) {
      const last = lines[lines.length - 1] || ''
      if (/I2VA|waiting/i.test(last) || /video_only|queued/i.test(lines.slice(-5).join('\n'))) {
        if (state !== 'done') finalState = 'video'
      } else if (/HERO stills|hero \[/i.test(lines.slice(-8).join('\n'))) {
        if (state !== 'done' && state !== 'video') finalState = 'stills'
      }
    }

    const err =
      doneEntry && doneEntry.ok === false && doneEntry.error ? String(doneEntry.error) : null

    return {
      id,
      title: spec.title || null,
      section: spec.section || null,
      mood: spec.mood || null,
      sexy: Boolean(spec.sexy),
      gun_risk: Boolean(spec.gun_risk),
      t_start: spec.t_start ?? null,
      t_end: spec.t_end ?? null,
      durationSec: spec.durationSec ?? null,
      state: finalState,
      stillPickPath: pickPath,
      stillPickUrl: mediaUrl(pickPath),
      stillCandidates: candidates.slice(0, 8).map((f) => ({
        path: f,
        name: path.basename(f),
        url: mediaUrl(f),
      })),
      videoPath: doneEntry?.video && exists(doneEntry.video) ? doneEntry.video : videoPath,
      videoUrl: mediaUrl(
        doneEntry?.video && exists(doneEntry.video) ? doneEntry.video : videoPath,
      ),
      error: err,
      faceApproved: Boolean(doneEntry?.face_approved),
      awaitingFaceQa: Boolean(doneEntry?.awaiting_face_qa),
      updatedAt: doneEntry?.at || null,
      passKeys: Object.keys(doneMap).filter((k) => k.endsWith(`:${id}`)),
    }
  })

  const doneN = clips.filter((c) => c.state === 'done').length
  const failN = clips.filter((c) => c.state === 'fail').length
  const total = clips.length
  const percent = total > 0 ? Math.round((doneN / total) * 1000) / 10 : 0
  const activeStates = new Set(['stills', 'video', 'face_qa'])
  const packComplete = total > 0 && doneN >= total
  // Only treat log "current clip" as running if that clip is not already done
  let runningClip =
    clips.find((c) => c.id === currentClip && activeStates.has(c.state)) ||
    clips.find((c) => activeStates.has(c.state)) ||
    null
  if (packComplete) runningClip = null

  const logSt = p.logPath ? safeStat(p.logPath) : null
  const summaryOk = clips.filter((c) => c.state === 'done').length
  const active = isPipelineActive({
    status,
    logStat: logSt,
    okCount: summaryOk,
    clipTotal: total || null,
    hasRunningClip: Boolean(runningClip && activeStates.has(runningClip.state)),
  })

  return {
    id: p.id,
    name: p.name,
    song: p.song || shotlist?.song || null,
    durationTargetSec: shotlist?.durationTargetSec || null,
    config: status.config || null,
    startedAt: status.startedAt || null,
    updatedAt: status.updatedAt || null,
    finishedAt: status.finishedAt || null,
    archived: Boolean(status.archived),
    active,
    percent,
    done: doneN,
    failed: failN,
    total,
    currentClip: runningClip?.id || null,
    currentTitle: runningClip?.title || null,
    currentState: runningClip?.state || null,
    extraOkCount: summarizeDoneMap(
      doneMap,
      clipsSpec.length ? clipsSpec.map((c) => c.id) : null,
    ).extraOkCount,
    clips,
    logTail: lines.slice(-40),
    paths: {
      statusPath: p.statusPath,
      logPath: p.logPath,
      shotlistPath: p.shotlistPath,
      stillRoot: p.stillRoot,
      videoRoot: p.videoRoot,
    },
  }
}

/**
 * Build a live floor overlay from produce pipeline detail (in-memory, no persist).
 */
export function floorOverlayFromProduce(detail, baseFloor) {
  if (!detail || !detail.total) return baseFloor
  const phase = detail.active
    ? detail.currentState === 'video'
      ? 'i2va'
      : detail.currentState === 'stills'
        ? 'stills'
        : 'rendering'
    : detail.done >= detail.total && detail.total > 0
      ? 'master_ready'
      : detail.done > 0
        ? 'paused'
        : 'idle'

  const statusLine =
    phase === 'master_ready'
      ? `${detail.name}: ${detail.done}/${detail.total} clips done`
      : detail.active
        ? `${detail.name} · ${detail.currentClip || '?'} ${detail.currentState || ''} · ${detail.done}/${detail.total}`
        : detail.done > 0
          ? `${detail.name} · ${detail.done}/${detail.total} done (idle)`
          : baseFloor.statusLine

  const mood =
    phase === 'master_ready'
      ? 'complete'
      : detail.active
        ? detail.currentState === 'video'
          ? 'rendering video'
          : 'rendering stills'
        : baseFloor.mood

  const friends = [
    { name: detail.name, blurb: `${detail.done}/${detail.total}` },
    { name: 'ComfyUI', blurb: detail.active ? 'busy GPU' : 'standby' },
    { name: 'Gallery', blurb: 'media' },
    { name: 'Board', blurb: 'review' },
  ]

  return {
    ...baseFloor,
    mood: detail.total > 0 ? mood : baseFloor.mood,
    statusLine: detail.total > 0 ? statusLine : baseFloor.statusLine,
    song: detail.song || baseFloor.song,
    friends,
    progress: {
      ...baseFloor.progress,
      project: detail.id,
      runId: detail.id,
      phase,
      done: detail.done,
      total: detail.total,
      failed: detail.failed,
      percent: detail.percent,
      currentShot: detail.currentClip,
      detail: detail.currentTitle
        ? `${detail.currentClip} · ${detail.currentTitle} · ${detail.currentState}`
        : detail.currentClip,
      masterPath: null,
      workDir: detail.paths?.videoRoot || null,
    },
  }
}
