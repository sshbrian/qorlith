import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildVideoSystemPrompt,
  dryRunPlan,
  dryRunVideoPlan,
  parsePlanJson,
  sanitizePonyPositive,
  stripThinkTags,
  validatePlan,
  validateVideoPlan,
} from './director.mjs'
import { getLoraInventory } from './studioConfig.mjs'

describe('sanitizePonyPositive', () => {
  it('converts underscores and strips device meta', () => {
    const p = sanitizePonyPositive('blue_hair, short_hair, iPhone_portrait, (hero:1.2)')
    assert.ok(p.includes('blue hair'))
    assert.ok(!p.includes('blue_hair'))
    assert.ok(!/iphone/i.test(p))
    assert.ok(!p.includes('1.2'))
  })

  it('keeps source_anime across a second sanitize pass', () => {
    const once = sanitizePonyPositive('score_9, source_anime, 1girl, standing')
    const twice = sanitizePonyPositive(once)
    assert.match(twice, /source_anime/)
    assert.doesNotMatch(twice, /source anime/)
    assert.match(twice, /\bsolo\b/)
    assert.equal(twice, sanitizePonyPositive(twice))
  })

  it('only prepends gitsstyl when the brief or user text is GitS', () => {
    const inv = getLoraInventory()
    const hasGits = inv.some((l) => (l.triggers || []).includes('gitsstyl') || String(l.role) === 'gits')
    if (!hasGits) return
    const plain = sanitizePonyPositive('1girl, standing')
    assert.doesNotMatch(plain, /gitsstyl/)
    const fromUser = sanitizePonyPositive('1girl, standing', { userText: 'Ghost in the Shell Motoko' })
    assert.match(fromUser, /gitsstyl/)
    const fromBrief = sanitizePonyPositive('1girl, motoko, thermoptic bodysuit')
    assert.match(fromBrief, /gitsstyl/)
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
    assert.equal(plan.ipadapter.weight_type, 'ease out')
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

  it('keeps lookTrack, characters, and singing on a provided plan', () => {
    const { plan } = validateVideoPlan(
      {
        motion: 'he turns toward the counter',
        dialogue: '',
        music: 'N/A',
        lookTrack: 'live',
        characters: [
          { id: 'S1', name: 'Ben' },
          { id: 'S2', name: 'Cal' },
        ],
      },
      { userText: '24s kitchen argument, two adult men' },
    )
    assert.equal(plan.lookTrack, 'live')
    assert.equal(plan.characters[0].name, 'Ben')
    assert.equal(plan.allowSinging, false)
    const sung = validateVideoPlan({ motion: 'she hits the chorus' }, { userText: 'music video chorus' })
    assert.equal(sung.plan.allowSinging, true)
  })

  it('buildVideoSystemPrompt teaches official H3 markup', () => {
    const p = buildVideoSystemPrompt()
    assert.match(p, /<d>/)
    assert.match(p, /lookTrack/)
    assert.match(p, /Do not write \[Shot 1\]/)
    assert.match(p, /named instruments/)
    assert.match(p, /The start still IS frame 0/)
  })

  it('Straight to video director prompt is T2VA, not a start still', () => {
    const p = buildVideoSystemPrompt({ t2v: true })
    assert.match(p, /text-to-video-audio/)
    assert.match(p, /medium-wide shot frames/)
    assert.doesNotMatch(p, /The start still IS frame 0/)
    assert.doesNotMatch(p, /camera \+ body action only/)
    const cont = buildVideoSystemPrompt({ t2v: true, continueFromPrior: true })
    assert.match(cont, /The start still IS frame 0/)
    assert.match(cont, /camera \+ body action only/)
  })
})
