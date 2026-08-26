import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyHouseLockToMotionBrief,
  applyHouseLockToPlan,
  applyHouseLockToStillBrief,
} from './gitsLock.mjs'

const LOCK = {
  name: 'Motoko',
  look: 'adult woman, the Major Motoko Kusanagi, short dark violet-black hair, gitsstyl',
}

describe('gitsLock', () => {
  it('applyHouseLockToMotionBrief inserts look after the shot sentence', () => {
    const next = applyHouseLockToMotionBrief(
      'a medium-wide shot frames a rain-wet rooftop. The camera holds static as the lead strikes.',
      LOCK,
    )
    assert.match(next, /^a medium-wide shot frames a rain-wet rooftop\. Motoko, adult woman/)
    assert.match(next, /gitsstyl/)
    assert.match(next, /the lead strikes/)
    assert.doesNotMatch(next, /\b1girl\b/)
    assert.equal(applyHouseLockToMotionBrief(next, LOCK), next)
  })

  it('applyHouseLockToMotionBrief prepends when there is no shot opener', () => {
    const next = applyHouseLockToMotionBrief('The camera holds static as she raises the SMG.', LOCK)
    assert.match(next, /^Motoko, adult woman/)
    assert.match(next, /The camera holds static as she raises the SMG\./)
  })

  it('applyHouseLockToPlan only rewrites motionBrief in t2v', () => {
    const motion = 'The camera holds static as the lead strikes.'
    const stills = applyHouseLockToPlan(
      {
        videoMode: 'stills',
        characters: [{ id: 'S1', name: 'Lead', look: 'adult woman' }],
        clips: [{ id: 'S01', stillBrief: 'rain-wet rooftop', motionBrief: motion }],
      },
      'Ghost in the Shell rooftop with the Major Motoko',
      [],
    )
    assert.equal(stills.clips[0].motionBrief, motion)
    assert.match(stills.clips[0].stillBrief, /gitsstyl/)

    const warnings = []
    const t2v = applyHouseLockToPlan(
      {
        videoMode: 't2v',
        characters: [{ id: 'S1', name: 'Lead', look: 'adult woman' }],
        clips: [
          {
            id: 'S01',
            stillBrief: 'rain-wet rooftop',
            motionBrief: 'a medium-wide shot frames a rain-wet rooftop. The camera holds static as the lead strikes.',
          },
        ],
      },
      'Ghost in the Shell rooftop with the Major Motoko',
      warnings,
    )
    assert.match(t2v.clips[0].motionBrief, /Motoko/)
    assert.match(t2v.clips[0].motionBrief, /gitsstyl/)
    assert.equal(t2v.clips[0].stillBrief, 'rain-wet rooftop')
    assert.doesNotMatch(t2v.clips[0].stillBrief, /1girl/)
    assert.match(t2v.characters[0].look, /gitsstyl/)
    assert.equal(t2v.characters[0].name, 'Motoko')
    assert.ok(warnings.some((w) => /motionBrief for house lock/i.test(w)))
    const chain = applyHouseLockToPlan(
      {
        videoMode: 't2v',
        characters: [{ id: 'S1', name: 'Lead', look: 'adult woman' }],
        clips: [
          {
            id: 'S01',
            motionBrief: 'a medium-wide shot frames a rain-wet rooftop. The camera holds static as the lead strikes.',
          },
          { id: 'S02', cut: false, motionBrief: 'The camera holds static as the chase continues.' },
        ],
      },
      'Ghost in the Shell rooftop with the Major Motoko',
      [],
    )
    assert.match(chain.clips[0].motionBrief, /gitsstyl/)
    assert.equal(chain.clips[1].motionBrief, 'The camera holds static as the chase continues.')
  })

  it('applyHouseLockToStillBrief stays tag-shaped', () => {
    const next = applyHouseLockToStillBrief('rain-wet rooftop, neon', LOCK.look)
    assert.match(next, /^1girl, solo, adult woman/)
    assert.match(next, /gitsstyl/)
  })
})
