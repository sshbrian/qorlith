export function PosterCard({
  title,
  meta,
  coverUrl,
  live,
  onClick,
}: {
  title: string
  meta?: string
  coverUrl?: string | null
  live?: boolean
  onClick: () => void
}) {
  const letter = (title || '?').slice(0, 1).toUpperCase()
  return (
    <button type="button" onClick={onClick} className="poster-card">
      <div className="poster-still">
        {coverUrl ? <img src={coverUrl} alt="" /> : <div className="poster-empty">{letter}</div>}
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
