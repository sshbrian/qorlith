import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isEmptyBrain, preferHeld, rememberBrain } from './brainHold.ts'

describe('brain hold', () => {
  it('treats idle no-clip reports as empty', () => {
    assert.equal(isEmptyBrain(null), true)
    assert.equal(isEmptyBrain({ status: 'idle', started: false, clips: [] }), true)
    assert.equal(isEmptyBrain({ status: 'video', started: true, clips: [] }), false)
    assert.equal(isEmptyBrain({ status: 'idle', started: false, clips: [{ id: 'S01' }] }), false)
  })

  it('keeps a live report when the next poll is empty idle', () => {
    const live = {
      projectId: 'night_drop',
      status: 'video',
      started: true,
      running: true,
      clips: [{ id: 'S01', still: '/a.png' }],
    }
    rememberBrain('night_drop', live)
    const held = preferHeld('night_drop', { status: 'idle', started: false, clips: [] })
    assert.equal(held.status, 'video')
    assert.equal(held.clips.length, 1)
  })
})
