import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fail, toErrorBody } from './errors.mjs'
import { formatLine } from './log.mjs'
import { requireCheckpoint, requireComfyRoot, getCheckpoint, getComfyRoot } from './studioConfig.mjs'

describe('fail()', () => {
  it('throws a status, code, message, and hint', () => {
    try {
      fail(400, 'missing_checkpoint', 'Set stills.checkpoint in qorlith.yaml', {
        hint: 'Edit qorlith.yaml or qorlith.local.yaml, then retry.',
      })
      assert.fail('should have thrown')
    } catch (e) {
      assert.equal(e.status, 400)
      assert.equal(e.code, 'missing_checkpoint')
      assert.match(e.message, /stills\.checkpoint/)
      assert.match(e.hint, /qorlith\.yaml/)
      const body = toErrorBody(e)
      assert.equal(body.ok, false)
      assert.equal(body.code, 'missing_checkpoint')
      assert.equal(body.hint, e.hint)
    }
  })
})

describe('yaml failures name the file to edit', () => {
  it('refuses a still without a checkpoint', () => {
    if (getCheckpoint()) return
    try {
      requireCheckpoint()
      assert.fail('should have thrown')
    } catch (e) {
      assert.equal(e.status, 400)
      assert.equal(e.code, 'missing_checkpoint')
      assert.match(e.message, /stills\.checkpoint/)
      assert.match(String(e.hint), /qorlith\.yaml/)
    }
  })

  it('refuses Comfy IO without comfy.root', () => {
    if (getComfyRoot()) return
    try {
      requireComfyRoot()
      assert.fail('should have thrown')
    } catch (e) {
      assert.equal(e.status, 400)
      assert.equal(e.code, 'missing_comfy_root')
      assert.match(e.message, /comfy\.root/)
      assert.match(String(e.hint), /qorlith\.yaml/)
    }
  })
})

describe('log format', () => {
  it('writes one JSON line with event name', () => {
    const line = formatLine('info', 'comfy.queue', { promptId: 'abc' })
    const row = JSON.parse(line)
    assert.equal(row.level, 'info')
    assert.equal(row.event, 'comfy.queue')
    assert.equal(row.promptId, 'abc')
    assert.ok(row.t)
  })
})
