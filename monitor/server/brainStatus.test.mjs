import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { describe, it } from 'node:test'
import {
  floorOverlayFromBrain,
  idleBrain,
  killBrainPid,
  markBrainStopped,
  statusLabel,
  stopBrain,
  viewBrain,
} from './brainStatus.mjs'

describe('brain status view', () => {
  it('idle graph has seven waiting steps', () => {
    const idle = idleBrain('harbor')
    assert.equal(idle.started, false)
    assert.equal(idle.steps.length, 7)
    assert.ok(idle.steps.every((s) => s.state === 'idle'))
  })

  it('idle t2v graph skips pictures', () => {
    const idle = idleBrain('harbor', { videoMode: 't2v' })
    assert.equal(idle.videoMode, 't2v')
    assert.deepEqual(
      idle.steps.map((s) => s.id),
      ['health', 'plan', 'video', 'free', 'finish'],
    )
    const view = viewBrain(
      {
        projectId: 'harbor',
        status: 'video',
        step: 'video',
        videoMode: 't2v',
        steps: [
          { id: 'health', state: 'done' },
          { id: 'plan', state: 'done' },
          { id: 'stills', state: 'done' },
          { id: 'face_qa', state: 'done' },
          { id: 'video', state: 'active' },
        ],
      },
      'harbor',
    )
    assert.deepEqual(
      view.steps.map((s) => s.id),
      ['health', 'plan', 'video'],
    )
    assert.equal(view.label, 'Making clips')
  })

  it('keeps clip briefs on the public view', () => {
    const view = viewBrain(
      {
        projectId: 'harbor',
        status: 'video',
        step: 'video',
        videoMode: 't2v',
        clips: [
          {
            id: 'S01',
            title: 'open',
            durationSec: 12,
            motionBrief: 'a medium-wide shot frames a neon alley.',
            stillBrief: 'neon alley',
          },
        ],
      },
      'harbor',
    )
    assert.equal(view.clips[0].title, 'open')
    assert.equal(view.clips[0].motionBrief, 'a medium-wide shot frames a neon alley.')
    assert.equal(view.clips[0].stillBrief, 'neon alley')
  })

  it('reads a live v1 report', () => {
    const view = viewBrain(
      {
        schema: 'qorlith.brain.v1',
        projectId: 'harbor',
        status: 'stills',
        step: 'stills',
        clips: [{ id: 'S01', title: 'Approach', still: '/tmp/a.png' }],
        steps: [
          { id: 'health', label: 'Health', state: 'done' },
          { id: 'plan', label: 'Plan', state: 'done' },
          { id: 'stills', label: 'Stills', state: 'active' },
        ],
      },
      'harbor',
    )
    assert.equal(view.started, true)
    assert.equal(view.clips[0].still, '/tmp/a.png')
    assert.equal(view.steps[2].state, 'active')
  })

  it('keeps step timings for the graph', () => {
    const view = viewBrain(
      {
        projectId: 'harbor',
        status: 'stills',
        step: 'stills',
        timings: { stills: { startedAt: '2026-08-14T12:00:00.000Z', seconds: 4 } },
        graph: { nodes: [{ id: 'stills', label: 'Pictures', state: 'active' }], edges: [] },
      },
      'harbor',
    )
    assert.equal(view.timings.stills.seconds, 4)
    assert.equal(view.graph.nodes[0].id, 'stills')
  })

  it('upgrades a finish-only report', () => {
    const view = viewBrain(
      {
        projectId: 'harbor',
        title: 'Harbor',
        status: 'done',
        clips: [{ id: 'S01', still: '/a.png', video: '/a.mp4' }],
      },
      'harbor',
    )
    assert.equal(view.step, 'finish')
    assert.ok(view.steps.every((s) => s.state === 'done'))
  })

  it('labels a plan-only stop as plan ready', () => {
    const view = viewBrain(
      {
        projectId: 'harbor',
        status: 'stills',
        step: 'stills',
        stopAfter: 'plan',
      },
      'harbor',
    )
    assert.equal(statusLabel(view), 'Plan ready')
    const rebuilt = viewBrain(
      {
        projectId: 'harbor',
        status: 'stills',
        step: 'stills',
        stopAfter: 'plan',
        steps: undefined,
      },
      'harbor',
    )
    assert.equal(rebuilt.steps.find((s) => s.id === 'plan')?.state, 'done')
    assert.equal(rebuilt.steps.find((s) => s.id === 'stills')?.state, 'idle')
  })

  it('labels a stopped report', () => {
    const view = viewBrain({ projectId: 'harbor', status: 'stopped', step: 'stills' }, 'harbor')
    assert.equal(statusLabel(view), 'Stopped')
    assert.equal(view.master, null)
  })

  it('keeps a master path', () => {
    const view = viewBrain(
      { projectId: 'harbor', status: 'done', master: '/tmp/harbor/master.mp4' },
      'harbor',
    )
    assert.equal(view.master, '/tmp/harbor/master.mp4')
  })

  it('killBrainPid terminates a child process', () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    })
    const result = killBrainPid(child.pid, { waitMs: 1500 })
    child.unref()
    assert.equal(result.killed, true)
  })

  it('markBrainStopped rewrites a live report', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-brain-'))
    const prev = process.env.QORLITH_PROJECTS
    process.env.QORLITH_PROJECTS = root
    try {
      const dir = path.join(root, 'harbor')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'brain.json'),
        JSON.stringify({
          projectId: 'harbor',
          status: 'stills',
          step: 'stills',
          steps: [{ id: 'stills', label: 'Stills', state: 'active' }],
        }),
      )
      markBrainStopped('harbor')
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'brain.json'), 'utf8'))
      assert.equal(raw.status, 'stopped')
      assert.equal(raw.steps[0].state, 'idle')
    } finally {
      if (prev == null) delete process.env.QORLITH_PROJECTS
      else process.env.QORLITH_PROJECTS = prev
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('stopBrain refuses when no process is running', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-brain-'))
    const prev = process.env.QORLITH_PROJECTS
    process.env.QORLITH_PROJECTS = root
    try {
      assert.throws(() => stopBrain('harbor'), (err) => err.code === 'brain_not_running')
    } finally {
      if (prev == null) delete process.env.QORLITH_PROJECTS
      else process.env.QORLITH_PROJECTS = prev
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('floor overlay prefers brain clip counts and human label', () => {
    const view = viewBrain(
      {
        projectId: 'harbor',
        title: 'Harbor',
        status: 'video',
        step: 'video',
        currentClip: 'S02',
        clips: [
          { id: 'S01', video: '/a.mp4' },
          { id: 'S02', still: '/b.png' },
        ],
      },
      'harbor',
    )
    view.running = true
    view.label = statusLabel(view)
    const over = floorOverlayFromBrain(view, {
      statusLine: 'Idle',
      mood: 'idle',
      progress: {},
    })
    assert.equal(over.progress.project, 'harbor')
    assert.equal(over.progress.done, 1)
    assert.equal(over.progress.total, 2)
    assert.equal(over.progress.currentShot, 'S02')
    assert.equal(over.progress.phase, 'motion')
    assert.match(over.statusLine, /Animating|Running|video/i)
    assert.ok(over.friends.some((f) => f.name === 'Board'))
  })

  it('floor overlay skips Board on Straight to video', () => {
    const view = viewBrain(
      {
        projectId: 'harbor',
        title: 'Harbor',
        status: 'video',
        step: 'video',
        videoMode: 't2v',
        clips: [{ id: 'S01' }],
      },
      'harbor',
    )
    view.running = true
    const over = floorOverlayFromBrain(view, { statusLine: 'Idle', mood: 'idle', progress: {} })
    assert.ok(!over.friends.some((f) => f.name === 'Board'))
    assert.ok(over.friends.some((f) => f.name === 'Watch'))
  })
})
