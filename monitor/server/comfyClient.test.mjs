import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { queueIsBusy } from './comfyClient.mjs'

describe('comfy queue busy check', () => {
  it('is idle when both lists are empty', () => {
    assert.equal(queueIsBusy({ queue_running: [], queue_pending: [] }), false)
    assert.equal(queueIsBusy({}), false)
  })

  it('is busy when running or pending has work', () => {
    assert.equal(queueIsBusy({ queue_running: [[1]], queue_pending: [] }), true)
    assert.equal(queueIsBusy({ queue_running: [], queue_pending: [[2]] }), true)
  })
})
