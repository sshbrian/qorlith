import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArchiveProjectDialog } from '../components/ArchiveProjectDialog'
import { FailNote } from '../components/FailNote'
import { VideoModeToggle, type VideoMode } from '../components/VideoModeToggle'
import {
  api,
  type StudioMoviePlan,
  type StudioPlanClip,
  type StudioPlanRecord,
} from '../lib/api'
import { clipJoinNote, PROMPT_PLACEHOLDER, PROMPT_STARTERS, VIDEO_MODE_HINT } from '../lib/studio'

function ClipCard({
  clip,
  index,
  selected,
  onSelect,
}: {
  clip: StudioPlanClip
  index: number
  selected: boolean
  onSelect: () => void
}) {
  const join = clipJoinNote(index, clip.cut)
  return (
    <button type="button" onClick={onSelect} className={['script-take', selected ? 'is-on' : ''].join(' ')}>
      <span className="script-take-id">{clip.id}</span>
      <span className="script-take-title">{clip.title}</span>
      <span className="script-take-dur">
        {clip.durationSec}s{join ? ` · ${join}` : ''}
      </span>
    </button>
  )
}

function Timeline({
  clips,
  selectedId,
  onSelect,
}: {
  clips: StudioPlanClip[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const total = Math.max(
    1,
    ...clips.map((c) => c.t_end || c.t_start + c.durationSec),
    clips.reduce((a, c) => a + (c.durationSec || 0), 0),
  )
  return (
    <div className="script-reel">
      <div className="script-reel-track">
        {clips.map((c, i) => {
          const w = Math.max(8, ((c.durationSec || 8) / total) * 100)
          const sel = selectedId === c.id
          const join = clipJoinNote(i, c.cut)
          return (
            <button
              key={c.id}
              type="button"
              title={`${c.id} ${c.title} · ${c.durationSec}s${join ? ` · ${join}` : ''}`}
              onClick={() => onSelect(c.id)}
              style={{ flex: `${c.durationSec || 8} 1 0`, minWidth: `${w * 0.4}%` }}
              className={`script-reel-take ${sel ? 'is-on' : ''} ${c.cut && i > 0 ? 'is-cut' : ''}`}
            >
              {c.id}
            </button>
          )
        })}
      </div>
      <div className="script-reel-time">
        <span>0s</span>
        <span>{Math.round(total)}s</span>
      </div>
    </div>
  )
}

function PlanVisual({ plan }: { plan: StudioMoviePlan }) {
  const t2v = plan.videoMode === 't2v'
  const [selectedId, setSelectedId] = useState<string | null>(plan.clips[0]?.id || null)
  useEffect(() => {
    setSelectedId(plan.clips[0]?.id || null)
  }, [plan.projectId, plan.clips])

  const selectedIndex = Math.max(
    0,
    plan.clips.findIndex((c) => c.id === selectedId),
  )
  const selected = useMemo(
    () => plan.clips.find((c) => c.id === selectedId) || plan.clips[0] || null,
    [plan.clips, selectedId],
  )
  const selectedJoin = selected ? clipJoinNote(selectedIndex, selected.cut) : ''

  return (
    <div className="script-pages">
      <div className="script-sheet">
        <h1 className="script-title">{plan.title}</h1>
        {plan.logline ? <p className="script-logline">{plan.logline}</p> : null}
        <p className="script-colophon">
          {plan.durationTargetSec}s · {plan.clips.length} clips
          {plan.rating ? ` · ${plan.rating}` : ''}
        </p>
        {plan.musicPalette ? <p className="script-music">{plan.musicPalette}</p> : null}
        {plan.warnings?.length ? (
          <p className="script-warn">{plan.warnings.join(' · ')}</p>
        ) : null}
      </div>

      <Timeline clips={plan.clips} selectedId={selectedId} onSelect={setSelectedId} />

      {plan.characters?.length ? (
        <div className="script-cast">
          {plan.characters.map((ch) => (
            <div key={ch.id} className="script-cast-name">
              <div>{ch.name}</div>
              {ch.look ? <p>{ch.look}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="script-takes">
        <aside className="script-take-list">
          {plan.clips.map((c, i) => (
            <ClipCard
              key={c.id}
              clip={c}
              index={i}
              selected={selected?.id === c.id}
              onSelect={() => setSelectedId(c.id)}
            />
          ))}
        </aside>
        <section className="script-page">
          {selected ? (
            <>
              <h2 className="script-scene">
                {selected.id}
                <span>{selected.title}</span>
              </h2>
              {selectedJoin ? <p className="script-join">{selectedJoin}</p> : null}
              {t2v ? null : <Field label="Still" value={selected.stillBrief} />}
              <Field label={t2v ? 'Scene' : 'Clip'} value={selected.motionBrief} />
              <Field label="Dialogue" value={selected.dialogue} />
              <Field label="Sound" value={selected.soundscape} />
              <Field label="Music" value={selected.musicNote} />
            </>
          ) : (
            <p className="script-join">The page is blank.</p>
          )}
        </section>
      </div>

      {plan.markdown ? (
        <details className="card">
          <summary className="text-[15px] text-ghost cursor-pointer">Show full script</summary>
          <pre className="mt-3 terminal p-4 text-[13px] whitespace-pre-wrap max-h-80 overflow-auto">
            {plan.markdown}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="script-field">
      <div className="script-kicker">{label}</div>
      <div className="script-body">{value}</div>
    </div>
  )
}

function writerLabel(health: Awaited<ReturnType<typeof api.studioHealth>> | null) {
  const p = health?.planner?.provider
  if (p === 'none') return 'Paste a plan under More'
  if (p === 'xai') return health?.ok ? 'Grok is ready' : 'Add a Grok key to write'
  if (p === 'openai') return health?.ok ? 'Remote writer is ready' : 'Remote writer needs a key'
  return health?.ok ? 'Local writer is ready' : 'Local writer is offline'
}

export function StudioPlanner() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [videoMode, setVideoMode] = useState<VideoMode>('stills')
  const [dryRun, setDryRun] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.studioHealth>> | null>(null)
  const [record, setRecord] = useState<StudioPlanRecord | null>(null)
  const [approveMsg, setApproveMsg] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [importText, setImportText] = useState('')

  useEffect(() => {
    api
      .studioHealth()
      .then(setHealth)
      .catch((e) => setHealth({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  }, [])

  useEffect(() => {
    if (!projectId) return
    let alive = true
    api
      .studioPlanGet(projectId)
      .then((r) => {
        if (!alive) return
        setRecord(r.record)
        if (!prompt && r.record?.userPrompt) setPrompt(r.record.userPrompt)
        if (r.record?.plan?.videoMode === 't2v') setVideoMode('t2v')
      })
      .catch(() => {
        if (alive) setRecord(null)
      })
    return () => {
      alive = false
    }
    // only reload when the project changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const generate = async () => {
    setBusy(true)
    setErr(null)
    setApproveMsg(null)
    try {
      let imported: StudioMoviePlan | undefined
      const raw = importText.trim()
      if (raw) {
        imported = JSON.parse(raw) as StudioMoviePlan
      }
      const r = await api.studioPlan({ prompt, dryRun, projectId, plan: imported, videoMode })
      setRecord(r.record)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const makeMovie = async () => {
    setBusy(true)
    setErr(null)
    setApproveMsg(null)
    try {
      let imported: StudioMoviePlan | undefined
      const raw = importText.trim()
      if (raw) imported = JSON.parse(raw) as StudioMoviePlan
      const r = await api.studioFilm({ prompt, projectId, dryRun, plan: imported, videoMode })
      setRecord(r.record)
      if (r.projectId && !dryRun) navigate(`/studio/${encodeURIComponent(r.projectId)}/make`)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    if (!record?.projectId) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.studioPlanApprove(record.projectId, { startProduction: true })
      setApproveMsg(
        r.message || 'Plan locked. Open Make to make the film.',
      )
      // reload record
      const again = await api.studioPlanGet(record.projectId)
      setRecord(again.record)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const confirmArchiveProject = async () => {
    if (!record?.projectId) return
    setArchiveBusy(true)
    setErr(null)
    try {
      const r = await api.studioPlanArchive(record.projectId)
      setApproveMsg(
        r.message ||
          `Archived project ${r.projectId} · ${r.addedCount} media file(s) hidden from Gallery.`,
      )
      setArchiveOpen(false)
      if (r.record) setRecord(r.record)
      else {
        const again = await api.studioPlanGet(record.projectId)
        setRecord(again.record)
      }
    } catch (e) {
      setErr(e)
      setArchiveOpen(false)
    } finally {
      setArchiveBusy(false)
    }
  }

  const plan = record?.plan

  return (
    <div className="script">
      {plan ? null : (
        <div className="script-sheet script-sheet-write">
          <p className="script-colophon">{writerLabel(health)}</p>
          <label className="sr-live" htmlFor="script-prompt">
            What happens in the film?
          </label>
          <textarea
            id="script-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void makeMovie()
            }}
            rows={4}
            placeholder={PROMPT_PLACEHOLDER}
            className="script-cover-field title-card-field"
          />
          <div className="title-card-starters">
            {PROMPT_STARTERS.map((s) => (
              <button key={s.label} type="button" className="chip" onClick={() => setPrompt(s.text)}>
                {s.label}
              </button>
            ))}
          </div>
          <VideoModeToggle value={videoMode} onChange={setVideoMode} />
          <p className="title-card-hint">{VIDEO_MODE_HINT[videoMode]}</p>
          {health && !health.ok && health.planner?.provider === 'local' ? (
            <span className="text-[13px] text-amber">
              Local writer is offline — paste a plan under More, or start LM Studio.
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy || (!prompt.trim() && !importText.trim())}
            onClick={() => void makeMovie()}
            className="btn btn-primary btn-xl title-card-go"
          >
            {busy ? 'Starting…' : 'Make movie'}
          </button>
        </div>
      )}

      <FailNote error={err} />

      {approveMsg ? (
        <div className="card text-[15px] space-y-2">
          <div>{approveMsg}</div>
        </div>
      ) : null}

      {plan ? (
        <>
          <PlanVisual plan={plan} />
          <button
            type="button"
            disabled={busy || (!prompt.trim() && !importText.trim())}
            onClick={() => void makeMovie()}
            className="btn btn-primary btn-xl title-card-go script-go"
          >
            {busy ? 'Starting…' : 'Make movie'}
          </button>
        </>
      ) : null}

      <details className="card">
        <summary className="text-[13px] text-ghost cursor-pointer">More (plan only, import JSON, archive)</summary>
        <div className="mt-4 space-y-3">
          <label className="block text-[13px] text-ghost">Paste a plan JSON</label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={4}
            placeholder='{"title":"Night Drop","lookTrack":"anime","clips":[...]}'
            className="field resize-y min-h-[88px] font-mono text-[12px]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || (!prompt.trim() && !importText.trim())}
              onClick={generate}
              className="btn btn-secondary"
            >
              {busy ? 'Working…' : 'Plan only'}
            </button>
            <label className="flex items-center gap-2 text-xs text-ghost cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Demo story
            </label>
            {plan && record?.projectId ? (
              <>
                <button
                  type="button"
                  disabled={busy || record?.approved || record?.archived}
                  onClick={approve}
                  className="btn btn-secondary"
                >
                  {record?.archived ? 'Archived' : record?.approved ? 'Story locked' : 'Lock this story'}
                </button>
                <button
                  type="button"
                  disabled={busy || archiveBusy || !record?.projectId || record?.archived}
                  onClick={() => setArchiveOpen(true)}
                  className="text-[13px] text-ghost hover:text-magenta px-2"
                >
                  Archive
                </button>
              </>
            ) : null}
          </div>
        </div>
      </details>

      <ArchiveProjectDialog
        open={Boolean(archiveOpen && record?.projectId)}
        busy={archiveBusy}
        projectId={record?.projectId || projectId || ''}
        label={record?.plan?.title || record?.projectId}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() => void confirmArchiveProject()}
      />
    </div>
  )
}
