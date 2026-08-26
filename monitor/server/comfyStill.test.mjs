import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  applyQualityLoras,
  buildStillGraph,
  controlNetModelForType,
  QUALITY_PRESETS,
  queueStillAndWait,
  resolveDetailerConfig,
  resolveIpadapterConfig,
} from './comfyStill.mjs'
import { getCheckpoint, requireCheckpoint, requireComfyRoot } from './studioConfig.mjs'

describe('comfyStill yaml contract', () => {
  it('does not invent LoRA filenames', () => {
    const out = applyQualityLoras({ positive: 'a person', loras: [] }, 'standard')
    assert.deepEqual(out.loras, [])
  })

  it('quality presets have no leftover pack fields', () => {
    for (const q of Object.values(QUALITY_PRESETS)) {
      assert.equal('gitsStrength' in q, false)
    }
  })

  it('ControlNet filenames come from yaml (empty until the user fills them)', () => {
    assert.equal(typeof controlNetModelForType('openpose'), 'string')
    assert.equal(typeof controlNetModelForType('canny'), 'string')
  })

  it('polish needs an upscale model', async () => {
    const { buildPolishGraph } = await import('./stillGraph.mjs')
    try {
      buildPolishGraph(
        { positive: 'a person', sampler: { steps: 20, cfg: 5, sampler_name: 'euler', scheduler: 'normal', seed: 1 } },
        { upscale: '', checkpoint: 'demo.safetensors', sourceImage: '/tmp/still.png' },
      )
      assert.fail('should have thrown')
    } catch (e) {
      assert.equal(e.code, 'missing_upscale')
      assert.match(String(e.hint), /stills\.upscale/)
    }
  })

  it('buildStillGraph wires hires, face/hand detailer, and IPAdapter', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-still-'))
    const input = path.join(tmp, 'input')
    fs.mkdirSync(input, { recursive: true })
    const hero = path.join(input, 'hero.png')
    fs.writeFileSync(hero, 'png')
    const built = buildStillGraph(
      {
        positive: '1girl, adult woman, portrait',
        negative: 'bad',
        loras: [],
        size: { width: 1280, height: 720 },
        sampler: { steps: 34, cfg: 6, sampler_name: 'euler_ancestral', scheduler: 'normal', seed: 7 },
        ipadapter: { enabled: true, image: hero },
      },
      {
        checkpoint: 'demo.safetensors',
        quality: 'standard',
        upscale: '4x-AnimeSharp.pth',
        comfyRoot: tmp,
        detailer: {
          enabled: true,
          face: 'bbox/face_yolov8m.pt',
          hand: 'bbox/hand_yolov8n.pt',
        },
        ipadapter: {
          enabled: true,
          model: 'ip-adapter-plus-face_sdxl_vit-h.safetensors',
          clip_vision: 'clip_vision_h.safetensors',
          image: hero,
        },
      },
    )
    assert.equal(built.quality.useHires, true)
    assert.equal(built.graph['20'].class_type, 'UpscaleModelLoader')
    assert.equal(built.graph['52'].class_type, 'IPAdapterModelLoader')
    assert.equal(built.graph['53'].class_type, 'IPAdapterAdvanced')
    assert.equal(built.graph['53'].inputs.weight_type, 'ease out')
    assert.ok(built.graph['53'].inputs.end_at <= 1)
    assert.equal(built.graph['60'].class_type, 'UltralyticsDetectorProvider')
    assert.equal(built.graph['61'].class_type, 'FaceDetailer')
    assert.equal(built.graph['61'].inputs.bbox_crop_factor, 1.6)
    assert.equal(built.graph['61'].inputs.max_size, 768)
    assert.equal(built.graph['62'].class_type, 'UltralyticsDetectorProvider')
    assert.equal(built.graph['63'].class_type, 'FaceDetailer')
    assert.deepEqual(built.graph['26'].inputs.images, ['63', 0])
    assert.equal(built.detailer.face, 'bbox/face_yolov8m.pt')
    assert.equal(built.ipadapter.enabled, true)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('draft stills skip hires even when an upscale model is named', () => {
    const built = buildStillGraph(
      {
        positive: 'x',
        negative: 'y',
        loras: [],
        size: { width: 64, height: 64 },
        sampler: { steps: 28, cfg: 5.5, sampler_name: 'euler', scheduler: 'normal', seed: 1 },
      },
      {
        checkpoint: 'demo.safetensors',
        quality: 'draft',
        upscale: '4x-AnimeSharp.pth',
        detailer: { enabled: false },
        ipadapter: { enabled: false },
      },
    )
    assert.equal(built.quality.useHires, false)
    assert.equal(built.graph['20'], undefined)
    assert.equal(built.detailer, null)
  })

  it('resolve configs stay off when yaml/opts disable them', () => {
    const d = resolveDetailerConfig({ detailer: { enabled: false, face: 'bbox/face_yolov8m.pt' } })
    assert.equal(d.enabled, false)
    const ip = resolveIpadapterConfig({ ipadapter: { enabled: false, image: '/tmp/x.png' } }, {})
    assert.equal(ip.enabled, false)
  })

  it('buildStillGraph fails closed without a checkpoint', () => {
    if (getCheckpoint()) return
    assert.throws(
      () => buildStillGraph({ positive: 'x', negative: '', loras: [], size: { width: 64, height: 64 } }),
      /stills\.checkpoint/,
    )
  })
})

describe('studioConfig fail-closed', () => {
  it('requireCheckpoint / requireComfyRoot throw when yaml is empty', () => {
    if (!getCheckpoint()) {
      assert.throws(() => requireCheckpoint(), /stills\.checkpoint/)
    }
    // default qorlith.yaml ships with empty comfy.root
    try {
      requireComfyRoot()
    } catch (e) {
      assert.match(String(e.message), /comfy\.root/)
      return
    }
  })
})

describe('queued still logs comfy.queue then comfy.done', () => {
  it('emits both events to QORLITH_LOG', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-comfy-'))
    const root = path.join(tmp, 'comfy')
    const output = path.join(root, 'output')
    fs.mkdirSync(output, { recursive: true })
    const yaml = path.join(tmp, 'qorlith.yaml')
    fs.writeFileSync(
      yaml,
      [
        'comfy:',
        `  root: ${JSON.stringify(root)}`,
        `  output: ${JSON.stringify(output)}`,
        'stills:',
        '  checkpoint: demo.safetensors',
        '  sampler: { name: euler, scheduler: normal, steps: 4, cfg: 4 }',
      ].join('\n'),
      'utf8',
    )
    const logFile = path.join(tmp, 'qorlith.log')
    const prevYaml = process.env.QORLITH_YAML
    const prevLog = process.env.QORLITH_LOG
    const prevLevel = process.env.QORLITH_LOG_LEVEL
    process.env.QORLITH_YAML = yaml
    process.env.QORLITH_LOG = logFile
    process.env.QORLITH_LOG_LEVEL = 'info'
    const origFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      const u = String(url)
      const json = (body) =>
        ({
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        })
      if (u.includes('/system_stats')) return json({ devices: [{ name: 'mock' }] })
      if (u.endsWith('/prompt')) return json({ prompt_id: 'prompt-1' })
      if (u.includes('/history/prompt-1')) {
        return json({
          'prompt-1': {
            status: { status_str: 'success' },
            outputs: { 9: { images: [{ filename: 'out.png', subfolder: '' }] } },
          },
        })
      }
      return json({})
    }
    try {
      await queueStillAndWait(
        {
          positive: 'a person standing',
          negative: '',
          loras: [],
          size: { width: 64, height: 64 },
          sampler: { steps: 4, cfg: 4, sampler_name: 'euler', scheduler: 'normal', seed: 1 },
        },
        {
          quality: 'draft',
          comfyBase: 'http://127.0.0.1:8188',
          comfyRoot: root,
          comfyOutputRoot: output,
          checkpoint: 'demo.safetensors',
          waitMs: 2000,
          pollMs: 10,
        },
      )
    } finally {
      globalThis.fetch = origFetch
      if (prevYaml === undefined) delete process.env.QORLITH_YAML
      else process.env.QORLITH_YAML = prevYaml
      if (prevLog === undefined) delete process.env.QORLITH_LOG
      else process.env.QORLITH_LOG = prevLog
      if (prevLevel === undefined) delete process.env.QORLITH_LOG_LEVEL
      else process.env.QORLITH_LOG_LEVEL = prevLevel
    }
    const lines = fs.readFileSync(logFile, 'utf8')
    const queueAt = lines.indexOf('"event":"comfy.queue"')
    const doneAt = lines.indexOf('"event":"comfy.done"')
    assert.ok(queueAt >= 0, 'expected comfy.queue')
    assert.ok(doneAt >= 0, 'expected comfy.done')
    assert.ok(queueAt < doneAt, 'queue should precede done')
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
