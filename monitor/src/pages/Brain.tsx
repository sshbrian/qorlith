import { memo, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { BrainGraph } from '../components/BrainGraph'
import { ComfyProgress } from '../components/ComfyProgress'
import { StoryboardModal } from '../components/StoryboardModal'
import { WorkflowModal } from '../components/WorkflowModal'
import { useStudioLive, useStudioSession } from '../components/StudioSession'
import { api, type BrainClip, type BrainStep } from '../lib/api'
import { idleBrainReport, runIsLive } from '../lib/studioSession'

function StepNode({ step }: { step: BrainStep }) {
  const on = step.state === 'active'
  const done = step.state === 'done'
  const fail = step.state === 'fail'
  return (
    <div
      className={[
        'shrink-0 rounded-full px-3 py-1 text-[13px]',
        fail
          ? 'bg-magenta/15 text-magenta'
          : on
            ? 'bg-cyan text-white'
            : done
              ? 'text-ink bg-white/[0.08]'
              : 'text-ghost bg-white/[0.04]',
      ].join(' ')}
      aria-current={on ? 'step' : undefined}
    >
      {step.label}
    </div>
  )
}

function BrainProgress({ armed }: { armed: boolean }) {
  const { comfy } = useStudioLive()
  return (
    <div className={`progress-slot ${armed ? 'is-armed' : ''}`}>
      <ComfyProgress progress={comfy} hold={armed} />
    </div>
  )
}

const ClipList = memo(function ClipList({
  clips,
  currentClip,
}: {
  clips: BrainClip[]
  currentClip: string | null | undefined
}) {
  const stills = clips.filter((c) => c.still).length
  const videos = clips.filter((c) => c.video).length
  const picks = clips.filter((c) => c.pick).length
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-5 py-3.5 text-[13px] text-ghost flex justify-between">
        <span>Clips</span>
        <span>
          {stills}/{clips.length} stills
          {picks ? ` · ${picks} picks` : ''}
          {videos ? ` · ${videos} video` : ''}
        </span>
      </div>
      <ul>
        {clips.map((c) => (
          <li
            key={c.id}
            className={`flex items-center gap-3 px-5 py-3 border-t border-white/[0.05] ${
              currentClip === c.id ? 'bg-white/[0.04]' : ''
            }`}
          >
            {c.still ? (
              <img
                src={api.mediaUrl(c.still)}
                alt=""
                width={44}
                height={44}
                decoding="async"
                className="h-11 w-11 rounded-[8px] object-cover bg-black shrink-0"
              />
            ) : (
              <span className="h-11 w-11 rounded-[8px] bg-white/[0.04] shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] truncate">{c.title || c.id}</span>
              <span className="block text-[12px] text-ghost">
                {c.id}
                {c.durationSec != null ? ` · ${c.durationSec}s` : ''}
              </span>
            </span>
            <span className="text-[12px] text-ghost hidden sm:flex gap-3">
              <span className={c.still ? 'text-ink' : 'text-ghost/40'}>Still</span>
              <span className={c.pick ? 'text-ink' : 'text-ghost/40'}>Pick</span>
              <span className={c.video ? 'text-ink' : 'text-ghost/40'}>Video</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
})

export function Brain() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { brain, loading, busy, err, start, resume, stop } = useStudioSession()
  const fallback = useMemo(() => idleBrainReport(projectId || ''), [projectId])
  const [sheet, setSheet] = useState<null | 'story' | 'stills' | 'video'>(null)

  if (!projectId) {
    return <p className="text-[15px] text-ghost">Open a project to make the film.</p>
  }

  const openNode = (id: string) => {
    if (id === 'plan') setSheet('story')
    else if (id === 'stills') setSheet('stills')
    else if (id === 'video') setSheet('video')
    else if (id === 'face_qa') navigate(`/studio/${encodeURIComponent(projectId)}/board`)
    else if (id === 'finish') navigate(`/studio/${encodeURIComponent(projectId)}/watch`)
  }

  const report = brain && (brain.started || (brain.clips && brain.clips.length)) ? brain : fallback
  const clips = report.clips || []
  const running = runIsLive(report)
  const hasMaster = Boolean(report.master)
  const canStart = !running && !busy
  const canStop = running && !busy
  const canResume =
    canStart && Boolean(report.started) && report.status !== 'done' && report.status !== 'idle'
  const primaryLabel = running || busy ? 'Working…' : report.started ? 'Make again' : 'Make the film'
  const statusTone =
    running
      ? 'text-amber'
      : report.status === 'fail' || report.status === 'stopped'
        ? 'text-magenta'
        : 'text-ghost'
  return (
    <div className="page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="page-lead">Pictures first. You pick favorites. Then motion.</p>
        <div className={`text-[15px] ${statusTone}`}>
          {running ? (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber mr-2 align-middle pulse-dot" />
          ) : null}
          {report.label || (report.started ? report.status : 'Ready')}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 min-h-8">
        <Link
          to={`/studio/${encodeURIComponent(projectId)}/watch`}
          className="btn btn-primary"
          style={{ visibility: hasMaster && !running ? 'visible' : 'hidden' }}
        >
          Watch
        </Link>
        <button type="button" disabled={!canStart} onClick={() => void start('stills')} className="btn btn-primary">
          {primaryLabel}
        </button>
        <button
          type="button"
          disabled={!canResume}
          onClick={() => void resume()}
          className="btn btn-secondary"
          style={{ visibility: canResume ? 'visible' : 'hidden' }}
        >
          Continue
        </button>
        <button type="button" disabled={!canStop} onClick={() => void stop()} className="btn btn-danger">
          Stop
        </button>
      </div>

      <FailNote error={err} />
      {report.lastError ? <FailNote error={report.lastError} /> : null}

      <BrainProgress armed={running || Boolean(report.started)} />

      {report.started || (report.steps || []).length ? (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2" role="list">
            {(report.steps || []).map((step, i) => (
              <div key={step.id} className="flex items-center gap-2" role="listitem">
                {i > 0 ? <span className="text-ghost/35 text-xs">→</span> : null}
                <StepNode step={step} />
              </div>
            ))}
          </div>
          <p className="text-[15px] text-ghost mt-4 min-h-[1.35em]">
            {report.currentClip ? `Now ${report.currentClip}` : '\u00a0'}
          </p>
          {report.status === 'face_qa' && !report.reviewOk ? (
            <p className="text-[17px] text-ghost mt-4">
              Waiting on the board.{' '}
              <Link to={`/studio/${encodeURIComponent(projectId)}/board`} className="text-cyan hover:underline">
                Set picks
              </Link>
              , then press Continue.
            </p>
          ) : null}
        </div>
      ) : null}

      {!report.started && !loading ? (
        <div className="card">
          <p className="text-[17px] text-ghost">Nothing is rendering yet. Press Make the film when the plan looks right.</p>
        </div>
      ) : null}

      {hasMaster ? (
        <div className="overflow-hidden rounded-[16px] bg-black aspect-video">
          <video src={api.brainMasterUrl(projectId)} controls className="w-full h-full object-contain bg-black" />
        </div>
      ) : null}

      {clips.length ? <ClipList clips={clips} currentClip={report.currentClip} /> : null}

      <BrainGraph brain={report} onOpenNode={openNode} />
      {sheet === 'story' ? <StoryboardModal projectId={projectId} onClose={() => setSheet(null)} /> : null}
      {sheet === 'stills' ? (
        <WorkflowModal projectId={projectId} kind="still" onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'video' ? (
        <WorkflowModal projectId={projectId} kind="video" onClose={() => setSheet(null)} />
      ) : null}
    </div>
  )
}
