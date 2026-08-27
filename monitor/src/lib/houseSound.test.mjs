import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { houseLights, housePin, houseWhoosh, readHouseMute, syncHouseQuiet, toggleHouseMute, writeHouseMute } from './houseSound.ts'

describe('house sound', () => {
  it('is silent without a window and does not throw', () => {
    assert.equal(typeof houseWhoosh, 'function')
    assert.equal(typeof housePin, 'function')
    assert.equal(typeof houseLights, 'function')
    houseWhoosh()
    housePin()
    houseLights()
    syncHouseQuiet()
    writeHouseMute(false)
    assert.equal(readHouseMute(), false)
    toggleHouseMute()
    writeHouseMute(false)
  })
})
