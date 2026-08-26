import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clipJoinNote, clipPoster } from './studio.ts'

describe('clipJoinNote', () => {
  it('S01 is an open take; later clips continue or cut', () => {
    assert.equal(clipJoinNote(0, false), '')
    assert.equal(clipJoinNote(0, true), '')
    assert.equal(clipJoinNote(1, false), 'continues')
    assert.equal(clipJoinNote(1, true), 'cut')
    assert.equal(clipJoinNote(2, undefined), 'continues')
  })
})

describe('clipPoster', () => {
  it('T2V prefers the clip video over a last-frame still', () => {
    const clip = { still: '/board/S02_from_prev.png', video: '/video/S02.mp4' }
    assert.deepEqual(clipPoster(clip, 't2v'), { src: '/video/S02.mp4', kind: 'video' })
    assert.deepEqual(clipPoster(clip, 'stills'), { src: '/board/S02_from_prev.png', kind: 'image' })
    assert.deepEqual(clipPoster({ still: '/x.png' }, 't2v'), { src: '/x.png', kind: 'image' })
    assert.equal(clipPoster({}, 't2v'), null)
  })
})
