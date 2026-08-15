import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveModelKey } from './lms.mjs'

describe('resolveModelKey', () => {
  const models = [
    {
      modelKey: 'mistral-small-3.2-24b-instruct-2506',
      path: 'unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF/x.gguf',
      displayName: 'Mistral Small',
    },
    {
      modelKey: 'preferred-chat',
      path: 'vendor/preferred-chat/x.gguf',
      displayName: 'Preferred Chat',
    },
    {
      modelKey: 'other-chat',
      path: 'vendor/other-chat/x.gguf',
      displayName: 'Other',
    },
  ]

  it('prefers the first matching yaml keyword', () => {
    const key = resolveModelKey(models, {
      prefer: ['preferred', 'other'],
    })
    assert.equal(key, 'preferred-chat')
  })

  it('uses exact modelKey', () => {
    const key = resolveModelKey(models, { modelKey: 'other-chat' })
    assert.equal(key, 'other-chat')
  })

  it('falls back to the first disk model when prefer is empty', () => {
    const key = resolveModelKey(models, { prefer: [] })
    assert.equal(key, 'mistral-small-3.2-24b-instruct-2506')
  })
})
