import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  defaultPlannerUrl,
  normalizePlannerProvider,
  plannerNeedsLms,
  resolvePlanner,
} from './plannerProvider.mjs'
import { generateMoviePlan, plannerSpec } from './studioPlanner.mjs'
import { ensureKitchenAttention, KITCHEN_ATTENTION } from './comfyVideo.mjs'

describe('planner providers', () => {
  it('maps grok/xai/lms aliases', () => {
    assert.equal(normalizePlannerProvider('grok'), 'xai')
    assert.equal(normalizePlannerProvider('lmstudio'), 'local')
    assert.equal(normalizePlannerProvider('import'), 'none')
    assert.equal(plannerNeedsLms('xai'), false)
    assert.equal(plannerNeedsLms('local'), true)
    assert.equal(defaultPlannerUrl('xai'), 'https://api.x.ai/v1')
  })

  it('resolvePlanner does not require LM Studio for remote or none', () => {
    const grok = resolvePlanner({ provider: 'xai', model: 'grok-4' })
    assert.equal(grok.provider, 'xai')
    assert.equal(grok.local, false)
    assert.equal(grok.needsKey, true)
    const none = resolvePlanner({ provider: 'none' })
    assert.equal(none.provider, 'none')
    assert.equal(plannerNeedsLms(none.provider), false)
  })
})

describe('imported movie plans', () => {
  it('validate and return without calling a model', async () => {
    const { plan, model, provider } = await generateMoviePlan({
      userPrompt: 'Ghost in the Shell 24s Motoko rooftop',
      plan: {
        title: 'Night Drop',
        lookTrack: 'anime',
        durationTargetSec: 24,
        characters: [{ id: 'S1', name: 'Motoko', look: 'adult woman, gitsstyl' }],
        clips: [
          {
            id: 'S01',
            durationSec: 12,
            stillBrief: '1girl, medium close-up, Motoko, gitsstyl, SMG, rain rooftop',
            motionBrief: 'The camera holds static as she fires.',
            dialogue: '',
            musicNote: 'sparse taiko and cello at moderate tempo',
          },
          {
            id: 'S02',
            durationSec: 12,
            cut: true,
            stillBrief: '1girl, Motoko, gitsstyl, alley, SMG',
            motionBrief: 'The camera holds as she finishes the mag.',
            dialogue: '',
            musicNote: 'sparse taiko and cello at moderate tempo',
          },
        ],
      },
    })
    assert.equal(model, 'imported')
    assert.equal(provider, 'none')
    assert.equal(plan.title, 'Night Drop')
    assert.equal(plan.clips.length, 2)
    assert.match(plan.clips[0].stillBrief, /gitsstyl/)
  })

  it('plannerSpec exposes schema for Grok bots', () => {
    const spec = plannerSpec()
    assert.equal(typeof spec.system, 'string')
    assert.match(spec.schema, /stillBrief/)
    assert.match(spec.howTo, /\/api\/studio\/plan/)
  })
})

describe('kitchen attention', () => {
  it('inserts ModelAttentionBackend on a bare MiniMax UNET graph', () => {
    const g = ensureKitchenAttention({
      '127': {
        class_type: 'UNETLoader',
        inputs: { unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors' },
      },
      '140': { class_type: 'BasicGuider', inputs: { model: ['127', 0] } },
    })
    const kitchen = Object.values(g).find((n) => n.class_type === 'ModelAttentionBackend')
    assert.ok(kitchen)
    assert.equal(kitchen.inputs.attention, KITCHEN_ATTENTION)
    assert.deepEqual(g['140'].inputs.model, [Object.keys(g).find((id) => g[id] === kitchen), 0])
  })

  it('rewrites an existing backend to kitchen', () => {
    const g = ensureKitchenAttention({
      '138': { class_type: 'ModelAttentionBackend', inputs: { model: ['127', 0], attention: 'sage' } },
    })
    assert.equal(g['138'].inputs.attention, KITCHEN_ATTENTION)
  })
})
