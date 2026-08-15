import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSyntheticTrainLog,
  decodeLogBuffer,
  formatDuration,
  mergeTrainMeta,
  parseProgress,
  parseTrainMeta,
} from './progress.mjs'

describe('formatDuration', () => {
  it('formats seconds', () => {
    assert.equal(formatDuration(45), '45s')
    assert.equal(formatDuration(125), '2m 05s')
    assert.equal(formatDuration(3725), '1h 02m')
    assert.equal(formatDuration(null), null)
  })
})

describe('decodeLogBuffer', () => {
  it('decodes utf8', () => {
    assert.equal(decodeLogBuffer(Buffer.from('steps: 1/2', 'utf8')), 'steps: 1/2')
  })

  it('decodes utf16le BOM (PowerShell Tee-Object style)', () => {
    const body = 'epoch 1/16\nsteps:  10%|█| 128/1280 [01:00<09:00, 1.50it/s]'
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')])
    const text = decodeLogBuffer(buf)
    assert.match(text, /epoch 1\/16/)
    assert.match(text, /1\.50it\/s/)
  })
})

describe('parseProgress — Kohya train pipe fixtures', () => {
  it('parses full tqdm training line with speed, loss, eta', () => {
    const log = buildSyntheticTrainLog({
      epoch: 3,
      epochTotal: 16,
      step: 580,
      maxSteps: 1280,
      itPerSec: 1.42,
      loss: 0.0831,
      avgLoss: 0.0912,
      lr: 7.2e-5,
      batchSize: 2,
    })
    const p = parseProgress(log)

    assert.deepEqual(p.epoch, { current: 3, total: 16 })
    assert.equal(p.step, 580)
    assert.equal(p.maxSteps, 1280)
    assert.ok(p.percent != null && p.percent >= 45 && p.percent <= 46)
    assert.ok(p.overallPercent != null && p.overallPercent > 12 && p.overallPercent < 20)
    assert.equal(p.itPerSec, 1.42)
    assert.ok(p.secPerIt != null && Math.abs(p.secPerIt - 1 / 1.42) < 1e-6)
    assert.equal(p.loss, 0.0831)
    assert.equal(p.avgLoss, 0.0912)
    assert.ok(p.lr != null && Math.abs(p.lr - 7.2e-5) < 1e-10)
    assert.equal(p.batchSize, 2)
    assert.equal(p.samplesPerSec, 1.42 * 2)
    assert.equal(p.phase, 'train')
    assert.ok(p.etaSeconds != null && p.etaSeconds > 0)
    assert.ok(p.etaHuman)
    assert.ok(p.etaTotalSeconds != null && p.etaTotalSeconds > p.etaSeconds)
    assert.ok(p.recentLines.length > 0)
  })

  it('parses caption phase tqdm (pre-train)', () => {
    const log = [
      'read caption:  51%|█████     | 131/256 [00:00<00:00, 257.83it/s]',
    ].join('\n')
    const p = parseProgress(log)
    assert.equal(p.step, 131)
    assert.equal(p.maxSteps, 256)
    assert.ok(p.percent != null && p.percent > 50)
    assert.equal(p.phase, 'caption')
    assert.ok(p.itPerSec != null && p.itPerSec > 200)
  })

  it('parses s/it rate format', () => {
    const log = 'steps:  20%|██| 200/1000 [05:00<20:00, 1.50s/it, loss=0.12]'
    const p = parseProgress(log)
    assert.equal(p.step, 200)
    assert.equal(p.maxSteps, 1000)
    assert.equal(p.secPerIt, 1.5)
    assert.ok(p.itPerSec != null && Math.abs(p.itPerSec - 1 / 1.5) < 1e-6)
    assert.equal(p.loss, 0.12)
  })

  it('parses completed bar without eta field', () => {
    const log = 'steps: 100%|██████████| 1280/1280 [15:00, 1.42it/s]'
    const p = parseProgress(log)
    assert.equal(p.step, 1280)
    assert.equal(p.maxSteps, 1280)
    assert.equal(p.percent, 100)
    assert.equal(p.itPerSec, 1.42)
  })

  it('handles empty and garbage input', () => {
    assert.equal(parseProgress('').step, null)
    assert.equal(parseProgress(null).step, null)
    assert.equal(parseProgress('hello world no metrics').percent, null)
  })

  it('derives overall percent across epochs for progress bars', () => {
    // epoch 1 of 4, halfway through steps => overall ~12.5%
    const log = 'epoch 1/4\nsteps:  50%|█████| 640/1280 [05:00<05:00, 2.00it/s]'
    const p = parseProgress(log)
    assert.equal(p.epoch.current, 1)
    assert.ok(Math.abs(p.percent - 50) < 0.1)
    assert.ok(Math.abs(p.overallPercent - 12.5) < 0.5)
  })

  it('uses latest tqdm rewrite when updates are joined with \\r (file redirect)', () => {
    // Kohya/tqdm stderr tee: same physical line rewritten with CR, no LF between steps
    const log = [
      'steps:   0%|          | 0/20480 [00:00<?, ?it/s]',
      'steps:   0%|          | 1/20480 [00:02<12:07:20, 2.13s/it]',
      'steps:   0%|          | 1/20480 [00:02<12:07:20, 2.13s/it, avr_loss=0.248]',
      'steps:   2%|▏         | 374/20480 [05:00<4:29:16, 1.24it/s, avr_loss=0.0936]',
      'steps:   2%|▏         | 374/20480 [05:00<4:29:16, 1.24it/s, avr_loss=0.0941]',
    ].join('\r')
    const p = parseProgress(log)
    assert.equal(p.step, 374)
    assert.equal(p.maxSteps, 20480)
    assert.equal(p.itPerSec, 1.24)
    assert.equal(p.avgLoss, 0.0941)
    assert.ok(p.percent != null && p.percent >= 1.5 && p.percent <= 2.5)
    // CR-split virtual lines (not one giant blob with every step glued together)
    assert.ok(p.recentLines.length >= 2)
    assert.ok(p.recentLines.every((l) => l.length < 200))
    assert.match(p.recentLines[p.recentLines.length - 1], /374\/20480/)
  })
})

describe('parseTrainMeta', () => {
  it('extracts model, LoRA, data, and schedule from synthetic Kohya log', () => {
    const log = buildSyntheticTrainLog({ batchSize: 2, maxSteps: 1280, epochTotal: 16 })
    const m = parseTrainMeta(log)
    assert.equal(m.method, 'DreamBooth')
    assert.equal(m.networkModule, 'networks.lora')
    assert.equal(m.networkDim, 32)
    assert.equal(m.networkAlpha, 16)
    assert.equal(m.baseModel, 'checkpoint.safetensors')
    assert.equal(m.classTokens, 'style')
    assert.equal(m.batchSize, 2)
    assert.equal(m.resolution, '1024×1024')
    assert.equal(m.imageCount, 256)
    assert.equal(m.epochs, 16)
    assert.equal(m.totalSteps, 20480)
    assert.equal(m.attention, 'SDPA')
    assert.match(m.optimizer || '', /AdamW/i)
  })

  it('lets train.meta.json override log fields', () => {
    const log = parseTrainMeta('batch_size: 2\ncreate LoRA network. base dim (rank): 16, alpha: 8.0')
    const merged = mergeTrainMeta(log, {
      networkDim: 32,
      networkAlpha: 16,
      unetLr: 8e-5,
      baseModel: 'checkpoint.safetensors',
    })
    assert.equal(merged.networkDim, 32)
    assert.equal(merged.networkAlpha, 16)
    assert.equal(merged.batchSize, 2)
    assert.equal(merged.unetLr, 8e-5)
    assert.equal(merged.source, 'log+meta.json')
  })
})
