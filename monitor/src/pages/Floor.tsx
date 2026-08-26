import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { api, type FloorStatus } from '../lib/api'

function ago(iso: string) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function statusKey(s: FloorStatus | null): string {
  if (!s) return ''
  const p = s.progress
  return [
    s.mood,
    s.statusLine,
    s.updatedAt,
    p?.done,
    p?.total,
    p?.failed,
    p?.phase,
    p?.currentShot,
    p?.masterPath,
    s.updates?.length,
    s.updates?.[0]?.id,
  ].join('|')
}

export function Floor() {
  const [status, setStatus] = useState<FloorStatus | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [, setTick] = useState(0)
  const keyRef = useRef('')

  const refresh = useCallback(() => {
    api
      .floorStatus()
      .then((r) => {
        const next = r.status
        const k = statusKey(next)
        if (k !== keyRef.current) {
          keyRef.current = k
          setStatus(next)
        }
        setErr(null)
      })
      .catch((e) => setErr(e))
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    const agoTimer = setInterval(() => setTick((n) => n + 1), 15000)
    return () => {
      clearInterval(t)
      clearInterval(agoTimer)
    }
  }, [refresh])

  const s = status
  const prog = s?.progress
  const updates = s?.updates || []

  return (
    <div className="space-y-5">
      <p className="text-[15px] text-ghost">
        {s?.statusLine || 'Nothing is making a film right now.'}
        {s?.updatedAt ? ` · ${ago(s.updatedAt)}` : ''}
      </p>

      <FailNote error={err} />

      <div className="card">
        <div className="flex flex-wrap justify-between gap-2 items-baseline mb-3">
          <div className="text-[13px] text-ghost">This film</div>
          <div className="text-[15px]">
            {prog?.project && prog.project !== 'idle'
              ? String(prog.project).replace(/_/g, ' ')
              : 'Idle'}
          </div>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, prog?.percent || 0))}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[13px] text-ghost">
          <span>
            {prog?.done ?? 0} of {prog?.total ?? 0} clips
          </span>
          {(prog?.failed ?? 0) > 0 ? <span className="text-magenta">{prog?.failed} failed</span> : null}
          {prog?.currentShot ? <span>Now {prog.currentShot}</span> : null}
        </div>
        {prog?.detail ? <div className="mt-1 text-[13px] text-ghost">{prog.detail}</div> : null}
        {s?.friends?.length ? (
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ghost">
            {s.friends.map((f) => (
              <span key={f.name}>
                {f.name}
                {f.blurb ? ` · ${f.blurb}` : ''}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-4">
          <Link
            to={
              prog?.project && prog.project !== 'idle'
                ? `/studio/${encodeURIComponent(String(prog.project))}/watch`
                : '/studio'
            }
            className="btn btn-secondary"
          >
            Watch the film
          </Link>
        </div>
      </div>

      {updates.some((u) => u.kind === 'error') ? (
        <div className="card bg-magenta/10">
          <div className="text-[15px] mb-2">Recent errors</div>
          <ul className="space-y-2 text-[13px]">
            {updates
              .filter((u) => u.kind === 'error')
              .slice(0, 5)
              .map((u) => (
                <li key={u.id}>
                  <span className="text-ghost">{ago(u.at)}</span> — {u.text}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      <div>
        <div className="text-[13px] text-ghost mb-2">What happened</div>
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {updates.length === 0 ? (
            <p className="text-[15px] text-ghost">No events yet.</p>
          ) : (
            updates.map((u) => (
              <div key={u.id} className="card py-3">
                <div className="flex flex-wrap justify-between gap-1 text-[12px] text-ghost mb-1">
                  <span>{u.mood || u.kind || 'update'}</span>
                  <span>{ago(u.at)}</span>
                </div>
                <p className="text-[15px] leading-snug whitespace-pre-wrap">{u.text}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
