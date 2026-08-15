/**
 * Qorlith Floor — ops event log for the monitor Floor tab.
 * Written by agents / pack runners; read by GET /api/floor/status
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const STATUS_PATH =
  process.env.QORLITH_FLOOR_STATUS || path.join(ROOT, 'data', 'floor-status.json')

const MAX_UPDATES = 80

function defaultStatus() {
  return {
    schema: 'qorlith.floor.v1',
    displayName: 'Qorlith Floor',
    handle: '@qorlith',
    title: 'Studio',
    mood: 'idle',
    statusLine: 'Idle — waiting for a film',
    song: null,
    songPlaying: false,
    employeePhotoUrl: null,
    friends: [
      { name: 'Comfy', blurb: 'renderer' },
      { name: 'Make', blurb: 'LangGraph' },
      { name: 'Board', blurb: 'picks' },
      { name: 'Watch', blurb: 'the film' },
    ],
    about: [
      'Local-only activity log for Qorlith.',
      'Stills first. You pick. Then motion.',
    ],
    photos: [],
    progress: {
      project: null,
      runId: null,
      phase: 'idle',
      done: 0,
      total: 0,
      failed: 0,
      percent: 0,
      currentShot: null,
      detail: null,
      masterPath: null,
      workDir: null,
    },
    updates: [
      {
        id: 'boot',
        at: new Date().toISOString(),
        mood: 'online',
        text: 'Activity log online. Waiting for a film.',
        kind: 'system',
        imageUrl: null,
      },
    ],
    updatedAt: new Date().toISOString(),
  }
}

export function loadFloorStatus() {
  try {
    if (!fs.existsSync(STATUS_PATH)) {
      const d = defaultStatus()
      saveFloorStatus(d)
      return d
    }
    const raw = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'))
    return { ...defaultStatus(), ...raw, progress: { ...defaultStatus().progress, ...(raw.progress || {}) } }
  } catch {
    return defaultStatus()
  }
}

export function saveFloorStatus(data) {
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true })
  const out = { ...data, updatedAt: new Date().toISOString() }
  fs.writeFileSync(STATUS_PATH, JSON.stringify(out, null, 2), 'utf8')
  return out
}

export function postFloorUpdate(patch = {}) {
  const cur = loadFloorStatus()
  const text = String(patch.text || '').trim()
  let imageUrl = patch.imageUrl || null
  if (!imageUrl && patch.imagePath) {
    imageUrl = `/api/gallery/file?path=${encodeURIComponent(String(patch.imagePath))}`
  }
  if (text || imageUrl) {
    const entry = {
      id: `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      mood: patch.mood || cur.mood || 'busy',
      text: text || (imageUrl ? 'Still attached' : ''),
      kind: patch.kind || (imageUrl ? 'photo' : 'update'),
      imageUrl: imageUrl || null,
    }
    cur.updates = [entry, ...(cur.updates || [])].slice(0, MAX_UPDATES)
  }
  if (patch.mood) cur.mood = String(patch.mood).slice(0, 80)
  if (patch.statusLine) cur.statusLine = String(patch.statusLine).slice(0, 200)
  if (patch.song != null) cur.song = String(patch.song).slice(0, 120)
  if (patch.songPlaying != null) cur.songPlaying = Boolean(patch.songPlaying)
  if (patch.employeePhotoUrl) cur.employeePhotoUrl = String(patch.employeePhotoUrl).slice(0, 400)
  if (Array.isArray(patch.photos)) cur.photos = patch.photos
  if (Array.isArray(patch.about)) cur.about = patch.about
  if (patch.progress && typeof patch.progress === "object") {
    cur.progress = { ...cur.progress, ...patch.progress }
    const p = cur.progress
    const total = Number(p.total) || 0
    const done = Number(p.done) || 0
    p.percent = total > 0 ? Math.round((done / total) * 1000) / 10 : Number(p.percent) || 0
  }
  if (patch.addPhoto && imageUrl) {
    const photos = Array.isArray(cur.photos) ? cur.photos : []
    photos.unshift({
      id: `p_${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      url: imageUrl,
      caption: String(patch.photoCaption || patch.text || 'still').slice(0, 160),
      kind: patch.kind || 'progress',
    })
    cur.photos = photos.slice(0, 40)
  }
  return saveFloorStatus(cur)
}
