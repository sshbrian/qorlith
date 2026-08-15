/**
 * Helpers for the 20s live LangGraph video run always execute.
 * The GPU run itself is opt-in: QORLITH_LIVE_VIDEO=1.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CLIP_DURATIONS,
  TARGET_SEC,
  clipSum,
  durationInBand,
  normalizePlanTo20,
} from '../scripts/live-video-20s.mjs'

describe('20s live video plan', () => {
  it('normalizes any plan to 3 clips totaling 20s', () => {
    const plan = normalizePlanTo20({
      title: 'X',
      clips: [
        { id: 'A', durationSec: 40, stillBrief: 'wide pier', motionBrief: 'walk' },
        { id: 'B', durationSec: 2 },
      ],
    })
    assert.equal(plan.durationTargetSec, TARGET_SEC)
    assert.equal(plan.lookTrack, 'anime')
    assert.deepEqual(
      plan.clips.map((c) => [c.id, c.durationSec, c.t_start, c.t_end]),
      [
        ['S01', 7, 0, 7],
        ['S02', 7, 7, 14],
        ['S03', 6, 14, 20],
      ],
    )
    assert.equal(clipSum(plan.clips), 20)
    assert.equal(plan.clips[0].stillBrief, 'wide pier')
    assert.ok(plan.clips[2].motionBrief)
    assert.deepEqual(CLIP_DURATIONS, [7, 7, 6])
  })

  it('accepts MiniMax rounding around 20s and rejects outliers', () => {
    assert.equal(durationInBand(20), true)
    assert.equal(durationInBand(21.167), true)
    assert.equal(durationInBand(18), true)
    assert.equal(durationInBand(24), true)
    assert.equal(durationInBand(17.9), false)
    assert.equal(durationInBand(24.1), false)
    assert.equal(durationInBand(NaN), false)
  })
})

describe('20s live LangGraph video (opt-in GPU)', { skip: process.env.QORLITH_LIVE_VIDEO !== '1' }, () => {
  it('makes a ~20s master through LangGraph', async () => {
    const { runLive } = await import('../scripts/live-video-20s.mjs')
    const result = await runLive()
    assert.equal(result.clips.length, 3)
    assert.ok(durationInBand(result.durationSec))
  })
})
