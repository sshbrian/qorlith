/**
 * Integration harness: graph + monitoring HTTP against a temp project tree.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { _resetComfyProgressForTests } from './comfyProgress.mjs'
import { createApp } from './http.mjs'

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || '{}') })
          } catch (e) {
            reject(new Error(`bad json ${res.statusCode}: ${data.slice(0, 200)}`))
          }
        })
      })
      .on('error', reject)
  })
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`)
}

describe('brain graph + monitor HTTP', () => {
  let root
  let server
  let port
  let prev = {}

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-graph-it-'))
    const keys = ['QORLITH_PROJECTS', 'QORLITH_DATA', 'QORLITH_PORT', 'QORLITH_CONFIG']
    for (const k of keys) prev[k] = process.env[k]
    process.env.QORLITH_PROJECTS = path.join(root, 'projects')
    process.env.QORLITH_DATA = path.join(root, 'data')
    process.env.QORLITH_PORT = '0'
    fs.mkdirSync(process.env.QORLITH_PROJECTS, { recursive: true })

    const app = createApp()
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = server.address().port
        resolve()
      })
    })
  })

  after(async () => {
    if (server) await new Promise((r) => server.close(r))
    _resetComfyProgressForTests()
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('404s when the project has no plan and no brain report', async () => {
    const { status, body } = await getJson(port, '/api/brain/missing_film')
    assert.equal(status, 404)
    assert.equal(body.code, 'brain_not_found')
    assert.ok(body.hint)
  })

  it('returns an idle graph for a plan-only project', async () => {
    writeJson(path.join(root, 'projects', 'draft_film', 'plan.json'), {
      projectId: 'draft_film',
      status: 'draft',
      plan: {
        projectId: 'draft_film',
        title: 'Draft Film',
        lookTrack: 'live',
        clips: [{ id: 'S01', title: 'Open', durationSec: 6 }],
      },
    })
    const { status, body } = await getJson(port, '/api/brain/draft_film')
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.brain.started, false)
    assert.equal(body.brain.title, 'Draft Film')
    assert.equal(body.brain.clips[0].id, 'S01')
    assert.equal(body.brain.running, false)
    assert.ok(Array.isArray(body.brain.steps))
    assert.ok(body.brain.steps.every((s) => s.state === 'idle'))
  })

  it('idle t2v plan skips picture steps', async () => {
    writeJson(path.join(root, 'projects', 't2v_draft', 'plan.json'), {
      projectId: 't2v_draft',
      status: 'draft',
      plan: {
        projectId: 't2v_draft',
        title: 'T2V Draft',
        lookTrack: 'anime',
        videoMode: 't2v',
        clips: [{ id: 'S01', title: 'Open', durationSec: 12 }],
      },
    })
    const { status, body } = await getJson(port, '/api/brain/t2v_draft')
    assert.equal(status, 200)
    assert.equal(body.brain.videoMode, 't2v')
    assert.deepEqual(
      body.brain.steps.map((s) => s.id),
      ['health', 'plan', 'video', 'free', 'finish'],
    )
  })

  it('serves live graph, timings, and comfy overlay from brain.json', async () => {
    const id = 'live_harbor'
    writeJson(path.join(root, 'projects', id, 'plan.json'), {
      projectId: id,
      status: 'approved',
      plan: { projectId: id, title: 'Live Harbor', clips: [{ id: 'S02', title: 'Alley' }] },
    })
    writeJson(path.join(root, 'projects', id, 'brain.json'), {
      schema: 'qorlith.brain.v1',
      projectId: id,
      title: 'Live Harbor',
      status: 'stills',
      step: 'stills',
      currentClip: 'S02',
      steps: [
        { id: 'health', label: 'Ready', state: 'done' },
        { id: 'plan', label: 'Story', state: 'done' },
        { id: 'stills', label: 'Pictures', state: 'active' },
        { id: 'face_qa', label: 'Your picks', state: 'idle' },
        { id: 'video', label: 'Motion', state: 'idle' },
        { id: 'finish', label: 'Film', state: 'idle' },
      ],
      clips: [{ id: 'S02', title: 'Alley', still: null, video: null }],
      timings: {
        health: {
          startedAt: '2026-08-14T12:00:00.000Z',
          endedAt: '2026-08-14T12:00:01.500Z',
          seconds: 1.5,
        },
        plan: {
          startedAt: '2026-08-14T12:00:01.500Z',
          endedAt: '2026-08-14T12:00:04.000Z',
          seconds: 2.5,
        },
        stills: { startedAt: '2026-08-14T12:00:04.000Z', endedAt: null, seconds: 6 },
      },
      graph: {
        nodes: [
          { id: 'start', label: 'Start', state: 'done' },
          { id: 'stills', label: 'Pictures', state: 'active' },
        ],
        edges: [
          { id: 'health->plan:flow', from: 'health', to: 'plan', kind: 'flow', seconds: 1.5, live: false },
        ],
      },
    })
    const { status, body } = await getJson(port, `/api/brain/${id}`)
    assert.equal(status, 200)
    const brain = body.brain
    assert.equal(brain.started, true)
    assert.equal(brain.step, 'stills')
    assert.equal(brain.currentClip, 'S02')
    assert.equal(brain.timings.health.seconds, 1.5)
    assert.equal(brain.timings.stills.endedAt, null)
    assert.ok(brain.graph)
    assert.equal(brain.running, false)
    assert.equal(typeof brain.label, 'string')
  })

  it('lists brains that have a report and exposes comfy progress', async () => {
    const listed = await getJson(port, '/api/brain')
    assert.equal(listed.status, 200)
    assert.ok(listed.body.brains.some((b) => b.projectId === 'live_harbor'))

    const prog = await getJson(port, '/api/comfy/progress')
    assert.equal(prog.status, 200)
    assert.equal(typeof prog.body.connected, 'boolean')
    assert.equal(typeof prog.body.active, 'boolean')
    assert.ok('percent' in prog.body)
  })

  it('keeps a failed report readable for the graph', async () => {
    const id = 'fail_harbor'
    writeJson(path.join(root, 'projects', id, 'brain.json'), {
      projectId: id,
      status: 'fail',
      step: 'video',
      lastError: 'Render job failed',
      steps: [
        { id: 'health', label: 'Ready', state: 'done' },
        { id: 'video', label: 'Motion', state: 'fail' },
      ],
      clips: [],
      timings: {
        video: {
          startedAt: '2026-08-14T12:00:00.000Z',
          endedAt: '2026-08-14T12:00:20.000Z',
          seconds: 20,
        },
      },
    })
    const { status, body } = await getJson(port, `/api/brain/${id}`)
    assert.equal(status, 200)
    assert.equal(body.brain.status, 'fail')
    assert.equal(body.brain.timings.video.seconds, 20)
    assert.match(body.brain.label, /Fail/i)
  })

  it('404s a missing master and rejects a path outside the project', async () => {
    const missing = await getJson(port, '/api/brain/draft_film/master')
    assert.equal(missing.status, 404)

    const id = 'bad_master'
    writeJson(path.join(root, 'projects', id, 'brain.json'), {
      projectId: id,
      status: 'done',
      step: 'finish',
      master: '/etc/passwd',
      steps: [],
      clips: [],
    })
    const forbidden = await getJson(port, `/api/brain/${id}/master`)
    assert.equal(forbidden.status, 403)
  })
})
