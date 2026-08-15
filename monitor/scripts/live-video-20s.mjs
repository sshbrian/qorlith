/**
 * Live LangGraph integration: a 20-second film (3 clips, 7 + 7 + 6).
 *
 * Requires Monitor, Comfy, and LM Studio. Queues real stills + MiniMax.
 *
 *   node scripts/live-video-20s.mjs
 *   npm run test:live-video
 *
 * Optional:
 *   QORLITH_LIVE_URL=http://127.0.0.1:3921
 *   QORLITH_LIVE_TIMEOUT_MS=10800000
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

export const TARGET_SEC = 20
export const CLIP_DURATIONS = [7, 7, 6]
export const DURATION_MIN = 18
export const DURATION_MAX = 24

const BASE = process.env.QORLITH_LIVE_URL || 'http://127.0.0.1:3921'
const POLL_MS = Number(process.env.QORLITH_LIVE_POLL_MS || 4000)
const TIMEOUT_MS = Number(process.env.QORLITH_LIVE_TIMEOUT_MS || 2.5 * 60 * 60 * 1000)
const PROMPT =
  'Return JSON only. lookTrack anime. durationTargetSec 20. 3 clips durationSec 7,7,6. ' +
  'Adult woman teal-blue hair red eyes black coat. Night rain neon pier. ' +
  'stillBrief and motionBrief on every clip. No sex. Title Neon Pier 20.'

const FALLBACK_CLIPS = [
  {
    id: 'S01',
    title: 'Rainy Approach',
    section: 'act1',
    mood: 'tension',
    stillBrief:
      'Adult woman, teal-blue hair, red eyes, black coat, walking onto a neon-lit pier at night, rain on wet boards, wide 16:9',
    motionBrief: 'She walks toward camera, coat hem lifts in the wind, rain streaks, neon reflections ripple',
    dialogue: '',
    soundscape: 'rain, distant harbor horn',
    musicNote: 'low',
  },
  {
    id: 'S02',
    title: 'Neon Glance',
    section: 'act2',
    mood: 'watchful',
    stillBrief:
      'Same adult woman at a pier railing, teal-blue hair wet, red eyes catching magenta neon, black coat, night rain',
    motionBrief: 'She turns her head, rain beads on the coat, neon sign flickers behind her',
    dialogue: '',
    soundscape: 'rain, soft neon buzz',
    musicNote: 'soft',
  },
  {
    id: 'S03',
    title: 'Harbor Hold',
    section: 'act3',
    mood: 'resolve',
    stillBrief:
      'Same adult woman under a pier lamp, teal-blue hair, red eyes, black coat, looking out over dark water, night rain',
    motionBrief: 'She steps forward and stops, lamp glow breathes, water moves below',
    dialogue: '',
    soundscape: 'rain, water against pilings',
    musicNote: 'soft',
  },
]

export function clipSum(clips) {
  return (clips || []).reduce((n, c) => n + Number(c.durationSec || 0), 0)
}

export function durationInBand(sec) {
  const n = Number(sec)
  return Number.isFinite(n) && n >= DURATION_MIN && n <= DURATION_MAX
}

export function normalizePlanTo20(plan = {}) {
  const want = CLIP_DURATIONS
  const src = Array.isArray(plan.clips) ? plan.clips.slice(0, want.length) : []
  const clips = want.map((durationSec, i) => {
    const base = src[i] || FALLBACK_CLIPS[i]
    const t_start = want.slice(0, i).reduce((a, b) => a + b, 0)
    return {
      ...FALLBACK_CLIPS[i],
      ...base,
      id: `S0${i + 1}`,
      durationSec,
      t_start,
      t_end: t_start + durationSec,
      gun_risk: false,
      sexy: false,
      stillBrief: String(base.stillBrief || FALLBACK_CLIPS[i].stillBrief),
      motionBrief: String(base.motionBrief || FALLBACK_CLIPS[i].motionBrief),
    }
  })
  return {
    ...plan,
    title: plan.title || 'Neon Pier 20',
    lookTrack: 'anime',
    durationTargetSec: TARGET_SEC,
    rating: plan.rating || 'R',
    clips,
  }
}

function log(msg, extra) {
  const t = new Date().toISOString()
  if (extra !== undefined) console.log(`[live-20s ${t}] ${msg}`, extra)
  else console.log(`[live-20s ${t}] ${msg}`)
}

function request(method, urlPath, body, timeoutMs = 30_000) {
  const u = new URL(urlPath, BASE)
  const payload = body == null ? null : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => {
          data += c
        })
        res.on('end', () => {
          let parsed = data
          try {
            parsed = data ? JSON.parse(data) : {}
          } catch {
            parsed = { _raw: data.slice(0, 400) }
          }
          resolve({ status: res.statusCode, body: parsed })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`timeout ${method} ${urlPath}`))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

const get = (p, t) => request('GET', p, null, t)
const post = (p, body, t) => request('POST', p, body, t)
const put = (p, body, t) => request('PUT', p, body, t)

function ffprobeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    let err = ''
    child.stdout.on('data', (c) => {
      out += c
    })
    child.stderr.on('data', (c) => {
      err += c
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const n = Number(out.trim())
      if (code === 0 && Number.isFinite(n)) resolve(n)
      else reject(new Error(err.trim() || `ffprobe exit ${code}`))
    })
  })
}

function summarize(brain) {
  if (!brain) return 'no-brain'
  const clips = brain.clips || []
  const stills = clips.filter((c) => c.still).length
  const videos = clips.filter((c) => c.video).length
  const picks = clips.filter((c) => c.pick).length
  const bits = [
    brain.running ? 'run' : 'idle',
    brain.status,
    brain.step,
    brain.phase || '-',
    brain.currentClip || '-',
    `stills ${stills}/${clips.length}`,
    `picks ${picks}`,
    `vid ${videos}`,
  ]
  if (brain.comfy?.percent != null) bits.push(`${Math.round(brain.comfy.percent)}%`)
  if (brain.lastError) bits.push(`err=${brain.lastError}`)
  return bits.join(' · ')
}

async function requireReady() {
  const health = await get('/api/health', 8000)
  assert.equal(health.status, 200, `Monitor not ok at ${BASE}`)
  assert.equal(health.body.product, 'Qorlith')
  const studio = await get('/api/studio/health', 8000)
  assert.equal(studio.status, 200, 'studio health failed')
  assert.ok(studio.body?.lmstudio?.ok, 'LM Studio is not ok')
  const comfy = await get('/api/system/stats', 8000)
  assert.ok(comfy.status === 200, 'system stats failed')
  const queue = await new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:8188/queue', { timeout: 8000 }, (res) => {
      let data = ''
      res.on('data', (c) => {
        data += c
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Comfy /queue timeout'))
    })
  })
  const busy = (queue.queue_running || []).length + (queue.queue_pending || []).length
  assert.equal(busy, 0, 'Comfy already has work — not starting a live video run')
}

async function createProject() {
  const created = await post('/api/studio/projects', { title: 'Neon Pier 20', prompt: PROMPT }, 15_000)
  assert.equal(created.status, 201, `create project failed: ${JSON.stringify(created.body).slice(0, 300)}`)
  const id = created.body?.project?.id
  assert.ok(id, 'no project id')
  return id
}

async function writeTwentySecondPlan(id) {
  const planned = await post('/api/studio/plan', { prompt: PROMPT, projectId: id }, 180_000)
  if (planned.status !== 200 || !planned.body?.plan?.clips?.length) {
    log('planner did not return clips — using fallback 20s plan', planned.body?.error || planned.status)
  }
  const recRes = await get(`/api/studio/plans/${encodeURIComponent(id)}`, 15_000)
  assert.equal(recRes.status, 200, 'plan record missing after generate')
  const rec = recRes.body.record
  rec.plan = normalizePlanTo20(planned.body?.plan || rec.plan || {})
  rec.plan.projectId = id
  rec.userPrompt = PROMPT
  rec.updatedAt = new Date().toISOString()
  rec.approved = false
  const dest = path.join(
    fileURLToPath(new URL('../data/projects/', import.meta.url)),
    id,
    'plan.json',
  )
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, JSON.stringify(rec, null, 2), 'utf8')
  const approved = await post(`/api/studio/plans/${encodeURIComponent(id)}/approve`, { startProduction: false }, 15_000)
  assert.equal(approved.status, 200, `approve failed: ${JSON.stringify(approved.body).slice(0, 300)}`)
  const sum = clipSum(rec.plan.clips)
  assert.equal(sum, TARGET_SEC, `normalized plan is ${sum}s, want ${TARGET_SEC}`)
  assert.equal(rec.plan.clips.length, 3)
  log(`plan locked ${id} · ${rec.plan.clips.map((c) => `${c.id}:${c.durationSec}`).join(' + ')} = ${sum}s`)
  return rec.plan
}

async function pickBoard(id) {
  const board = await get(`/api/episode-plans/${encodeURIComponent(id)}`, 15_000)
  assert.equal(board.status, 200, 'board load failed')
  const scenes = board.body?.scenes || []
  assert.ok(scenes.length >= 3, `board has ${scenes.length} scenes`)
  for (const scene of scenes) {
    const still = (scene.stills || [])[0]
    assert.ok(still?.rel, `no still on ${scene.id}`)
    if (scene.pickRel === still.rel) continue
    const set = await put(`/api/episode-plans/${encodeURIComponent(id)}/picks`, {
      sceneId: scene.id,
      imageRel: still.rel,
    })
    assert.equal(set.status, 200, `pick ${scene.id} failed`)
    log(`picked ${scene.id} → ${still.rel}`)
  }
}

async function waitBrain(id, pred, label) {
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < TIMEOUT_MS) {
    const res = await get(`/api/brain/${encodeURIComponent(id)}`, 15_000)
    const brain = res.body?.brain
    const line = summarize(brain)
    if (line !== last) {
      log(line)
      last = line
    }
    if (brain && pred(brain)) return brain
    if (brain?.status === 'fail' || brain?.status === 'stopped') {
      throw new Error(`${label}: ${brain.status} — ${brain.lastError || 'no error'}`)
    }
    await sleep(POLL_MS)
  }
  throw new Error(`${label}: timed out after ${Math.round(TIMEOUT_MS / 1000)}s`)
}

export async function runLive() {
  const t0 = Date.now()
  log(`preflight ${BASE}`)
  await requireReady()
  const id = await createProject()
  log(`project ${id}`)
  await writeTwentySecondPlan(id)

  const started = await post(`/api/brain/${encodeURIComponent(id)}/start`, { stopAfter: 'stills' }, 15_000)
  assert.equal(started.status, 202, `start failed: ${JSON.stringify(started.body).slice(0, 400)}`)
  log(`LangGraph start pid=${started.body.pid} stopAfter=stills`)

  const afterStills = await waitBrain(
    id,
    (b) => !b.running && (b.status === 'face_qa' || (b.step === 'face_qa' && b.started)),
    'stills',
  )
  assert.equal(afterStills.status, 'face_qa', `expected face_qa, got ${afterStills.status}`)
  const stillCount = (afterStills.clips || []).filter((c) => c.still).length
  assert.equal(stillCount, 3, `expected 3 stills, got ${stillCount}`)

  await pickBoard(id)
  const resumed = await post(`/api/brain/${encodeURIComponent(id)}/resume`, { reviewOk: true }, 15_000)
  assert.equal(resumed.status, 202, `resume failed: ${JSON.stringify(resumed.body).slice(0, 400)}`)
  log(`LangGraph resume pid=${resumed.body.pid}`)

  const done = await waitBrain(id, (b) => !b.running && b.status === 'done' && b.master, 'video+finish')
  assert.equal(done.status, 'done')
  assert.ok(done.master, 'no master path')
  assert.ok(fs.existsSync(done.master), `master missing: ${done.master}`)
  const videos = (done.clips || []).filter((c) => c.video)
  assert.equal(videos.length, 3, `expected 3 clip videos, got ${videos.length}`)

  const masterSec = await ffprobeDuration(done.master)
  const clipSecs = []
  for (const c of done.clips) {
    const sec = await ffprobeDuration(c.video)
    clipSecs.push({ id: c.id, want: c.durationSec, got: Number(sec.toFixed(3)) })
  }
  log('clip durations', clipSecs)
  log(`master ${masterSec.toFixed(3)}s (band ${DURATION_MIN}–${DURATION_MAX}, target ${TARGET_SEC})`)
  assert.ok(
    durationInBand(masterSec),
    `master is ${masterSec.toFixed(3)}s, want ${TARGET_SEC}s (${DURATION_MIN}–${DURATION_MAX})`,
  )
  const elapsed = Math.round((Date.now() - t0) / 1000)
  log(`ok ${id} master=${masterSec.toFixed(2)}s elapsed=${elapsed}s`)
  return { id, master: done.master, durationSec: masterSec, clips: clipSecs, elapsedSec: elapsed }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  runLive()
    .then((r) => {
      console.log(JSON.stringify({ ok: true, ...r }, null, 2))
    })
    .catch((err) => {
      console.error(`[live-20s] FAIL ${err?.stack || err}`)
      process.exitCode = 1
    })
}
