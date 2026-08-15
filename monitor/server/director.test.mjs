import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  dryRunPlan,
  dryRunVideoPlan,
  parsePlanJson,
  sanitizePonyPositive,
  stripThinkTags,
  validatePlan,
} from './director.mjs'

describe('sanitizePonyPositive', () => {
  it('converts underscores and strips device meta', () => {
    const p = sanitizePonyPositive('blue_hair, short_hair, iPhone_portrait, (hero:1.2)')
    assert.ok(p.includes('blue hair'))
    assert.ok(!p.includes('blue_hair'))
    assert.ok(!/iphone/i.test(p))
    assert.ok(!p.includes('1.2'))
  })
})

describe('director parsePlanJson', () => {
  it('parses fenced json', () => {
    const o = parsePlanJson('```json\n{"positive":"a person standing","negative":""}\n```')
    assert.equal(o.positive.includes('person'), true)
  })

  it('strips think tags then parses', () => {
    const raw = '<think>planning the shots and considering Motoko</think>\n```json\n{"projectId":"ok","title":"T"}\n```'
    assert.match(stripThinkTags(raw), /projectId/)
    assert.doesNotMatch(stripThinkTags(raw), /<think>/)
    const o = parsePlanJson(raw)
    assert.equal(o.projectId, 'ok')
  })
})

describe('director validatePlan', () => {
  it('keeps user positive without inventing model tags', () => {
    const { plan } = validatePlan(
      {
        positive: '1girl, blue hair',
        negative: '',
        loras: [],
        controlnet: { enabled: true, type: 'canny', strength: 0.9 },
        sampler: {},
        size: { width: 768, height: 1344 },
      },
      { userText: 'phone portrait' },
    )
    assert.ok(plan.positive.includes('blue hair'))
    assert.equal(plan.loras.length, 0)
    assert.equal(plan.controlnet.enabled, false)
    assert.equal(plan.size.aspectRatio, '9:16')
  })

  it('keeps controlnet when user asks', () => {
    const { plan } = validatePlan(
      {
        positive: 'test',
        negative: '',
        loras: [],
        controlnet: { enabled: true, type: 'canny', strength: 0.55 },
        size: { width: 1280, height: 720 },
      },
      { userText: 'use controlnet canny guide' },
    )
    assert.equal(plan.controlnet.enabled, true)
    assert.equal(plan.controlnet.type, 'canny')
  })

  it('merges face and hand artifact negatives', () => {
    const { plan } = validatePlan({ positive: '1girl, standing', negative: '', loras: [] })
    assert.match(plan.negative, /extra eyes/)
    assert.match(plan.negative, /extra fingers/)
    assert.match(plan.negative, /deformed face/)
  })

  it('keeps ipadapter image on the plan', () => {
    const { plan } = validatePlan({
      positive: '1girl',
      negative: '',
      loras: [],
      ipadapter: { enabled: true, image: '/tmp/hero.png', weight: 0.8 },
    })
    assert.equal(plan.ipadapter.enabled, true)
    assert.equal(plan.ipadapter.image, '/tmp/hero.png')
    assert.equal(plan.ipadapter.weight, 0.8)
  })

  it('drops unknown loras not listed in yaml', () => {
    const { plan } = validatePlan({
      positive: 'x',
      negative: '',
      loras: [{ name: 'not-in-yaml.safetensors', strength_model: 1 }],
    })
    assert.equal(plan.loras.length, 0)
  })
})

describe('director dryRunPlan', () => {
  it('returns a usable plan', () => {
    const { plan } = dryRunPlan('blue hair', '9:16')
    assert.ok(plan.positive.includes('blue hair'))
    assert.equal(plan.size.width, 768)
  })
})

describe('director video plan', () => {
  it('dry-run is MiniMax H3 fields', () => {
    const { plan } = dryRunVideoPlan('slow head turn')
    assert.match(plan.motion, /head turn/i)
    assert.equal(plan.fps, 24)
    assert.ok(plan.durationSec >= 4)
  })

  it('does not attach motion LoRA packs', () => {
    const { plan } = dryRunVideoPlan('anything')
    assert.equal(plan.motionLoras, undefined)
  })
})
