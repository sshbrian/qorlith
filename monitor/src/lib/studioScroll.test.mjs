import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SCROLL_KEY_PREFIX, scrollKey, shouldAdoptScroll, shouldRestoreScroll } from './studioScroll.ts'

describe('studio scroll keys', () => {
  it('namespaces each pathname', () => {
    assert.equal(scrollKey('/studio/daylight_ghost/make'), `${SCROLL_KEY_PREFIX}/studio/daylight_ghost/make`)
    assert.notEqual(scrollKey('/studio/a/make'), scrollKey('/studio/a/plan'))
    assert.equal(scrollKey(''), `${SCROLL_KEY_PREFIX}/`)
  })

  it('restores poll snaps to the top; a click is not a scroll', () => {
    assert.equal(shouldRestoreScroll(420, 0, false), true)
    assert.equal(shouldRestoreScroll(420, 0, true), false)
    assert.equal(shouldRestoreScroll(420, 380, false), false)
    assert.equal(shouldRestoreScroll(0, 0, false), false)
  })

  it('does not forget a pin when a poll jumps to 0 after a click', () => {
    assert.equal(shouldAdoptScroll(900, 0, false), false)
    assert.equal(shouldAdoptScroll(900, 0, true), true)
    assert.equal(shouldAdoptScroll(900, 640, false), true)
    assert.equal(shouldAdoptScroll(0, 200, false), true)
  })
})
