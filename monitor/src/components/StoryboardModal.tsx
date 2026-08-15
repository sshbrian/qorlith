import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { FailNote } from './FailNote'
import { MarkdownView } from './MarkdownView'

export function StoryboardModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [markdown, setMarkdown] = useState('')
  const [title, setTitle] = useState('Storyboard')
  const [meta, setMeta] = useState('')
  const [err, setErr] = useState<unknown>(null)

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
      .studioStoryboard(projectId)
      .then((r) => {
        if (!alive) return
        setTitle(r.title || 'Storyboard')
        setMarkdown(r.markdown || '')
        setMeta([r.model, r.updatedAt ? r.updatedAt.replace('T', ' ').slice(0, 16) : ''].filter(Boolean).join(' · '))
      })
      .catch((e) => {
        if (alive) setErr(e)
      })
    return () => {
      alive = false
    }
  }, [projectId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-black/65 backdrop-blur-md" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl max-h-[88vh] flex flex-col rounded-[28px] bg-[#161618] shadow-[0_32px_120px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.08]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-8 pt-7 pb-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-cyan/80">Local LLM · Story</div>
            <h2 className="mt-1 text-[26px] font-semibold tracking-tight truncate">{title}</h2>
            {meta ? <div className="mt-1 text-[13px] text-ghost">{meta}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="text-[15px] text-cyan hover:text-cyan-dim shrink-0 pt-1">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
          <FailNote error={err} />
          {markdown ? <MarkdownView markdown={markdown} /> : !err ? <p className="text-ghost">Writing the board…</p> : null}
        </div>
      </div>
    </div>
  )
}
