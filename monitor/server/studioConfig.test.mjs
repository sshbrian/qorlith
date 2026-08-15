import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clipDurationBounds, mergePlanner, loadStudio } from './studioConfig.mjs'
import { directorConfigFromApp } from './director.mjs'

describe('planner yaml', () => {
  it('overlays local model without dropping public url', () => {
    const p = mergePlanner(
      { url: 'http://127.0.0.1:1234/v1', model: '', prefer: [], temperature: 0.35 },
      { url: 'http://127.0.0.1:1234/v1', prefer: ['llama'] },
      { model: 'l3-8b-stheno-v3.2-iq-imatrix', temperature: 0.2 },
    )
    assert.equal(p.url, 'http://127.0.0.1:1234/v1')
    assert.equal(p.model, 'l3-8b-stheno-v3.2-iq-imatrix')
    assert.equal(p.temperature, 0.2)
    assert.deepEqual(p.prefer, ['llama'])
  })

  it('directorConfigFromApp exposes planner knobs', () => {
    const studio = loadStudio()
    const d = directorConfigFromApp()
    assert.ok(d.lmstudioBaseUrl.includes('1234'))
    assert.equal(typeof d.planModelKey, 'string')
    assert.equal(typeof d.temperature, 'number')
    assert.equal(typeof d.maxTokens, 'number')
    assert.equal(typeof d.plannerSystem, 'string')
    assert.equal(typeof d.plannerStyle, 'string')
    if (studio.planner.model) {
      assert.equal(d.planModelKey, studio.planner.model)
    }
  })

  it('loadStudio exposes still quality stack keys', () => {
    const s = loadStudio()
    assert.equal(typeof s.stills.quality, 'string')
    assert.equal(typeof s.stills.detailer, 'object')
    assert.equal(typeof s.stills.ipadapter, 'object')
    assert.equal(typeof s.stills.upscale, 'string')
  })

  it('clipDurationBounds reads yaml max 12', () => {
    const b = clipDurationBounds()
    assert.equal(b.max, 12)
    assert.ok(b.fallback >= 6)
    assert.ok(b.min >= 4)
  })
})
