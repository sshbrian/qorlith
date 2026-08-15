import type { ReactNode } from 'react'
import type { TrainMeta } from '../lib/api'

function dash(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—'
    // scientific for tiny LRs
    if (Math.abs(v) > 0 && Math.abs(v) < 1e-2) return v.toExponential(2)
    return Number.isInteger(v) ? String(v) : String(v)
  }
  return String(v)
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-[0.2em] text-ghost mb-0.5">{label}</div>
      <div
        className={`text-sm text-ink break-all ${mono ? 'font-mono text-xs text-cyan' : 'font-medium'}`}
        title={value !== '—' ? value : undefined}
      >
        {value}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[10px] uppercase tracking-[0.32em] text-cyan/80 border-b border-line/50 pb-1">
        {title}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3">{children}</div>
    </div>
  )
}

function hasAny(meta: TrainMeta | null | undefined, keys: (keyof TrainMeta)[]) {
  if (!meta) return false
  return keys.some((k) => meta[k] != null && meta[k] !== '')
}

export function TrainMetaPanel({ meta }: { meta: TrainMeta | null | undefined }) {
  if (!meta || meta.source === 'empty' || !hasAny(meta, [
    'baseModel',
    'networkDim',
    'optimizer',
    'classTokens',
    'totalSteps',
    'batchSize',
    'outputName',
  ])) {
    return (
      <section className="glass rounded-xl p-5 border border-line/40">
        <h2 className="text-xs uppercase tracking-[0.35em] text-ghost">Mission brief</h2>
        <p className="text-sm text-ghost mt-2">
          No model / hyperparameter dump yet. It appears once Kohya prints the dataset config
          (or when <code className="text-ink">train.meta.json</code> is written at launch).
        </p>
      </section>
    )
  }

  const dimAlpha =
    meta.networkDim != null || meta.networkAlpha != null
      ? `${dash(meta.networkDim)} / ${dash(meta.networkAlpha)}`
      : '—'

  return (
    <section className="glass rounded-xl p-5 space-y-5 border border-magenta/15">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xs uppercase tracking-[0.35em] text-ghost">Mission brief</h2>
          <p className="text-sm text-ink mt-1">
            Base model, LoRA network, data &amp; optimizer from train logs
            {meta.source ? (
              <span className="text-ghost"> · source <span className="text-cyan">{meta.source}</span></span>
            ) : null}
          </p>
        </div>
        {meta.method ? (
          <span className="text-[10px] uppercase tracking-widest text-magenta border border-magenta/40 rounded-full px-3 py-1">
            {meta.method}
          </span>
        ) : null}
      </div>

      <Section title="Model">
        <Row label="Base checkpoint" value={dash(meta.baseModel)} mono />
        <Row label="Network" value={dash(meta.networkModule)} mono />
        <Row label="Dim / alpha" value={dimAlpha} />
        <Row label="Attention" value={dash(meta.attention)} />
        <Row label="UNet dtype" value={dash(meta.unetDtype)} mono />
        <Row label="Mixed precision" value={dash(meta.mixedPrecision)} />
        <Row label="Output name" value={dash(meta.outputName)} mono />
        <Row label="Clip skip" value={dash(meta.clipSkip)} />
      </Section>

      <Section title="Data">
        <Row label="Trigger / class" value={dash(meta.classTokens)} />
        <Row label="Images" value={dash(meta.imageCount)} />
        <Row label="Images × repeats" value={dash(meta.trainImagesWithRepeats)} />
        <Row label="Batch size" value={dash(meta.batchSize)} />
        <Row label="Resolution" value={dash(meta.resolution)} />
        <Row label="Buckets" value={
          meta.enableBucket == null
            ? '—'
            : meta.enableBucket
              ? `${dash(meta.minBucketReso)}–${dash(meta.maxBucketReso)} step ${dash(meta.bucketResoSteps)}`
              : 'off'
        } />
        <Row label="Cache latents" value={dash(meta.cacheLatents)} />
        <Row label="Dataset" value={dash(meta.datasetDir)} mono />
      </Section>

      <Section title="Optimizer & schedule">
        <Row label="Optimizer" value={dash(meta.optimizer)} />
        <Row label="Learning rate" value={dash(meta.learningRate)} />
        <Row label="UNet LR" value={dash(meta.unetLr)} />
        <Row label="Text encoder LR" value={dash(meta.textEncoderLr)} />
        <Row label="LR scheduler" value={dash(meta.lrScheduler)} />
        <Row label="Warmup steps" value={dash(meta.lrWarmupSteps)} />
        <Row label="Epochs" value={dash(meta.epochs)} />
        <Row label="Steps / epoch" value={dash(meta.stepsPerEpoch)} />
        <Row label="Total steps" value={dash(meta.totalSteps)} />
        <Row label="Min-SNR γ" value={dash(meta.minSnrGamma)} />
        <Row label="Noise offset" value={dash(meta.noiseOffset)} />
        <Row label="Seed" value={dash(meta.seed)} />
        <Row label="Grad checkpoint" value={dash(meta.gradientCheckpointing)} />
      </Section>

      {meta.baseModelPath ? (
        <div className="pt-1 border-t border-line/40">
          <div className="text-[9px] uppercase tracking-[0.2em] text-ghost mb-1">Base path</div>
          <div className="font-mono text-[11px] text-ghost break-all">{meta.baseModelPath}</div>
        </div>
      ) : null}
    </section>
  )
}
