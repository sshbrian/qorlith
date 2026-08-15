import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { FailNote } from './FailNote'

type Kind = 'still' | 'video'

type ClipWf = {
  id: string
  title: string
  durationSec: number | null
  still: string | null
  video: string | null
  stillWorkflow: { workflowPath: string | null; apiPath: string | null }
  videoWorkflow: { workflowPath: string | null; apiPath: string | null }
}

function openInComfy(comfyUrl: string, apiPath: string | null) {
  const base = comfyUrl.replace(/\/$/, '')
  if (apiPath) {
    const jsonUrl = `${window.location.origin}${api.mediaUrl(apiPath)}`
    window.open(`${base}/?workflow=${encodeURIComponent(jsonUrl)}`, '_blank', 'noopener')
    return
  }
  window.open(`${base}/`, '_blank', 'noopener')
}

export function WorkflowModal({
  projectId,
  kind,
  onClose,
}: {
  projectId: string
  kind: Kind
  onClose: () => void
}) {
  const [err, setErr] = useState<unknown>(null)
  const [title, setTitle] = useState('')
  const [comfyUrl, setComfyUrl] = useState('http://127.0.0.1:8188')
  const [clips, setClips] = useState<ClipWf[]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    api
      .studioWorkflows(projectId)
      .then((r) => {
        if (!alive) return
        setTitle(r.title || projectId)
        setComfyUrl(r.comfyUrl || 'http://127.0.0.1:8188')
        setClips(r.clips || [])
      })
      .catch((e) => {
        if (alive) setErr(e)
      })
    return () => {
      alive = false
    }
  }, [projectId])

  const heading = kind === 'still' ? 'Pictures · Comfy stills' : 'Motion · Comfy video'
  const ready = clips.filter((c) => (kind === 'still' ? c.stillWorkflow.apiPath : c.videoWorkflow.apiPath))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-black/65 backdrop-blur-md" onClick={onClose}>
      <div
        className="relative w-full max-w-xl max-h-[88vh] flex flex-col rounded-[28px] bg-[#161618] shadow-[0_32px_120px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.08]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-cyan/80">{heading}</div>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight truncate">{title}</h2>
            <p className="mt-1.5 text-[13px] text-ghost leading-relaxed">
              Each clip keeps the exact API graph that Comfy ran. Open it on the canvas, or download the JSON.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[15px] text-cyan hover:text-cyan-dim shrink-0 pt-1">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 space-y-2">
          <FailNote error={err} />
          {!clips.length && !err ? <p className="text-ghost">No clips yet.</p> : null}
          {clips.map((c) => {
            const wf = kind === 'still' ? c.stillWorkflow : c.videoWorkflow
            const apiPath = wf.apiPath
            const media = kind === 'still' ? c.still : c.video
            return (
              <div key={c.id} className="rounded-[16px] bg-white/[0.04] px-4 py-3.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium truncate">
                    {c.id} · {c.title}
                  </div>
                  <div className="text-[12px] text-ghost mt-0.5">
                    {c.durationSec != null ? `${c.durationSec}s` : ''}
                    {media ? '' : ' · not rendered yet'}
                    {media && !apiPath ? ' · workflow missing' : ''}
                  </div>
                </div>
                {apiPath ? (
                  <div className="flex shrink-0 gap-2">
                    <a
                      href={api.mediaUrl(apiPath)}
                      download
                      className="text-[13px] text-ghost hover:text-ink px-2 py-1"
                    >
                      JSON
                    </a>
                    <button
                      type="button"
                      className="btn btn-primary !py-1.5 !px-3 !text-[13px]"
                      onClick={() => openInComfy(comfyUrl, apiPath)}
                    >
                      Open in Comfy
                    </button>
                  </div>
                ) : (
                  <span className="text-[12px] text-ghost/70">—</span>
                )}
              </div>
            )
          })}
          {ready.length ? (
            <p className="pt-2 text-[12px] text-ghost leading-relaxed">
              Graphs also live under Comfy → Workflows → <span className="font-mono text-ink">qorlith/</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
