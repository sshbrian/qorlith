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
          Hide media for <strong className="text-ink">{label || projectId}</strong>{' '}
          (<span className="font-mono text-cyan">{projectId}</span>) from the default Gallery.
        </p>
        {children || (
          <ul className="text-xs text-ghost space-y-1 list-disc pl-4">
            <li>All stills and videos under the project folders are archived</li>
            <li>
              Files are <strong className="text-ink">not deleted</strong> — restore via Gallery
              “show archived”
            </li>
            <li>Project stays on disk and is marked archived</li>
          </ul>
        )}
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