export function StatCard({
  label,
  value,
  hint,
  accent = 'cyan',
}: {
  label: string
  value: string
  hint?: string
  accent?: 'cyan' | 'magenta' | 'amber'
}) {
  const color =
    accent === 'magenta' ? 'text-magenta' : accent === 'amber' ? 'text-amber' : 'text-cyan'
  return (
    <div className="glass rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-[0.25em] text-ghost mb-2">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-ghost/80">{hint}</div> : null}
    </div>
  )
}
