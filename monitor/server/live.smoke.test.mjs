/**
 * Live HTTP smoke against a running Qorlith API (default :3921).
 * Skips cleanly when the API is down — safe for CI / offline.
 *
 * Read-only: GET only. Never queues Comfy jobs or clears the queue.
 *
 * Force run even if flaky: QORLITH_LIVE_SMOKE=1
 * Base URL: QORLITH_LIVE_URL=http://127.0.0.1:3921
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { describe, it, before } from 'node:test'

const BASE = process.env.QORLITH_LIVE_URL || 'http://127.0.0.1:3921'
const FORCE = process.env.QORLITH_LIVE_SMOKE === '1'

function getJson(urlPath) {
  const u = new URL(urlPath, BASE)
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        timeout: 8000,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let body = null
          try {
            body = JSON.parse(data || '{}')
          } catch {
            body = { _raw: data.slice(0, 200) }
          }
          resolve({ status: res.statusCode, body })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

describe('Live Qorlith HTTP smoke (optional)', () => {
  let live = false
  let health = null

  before(async () => {
    try {
      health = await getJson('/api/health')
      live = health.status === 200 && health.body?.product === 'Qorlith'
    } catch {
      live = false
    }
    if (!live && FORCE) {
      throw new Error(`QORLITH_LIVE_SMOKE=1 but API not reachable at ${BASE}`)
    }
  })

  it('API health (or skip if down)', async () => {
    if (!live) {
      console.log(`[live.smoke] skip — no API at ${BASE}`)
      return
    }
    assert.equal(health.status, 200)
    assert.equal(health.body.ok, true)
    assert.equal(health.body.product, 'Qorlith')
  })

  it('produce pipelines list (live)', async () => {
    if (!live) return
    const { status, body } = await getJson('/api/produce/pipelines')
    assert.equal(status, 200)
    assert.ok(Array.isArray(body.pipelines))
    // v3 default should appear when using project config
    const ids = body.pipelines.map((p) => p.id)
    console.log(`[live.smoke] pipelines: ${ids.join(', ') || '(none)'}`)
    for (const p of body.pipelines) {
      assert.ok(p.id)
      assert.ok(typeof p.okCount === 'number')
      // okCount must never exceed shotlist total when known
      if (p.clipTotal != null && p.clipTotal > 0) {
        assert.ok(
          p.okCount <= p.clipTotal,
          `${p.id} okCount ${p.okCount} > clipTotal ${p.clipTotal}`,
        )
      }
    }
  })

  it('produce detail shape when a pack is registered (live)', async () => {
    if (!live) return
    const listed = await getJson('/api/produce/pipelines')
    const id = listed.body?.pipelines?.[0]?.id
    if (!id) {
      console.log('[live.smoke] no pipelines registered — ok')
      return
    }
    const { status, body } = await getJson(`/api/produce/${id}`)
    if (status === 404) {
      return
    }
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    const pipe = body.pipeline
    assert.ok(pipe)
    assert.ok(Array.isArray(pipe.clips))
    assert.ok(typeof pipe.done === 'number')
    assert.ok(typeof pipe.total === 'number')
    assert.ok(typeof pipe.percent === 'number')
    console.log(
      `[live.smoke] ${pipe.id} ${pipe.done}/${pipe.total} (${pipe.percent}%) active=${pipe.active} current=${pipe.currentClip || '—'}`,
    )
    // every clip must have UI-required fields
    for (const c of pipe.clips) {
      assert.ok(c.id)
      assert.ok(c.state)
      assert.ok('stillPickUrl' in c)
      assert.ok('videoUrl' in c)
    }
  })

  it('gallery list + facets (live, limit small)', async () => {
    if (!live) return
    const { status, body } = await getJson('/api/gallery?limit=20')
    assert.equal(status, 200)
    assert.ok(Array.isArray(body.images))
    assert.ok(typeof body.count === 'number')
    assert.ok(body.facets)
    assert.ok(Array.isArray(body.facets.projects))
    assert.ok(Array.isArray(body.facets.clips))
    console.log(
      `[live.smoke] gallery count=${body.count} projects=${body.facets.projects.length} clips=${body.facets.clips.length}`,
    )
  })

  it('gallery search C07 if any media exists (live)', async () => {
    if (!live) return
    const { status, body } = await getJson('/api/gallery?limit=10&q=C07')
    assert.equal(status, 200)
    // may be 0 if no C07 gens yet
    assert.ok(Array.isArray(body.images))
    if (body.count > 0) {
      assert.ok(body.images.every((i) => /C07/i.test(i.name) || i.clipId === 'C07' || /C07/i.test(i.rel || '')))
    }
  })

  it('floor status well-formed (live)', async () => {
    if (!live) return
    const { status, body } = await getJson('/api/floor/status')
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.ok(body.status)
    // progress optional when no produce overlay
    if (body.status.progress) {
      assert.ok(typeof body.status.progress.total === 'number' || body.status.progress.total == null)
    }
  })

  it('training status well-formed (live)', async () => {
    if (!live) return
    const { status, body } = await getJson('/api/status')
    assert.equal(status, 200)
    assert.equal(typeof body.trainingActive, 'boolean')
    assert.ok(body.polledAt)
  })

  it('system stats well-formed (live)', async () => {
    if (!live) return
    const { status, body } = await getJson('/api/system/stats')
    assert.equal(status, 200)
    assert.ok(body && typeof body === 'object')
  })

  it('config GET (live)', async () => {
    if (!live) return
    const { status, body } = await getJson('/api/config')
    assert.equal(status, 200)
    assert.ok(Array.isArray(body.comfyOutputRoots))
  })

  it('gallery facets + totalMatched (live)', async () => {
    if (!live) return
    const { status, body } = await getJson('/api/gallery?limit=5')
    assert.equal(status, 200)
    assert.ok(body.facets?.projects)
    assert.ok(typeof body.totalMatched === 'number')
    assert.ok(body.totalMatched >= body.count)
  })

  it('produce okCount aligns with unique clips (live v2/v3)', async () => {
    if (!live) return
    const { body } = await getJson('/api/produce/pipelines')
    for (const p of body.pipelines || []) {
      if (p.clipTotal == null) continue
      // multi-pass must not inflate above shotlist after fix
      assert.ok(p.okCount <= p.clipTotal, `${p.id}: ${p.okCount}/${p.clipTotal}`)
      if (p.extraOkCount) {
        console.log(`[live.smoke] ${p.id} extraOk=${p.extraOkCount} (outside shotlist)`)
      }
    }
  })
})
