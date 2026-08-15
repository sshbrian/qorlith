/**
 * One folder per studio project.
 *
 *   data/projects/<id>/
 *     plan.json
 *     manifest.json
 *     comments.json
 *     picks.json
 *     plan.md
 *     board/<scene>/
 *
 * Legacy studio_plans/*.json and episode-plans/<id>/ are copied here on first list/load.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { slugifyProjectId } from './ids.mjs'
import { ensureEpisodePlan, listEpisodePlans } from './episodePlan.mjs'
import { info as logInfo } from './log.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LEGACY_PLANS = process.env.QORLITH_LEGACY_PLANS || path.join(ROOT, 'data', 'studio_plans')
const LEGACY_BOARDS = process.env.QORLITH_LEGACY_BOARDS || path.join(ROOT, 'data', 'episode-plans')

export const STAGES = ['plan', 'make', 'board', 'watch']

export function projectsRoot() {
  return (
    process.env.QORLITH_PROJECTS ||
    process.env.QORLITH_EPISODE_DATA ||
    path.join(ROOT, 'data', 'projects')
  )
}

export function projectDir(id) {
  return path.join(projectsRoot(), slugifyProjectId(id))
}

export function planRecordPath(id) {
  return path.join(projectDir(id), 'plan.json')
}

function shouldMigrateLegacy() {
  if (process.env.QORLITH_MIGRATE === '1') return true
  return !process.env.QORLITH_PROJECTS && !process.env.QORLITH_EPISODE_DATA
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

export function migrateProject(id) {
  const slug = slugifyProjectId(id)
  const dest = projectDir(slug)
  const oldPlan = path.join(LEGACY_PLANS, `${slug}.json`)
  const oldBoard = path.join(LEGACY_BOARDS, slug)
  const hadLegacy = fs.existsSync(oldPlan) || fs.existsSync(oldBoard)
  if (!hadLegacy) return dest

  fs.mkdirSync(dest, { recursive: true })
  const newPlan = planRecordPath(slug)
  if (!fs.existsSync(newPlan) && fs.existsSync(oldPlan)) {
    fs.copyFileSync(oldPlan, newPlan)
  }
  if (fs.existsSync(oldBoard) && fs.statSync(oldBoard).isDirectory()) {
    copyMissing(oldBoard, dest)
  }
  return dest
}

export function migrateAllProjects() {
  if (!shouldMigrateLegacy()) return
  const seen = new Set()
  if (fs.existsSync(LEGACY_PLANS)) {
    for (const f of fs.readdirSync(LEGACY_PLANS)) {
      if (!f.endsWith('.json')) continue
      const id = f.replace(/\.json$/i, '')
      migrateProject(id)
      seen.add(id)
    }
  }
  if (fs.existsSync(LEGACY_BOARDS)) {
    for (const name of fs.readdirSync(LEGACY_BOARDS)) {
      const p = path.join(LEGACY_BOARDS, name)
      if (!fs.statSync(p).isDirectory()) continue
      migrateProject(name)
      seen.add(name)
    }
  }
  if (seen.size) logInfo('project.migrate', { count: seen.size })
}

export function saveProjectRecord(record) {
  const id = slugifyProjectId(record.projectId)
  record.projectId = id
  const dest = projectDir(id)
  fs.mkdirSync(dest, { recursive: true })
  const p = planRecordPath(id)
  fs.writeFileSync(p, JSON.stringify(record, null, 2), 'utf8')
  return p
}

export function loadProjectRecord(projectId) {
  const id = slugifyProjectId(projectId)
  if (shouldMigrateLegacy()) migrateProject(id)
  const p = planRecordPath(id)
  if (!fs.existsSync(p)) {
    const legacy = path.join(LEGACY_PLANS, `${id}.json`)
    if (fs.existsSync(legacy)) {
      migrateProject(id)
    }
  }
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

export function listProjectRecords() {
  migrateAllProjects()
  const root = projectsRoot()
  const out = []
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const rec = loadProjectRecord(name)
      if (!rec?.projectId) continue
      out.push(summarizeRecord(rec))
    }
  }
  if (shouldMigrateLegacy() && fs.existsSync(LEGACY_PLANS)) {
    for (const f of fs.readdirSync(LEGACY_PLANS)) {
      if (!f.endsWith('.json')) continue
      const id = f.replace(/\.json$/i, '')
      if (out.some((r) => r.projectId === id)) continue
      const rec = loadProjectRecord(id)
      if (rec) out.push(summarizeRecord(rec))
    }
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return out
}

function summarizeRecord(rec) {
  return {
    projectId: rec.projectId,
    title: rec.plan?.title || rec.projectId,
    status: rec.status || 'draft',
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    clipCount: rec.plan?.clips?.length || 0,
    durationTargetSec: rec.plan?.durationTargetSec,
    rating: rec.plan?.rating,
    lookTrack: rec.plan?.lookTrack,
    approved: Boolean(rec.approved),
    produceRegistered: Boolean(rec.produceRegistered),
    archived: Boolean(rec.archived),
    archivedAt: rec.archivedAt || null,
  }
}

export function suggestedStage(project) {
  if (!project) return 'plan'
  if (project.id) {
    const brainFile = path.join(projectDir(project.id), 'brain.json')
    if (fs.existsSync(brainFile)) {
      try {
        const brain = JSON.parse(fs.readFileSync(brainFile, 'utf8'))
        const st = String(brain.status || '')
        if (st === 'face_qa') return 'board'
        if (st === 'done') return 'watch'
        if (st && st !== 'idle') return 'make'
      } catch {
        /* ignore broken report */
      }
    }
  }
  if (project.hasPlan && (project.clipCount || 0) > 0) return 'make'
  if (project.hasBoard && (project.sceneCount || 0) > 0) return 'board'
  return 'plan'
}

export function mergeStudioProjects({ plans = [], boards = [], produce = [], brains = [] } = {}) {
  const byId = new Map()

  const touch = (id) => {
    const key = String(id || '').trim()
    if (!key) return null
    if (!byId.has(key)) {
      byId.set(key, {
        id: key,
        title: key,
        status: 'draft',
        clipCount: 0,
        sceneCount: 0,
        okCount: 0,
        clipTotal: null,
        active: false,
        approved: false,
        produceRegistered: false,
        archived: false,
        hasPlan: false,
        hasBoard: false,
        hasProduce: false,
        updatedAt: null,
        lookTrack: null,
      })
    }
    return byId.get(key)
  }

  for (const p of plans) {
    if (p?.archived) continue
    const rec = touch(p.projectId || p.id)
    if (!rec) continue
    rec.hasPlan = true
    rec.title = p.title || rec.title
    rec.status = p.status || rec.status
    rec.clipCount = Number(p.clipCount) || 0
    rec.approved = Boolean(p.approved)
    rec.produceRegistered = Boolean(p.produceRegistered)
    rec.hasProduce = rec.hasProduce || rec.produceRegistered
    rec.lookTrack = p.lookTrack || rec.lookTrack
    rec.updatedAt = p.updatedAt || rec.updatedAt
  }

  for (const b of boards) {
    const rec = touch(b.id)
    if (!rec) continue
    rec.hasBoard = true
    rec.title = rec.title === rec.id && b.title ? b.title : rec.title || b.title
    rec.sceneCount = Number(b.sceneCount) || rec.sceneCount
  }

  for (const pipe of produce) {
    if (pipe?.archived) continue
    const rec = touch(pipe.id)
    if (!rec) continue
    rec.hasProduce = true
    rec.title = rec.title === rec.id ? pipe.name || rec.title : rec.title
    rec.okCount = Number(pipe.okCount) || 0
    rec.clipTotal = pipe.clipTotal == null ? rec.clipTotal : pipe.clipTotal
    rec.active = Boolean(pipe.active)
    rec.updatedAt = pipe.updatedAt || rec.updatedAt
    if (!rec.status || rec.status === 'draft') rec.status = pipe.active ? 'producing' : 'approved'
  }

  for (const brain of brains) {
    const rec = touch(brain.projectId || brain.id)
    if (!rec) continue
    if (brain.running) rec.active = true
    const videos = (brain.clips || []).filter((c) => c.video).length
    if (videos > rec.okCount) rec.okCount = videos
    if (brain.title && rec.title === rec.id) rec.title = brain.title
    if (brain.updatedAt && (!rec.updatedAt || String(brain.updatedAt) > String(rec.updatedAt))) {
      rec.updatedAt = brain.updatedAt
    }
    if (brain.status === 'done' && (rec.status === 'draft' || rec.status === 'approved' || rec.status === 'producing')) {
      rec.status = 'done'
    }
  }

  const out = [...byId.values()].map((p) => ({
    ...p,
    stage: suggestedStage(p),
  }))
  out.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  })
  return out
}

export function listStudioProjects(produceSummaries = [], brains = []) {
  return mergeStudioProjects({
    plans: listProjectRecords(),
    boards: listEpisodePlans(),
    produce: produceSummaries,
    brains,
  })
}

export function uniqueProjectId(title) {
  let base = slugifyProjectId(title)
  let id = base
  let n = 2
  while (loadProjectRecord(id) || listEpisodePlans().some((p) => p.id === id)) {
    id = slugifyProjectId(`${base}_${n}`)
    n += 1
  }
  return id
}

export function createStudioProject({ title, prompt } = {}) {
  const name = String(title || '').trim() || 'Untitled project'
  const id = uniqueProjectId(name)
  const now = new Date().toISOString()
  const userPrompt = String(prompt || '').trim()
  const record = {
    projectId: id,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    approved: false,
    produceRegistered: false,
    archived: false,
    userPrompt,
    plan: {
      projectId: id,
      title: name,
      logline: '',
      rating: '',
      durationTargetSec: 0,
      lookTrack: 'live',
      song: '',
      musicPalette: '',
      characters: [],
      clips: [],
      markdown: `# ${name}\n\n`,
      warnings: [],
    },
  }
  saveProjectRecord(record)
  ensureEpisodePlan(id, { title: name, markdown: record.plan.markdown, scenes: [] })
  logInfo('project.create', { id, title: name })
  return {
    project: {
      id,
      title: name,
      status: 'draft',
      clipCount: 0,
      sceneCount: 0,
      okCount: 0,
      clipTotal: null,
      active: false,
      approved: false,
      produceRegistered: false,
      archived: false,
      hasPlan: true,
      hasBoard: true,
      hasProduce: false,
      updatedAt: now,
      lookTrack: 'live',
      stage: 'plan',
    },
    record,
  }
}

export function syncBoardFromPlan(plan) {
  if (!plan?.projectId) return null
  return ensureEpisodePlan(plan.projectId, {
    title: plan.title,
    markdown: plan.markdown,
    scenes: (plan.clips || []).map((c) => ({
      id: c.id,
      title: c.title,
      heading: `### ${c.id} — ${c.title}`,
    })),
  })
}
