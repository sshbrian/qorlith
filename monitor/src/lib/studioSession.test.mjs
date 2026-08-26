import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  brainFingerprint,
  comfyFingerprint,
  idleBrainReport,
  projectsFingerprint,
  runIsLive,
} from './studioSession.ts'

describe('studio session fingerprints', () => {
  it('runIsLive follows the film run, not a single Comfy prompt', () => {
    assert.equal(runIsLive(null), false)
    assert.equal(runIsLive({ running: false }), false)
    assert.equal(runIsLive({ running: true }), true)
    assert.equal(runIsLive({ running: false, status: 'stills' }), true)
    assert.equal(runIsLive({ running: false, status: 'video' }), true)
    assert.equal(runIsLive({ running: false, status: 'face_qa' }), false)
    assert.equal(runIsLive({ running: false, status: 'done' }), false)
  })

  it('brain fingerprint ignores object identity and polled noise', () => {
    const a = {
      projectId: 'p',
      status: 'stills',
      step: 'stills',
      phase: 'still_wait',
      running: true,
      started: true,
      steps: [{ id: 'stills', state: 'active' }],
      clips: [{ id: 'S01', still: '/a.png' }],
      comfy: { active: true, kind: 'still', percent: 40, line: 'Step 4', title: 'Painting' },
    }
    const b = { ...a, clips: [{ ...a.clips[0] }], steps: [{ ...a.steps[0] }], comfy: { ...a.comfy } }
    assert.equal(brainFingerprint(a), brainFingerprint(b))
    assert.equal(
      brainFingerprint(a),
      brainFingerprint({ ...a, updatedAt: 't2', comfy: { ...a.comfy, percent: 41, line: 'Step 5' } }),
    )
    assert.notEqual(brainFingerprint(a), brainFingerprint({ ...a, running: false }))
    assert.notEqual(brainFingerprint(a), brainFingerprint({ ...a, videoMode: 't2v' }))
    assert.equal(brainFingerprint(null), '')
  })

  it('comfy fingerprint is stable across new objects', () => {
    const a = {
      connected: true,
      active: true,
      kind: 'video',
      title: 'Animating',
      line: 'Frame 10',
      percent: 12,
      value: 10,
      max: 80,
      queueRemaining: 0,
    }
    assert.equal(comfyFingerprint(a), comfyFingerprint({ ...a }))
    assert.notEqual(comfyFingerprint(a), comfyFingerprint({ ...a, active: false }))
    assert.equal(comfyFingerprint(null), '')
  })

  it('projects fingerprint tracks rail-visible fields', () => {
    const p = {
      id: 'p',
      title: 'Pier',
      status: 'approved',
      clipCount: 3,
      sceneCount: 3,
      okCount: 0,
      clipTotal: 3,
      active: true,
      approved: true,
      produceRegistered: true,
      archived: false,
      hasPlan: true,
      hasBoard: true,
      hasProduce: false,
      updatedAt: 't',
      stage: 'make',
    }
    assert.equal(projectsFingerprint([p]), projectsFingerprint([{ ...p }]))
    assert.notEqual(projectsFingerprint([p]), projectsFingerprint([{ ...p, active: false }]))
  })

  it('idle report is a stable empty document', () => {
    const idle = idleBrainReport('neon_pier_20')
    assert.equal(idle.status, 'idle')
    assert.equal(idle.clips.length, 0)
    assert.equal(idle.running, false)
  })
})
