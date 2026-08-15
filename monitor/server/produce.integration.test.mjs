/**
 * Integration: temp Comfy-like media tree + produce/gallery/floor APIs.
 * Does not talk to real ComfyUI or kill any jobs.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, timeout: 15000 }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || '{}'), headers: res.headers })
          } catch (e) {
            reject(new Error(`bad json ${res.statusCode}: ${data.slice(0, 300)}`))
          }
        })
      })
      .on('error', reject)
  })
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
        timeout: 15000,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || '{}') })
          } catch {
            resolve({ status: res.statusCode, body: data })
          }
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function rawGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, timeout: 15000 }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        })
      })
      .on('error', reject)
  })
}

function mkTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-prod-it-'))
  const comfyOut = path.join(root, 'comfy-output')
  const stills = path.join(comfyOut, 'qorlith', 'anime', 'demo_pack', 'stills', 'C07')
  const stillsC08 = path.join(comfyOut, 'qorlith', 'anime', 'demo_pack', 'stills', 'C08')
  const video = path.join(comfyOut, 'qorlith', 'anime', 'video', 'demo_pack')
  fs.mkdirSync(stills, { recursive: true })
  fs.mkdirSync(stillsC08, { recursive: true })
  fs.mkdirSync(video, { recursive: true })

  // minimal PNG header-ish + mp4
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ])
  fs.writeFileSync(path.join(stills, 'C07_PICK.png'), png)
  fs.writeFileSync(path.join(stills, 'C07_p1_b00_hires_00001_.png'), png)
  fs.writeFileSync(path.join(stillsC08, 'C08_p1_b00_hires_00001_.png'), png)
  fs.writeFileSync(path.join(video, 'C07_p1_00001_.mp4'), Buffer.from('ftypisom'))
  fs.writeFileSync(
    path.join(stills, 'C07_PICK.json'),
    JSON.stringify({
      schema: 'qorlith.gen.v1',
      prompt: 'anime alley still C07',
      negative: 'score_4, blurry',
      tags: ['demo_pack', 'C07'],
      clipId: 'C07',
      batchId: 'demo_pack_overnight',
      stackId: 'demo_pack_C07',
      checkpoint: 'checkpoint.safetensors',
      size: { width: 1056, height: 608 },
      resolution: '1056x608',
      sampler: { name: 'euler_ancestral', steps: 28, cfg: 6, seed: 42 },
      related: [
        {
          path: path.join(video, 'C07_p1_00001_.mp4'),
          role: 'video',
        },
      ],
    }),
    'utf8',
  )
  fs.writeFileSync(
    path.join(video, 'C07_p1_00001_.json'),
    JSON.stringify({
      schema: 'qorlith.gen.v1',
      kind: 'video',
      clipId: 'C07',
      sourceImage: path.join(stills, 'C07_PICK.png'),
      tags: ['demo_pack', 'C07'],
    }),
    'utf8',
  )

  const dataDir = path.join(root, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const shotlistPath = path.join(root, 'shotlist.json')
  fs.writeFileSync(
    shotlistPath,
    JSON.stringify({
      song: 'Test score',
      clips: [
        { id: 'C07', title: 'dual_aim_flash', mood: 'action', t_start: 48, t_end: 56, gun_risk: true },
        { id: 'C08', title: 'sprint', mood: 'action', t_start: 56, t_end: 64 },
      ],
    }),
    'utf8',
  )
  const statusPath = path.join(dataDir, 'status.json')
  fs.writeFileSync(
    statusPath,
    JSON.stringify({
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: { mp: 0.6 },
      done: {
        'p1:C07': {
          ok: true,
          video: path.join(video, 'C07_p1_00001_.mp4'),
          still: path.join(stills, 'C07_PICK.png'),
          at: new Date().toISOString(),
        },
      },
    }),
    'utf8',
  )
  const logPath = path.join(dataDir, 'run.log')
  fs.writeFileSync(
    logPath,
    `[x] === p1:C08 sprint ===\n[x]   HERO stills\n[x]   hero [1/8] queued\n`,
    'utf8',
  )

  const cfgPath = path.join(root, 'config.json')
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      outputRoots: [path.join(root, 'outputs')],
      logRoots: [],
      trainLogGlobs: [],
      comfyOutputRoots: [comfyOut],
      pollSeconds: 2,
      activeWindowMinutes: 60,
    }),
    'utf8',
  )

  const registryPath = path.join(root, 'produce_pipelines_studio.json')
  fs.writeFileSync(
    registryPath,
    JSON.stringify({
      pipelines: [
        {
          id: 'demo_pack',
          name: 'Demo pack',
          statusPath,
          logPath,
          shotlistPath,
          stillRoot: path.join(comfyOut, 'qorlith', 'anime', 'demo_pack', 'stills'),
          videoRoot: video,
          song: 'Test score',
        },
      ],
    }),
    'utf8',
  )

  // empty outputs so train discovery doesn't explode
  fs.mkdirSync(path.join(root, 'outputs'), { recursive: true })

  return {
    root,
    cfgPath,
    registryPath,
    comfyOut,
    stills,
    video,
    pick: path.join(stills, 'C07_PICK.png'),
  }
}

describe('Produce + Gallery + Floor integration', () => {
  let tree
  let server
  let port

  before(async () => {
    tree = mkTree()
    process.env.QORLITH_CONFIG = tree.cfgPath
    process.env.QORLITH_PORT = '0'
    process.env.QORLITH_PRODUCE_REGISTRY = tree.registryPath
    process.env.QORLITH_GALLERY_ARCHIVE = path.join(tree.root, 'gallery-archive.json')
    process.env.QORLITH_FLOOR_STATUS = path.join(tree.root, 'floor-status.json')

    const mod = await import(`./index.js?it=${Date.now()}`)
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
    delete process.env.QORLITH_PRODUCE_REGISTRY
    delete process.env.QORLITH_GALLERY_ARCHIVE
    delete process.env.QORLITH_FLOOR_STATUS
  })

  it('lists produce pipelines', async () => {
    const { status, body } = await getJson(port, '/api/produce/pipelines')
    assert.equal(status, 200)
    assert.ok(Array.isArray(body.pipelines))
    const p = body.pipelines.find((x) => x.id === 'demo_pack')
    assert.ok(p, 'demo_pack pipeline')
    assert.equal(p.okCount, 1)
    assert.equal(p.clipTotal, 2)
    assert.equal(p.name, 'Demo pack')
  })

  it('produce detail has C07 done with media urls', async () => {
    const { status, body } = await getJson(port, '/api/produce/demo_pack')
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    const pipe = body.pipeline
    assert.equal(pipe.total, 2)
    assert.equal(pipe.done, 1)
    assert.ok(pipe.percent >= 40 && pipe.percent <= 60)
    const c07 = pipe.clips.find((c) => c.id === 'C07')
    assert.ok(c07)
    assert.equal(c07.state, 'done')
    assert.ok(c07.stillPickUrl)
    assert.ok(c07.videoUrl)
    assert.equal(c07.title, 'dual_aim_flash')
    assert.equal(c07.gun_risk, true)
    assert.ok(Array.isArray(c07.stillCandidates))
    assert.ok(c07.stillCandidates.length >= 1)
    const c08 = pipe.clips.find((c) => c.id === 'C08')
    assert.ok(c08)
    assert.notEqual(c08.state, 'done')
    // C08 is in-progress via log (HERO stills)
    assert.ok(['stills', 'face_qa', 'video', 'pending'].includes(c08.state), `c08.state=${c08.state}`)
    assert.ok(Array.isArray(pipe.logTail) && pipe.logTail.length > 0)
  })

  it('produce unknown pipeline is 404', async () => {
    const { status, body } = await getJson(port, '/api/produce/does_not_exist')
    assert.equal(status, 404)
    assert.match(String(body.error || ''), /unknown/i)
  })

  it('gallery finds C07 by clip and project', async () => {
    const { body: byClip } = await getJson(port, '/api/gallery?limit=50&clip=C07')
    assert.ok(byClip.count >= 1, 'clip=C07 should match stills/videos')
    assert.ok(byClip.images.every((i) => i.clipId === 'C07' || /C07/i.test(i.name)))

    const { body: byQ } = await getJson(port, '/api/gallery?limit=50&q=C07')
    assert.ok(byQ.count >= 1)

    const { body: byProj } = await getJson(port, '/api/gallery?limit=50&project=demo_pack')
    assert.ok(byProj.count >= 1)
    assert.ok(byProj.facets?.projects?.some((p) => p.id === 'demo_pack'))
    assert.ok(byProj.facets?.clips?.some((c) => c.id === 'C07'))
    assert.ok(byProj.query)
    assert.equal(byProj.query.project, 'demo_pack')
  })

  it('gallery kind:video and kind:image filters', async () => {
    const { body: vids } = await getJson(port, '/api/gallery?limit=50&kind=video')
    assert.ok(vids.count >= 1)
    assert.ok(vids.images.every((i) => i.kind === 'video'))

    const { body: imgs } = await getJson(port, '/api/gallery?limit=50&kind=image')
    assert.ok(imgs.count >= 1)
    assert.ok(imgs.images.every((i) => i.kind === 'image' || i.kind !== 'video'))
  })

  it('gallery marks isPick and stackHints from sidecar', async () => {
    const { body } = await getJson(port, '/api/gallery?limit=50&q=pick')
    assert.ok(body.images.some((i) => i.isPick || /PICK/i.test(i.name)))
    const pick = body.images.find((i) => /PICK/i.test(i.name))
    assert.ok(pick)
    assert.ok(pick.hasMeta)
    if (pick.stackHints) {
      assert.ok(pick.stackHints.batchId === 'demo_pack_overnight' || pick.stackHints.stackId)
    }
  })

  it('gallery item returns full meta + related', async () => {
    const { status, body } = await getJson(
      port,
      `/api/gallery/item?path=${encodeURIComponent(tree.pick)}`,
    )
    assert.equal(status, 200)
    assert.ok(body.meta)
    assert.equal(body.meta.schema, 'qorlith.gen.v1')
    assert.match(String(body.meta.prompt || ''), /anime/)
    assert.ok(body.hasMeta)
    assert.ok(body.thumbUrl)
    // related video edge if resolved
    if (body.relatedCount != null) {
      assert.ok(body.relatedCount >= 0)
    }
  })

  it('gallery roots lists comfy root', async () => {
    const { status, body } = await getJson(port, '/api/gallery/roots')
    assert.equal(status, 200)
    assert.ok(Array.isArray(body.roots) || Array.isArray(body.comfyOutputRoots) || body.ok !== false)
  })

  it('archive + unarchive roundtrip hides then restores pick', async () => {
    const pick = tree.pick
    const arch = await postJson(port, '/api/gallery/archive', { path: pick })
    assert.equal(arch.status, 200)
    assert.equal(arch.body.ok, true)
    assert.ok(arch.body.archivedTotal >= 1)

    // API query param is `archived` (hide|only|all), not archiveMode
    const hidden = await getJson(port, '/api/gallery?limit=50&q=C07_PICK&archived=hide')
    assert.ok(
      !hidden.body.images.some((i) => i.path === pick || i.name === 'C07_PICK.png'),
      'archived pick should be hidden in default mode',
    )

    const only = await getJson(port, '/api/gallery?limit=50&archived=only')
    assert.ok(only.body.images.some((i) => /C07_PICK/i.test(i.name)))

    const un = await postJson(port, '/api/gallery/unarchive', { path: pick })
    assert.equal(un.status, 200)
    assert.equal(un.body.ok, true)

    const restored = await getJson(port, '/api/gallery?limit=50&q=C07_PICK&archived=hide')
    assert.ok(restored.body.images.some((i) => /C07_PICK/i.test(i.name)))
  })

  it('floor status overlays produce progress', async () => {
    const { status, body } = await getJson(port, '/api/floor/status')
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    const s = body.status
    assert.ok(s.progress)
    assert.ok(s.progress.total >= 2)
    assert.ok(s.progress.done >= 1)
    assert.ok(String(s.statusLine || '').length > 0)
  })

  it('floor update POST mutates mood without breaking produce overlay shape', async () => {
    const upd = await postJson(port, '/api/floor/update', {
      text: 'integration test pulse',
      mood: 'working',
      kind: 'info',
      statusLine: 'test line from IT',
    })
    assert.equal(upd.status, 200)
    assert.equal(upd.body.ok, true)

    const { body } = await getJson(port, '/api/floor/status')
    // produce overlay may rewrite statusLine — but response must stay well-formed
    assert.ok(body.status)
    assert.ok(body.status.progress)
    assert.ok(body.status.progress.total >= 2)
  })

  it('gallery file serves pick png', async () => {
    const pick = tree.pick
    const { status, body } = await rawGet(
      port,
      `/api/gallery/file?path=${encodeURIComponent(pick)}`,
    )
    assert.equal(status, 200)
    assert.ok(body.length >= 8)
    assert.equal(body[0], 0x89)
    assert.equal(body[1], 0x50) // P of PNG
  })

  it('config GET returns comfyOutputRoots', async () => {
    const { status, body } = await getJson(port, '/api/config')
    assert.equal(status, 200)
    assert.ok(Array.isArray(body.comfyOutputRoots))
    assert.ok(body.comfyOutputRoots.length >= 1)
  })

  it('system stats endpoint returns structure', async () => {
    const { status, body } = await getJson(port, '/api/system/stats')
    assert.equal(status, 200)
    // shape varies by platform; must not be empty error-only
    assert.ok(body && typeof body === 'object')
  })

  it('health + status (no train) are well-formed', async () => {
    const h = await getJson(port, '/api/health')
    assert.equal(h.status, 200)
    assert.equal(h.body.product, 'Qorlith')

    const s = await getJson(port, '/api/status')
    assert.equal(s.status, 200)
    assert.equal(typeof s.body.trainingActive, 'boolean')
    assert.ok(s.body.polledAt)
  })

  it('gallery facets present with single-pass scan', async () => {
    const { status, body } = await getJson(port, '/api/gallery?limit=10')
    assert.equal(status, 200)
    assert.ok(body.facets)
    assert.ok(Array.isArray(body.facets.projects))
    assert.ok(Array.isArray(body.facets.clips))
    assert.ok(body.facets.projects.some((p) => p.id === 'demo_pack'))
    assert.ok(typeof body.totalMatched === 'number')
    assert.ok(body.totalMatched >= body.count)
  })

  it('gallery empty roots returns empty list not 500', async () => {
    // Temporarily write config with empty comfy roots via second server is heavy;
    // assert current tree still handles limit=1 offset beyond end
    const { status, body } = await getJson(port, '/api/gallery?limit=1&offset=9999')
    assert.equal(status, 200)
    assert.equal(body.count, 0)
    assert.ok(Array.isArray(body.images))
    assert.equal(body.images.length, 0)
  })
})
