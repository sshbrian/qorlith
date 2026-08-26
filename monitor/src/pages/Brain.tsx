import { memo, useEffect, useMemo, useRef, useState } from 'react'
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
  if (!armed) return null
  return (
    <div className="progress-slot is-armed">
      <ComfyProgress progress={comfy} hold />
    </div>
  )
}

const Filmstrip = memo(function Filmstrip({
  clips,
  currentClip,
}: {
  clips: BrainClip[]
  currentClip: string | null | undefined
}) {
  return (
    <ul className="filmstrip">
      {clips.map((c) => (
        <li key={c.id} className={currentClip === c.id ? 'is-live' : ''}>
          {c.still ? (
            <img src={api.mediaUrl(c.still)} alt="" decoding="async" />
          ) : c.video ? (
            <video src={api.mediaUrl(c.video)} muted playsInline preload="metadata" />
          ) : (
            <span className="filmstrip-empty">{currentClip === c.id ? 'Now' : ''}</span>
          )}
          <span className="filmstrip-id">{c.title || c.id}</span>
        </li>
      ))}
    </ul>
  )
})

export function Brain() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { brain, loading, busy, err, start, resume, stop } = useStudioSession()
  const fallback = useMemo(() => idleBrainReport(projectId || ''), [projectId])
  const [sheet, setSheet] = useState<null | 'story' | 'stills' | 'video'>(null)
  const [more, setMore] = useState(false)
  const sentWatch = useRef(false)
  const sawLive = useRef(false)
  const report = brain && (brain.started || (brain.clips && brain.clips.length)) ? brain : fallback
  const running = runIsLive(report)
  const hasMaster = Boolean(report.master)

  useEffect(() => {
    sentWatch.current = false
    sawLive.current = false
  }, [projectId])
  useEffect(() => {
    if (running) sawLive.current = true
  }, [running])
  useEffect(() => {
    if (!projectId || running || report.status !== 'done' || !report.master) return
    if (!sawLive.current || sentWatch.current) return
    sentWatch.current = true
    sawLive.current = false
    navigate(`/studio/${encodeURIComponent(projectId)}/watch`)
  }, [projectId, running, report.status, report.master, navigate])

  if (!projectId) {
    return <p className="text-[15px] text-ghost">Open a project to make the film.</p>
  }

  const clips = report.clips || []
  const t2v = report.videoMode === 't2v'
  const openNode = (id: string) => {
    if (id === 'plan') setSheet('story')
    else if (id === 'stills') {
      if (!t2v) setSheet('stills')
    } else if (id === 'video') setSheet('video')
    else if (id === 'face_qa') {
      if (!t2v) navigate(`/studio/${encodeURIComponent(projectId)}/board`)
    } else if (id === 'finish') navigate(`/studio/${encodeURIComponent(projectId)}/watch`)
  }
  const steps = t2v
    ? (report.steps || []).filter((s) => s.id !== 'stills' && s.id !== 'face_qa')
    : report.steps || []
  const canStart = !running && !busy
  const canStop = running && !busy
  const canResume =
    canStart && Boolean(report.started) && report.status !== 'done' && report.status !== 'idle'
  const primaryLabel = running || busy ? 'Working…' : report.started ? 'Make again' : 'Make movie'
  const statusTone =
    running
      ? 'text-amber'
      : report.status === 'fail' || report.status === 'stopped'
        ? 'text-magenta'
        : 'text-ghost'
  const idle = !report.started && !loading

  return (
    <div className="page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="page-lead">
          {running
            ? 'Making your movie. You can leave this page.'
            : hasMaster
              ? 'The film is ready.'
              : t2v
                ? 'One button. Straight to video, then the film.'
                : 'One button. Stills, motion, then the film.'}
        </p>
        <div className={`text-[15px] ${statusTone}`}>
          {running ? (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber mr-2 align-middle pulse-dot" />
          ) : null}
          {report.label || (report.started ? report.status : 'Ready')}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 min-h-8">
        {hasMaster && !running ? (
          <Link to={`/studio/${encodeURIComponent(projectId)}/watch`} className="btn btn-primary">
            Watch
          </Link>
        ) : null}
        {canStart && !idle ? (
          <button type="button" onClick={() => void start('film')} className="btn btn-primary">
            {primaryLabel}
          </button>
        ) : null}
        {canResume ? (
          <button type="button" onClick={() => void resume()} className="btn btn-secondary">
            Continue
          </button>
        ) : null}
        {canStop ? (
          <button type="button" onClick={() => void stop()} className="btn btn-danger">
            Stop
          </button>
        ) : null}
        {t2v ? null : (
          <button type="button" onClick={() => setMore((v) => !v)} className="btn btn-secondary">
            {more ? 'Less' : 'More'}
          </button>
        )}
      </div>

      {more && !t2v ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void start('stills')}
            className="btn btn-secondary"
          >
            Pictures only
          </button>
        </div>
      ) : null}

      <FailNote error={err} />
      {report.lastError ? <FailNote error={report.lastError} /> : null}

      {idle ? (
        <div className="theater-player theater-empty">
          <div className="play-mark" aria-hidden>
            ▶
          </div>
          <p className="page-lead mt-5 text-center">
            {clips.length ? 'The film is not made yet.' : 'Nothing is rendering yet.'}
          </p>
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void start('film')}
            className="btn btn-primary btn-xl mt-6"
          >
            Make movie
          </button>
        </div>
      ) : (
        <BrainProgress armed={running} />
      )}

      {(running || more) && (report.started || (report.steps || []).length) ? (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2" role="list">
            {steps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-2" role="listitem">
                {i > 0 ? <span className="text-ghost/35 text-xs">→</span> : null}
                <StepNode step={step} />
              </div>
            ))}
          </div>
          <p className="text-[15px] text-ghost mt-4 min-h-[1.35em]">
            {report.currentClip ? `Now ${report.currentClip}` : '\u00a0'}
          </p>
          {report.status === 'face_qa' && !report.reviewOk && !t2v ? (
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

      {clips.length ? <Filmstrip clips={clips} currentClip={report.currentClip} /> : null}

      {hasMaster ? (
        <div className="theater-player">
          <video src={api.brainMasterUrl(projectId)} controls className="theater-video" />
        </div>
      ) : null}

      <details className="card">
        <summary className="text-[15px] text-ghost cursor-pointer">How it is made</summary>
        <div className="mt-4">
          <BrainGraph brain={report} onOpenNode={openNode} />
        </div>
      </details>
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
