import type { ReactNode } from 'react'

export function ArchiveProjectDialog({
  open,
  busy,
  projectId,
  label,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean
  busy: boolean
  projectId: string
  label?: string
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-void/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-project-title"
      onClick={() => !busy && onCancel()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel()
      }}
    >
      <div
        className="glass max-w-md w-full rounded-xl border border-magenta/40 p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="archive-project-title" className="text-lg text-ink font-medium">
          Archive entire project?
        </h2>
        <p className="text-sm text-ghost leading-relaxed">
          Put <strong className="text-ink">{label || projectId}</strong> away. It leaves the rail
          and All media. Nothing is deleted.
        </p>
        <ul className="text-xs text-ghost space-y-1 list-disc pl-4">
          <li>The project and its stills stay on disk</li>
          <li>
            Restore it later from <strong className="text-ink">Archive</strong> in the left rail
          </li>
        </ul>
        {children}
        <div className="flex flex-wrap gap-2 justify-end pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="btn btn-danger"
          >
            {busy ? 'Archiving…' : 'Yes, archive project'}
          </button>
        </div>
      </div>
    </div>
  )
}