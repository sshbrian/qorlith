/**
 * Integration: spin API against a fake Kohya output tree (the same layout
 * a Kohya output tree writes) and assert status exposes bar-ready progress.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSyntheticTrainLog } from './progress.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function mkTmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-it-'))
  const outputs = path.join(root, 'outputs')
  const run = path.join(outputs, 'demo_run')
  const logs = path.join(root, 'tb_logs')
  fs.mkdirSync(run, { recursive: true })
  fs.mkdirSync(logs, { recursive: true })

  // Same files our train script produces
  const trainLog = path.join(run, 'train.log')
  const body = buildSyntheticTrainLog({
    epoch: 2,
    epochTotal: 16,
    step: 400,
    maxSteps: 1280,
    itPerSec: 1.55,
    loss: 0.1,
    avgLoss: 0.11,
    lr: 8e-5,
    batchSize: 2,
    elapsed: '04:18',
    eta: '09:28',
  })
  fs.writeFileSync(trainLog, body, 'utf8')

  // Fake mid-run (no ckpt yet) — API should still discover the run via logs
  const cfgPath = path.join(root, 'config.json')
  fs.writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        outputRoots: [outputs],
        logRoots: [logs],
        trainLogGlobs: [],
        comfyOutputRoots: [],
        pollSeconds: 2,
        activeWindowMinutes: 60,
      },
      null,
      2,
    ),
    'utf8',
  )

  return { root, outputs, run, trainLog, cfgPath }
}

function postJson(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {})
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || '{}') })
          } catch (e) {
            reject(new Error(`bad json ${res.statusCode}: ${data.slice(0, 200)}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) })
          } catch (e) {
            reject(new Error(`bad json: ${data.slice(0, 200)}`))
          }
        })
      })
      .on('error', reject)
  })
}

describe('Qorlith API integration (synthetic Kohya pipes)', () => {
  let tree
  let server
  let port

  before(async () => {
    tree = mkTmpTree()
    process.env.QORLITH_CONFIG = tree.cfgPath
    process.env.QORLITH_PORT = '0'
    process.env.QORLITH_PROJECTS = path.join(tree.root, 'projects')
    process.env.QORLITH_DATA = path.join(tree.root, 'data')
    process.env.QORLITH_PRODUCE_REGISTRY = path.join(tree.root, 'produce_pipelines_studio.json')
    process.env.QORLITH_FLOOR_STATUS = path.join(tree.root, 'floor-status.json')

    // Dynamic import after env is set
    const mod = await import(`./index.js?t=${Date.now()}`)
    await new Promise((resolve) => {
      server = mod.app.listen(0, '127.0.0.1', () => {
        port = server.address().port
        resolve()
      })
    })
  })

  after(async () => {
    if (server) await new Promise((r) => server.close(r))
    try {
      fs.rmSync(tree.root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    delete process.env.QORLITH_CONFIG
    delete process.env.QORLITH_PROJECTS
    delete process.env.QORLITH_DATA
    delete process.env.QORLITH_PRODUCE_REGISTRY
    delete process.env.QORLITH_FLOOR_STATUS
  })

  it('health ok', async () => {
    const { status, body } = await getJson(port, '/api/health')
    assert.equal(status, 200)
    assert.equal(body.product, 'Qorlith')
  })

  it('studio health names the projects folder', async () => {
    const { status, body } = await getJson(port, '/api/studio/health')
    assert.equal(status, 200)
    assert.match(String(body.projectsDir || ''), /projects/)
    assert.equal(body.plansDir, undefined)
  })

  it('create → approve seeds board → archive hides the produce pack', async () => {
    const created = await postJson(port, '/api/studio/projects', {
      title: 'Night Alley',
      prompt: 'two adults, alley',
    })
    assert.equal(created.status, 201)
    const id = created.body.project.id
    assert.equal(id, 'night_alley')

    const planned = await postJson(port, '/api/studio/plan', {
      prompt: 'two adults, alley chase',
      dryRun: true,
      projectId: id,
    })
    assert.equal(planned.status, 200)
    assert.ok(planned.body.record?.plan?.clips?.length >= 1)

    const approved = await postJson(port, `/api/studio/plans/${id}/approve`, {
      startProduction: true,
    })
    assert.equal(approved.status, 200)
    const board = await getJson(port, `/api/episode-plans/${id}`)
    assert.equal(board.status, 200)
    assert.ok((board.body.scenes || []).length >= 1)

    const listed = await getJson(port, '/api/produce/pipelines')
    assert.ok(listed.body.pipelines.some((p) => p.id === id))

    const archived = await postJson(port, `/api/studio/plans/${id}/archive`, {})
    assert.equal(archived.status, 200)
    const after = await getJson(port, '/api/produce/pipelines')
    assert.ok(!after.body.pipelines.some((p) => p.id === id))

    const live = await getJson(port, '/api/studio/projects')
    assert.ok(!(live.body.projects || []).some((p) => p.id === id))
    const vault = await getJson(port, '/api/studio/archive')
    assert.ok((vault.body.projects || []).some((p) => p.id === id))

    const restored = await postJson(port, `/api/studio/plans/${id}/unarchive`, {})
    assert.equal(restored.status, 200)
    const liveAgain = await getJson(port, '/api/studio/projects')
    assert.ok((liveAgain.body.projects || []).some((p) => p.id === id))
  })

  it('unknown produce pipeline returns error + code + hint', async () => {
    const { status, body } = await getJson(port, '/api/produce/no_such_pipe')
    assert.equal(status, 404)
    assert.equal(body.ok, false)
    assert.ok(body.error)
    assert.ok(body.code)
    assert.ok(body.hint)
  })

  it('discovers demo_run from train.log without checkpoints', async () => {
    const { body } = await getJson(port, '/api/runs')
    assert.ok(body.runs.length >= 1)
    const run = body.runs.find((r) => r.name === 'demo_run')
    assert.ok(run, 'expected demo_run folder')
    assert.equal(run.checkpointCount, 0)
  })

  it('status exposes epoch progress + speed for progress bars', async () => {
    const { body } = await getJson(port, '/api/status')
    assert.equal(body.trainingActive, true)
    assert.ok(body.progress, 'progress object required')
    const p = body.progress
    assert.deepEqual(p.epoch, { current: 2, total: 16 })
    assert.equal(p.step, 400)
    assert.equal(p.maxSteps, 1280)
    assert.ok(p.percent != null && p.percent > 30 && p.percent < 32)
    assert.ok(p.overallPercent != null && p.overallPercent > 5 && p.overallPercent < 15)
    assert.equal(p.itPerSec, 1.55)
    assert.ok(p.etaHuman)
    assert.ok(p.etaTotalHuman)
    assert.ok(Array.isArray(p.recentLines) && p.recentLines.some((l) => /steps:/.test(l)))
  })

  it('run detail returns bar-ready progress from run train.log', async () => {
    const { body: runsBody } = await getJson(port, '/api/runs')
    const run = runsBody.runs.find((r) => r.name === 'demo_run')
    const { body } = await getJson(port, `/api/runs/${encodeURIComponent(run.id)}`)
    assert.ok(body.progress)
    assert.equal(body.progress.step, 400)
    assert.ok(body.log?.text?.includes('1.55it/s'))
  })

  it('updates progress when train.log advances (simulates live epoch)', async () => {
    const advanced = buildSyntheticTrainLog({
      epoch: 2,
      epochTotal: 16,
      step: 900,
      maxSteps: 1280,
      itPerSec: 1.6,
      loss: 0.07,
      batchSize: 2,
    })
    fs.writeFileSync(tree.trainLog, advanced, 'utf8')
    // touch mtime
    const now = new Date()
    fs.utimesSync(tree.trainLog, now, now)

    const { body } = await getJson(port, '/api/status')
    assert.equal(body.progress.step, 900)
    assert.ok(body.progress.percent >= 70 && body.progress.percent < 71)
    assert.equal(body.progress.itPerSec, 1.6)
  })
})
