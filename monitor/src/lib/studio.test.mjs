import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clipJoinNote } from './studio.ts'

describe('clipJoinNote', () => {
  it('S01 is an open take; later clips continue or cut', () => {
    assert.equal(clipJoinNote(0, false), '')
    assert.equal(clipJoinNote(0, true), '')
    assert.equal(clipJoinNote(1, false), 'continues')
    assert.equal(clipJoinNote(1, true), 'cut')
    assert.equal(clipJoinNote(2, undefined), 'continues')
  })
})
