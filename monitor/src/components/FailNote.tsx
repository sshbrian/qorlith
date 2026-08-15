import { errorHint, errorMessage } from '../lib/api'

/** One error shape in the UI: what failed, then what to do. */
export function FailNote({ error }: { error: unknown }) {
  if (error == null || error === '') return null
  const msg = errorMessage(error)
  const hint = errorHint(error)
  return (
    <div className="rounded-[14px] bg-magenta/12 px-4 py-3.5">
      <div className="text-[15px] font-medium text-magenta">{msg}</div>
      {hint ? <div className="text-[13px] text-ghost mt-1 leading-relaxed">{hint}</div> : null}
    </div>
  )
}
