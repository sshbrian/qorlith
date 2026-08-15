import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  applyComfyEvent,
  classForNode,
  countLabel,
  decorateProgressForBrain,
  emptyState,
  etaLabel,
  kindForClass,
  parseComfyWsMessage,
  rememberPromptGraph,
  viewComfyProgress,
  wsUrlFromHttp,
  _resetComfyProgressForTests,
} from './comfyProgress.mjs'

describe('comfy progress', () => {
  beforeEach(() => _resetComfyProgressForTests())

  it('builds a ws url with the monitor client id', () => {
    const url = wsUrlFromHttp('http://127.0.0.1:8188')
    assert.equal(url, 'ws://127.0.0.1:8188/ws?clientId=qorlith-monitor')
  })

  it('parses json ws frames and ignores binary', () => {
    const msg = parseComfyWsMessage(JSON.stringify({ type: 'progress', data: { value: 3, max: 28 } }))
    assert.equal(msg.type, 'progress')
    assert.equal(parseComfyWsMessage(Buffer.from([1, 2, 3])), null)
  })

  it('tracks sampler steps and writes a human still view', () => {
    rememberPromptGraph('p1', { '3': { class_type: 'KSampler' } })
    let s = emptyState()
    s = applyComfyEvent(s, { type: 'execution_start', data: { prompt_id: 'p1' } })
    s = applyComfyEvent(s, { type: 'progress', data: { value: 10, max: 28, node: '3', prompt_id: 'p1' } })
    assert.equal(s.value, 10)
    assert.equal(s.max, 28)
    assert.equal(classForNode('p1', '3'), 'KSampler')
    const view = viewComfyProgress(s)
    assert.equal(view.active, true)
    assert.equal(view.kind, 'still')
    assert.equal(view.title, 'Painting the still')
    assert.match(view.line, /Step 10 of 28/)
    assert.ok(view.percent > 35 && view.percent < 36)
  })

  it('calls long video nodes by name, not by step count', () => {
    assert.equal(kindForClass('MiniMaxH3ImageToVideo', 168), 'video')
    assert.equal(countLabel(42, 168, 'video', 'MiniMaxH3ImageToVideo'), 'Frame 42 of 168')
    assert.equal(countLabel(18, 28, 'video', 'SamplerCustomAdvanced'), 'Step 18 of 28')
    rememberPromptGraph('v1', { '136': { class_type: 'MiniMaxH3ImageToVideo' } })
    let s = emptyState()
    s = applyComfyEvent(s, {
      type: 'progress',
      data: { value: 42, max: 168, node: '136', prompt_id: 'v1' },
    })
    const view = viewComfyProgress(s)
    assert.equal(view.title, 'Animating the clip')
    assert.match(view.line, /Frame 42 of 168/)
  })

  it('names the live clip from the brain report', () => {
    const view = decorateProgressForBrain(
      { active: true, kind: 'still', title: 'Painting the still', line: 'Step 4 of 28', hint: 'x' },
      {
        step: 'video',
        status: 'video',
        currentClip: 'S04',
        clips: [
          { id: 'S03', title: 'Harbor Encounter' },
          { id: 'S04', title: 'Rainy Pursuit' },
        ],
      },
    )
    assert.equal(view.title, 'Animating Rainy Pursuit')
    assert.match(view.line, /2 of 2/)
  })

  it('uses progress_state running node', () => {
    let s = emptyState()
    s = applyComfyEvent(s, {
      type: 'progress_state',
      data: {
        prompt_id: 'p2',
        nodes: {
          a: { value: 28, max: 28, state: 'finished' },
          b: { value: 4, max: 20, state: 'running' },
        },
      },
    })
    assert.equal(s.node, 'b')
    assert.equal(s.value, 4)
    assert.equal(s.max, 20)
  })

  it('shows a wait message when the queue is ahead and nothing is ticking', () => {
    let s = emptyState()
    s = applyComfyEvent(s, { type: 'status', data: { status: { exec_info: { queue_remaining: 2 } } } })
    const view = viewComfyProgress(s)
    assert.equal(view.active, true)
    assert.equal(view.title, 'Waiting for the GPU')
    assert.match(view.line, /more after the current/i)
  })

  it('estimates remaining time from tick rate', () => {
    const now = 1_000_000
    const s = {
      ...emptyState(),
      value: 10,
      max: 20,
      tickAt: now - 10_000,
      tickValue: 5,
    }
    const label = etaLabel(s, now)
    assert.equal(label, 'about 20 seconds left')
  })
})
