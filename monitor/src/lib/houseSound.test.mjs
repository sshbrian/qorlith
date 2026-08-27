import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { housePin, houseWhoosh } from './houseSound.ts'

describe('house sound', () => {
  it('is silent without a window and does not throw', () => {
    assert.equal(typeof houseWhoosh, 'function')
    assert.equal(typeof housePin, 'function')
    houseWhoosh()
    housePin()
  })
})
