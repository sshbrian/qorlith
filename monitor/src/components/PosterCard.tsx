export function CoverThumb({
  url,
  kind,
  className,
}: {
  url?: string | null
  kind?: string | null
  className?: string
}) {
  if (!url) return null
  if (kind === 'video') {
    return <video src={url} muted playsInline preload="metadata" className={className} />
  }
  return <img src={url} alt="" className={className} />
}

export function PosterCard({
  title,
  meta,
  coverUrl,
  coverKind,
  live,
  onClick,
}: {
  title: string
  meta?: string
  coverUrl?: string | null
  coverKind?: string | null
  live?: boolean
  onClick: () => void
}) {
  const letter = (title || '?').slice(0, 1).toUpperCase()
  return (
    <button type="button" onClick={onClick} className="poster-card">
      <div className="poster-still">
        {coverUrl ? (
          <CoverThumb url={coverUrl} kind={coverKind} />
        ) : (
          <div className="poster-empty">{letter}</div>
        )}
        <div className="poster-shade" />
        {live ? <span className="poster-live">Making now</span> : null}
      </div>
      <div className="poster-body">
        <div className="text-[16px] font-semibold tracking-tight truncate">{title}</div>
        {meta ? <div className="text-[12px] text-ghost mt-1 truncate">{meta}</div> : null}
      </div>
    </button>
  )
}
