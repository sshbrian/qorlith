import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArchiveProjectDialog } from '../components/ArchiveProjectDialog'
import { FailNote } from '../components/FailNote'
import {
  api,
  type StudioMoviePlan,
  type StudioPlanClip,
  type StudioPlanRecord,
} from '../lib/api'

const PROMPT_PLACEHOLDER = `Example:
30 second rated-R found-footage action short, real_movie look.
Handheld camcorder, two adult characters, radio dialogue, MiniMax music.
End on a chase and a last radio line.`

function ClipCard({
  clip,
  selected,
  onSelect,
}: {
  clip: StudioPlanClip
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-[12px] px-3 py-2.5 ${
        selected ? 'bg-white/[0.1]' : 'bg-white/[0.03] hover:bg-white/[0.06]'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] truncate">{clip.title}</span>
        <span className="text-[12px] text-ghost shrink-0">{clip.durationSec}s</span>
      </div>
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
    <div className="mt-3">
      <div className="flex gap-0.5 h-10 items-stretch">
        {clips.map((c) => {
          const w = Math.max(8, ((c.durationSec || 8) / total) * 100)
          const sel = selectedId === c.id
          return (
            <button
              key={c.id}
              type="button"
              title={`${c.id} ${c.title} · ${c.durationSec}s`}
              onClick={() => onSelect(c.id)}
              style={{ flex: `${c.durationSec || 8} 1 0`, minWidth: `${w * 0.4}%` }}
              className={`rounded-[8px] text-[11px] transition ${
                sel ? 'bg-cyan text-white' : 'bg-white/[0.08] text-ghost hover:text-ink'
              }`}
            >
              {c.id}
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-ghost">
        <span>0s</span>
        <span>{Math.round(total)}s</span>
      </div>
    </div>
  )
}

function PlanVisual({ plan }: { plan: StudioMoviePlan }) {
  const [selectedId, setSelectedId] = useState<string | null>(plan.clips[0]?.id || null)
  useEffect(() => {
    setSelectedId(plan.clips[0]?.id || null)
  }, [plan.projectId, plan.clips])

  const selected = useMemo(
    () => plan.clips.find((c) => c.id === selectedId) || plan.clips[0] || null,
    [plan.clips, selectedId],
  )

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[22px] font-semibold tracking-tight">{plan.title}</div>
            <p className="text-[15px] text-ghost mt-1.5 max-w-2xl leading-relaxed">{plan.logline}</p>
          </div>
          <div className="text-[13px] text-ghost">
            {plan.durationTargetSec}s · {plan.clips.length} clips
            {plan.rating ? ` · ${plan.rating}` : ''}
          </div>
        </div>
        <Timeline clips={plan.clips} selectedId={selectedId} onSelect={setSelectedId} />
        {plan.musicPalette ? (
          <div className="mt-4 text-[13px] text-ghost">{plan.musicPalette}</div>
        ) : null}
        {plan.warnings?.length ? (
          <div className="mt-3 text-[13px] text-amber">{plan.warnings.join(' · ')}</div>
        ) : null}
      </div>

      {plan.characters?.length ? (
        <div className="card">
          <div className="text-[13px] text-ghost mb-3">Cast</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {plan.characters.map((ch) => (
              <div key={ch.id}>
                <div className="text-[15px]">{ch.name}</div>
                <div className="text-[13px] text-ghost mt-0.5">{ch.look || '—'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[240px_1fr] gap-3">
        <aside className="space-y-1 max-h-[420px] overflow-y-auto">
          {plan.clips.map((c) => (
            <ClipCard
              key={c.id}
              clip={c}
              selected={selected?.id === c.id}
              onSelect={() => setSelectedId(c.id)}
            />
          ))}
        </aside>
        <section className="card min-h-[280px]">
          {selected ? (
            <div className="space-y-4 text-[15px]">
              <div>
                <h2 className="text-[20px] font-semibold tracking-tight">{selected.title}</h2>
                <div className="text-[13px] text-ghost mt-0.5">{selected.id}</div>
              </div>
              <Field label="Still" value={selected.stillBrief} />
              <Field label="Motion" value={selected.motionBrief} />
              <Field label="Dialogue" value={selected.dialogue} />
              <Field label="Sound" value={selected.soundscape} />
              <Field label="Music" value={selected.musicNote} />
            </div>
          ) : (
            <p className="text-ghost text-[15px]">Select a clip</p>
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
    <div>
      <div className="text-[13px] text-ghost mb-1">{label}</div>
      <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{value}</div>
    </div>
  )
}

export function StudioPlanner() {
  const { projectId } = useParams()
  const [prompt, setPrompt] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.studioHealth>> | null>(null)
  const [record, setRecord] = useState<StudioPlanRecord | null>(null)
  const [approveMsg, setApproveMsg] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)

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
      const r = await api.studioPlan({ prompt, dryRun, projectId })
      setRecord(r.record)
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
      setApproveMsg(r.message || 'Plan locked. Open Make to paint the stills.')
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
    <div className="page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="page-lead">Write the story, then Make the film.</p>
        </div>
        <div className="text-[13px] text-ghost">{health?.ok ? 'Writer is on' : 'Writer is off'}</div>
      </div>

      {plan ? (
        <div className="flex flex-wrap gap-2 items-center">
          {record?.projectId ? (
            <Link to={`/studio/${encodeURIComponent(record.projectId)}/make`} className="btn btn-primary">
              Make the film
            </Link>
          ) : null}
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
            {record?.archived ? 'Project archived' : 'Archive'}
          </button>
        </div>
      ) : null}

      {plan ? <PlanVisual plan={plan} /> : null}

      <div className="card space-y-3">
        <label className="block text-[13px] text-ghost">What happens in the film?</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder={PROMPT_PLACEHOLDER}
          className="field resize-y min-h-[140px]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !prompt.trim()}
            onClick={generate}
            className="btn btn-primary"
          >
            {busy ? 'Working…' : 'Generate plan'}
          </button>
          <label className="flex items-center gap-2 text-xs text-ghost cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            Use a demo story
          </label>
          {!health?.ok ? (
            <span className="text-[11px] text-amber">
              Writer is offline — use a demo story, or start the local writer on :1234
            </span>
          ) : null}
        </div>
      </div>

      <FailNote error={err} />

      {approveMsg ? (
        <div className="card text-[15px] space-y-2">
          <div>{approveMsg}</div>
        </div>
      ) : null}

      {!plan ? (
        <div className="card text-center text-ghost text-[15px]">
          Generate a plan to see the timeline and per-clip still, motion, and dialogue.
        </div>
      ) : null}

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
