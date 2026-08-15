#!/usr/bin/env node
/**
 * Overnight babysit: poll Monitor Brain API and press Continue if the run dies.
 *
 *   node scripts/babysit-brain.mjs daylight_ghost_2
 */
import http from 'node:http'

const BASE = process.env.QORLITH_LIVE_URL || 'http://127.0.0.1:3921'
const ID = process.argv[2]
const POLL_MS = Number(process.env.QORLITH_BABYSIT_POLL_MS || 30_000)
const MAX_MS = Number(process.env.QORLITH_BABYSIT_MAX_MS || 10 * 60 * 60 * 1000)

if (!ID) {
  console.error('usage: node scripts/babysit-brain.mjs <projectId>')
  process.exit(2)
}

function request(method, path, body) {
  const u = new URL(path, BASE)
  const payload = body == null ? null : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
        timeout: 20_000,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => {
          data += c
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} })
          } catch {
            resolve({ status: res.statusCode, body: { _raw: data.slice(0, 400) } })
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`timeout ${method} ${path}`))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function line(brain) {
  const clips = brain?.clips || []
  const videos = clips.filter((c) => c.video).length
  return [
    brain?.running ? 'run' : 'idle',
    brain?.status,
    brain?.step,
    brain?.phase,
    brain?.currentClip || '-',
    `video ${videos}/${clips.length}`,
    brain?.lastError || '',
  ].join(' ')
}

async function tick() {
  const res = await request('GET', `/api/brain/${encodeURIComponent(ID)}`)
  const brain = res.body?.brain
  if (!brain) return { brain: null, action: 'missing' }
  const clips = brain.clips || []
  const videos = clips.filter((c) => c.video).length
  const done = !brain.running && brain.status === 'done' && brain.master
  const failedHard = !brain.running && brain.status === 'fail' && videos === clips.length
  const needsContinue =
    !brain.running &&
    !done &&
    clips.length > 0 &&
    videos < clips.length &&
    ['face_qa', 'video', 'stopped', 'fail', 'stills', 'recut'].includes(String(brain.status || ''))
  return { brain, done, failedHard, needsContinue, videos, total: clips.length }
}

const started = Date.now()
let last = ''
let resumes = 0
while (Date.now() - started < MAX_MS) {
  try {
    const snap = await tick()
    const msg = line(snap.brain)
    if (msg !== last) {
      console.error(`[babysit ${new Date().toISOString()}] ${msg}`)
      last = msg
    }
    if (snap.done) {
      console.log('DONE')
      process.exit(0)
    }
    if (snap.failedHard) {
      console.log('FAILED')
      process.exit(1)
    }
    if (snap.needsContinue) {
      resumes += 1
      console.error(`[babysit] resume #${resumes} reviewOk`)
      const r = await request('POST', `/api/brain/${encodeURIComponent(ID)}/resume`, { reviewOk: true })
      if (r.status >= 400) console.error(`[babysit] resume ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    }
  } catch (e) {
    console.error(`[babysit] ${e instanceof Error ? e.message : e}`)
  }
  await new Promise((r) => setTimeout(r, POLL_MS))
}
console.log('FAILED')
process.exit(1)
