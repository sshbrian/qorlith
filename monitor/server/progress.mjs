/**
 * Pure progress parsing for Kohya / accelerate / tqdm logs.
 * Exported for unit tests and used by the Qorlith API.
 */

export function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`
  return `${r}s`
}

function parseDuration(str) {
  if (!str || str === '?') return null
  const cleaned = String(str).trim()
  const parts = cleaned.split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}

/**
 * Decode training logs written as UTF-8 or UTF-16 (PowerShell redirects often use UTF-16 LE).
 */
export function decodeLogBuffer(buf) {
  if (!buf || !buf.length) return ''
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le')
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const copy = Buffer.from(buf)
    copy.swap16()
    return copy.toString('utf16le')
  }
  if (buf.length >= 16) {
    const sample = Math.min(buf.length, 400)
    let nullOdd = 0
    let pairs = 0
    for (let i = 1; i < sample; i += 2) {
      pairs++
      if (buf[i] === 0) nullOdd++
    }
    if (pairs && nullOdd / pairs > 0.6) {
      const offset = buf.length % 2 === 0 ? 0 : 1
      return buf.subarray(offset).toString('utf16le')
    }
  }
  return buf.toString('utf8')
}

/**
 * Parse Kohya / accelerate / tqdm training logs into rich progress for UI bars.
 */
/**
 * tqdm rewrites the same physical line with \\r. Split those into virtual lines
 * so we parse the *latest* step, not the first one on a giant concatenated line.
 */
export function normalizeLogLines(logText) {
  if (!logText || typeof logText !== 'string') return []
  return logText
    .split(/\r\n|\n|\r/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function applyTqdmMatch(m, ratePart, line, state) {
  state.percent = Number(m[1])
  state.step = Number(m[2])
  state.maxSteps = Number(m[3])
  if (m[4] != null) state.elapsedSeconds = parseDuration(String(m[4]).trim())
  if (m[5] != null && m[6] != null) {
    // full form: elapsed < eta, rate
    state.etaSeconds = parseDuration(String(m[5]).trim())
    ratePart = String(m[6]).trim()
  } else if (m[5] != null && m[6] == null) {
    // done form: elapsed, rate  — already in ratePart from caller
  }
  const rp = ratePart || ''
  const itMatch = rp.match(/([\d.]+)\s*it\/s/i)
  const sMatch = rp.match(/([\d.]+)\s*s\/it/i)
  if (itMatch) {
    state.itPerSec = Number(itMatch[1])
    state.secPerIt = state.itPerSec > 0 ? 1 / state.itPerSec : null
  } else if (sMatch) {
    state.secPerIt = Number(sMatch[1])
    state.itPerSec = state.secPerIt > 0 ? 1 / state.secPerIt : null
  }
  const lossM = rp.match(/(?<![a-z_])loss=([0-9.eE+-]+)/i) || rp.match(/loss=([0-9.eE+-]+)/i)
  if (lossM) state.loss = Number(lossM[1])
  const avrM = rp.match(/(?:avr_?loss|avg_?loss)=([0-9.eE+-]+)/i)
  if (avrM) state.avgLoss = Number(avrM[1])
  const lrM = rp.match(/lr=([0-9.eE+-]+)/i)
  if (lrM) state.lr = Number(lrM[1])

  if (/read caption|caption/i.test(line)) state.phase = 'caption'
  else if (/cache|latent/i.test(line)) state.phase = 'cache'
  else state.phase = 'train'
}

export function parseProgress(logText) {
  if (!logText || typeof logText !== 'string') {
    return emptyProgress()
  }

  // Keep last N virtual lines (after \\r split) so UI stays fresh
  const lines = normalizeLogLines(logText)
  const last = lines.slice(-400)

  const state = {
    epoch: null,
    step: null,
    maxSteps: null,
    loss: null,
    lr: null,
    avgLoss: null,
    itPerSec: null,
    secPerIt: null,
    etaSeconds: null,
    elapsedSeconds: null,
    percent: null,
    phase: null,
    batchSize: null,
  }

  // Full tqdm: 45%|...| 580/1280 [08:12<09:45, 1.20it/s, loss=0.082]
  const reFull =
    /(\d+(?:\.\d+)?)\s*%?\s*\|[^|\r\n]*\|\s*(\d+)\s*\/\s*(\d+)\s*\[\s*([^\]<]+)\s*<\s*([^,\]]+)\s*,\s*([^\]]+)\]/g
  // Done tqdm: 100%|...| 1280/1280 [15:00, 1.42it/s]
  const reDone =
    /(\d+(?:\.\d+)?)\s*%?\s*\|[^|\r\n]*\|\s*(\d+)\s*\/\s*(\d+)\s*\[\s*([^,\]]+)\s*,\s*([^\]]+)\]/g

  for (const line of last) {
    let m

    m = line.match(/batch_size:\s*(\d+)/i)
    if (m) state.batchSize = Number(m[1])

    m = line.match(/epochs?\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/i)
    if (m) state.epoch = { current: Number(m[1]), total: Number(m[2]) }

    // Prefer LAST tqdm match on this line (\\r-joined updates)
    let lastFull = null
    reFull.lastIndex = 0
    while ((m = reFull.exec(line)) !== null) lastFull = m
    if (lastFull) {
      applyTqdmMatch(lastFull, lastFull[6], line, state)
      continue
    }

    let lastDone = null
    reDone.lastIndex = 0
    while ((m = reDone.exec(line)) !== null) lastDone = m
    if (lastDone) {
      // groups: pct, step, max, elapsed, rate
      state.percent = Number(lastDone[1])
      state.step = Number(lastDone[2])
      state.maxSteps = Number(lastDone[3])
      state.elapsedSeconds = parseDuration(lastDone[4].trim())
      const rp = lastDone[5].trim()
      const itMatch = rp.match(/([\d.]+)\s*it\/s/i)
      const sMatch = rp.match(/([\d.]+)\s*s\/it/i)
      if (itMatch) {
        state.itPerSec = Number(itMatch[1])
        state.secPerIt = state.itPerSec > 0 ? 1 / state.itPerSec : null
      } else if (sMatch) {
        state.secPerIt = Number(sMatch[1])
        state.itPerSec = state.secPerIt > 0 ? 1 / state.secPerIt : null
      }
      state.phase = /caption/i.test(line) ? 'caption' : /cache|latent/i.test(line) ? 'cache' : 'train'
      continue
    }

    // simpler: 580/1280 [  — take last occurrence
    const simpleAll = [...line.matchAll(/(?:steps?[:\s]*)?(\d+)\s*\/\s*(\d+)\s*\[/gi)]
    if (simpleAll.length) {
      const sm = simpleAll[simpleAll.length - 1]
      state.step = Number(sm[1])
      state.maxSteps = Number(sm[2])
      if (state.maxSteps > 0) state.percent = (state.step / state.maxSteps) * 100
      state.phase = state.phase || 'train'
    }

    const itAll = [...line.matchAll(/([\d.]+)\s*it\/s/gi)]
    if (itAll.length) {
      state.itPerSec = Number(itAll[itAll.length - 1][1])
      state.secPerIt = state.itPerSec > 0 ? 1 / state.itPerSec : null
    }
    const sAll = [...line.matchAll(/([\d.]+)\s*s\/it/gi)]
    if (sAll.length) {
      state.secPerIt = Number(sAll[sAll.length - 1][1])
      state.itPerSec = state.secPerIt > 0 ? 1 / state.secPerIt : null
    }

    const avrAll = [
      ...line.matchAll(/(?:avr[_ ]?loss|average[_ ]?loss|avg[_ ]?loss)[:=\s]+([0-9.eE+-]+)/gi),
    ]
    if (avrAll.length) state.avgLoss = Number(avrAll[avrAll.length - 1][1])

    const lossAll = [...line.matchAll(/avr_loss=([0-9.eE+-]+)|(?<!avr_|avg_|average_)loss=([0-9.eE+-]+)/gi)]
    if (lossAll.length) {
      const g = lossAll[lossAll.length - 1]
      state.loss = Number(g[1] || g[2])
    }

    const lrAll = [...line.matchAll(/(?:^|[\s,;])lr[:=\s]+([0-9.eE+-]+)/gi)]
    if (lrAll.length) state.lr = Number(lrAll[lrAll.length - 1][1])
  }

  let {
    epoch,
    step,
    maxSteps,
    loss,
    lr,
    avgLoss,
    itPerSec,
    secPerIt,
    etaSeconds,
    elapsedSeconds,
    percent,
    phase,
    batchSize,
  } = state

  if (percent == null && step != null && maxSteps != null && maxSteps > 0) {
    percent = (step / maxSteps) * 100
  }

  let overallPercent = null
  if (epoch && epoch.total > 0 && step != null && maxSteps != null && maxSteps > 0) {
    const doneEpochs = Math.max(0, epoch.current - 1)
    overallPercent = ((doneEpochs + step / maxSteps) / epoch.total) * 100
  } else if (epoch && epoch.total > 0 && epoch.current != null) {
    overallPercent = ((epoch.current - 0) / epoch.total) * 100
  } else if (percent != null) {
    overallPercent = percent
  }

  let etaEpochSeconds = etaSeconds
  let etaTotalSeconds = null
  if (etaEpochSeconds == null && secPerIt != null && step != null && maxSteps != null) {
    etaEpochSeconds = Math.max(0, (maxSteps - step) * secPerIt)
  }
  if (epoch && epoch.total > 0 && secPerIt != null && maxSteps != null && step != null) {
    const stepsLeftThisEpoch = Math.max(0, maxSteps - step)
    const fullEpochsLeft = Math.max(0, epoch.total - epoch.current)
    etaTotalSeconds = stepsLeftThisEpoch * secPerIt + fullEpochsLeft * maxSteps * secPerIt
  }

  let samplesPerSec = null
  if (itPerSec != null && batchSize != null) samplesPerSec = itPerSec * batchSize

  const clamp = (v) =>
    v == null || !Number.isFinite(v) ? null : Math.min(100, Math.max(0, v))

  return {
    epoch,
    step,
    maxSteps,
    loss,
    avgLoss,
    lr,
    percent: clamp(percent),
    overallPercent: clamp(overallPercent),
    itPerSec,
    secPerIt,
    samplesPerSec,
    batchSize,
    etaSeconds: etaEpochSeconds,
    etaTotalSeconds,
    elapsedSeconds,
    phase,
    etaHuman: formatDuration(etaEpochSeconds),
    etaTotalHuman: formatDuration(etaTotalSeconds),
    elapsedHuman: formatDuration(elapsedSeconds),
    recentLines: last.slice(-30),
  }
}

function emptyProgress() {
  return {
    epoch: null,
    step: null,
    maxSteps: null,
    loss: null,
    avgLoss: null,
    lr: null,
    percent: null,
    overallPercent: null,
    itPerSec: null,
    secPerIt: null,
    samplesPerSec: null,
    batchSize: null,
    etaSeconds: null,
    etaTotalSeconds: null,
    elapsedSeconds: null,
    phase: null,
    etaHuman: null,
    etaTotalHuman: null,
    elapsedHuman: null,
    recentLines: [],
  }
}

function emptyTrainMeta() {
  return {
    method: null,
    networkModule: null,
    networkDim: null,
    networkAlpha: null,
    baseModel: null,
    baseModelPath: null,
    outputName: null,
    outputDir: null,
    datasetDir: null,
    classTokens: null,
    imageCount: null,
    trainImagesWithRepeats: null,
    regImages: null,
    batchSize: null,
    resolution: null,
    enableBucket: null,
    minBucketReso: null,
    maxBucketReso: null,
    bucketResoSteps: null,
    epochs: null,
    stepsPerEpoch: null,
    totalSteps: null,
    optimizer: null,
    learningRate: null,
    unetLr: null,
    textEncoderLr: null,
    lrScheduler: null,
    lrWarmupSteps: null,
    mixedPrecision: null,
    savePrecision: null,
    attention: null,
    unetDtype: null,
    clipSkip: null,
    gradientCheckpointing: null,
    minSnrGamma: null,
    noiseOffset: null,
    seed: null,
    captionDropout: null,
    keepTokens: null,
    maxTokenLength: null,
    cacheLatents: null,
    source: null,
    fields: {},
  }
}

function setMeta(meta, key, value) {
  if (value == null || value === '') return
  if (meta[key] == null) meta[key] = value
  meta.fields[key] = value
}

function basenamePath(p) {
  if (!p) return null
  const s = String(p).replace(/["']/g, '').trim()
  const parts = s.split(/[/\\]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : s
}

function parseNum(v) {
  if (v == null) return null
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Parse Kohya train log head / train.meta.json-style text into model + hyperparams.
 * Prefers values already set (first wins) so structured meta can be merged on top later.
 */
export function parseTrainMeta(logText) {
  const meta = emptyTrainMeta()
  if (!logText || typeof logText !== 'string') {
    meta.source = 'empty'
    return meta
  }

  const text = logText
  const lines = normalizeLogLines(text)
  const joined = lines.join('\n')

  if (/DreamBooth/i.test(joined)) setMeta(meta, 'method', 'DreamBooth')
  else if (/FineTuning|fine.?tun/i.test(joined)) setMeta(meta, 'method', 'Fine-tuning')

  let m
  m = joined.match(/import network module:\s*(\S+)/i)
  if (m) setMeta(meta, 'networkModule', m[1])

  m = joined.match(/create LoRA network\.\s*base dim \(rank\):\s*(\d+)\s*,\s*alpha:\s*([0-9.]+)/i)
  if (m) {
    setMeta(meta, 'networkDim', parseNum(m[1]))
    setMeta(meta, 'networkAlpha', parseNum(m[2]))
  }
  m = joined.match(/network_dim[=:\s]+(\d+)/i)
  if (m) setMeta(meta, 'networkDim', parseNum(m[1]))
  m = joined.match(/network_alpha[=:\s]+([0-9.]+)/i)
  if (m) setMeta(meta, 'networkAlpha', parseNum(m[1]))

  // load StableDiffusion checkpoint: <path>  (path may be on next line)
  m = joined.match(
    /load StableDiffusion(?:XL)? checkpoint:\s*([^\n]+?)(?:\s+INFO|\s+building|\n|$)/i,
  )
  if (m) {
    const p = m[1].replace(/\s+/g, '').trim()
    if (/\.safetensors|\.ckpt|\.pt/i.test(p)) {
      setMeta(meta, 'baseModelPath', p)
      setMeta(meta, 'baseModel', basenamePath(p))
    }
  }
  m = joined.match(/base=([^\s\n]+)/i)
  if (m) {
    setMeta(meta, 'baseModelPath', m[1])
    setMeta(meta, 'baseModel', basenamePath(m[1]))
  }
  // split checkpoint path lines
  m = joined.match(/([A-Za-z]:\\[^\s"'<>|*?]+\.(?:safetensors|ckpt))/i)
  if (m && /checkpoint|pretrained|base|models/i.test(joined.slice(Math.max(0, joined.indexOf(m[1]) - 80), joined.indexOf(m[1])))) {
    setMeta(meta, 'baseModelPath', m[1])
    setMeta(meta, 'baseModel', basenamePath(m[1]))
  }
  // also catch filename alone after "checkpoint:"
  m = joined.match(
    /(?:checkpoint|pretrained_model)[^:\n]*:\s*[^\n]*?([A-Za-z0-9_.-]+\.safetensors)/i,
  )
  if (m) setMeta(meta, 'baseModel', m[1])

  m = joined.match(/found directory\s+(.+?)\s+contains\s+(\d+)\s+image/i)
  if (m) {
    setMeta(meta, 'datasetDir', m[1].replace(/\s+/g, ''))
    setMeta(meta, 'imageCount', parseNum(m[2]))
  }
  m = joined.match(/contains\s+(\d+)\s+image files/i)
  if (m) setMeta(meta, 'imageCount', parseNum(m[1]))

  m = joined.match(/class_tokens:\s*(\S+)/i)
  if (m) setMeta(meta, 'classTokens', m[1])

  m = joined.match(/batch_size:\s*(\d+)/i)
  if (m) setMeta(meta, 'batchSize', parseNum(m[1]))
  m = joined.match(/batch size per device[^\d]*(\d+)/i)
  if (m) setMeta(meta, 'batchSize', parseNum(m[1]))

  m = joined.match(/resolution:\s*\((\d+)\s*,\s*(\d+)\)/i)
  if (m) setMeta(meta, 'resolution', `${m[1]}×${m[2]}`)

  m = joined.match(/enable_bucket:\s*(True|False)/i)
  if (m) setMeta(meta, 'enableBucket', /^true$/i.test(m[1]))
  m = joined.match(/min_bucket_reso:\s*(\d+)/i)
  if (m) setMeta(meta, 'minBucketReso', parseNum(m[1]))
  m = joined.match(/max_bucket_reso:\s*(\d+)/i)
  if (m) setMeta(meta, 'maxBucketReso', parseNum(m[1]))
  m = joined.match(/bucket_reso_steps:\s*(\d+)/i)
  if (m) setMeta(meta, 'bucketResoSteps', parseNum(m[1]))

  m = joined.match(/(\d+)\s+train images with\s+repeats/i)
  if (m) setMeta(meta, 'trainImagesWithRepeats', parseNum(m[1]))
  m = joined.match(/num train images \* repeats[^\d]*(\d+)/i)
  if (m) setMeta(meta, 'trainImagesWithRepeats', parseNum(m[1]))

  m = joined.match(/(\d+)\s+reg images/i)
  if (m) setMeta(meta, 'regImages', parseNum(m[1]))

  // Prefer ": N" at end of bilingual lines (avoids matching the "1" in "1epoch…")
  m = joined.match(/num epochs[^\n]*:\s*(\d+)/i)
  if (m) setMeta(meta, 'epochs', parseNum(m[1]))
  m = joined.match(/num batches per epoch[^\n]*:\s*(\d+)/i)
  if (m) setMeta(meta, 'stepsPerEpoch', parseNum(m[1]))
  m = joined.match(/total optimization steps[^\n]*:\s*(\d+)/i)
  if (m) setMeta(meta, 'totalSteps', parseNum(m[1]))
  m = joined.match(/override steps\.[^\n]*:\s*(\d+)/i)
  if (m) setMeta(meta, 'totalSteps', parseNum(m[1]))
  // steps: n/N from tqdm if totals missing
  m = joined.match(/steps:\s+\d+%\s*\|[^|]*\|\s*\d+\s*\/\s*(\d+)/i)
  if (m) setMeta(meta, 'totalSteps', parseNum(m[1]))

  m = joined.match(/use\s+([^\n|]+?)\s+optimizer/i)
  if (m) setMeta(meta, 'optimizer', m[1].trim())
  m = joined.match(/optimizer[=:\s]+([A-Za-z0-9_]+)/i)
  if (m) setMeta(meta, 'optimizer', m[1])

  m = joined.match(/unet dtype:\s*(torch\.\w+)/i)
  if (m) setMeta(meta, 'unetDtype', m[1])
  if (/Enable SDPA/i.test(joined)) setMeta(meta, 'attention', 'SDPA')
  if (/\bsdpa\b/i.test(joined) && !meta.attention) setMeta(meta, 'attention', 'sdpa')
  if (/xformers/i.test(joined) && !meta.attention) setMeta(meta, 'attention', 'xformers')

  m = joined.match(/mixed_precision[=:\s]+(\w+)/i)
  if (m) setMeta(meta, 'mixedPrecision', m[1])
  m = joined.match(/unet_lr[=:\s]+([0-9.eE+-]+)/i)
  if (m) setMeta(meta, 'unetLr', parseNum(m[1]))
  m = joined.match(/(?:text_encoder_lr|te_lr)[=:\s]+([0-9.eE+-]+)/i)
  if (m) setMeta(meta, 'textEncoderLr', parseNum(m[1]))
  m = joined.match(/(?:^|\s)learning_rate[=:\s]+([0-9.eE+-]+)/i)
  if (m) setMeta(meta, 'learningRate', parseNum(m[1]))
  m = joined.match(/lr_scheduler[=:\s]+(\w+)/i)
  if (m) setMeta(meta, 'lrScheduler', m[1])
  m = joined.match(/lr_warmup_steps[=:\s]+(\d+)/i)
  if (m) setMeta(meta, 'lrWarmupSteps', parseNum(m[1]))
  m = joined.match(/clip_skip[=:\s]+(\d+)/i)
  if (m) setMeta(meta, 'clipSkip', parseNum(m[1]))
  m = joined.match(/min_snr_gamma[=:\s]+([0-9.]+)/i)
  if (m) setMeta(meta, 'minSnrGamma', parseNum(m[1]))
  m = joined.match(/noise_offset[=:\s]+([0-9.]+)/i)
  if (m) setMeta(meta, 'noiseOffset', parseNum(m[1]))
  m = joined.match(/seed[=:\s]+(\d+)/i)
  if (m) setMeta(meta, 'seed', parseNum(m[1]))
  m = joined.match(/name=([^\s\n]+)/i)
  if (m) setMeta(meta, 'outputName', m[1])
  m = joined.match(/output=([^\s\n]+)/i)
  if (m) setMeta(meta, 'outputDir', m[1])
  m = joined.match(/data=([^\s\n]+)/i)
  if (m) setMeta(meta, 'datasetDir', m[1])

  if (/gradient_checkpointing/i.test(joined)) setMeta(meta, 'gradientCheckpointing', true)
  if (/cache_latents/i.test(joined)) setMeta(meta, 'cacheLatents', true)

  meta.source = 'log'
  return meta
}

/** Merge structured train.meta.json over log-parsed meta (JSON wins for set keys). */
export function mergeTrainMeta(logMeta, jsonMeta) {
  const base = logMeta && typeof logMeta === 'object' ? { ...logMeta, fields: { ...(logMeta.fields || {}) } } : emptyTrainMeta()
  if (!jsonMeta || typeof jsonMeta !== 'object') return base

  const skip = new Set(['fields', 'source'])
  for (const [k, v] of Object.entries(jsonMeta)) {
    if (skip.has(k) || v == null || v === '') continue
    base[k] = v
    base.fields[k] = v
  }
  // derive baseModel from path if needed
  if (!base.baseModel && base.baseModelPath) base.baseModel = basenamePath(base.baseModelPath)
  base.source = logMeta?.source && logMeta.source !== 'empty' ? 'log+meta.json' : 'meta.json'
  return base
}

/** Build a realistic Kohya-style train.log body for tests / demos */
export function buildSyntheticTrainLog({
  epoch = 3,
  epochTotal = 16,
  step = 580,
  maxSteps = 1280,
  itPerSec = 1.42,
  loss = 0.0831,
  avgLoss = 0.0912,
  lr = 7.2e-5,
  batchSize = 2,
  elapsed = '08:12',
  eta = '09:45',
} = {}) {
  const pct = ((step / maxSteps) * 100).toFixed(0)
  const barLen = 20
  const filled = Math.round((step / maxSteps) * barLen)
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled)
  return [
    'ipex flag is deprecated, will be removed in Accelerate v1.10.',
    '2026-08-01 22:29:45 INFO     Using DreamBooth method.       train_network.py:937',
    `                    INFO     [Dataset 0]                      config_util.py:587`,
    `                               batch_size: ${batchSize}`,
    `                               resolution: (1024, 1024)`,
    `                               enable_bucket: True`,
    `                                 class_tokens: style`,
    `                    INFO     found directory C:\\data\\10_style contains 256 image files`,
    `                    INFO     load StableDiffusion checkpoint: C:\\models\\checkpoint.safetensors`,
    `                    INFO     create LoRA network. base dim (rank): 32, alpha: 16.0`,
    `                    INFO     use 8-bit AdamW optimizer | {}`,
    `                    INFO     Enable SDPA for U-Net`,
    `                    INFO     unet dtype: torch.bfloat16, device: cuda:0`,
    `import network module: networks.lora`,
    `  num train images * repeats / x: 2560`,
    `  num epochs / epoch数: ${epochTotal}`,
    `  batch size per device / : ${batchSize}`,
    `  num batches per epoch / : ${maxSteps}`,
    `  total optimization steps / : ${maxSteps * epochTotal}`,
    `epoch ${epoch}/${epochTotal}`,
    `steps:  ${pct}%|${bar}| ${step}/${maxSteps} [${elapsed}<${eta}, ${itPerSec}it/s, loss=${loss}, avr_loss=${avgLoss}, lr=${lr}]`,
    `running training / 学習中...`,
  ].join('\n')
}
