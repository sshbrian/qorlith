/**
 * Live LangGraph: 2-minute action short (10 clips × 12s) at video.megapixels from yaml.
 *
 *   node scripts/live-video-120s.mjs
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { loadStudio } from '../server/studioConfig.mjs'

export const TARGET_SEC = 120
export const CLIP_DURATIONS = [12, 12, 12, 12, 12, 12, 12, 12, 12, 12]
export const DURATION_MIN = 108
export const DURATION_MAX = 140

const BASE = process.env.QORLITH_LIVE_URL || 'http://127.0.0.1:3921'
const POLL_MS = Number(process.env.QORLITH_LIVE_POLL_MS || 5000)
const TIMEOUT_MS = Number(process.env.QORLITH_LIVE_TIMEOUT_MS || 8 * 60 * 60 * 1000)

const MAJOR =
  'Adult woman, the Major: short dark violet-black hair, stoic face, red-violet eyes, ' +
  'full cybernetic body, dark thermoptic tactical bodysuit, no helmet, cinematic anime, ' +
  'Ghost in the Shell look'
const CITY =
  'harsh daylight, dusty beige ruined city like Mosul, stone mid-rises, rubble streets, ' +
  'satellite dishes, distant minaret, dry heat haze, 16:9'
const FOE = 'adult armed militant fighters, black clothing, rifles, technicals, no children'

const CLIPS = [
  {
    title: 'Rooftop Overwatch',
    mood: 'hunt',
    stillBrief: `${MAJOR}, crouched on a ruined rooftop over ${CITY}, cyber HUD in her eyes, fighters in the street below`,
    motionBrief: 'She leans forward, thermoptic suit shimmers in hard sun, dust blows, HUD ticks across her iris',
    soundscape: 'distant gunfire, wind over rubble',
    musicNote: 'low',
  },
  {
    title: 'Thermoptic Drop',
    mood: 'strike',
    stillBrief: `${MAJOR} mid-leap off the rooftop into an alley, thermoptic fade, ${CITY}`,
    motionBrief: 'She drops, suit flickers invisible then slams into the alley dust, two fighters turn too late',
    soundscape: 'whoosh, boot impact, shouts',
    musicNote: 'loud',
  },
  {
    title: 'First Blood',
    mood: 'violence',
    stillBrief: `${MAJOR} in close quarters, cybernetic arm through a fighter, blood spray, ${CITY} alley walls`,
    motionBrief: 'She rips the fighter aside, arterial spray, second man fires, she bats the rifle, blood hits the wall',
    soundscape: 'wet impact, rifle clatter, scream cut short',
    musicNote: 'loud',
  },
  {
    title: 'Street Sweep',
    mood: 'assault',
    stillBrief: `${MAJOR} walking through a rubble street under fire, tracers, ${FOE} behind wrecked cars, ${CITY}`,
    motionBrief: 'She advances through gunfire, bullets spark off her body, she returns fire, a fighter drops gory',
    soundscape: 'full-auto, ricochet, dust',
    musicNote: 'loud',
  },
  {
    title: 'Airstrike Call',
    mood: 'doom',
    stillBrief: `${MAJOR} looking up, daylight sky, incoming strike, ${FOE} scattering in the square, ${CITY}`,
    motionBrief: 'She glances up, missiles streak in, the far building detonates, fireball and debris rain',
    soundscape: 'jet roar, impact, collapsing stone',
    musicNote: 'loud',
  },
  {
    title: 'Through the Fire',
    mood: 'unstoppable',
    stillBrief: `${MAJOR} walking out of smoke and fire, gore and wreckage in the street, ${CITY}`,
    motionBrief: 'Smoke peels off her, she keeps walking, a burning technical explodes behind her, fighters flee',
    soundscape: 'fire roar, secondary blast, coughing men',
    musicNote: 'loud',
  },
  {
    title: 'Stairwell',
    mood: 'brutal',
    stillBrief: `${MAJOR} in a shattered concrete stairwell, blood on walls, two adult fighters mid-takedown, harsh daylight from a hole`,
    motionBrief: 'She slams one into the rail, throws the other down the well, blood smears the steps, she descends',
    soundscape: 'bone, concrete, body fall',
    musicNote: 'low',
  },
  {
    title: 'Courtyard Break',
    mood: 'chaos',
    stillBrief: `${MAJOR} in a sun-blasted courtyard, ${FOE} around a technical, she is already among them, ${CITY}`,
    motionBrief: 'She vaults the hood, kicks a gunner off the technical, the truck lurches and slams a wall, dust and blood',
    soundscape: 'engine, metal, shouts',
    musicNote: 'loud',
  },
  {
    title: 'Second Strike',
    mood: 'apocalypse',
    stillBrief: `${MAJOR} in the open square, gunship or missile trail above, ${CITY} about to erupt`,
    motionBrief: 'The square detonates, shockwave, bodies and stone fly, she stands in the blast wash, hair and coat snap',
    soundscape: 'airstrike, shockwave, ringing',
    musicNote: 'loud',
  },
  {
    title: 'Dust Crown',
    mood: 'resolve',
    stillBrief: `${MAJOR} alone in the cratered street, fires, wrecked technicals, ${CITY} behind her, thermoptic flicker`,
    motionBrief: 'She stands, dust settles, suit shimmers, she walks toward camera through smoke and blood-dark puddles',
    soundscape: 'fires, distant siren, wind',
    musicNote: 'soft',
  },
].map((c, i) => ({
  id: `S${String(i + 1).padStart(2, '0')}`,
  section: i < 3 ? 'act1' : i < 8 ? 'act2' : 'act3',
  gun_risk: true,
  sexy: false,
  dialogue: '',
  durationSec: 12,
  t_start: i * 12,
  t_end: i * 12 + 12,
  ...c,
}))

const PROMPT =
  'lookTrack anime. durationTargetSec 120. 10 clips durationSec 12. ' +
  'Adult Major, Ghost in the Shell style, daytime Mosul-like city battle. ' +
  'R-rated combat, gore, airstrikes. Adults only. No sex. Title Daylight Ghost.'

function log(msg, extra) {
  const t = new Date().toISOString()
  if (extra !== undefined) console.log(`[live-120s ${t}] ${msg}`, extra)
  else console.log(`[live-120s ${t}] ${msg}`)
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
  const mp = Number(loadStudio().video?.megapixels)
  assert.equal(mp, 0.6, `video.megapixels is ${mp}, want 0.6 — not starting`)
  log(`quality megapixels=${mp}`)
  const health = await get('/api/health', 8000)
  assert.equal(health.status, 200, `Monitor not ok at ${BASE}`)
  assert.equal(health.body.product, 'Qorlith')
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

async function lockPlan() {
  const created = await post(
    '/api/studio/projects',
    { title: 'Daylight Ghost', prompt: PROMPT },
    15_000,
  )
  assert.equal(created.status, 201, `create failed: ${JSON.stringify(created.body).slice(0, 300)}`)
  const id = created.body?.project?.id
  assert.ok(id, 'no project id')

  const recRes = await get(`/api/studio/plans/${encodeURIComponent(id)}`, 15_000)
  assert.equal(recRes.status, 200)
  const rec = recRes.body.record
  rec.userPrompt = PROMPT
  rec.updatedAt = new Date().toISOString()
  rec.approved = false
  rec.plan = {
    projectId: id,
    title: 'Daylight Ghost',
    logline:
      'Daylight over a ruined Mosul-like city. The Major, a cybernetic adult woman, tears through militant fighters. Airstrikes, gore, thermoptic war.',
    rating: 'R',
    durationTargetSec: TARGET_SEC,
    lookTrack: 'anime',
    song: 'Percussive industrial pulse, no vocals',
    musicPalette: 'Low war drums, distorted brass hits, silence under explosions',
    characters: [
      {
        id: 'S1',
        name: 'The Major',
        look: 'Adult woman, short dark violet-black hair, red-violet eyes, cybernetic body, dark thermoptic suit',
        voice: 'Low, flat, adult woman',
      },
    ],
    clips: CLIPS,
    markdown: `# Daylight Ghost\n\n${PROMPT}\n`,
    warnings: [],
  }
  const dest = path.join(fileURLToPath(new URL('../data/projects/', import.meta.url)), id, 'plan.json')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, JSON.stringify(rec, null, 2), 'utf8')
  const approved = await post(
    `/api/studio/plans/${encodeURIComponent(id)}/approve`,
    { startProduction: false },
    15_000,
  )
  assert.equal(approved.status, 200, `approve failed: ${JSON.stringify(approved.body).slice(0, 300)}`)
  const sum = CLIPS.reduce((n, c) => n + c.durationSec, 0)
  assert.equal(sum, TARGET_SEC)
  log(`plan locked ${id} · 10×12s = ${sum}s · mp=${loadStudio().video.megapixels}`)
  return id
}

async function pickBoard(id) {
  const board = await get(`/api/episode-plans/${encodeURIComponent(id)}`, 15_000)
  assert.equal(board.status, 200, 'board load failed')
  const scenes = board.body?.scenes || []
  assert.ok(scenes.length >= 10, `board has ${scenes.length} scenes`)
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
  const id = await lockPlan()

  const started = await post(`/api/brain/${encodeURIComponent(id)}/start`, { stopAfter: 'stills' }, 15_000)
  assert.equal(started.status, 202, `start failed: ${JSON.stringify(started.body).slice(0, 400)}`)
  log(`LangGraph start pid=${started.body.pid}`)

  const afterStills = await waitBrain(
    id,
    (b) => !b.running && (b.status === 'face_qa' || (b.step === 'face_qa' && b.started)),
    'stills',
  )
  assert.equal(afterStills.status, 'face_qa')
  const stillCount = (afterStills.clips || []).filter((c) => c.still).length
  assert.equal(stillCount, 10, `expected 10 stills, got ${stillCount}`)

  await pickBoard(id)
  const resumed = await post(`/api/brain/${encodeURIComponent(id)}/resume`, { reviewOk: true }, 15_000)
  assert.equal(resumed.status, 202, `resume failed: ${JSON.stringify(resumed.body).slice(0, 400)}`)
  log(`LangGraph resume pid=${resumed.body.pid}`)

  const done = await waitBrain(id, (b) => !b.running && b.status === 'done' && b.master, 'video+finish')
  assert.ok(fs.existsSync(done.master), `master missing: ${done.master}`)
  const videos = (done.clips || []).filter((c) => c.video)
  assert.equal(videos.length, 10, `expected 10 clip videos, got ${videos.length}`)

  const masterSec = await ffprobeDuration(done.master)
  const clipSecs = []
  for (const c of done.clips) {
    clipSecs.push({ id: c.id, want: c.durationSec, got: Number((await ffprobeDuration(c.video)).toFixed(3)) })
  }
  log('clip durations', clipSecs)
  log(`master ${masterSec.toFixed(3)}s (band ${DURATION_MIN}–${DURATION_MAX})`)
  assert.ok(masterSec >= DURATION_MIN && masterSec <= DURATION_MAX, `master ${masterSec}s not ~120s`)
  const elapsed = Math.round((Date.now() - t0) / 1000)
  log(`ok ${id} master=${masterSec.toFixed(2)}s elapsed=${elapsed}s`)
  return { id, master: done.master, durationSec: masterSec, clips: clipSecs, elapsedSec: elapsed, megapixels: 0.6 }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  runLive()
    .then((r) => {
      console.log(JSON.stringify({ ok: true, ...r }, null, 2))
    })
    .catch((err) => {
      console.error(`[live-120s] FAIL ${err?.stack || err}`)
      process.exitCode = 1
    })
}
