/**
 * Unit tests for produce.mjs (no HTTP server, no Comfy).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  getPipelineDetail,
  isPipelineActive,
  listPipelines,
  resolvePipelines,
  floorOverlayFromProduce,
  summarizeDoneMap,
} from './produce.mjs'

function mkPipelineFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-produce-'))
  const stillRoot = path.join(root, 'stills')
  const videoRoot = path.join(root, 'video')
  const c01 = path.join(stillRoot, 'C01')
  const c02 = path.join(stillRoot, 'C02')
  fs.mkdirSync(c01, { recursive: true })
  fs.mkdirSync(c02, { recursive: true })
  fs.mkdirSync(videoRoot, { recursive: true })

  fs.writeFileSync(path.join(c01, 'C01_PICK.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  fs.writeFileSync(path.join(c01, 'C01_p1_b00_hires_00001_.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  fs.writeFileSync(path.join(c02, 'C02_p1_b00_hires_00001_.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  fs.writeFileSync(path.join(videoRoot, 'C01_p1_00001_.mp4'), Buffer.from('fake'))

  const shotlistPath = path.join(root, 'shotlist.json')
  fs.writeFileSync(
    shotlistPath,
    JSON.stringify({
      song: 'Test Song',
      durationTargetSec: 24,
      clips: [
        { id: 'C01', title: 'intro', section: 'intro', mood: 'mood', t_start: 0, t_end: 8 },
        { id: 'C02', title: 'next', section: 'verse', mood: 'mood', t_start: 8, t_end: 16 },
        { id: 'C03', title: 'pending', section: 'verse', mood: 'action', t_start: 16, t_end: 24, gun_risk: true },
      ],
    }),
    'utf8',
  )

  const statusPath = path.join(root, 'status.json')
  fs.writeFileSync(
    statusPath,
    JSON.stringify({
      startedAt: '2026-08-04T00:00:00.000Z',
      updatedAt: new Date().toISOString(),
      config: { mp: 0.6, duration_default: 8 },
      done: {
        'p1:C01': {
          ok: true,
          still: path.join(c01, 'C01_PICK.png'),
          video: path.join(videoRoot, 'C01_p1_00001_.mp4'),
          at: '2026-08-04T01:00:00.000Z',
        },
      },
    }),
    'utf8',
  )

  const logPath = path.join(root, 'overnight.log')
  fs.writeFileSync(
    logPath,
    [
      '[2026-08-04 12:00:00] === overnight START ===',
      '[2026-08-04 12:00:01] SKIP done p1:C01',
      '[2026-08-04 12:00:02] === p1:C02 city_eyes gun=False ===',
      '[2026-08-04 12:00:03]   HERO stills ×8',
      '[2026-08-04 12:00:04]   hero [3/8] seed=1 queued abcd',
    ].join('\n'),
    'utf8',
  )

  const pipeline = {
    id: 'test_pipe',
    name: 'Test Pipe',
    statusPath,
    logPath,
    shotlistPath,
    stillRoot,
    videoRoot,
    song: 'Test Song',
  }

  return { root, pipeline }
}

describe('produce.mjs', () => {
  it('isPipelineActive false when pack complete even if log/status recent', () => {
    const now = new Date().toISOString()
    assert.equal(
      isPipelineActive({
        status: {
          updatedAt: now,
          finishedAt: now,
          heartbeat: { phase: 'wait_history', ts: now },
        },
        logStat: { mtimeMs: Date.now() },
        okCount: 9,
        clipTotal: 9,
        hasRunningClip: false,
      }),
      false,
    )
    assert.equal(
      isPipelineActive({
        status: { archived: true, updatedAt: now },
        logStat: { mtimeMs: Date.now() },
        okCount: 3,
        clipTotal: 9,
        hasRunningClip: true,
      }),
      false,
    )
    assert.equal(
      isPipelineActive({
        status: {
          heartbeat: { phase: 'i2va_wait', ts: now },
        },
        logStat: { mtimeMs: Date.now() },
        okCount: 2,
        clipTotal: 9,
        hasRunningClip: true,
      }),
      true,
    )
  })

  let fx
  before(() => {
    fx = mkPipelineFixture()
  })
  after(() => {
    try {
      fs.rmSync(fx.root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('resolvePipelines is empty until the user registers a pack', () => {
    const prev = process.env.QORLITH_PRODUCE_REGISTRY
    process.env.QORLITH_PRODUCE_REGISTRY = path.join(os.tmpdir(), `qorlith-empty-reg-${Date.now()}.json`)
    try {
      const pipes = resolvePipelines({})
      assert.equal(pipes.length, 0)
    } finally {
      if (prev === undefined) delete process.env.QORLITH_PRODUCE_REGISTRY
      else process.env.QORLITH_PRODUCE_REGISTRY = prev
    }
  })

  it('getPipelineDetail merges shotlist + status + files', () => {
    const detail = getPipelineDetail('test_pipe', { producePipelines: [fx.pipeline] })
    assert.ok(detail)
    assert.equal(detail.id, 'test_pipe')
    assert.equal(detail.total, 3)
    assert.equal(detail.done, 1)
    assert.ok(detail.percent > 30 && detail.percent < 35)

    const c01 = detail.clips.find((c) => c.id === 'C01')
    assert.ok(c01)
    assert.equal(c01.state, 'done')
    assert.ok(c01.stillPickUrl?.includes('/api/gallery/file'))
    assert.ok(c01.videoUrl?.includes('/api/gallery/file'))
    assert.equal(c01.title, 'intro')

    const c02 = detail.clips.find((c) => c.id === 'C02')
    assert.ok(c02)
    // has stills, no video
    assert.ok(['stills', 'video', 'face_qa', 'pending'].includes(c02.state))
    assert.ok(c02.stillCandidates.length >= 1)

    const c03 = detail.clips.find((c) => c.id === 'C03')
    assert.equal(c03.state, 'pending')
    assert.equal(c03.gun_risk, true)
  })

  it('listPipelines summarizes fixture when registered', () => {
    const list = listPipelines({ producePipelines: [fx.pipeline] })
    const row = list.find((p) => p.id === 'test_pipe')
    assert.ok(row)
    assert.equal(row.okCount, 1)
    assert.equal(row.clipTotal, 3)
    assert.equal(row.statusExists, true)
  })

  it('summarizeDoneMap counts unique clips not multi-pass keys', () => {
    const done = {
      'p1:C01': { ok: true, video: '/v/c01.mp4' },
      'p2:C01': { ok: true, video: '/v/c01b.mp4' },
      'p1:C02': { ok: true, video: '/v/c02.mp4' },
      'p1:C03': { ok: false, error: 'boom' },
      'p1:G01': { ok: true, video: '/v/g01.mp4' },
    }
    const raw = summarizeDoneMap(done, null)
    assert.equal(raw.okCount, 3) // C01, C02, G01 — not 4
    assert.equal(raw.failCount, 1)
    assert.equal(raw.passEntries, 5)

    const scoped = summarizeDoneMap(done, ['C01', 'C02', 'C03'])
    assert.equal(scoped.okCount, 2) // C01, C02 only
    assert.equal(scoped.failCount, 1)
    assert.equal(scoped.extraOkCount, 1)
    assert.deepEqual(scoped.extraOkClips, ['G01'])
  })

  it('listPipelines does not inflate okCount on multi-pass status', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-multipass-'))
    const statusPath = path.join(root, 'status.json')
    const shotlistPath = path.join(root, 'shotlist.json')
    fs.writeFileSync(
      shotlistPath,
      JSON.stringify({ clips: [{ id: 'C01' }, { id: 'C02' }] }),
      'utf8',
    )
    fs.writeFileSync(
      statusPath,
      JSON.stringify({
        done: {
          'p1:C01': { ok: true, video: 'a.mp4' },
          'p2:C01': { ok: true, video: 'b.mp4' },
          'p1:C02': { ok: true, video: 'c.mp4' },
          'p1:G01': { ok: true, video: 'g.mp4' },
        },
      }),
      'utf8',
    )
    const list = listPipelines({
      producePipelines: [
        {
          id: 'mp',
          name: 'Multi',
          statusPath,
          shotlistPath,
          logPath: path.join(root, 'nope.log'),
        },
      ],
    })
    const row = list.find((p) => p.id === 'mp')
    assert.equal(row.okCount, 2)
    assert.equal(row.clipTotal, 2)
    assert.equal(row.extraOkCount, 1)
    assert.ok(row.okCount <= row.clipTotal)
    const detail = getPipelineDetail('mp', {
      producePipelines: [
        {
          id: 'mp',
          name: 'Multi',
          statusPath,
          shotlistPath,
          logPath: path.join(root, 'nope.log'),
        },
      ],
    })
    assert.equal(detail.extraOkCount, 1)
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('floorOverlayFromProduce sets mission progress', () => {
    const detail = getPipelineDetail('test_pipe', { producePipelines: [fx.pipeline] })
    const base = {
      mood: 'idle',
      statusLine: 'standing by',
      song: 'old',
      friends: [],
      progress: { phase: 'idle', done: 0, total: 0, percent: 0 },
    }
    const over = floorOverlayFromProduce(detail, base)
    assert.equal(over.progress.total, 3)
    assert.equal(over.progress.done, 1)
    assert.ok(String(over.statusLine).includes('Test Pipe') || String(over.statusLine).includes('C0'))
    assert.ok(over.progress.percent > 0)
    assert.ok(over.friends.some((f) => f.name === 'All media' && f.blurb === 'library'))
    assert.ok(!over.friends.some((f) => f.name === 'Gallery'))
  })

  it('unknown pipeline returns null', () => {
    assert.equal(getPipelineDetail('nope', {}), null)
  })
})
