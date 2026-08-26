/**
 * Storyboard markdown from a planner record, plus clip workflow sidecars.
 */
import fs from 'fs'
import path from 'path'
import { loadBrain } from './brainStatus.mjs'
import { loadProjectRecord, projectDir } from './project.mjs'
import { loadStudio } from './studioConfig.mjs'

function line(s) {
  return String(s || '').trim()
}

export function buildStoryboardMarkdown(record) {
  const plan = record?.plan || {}
  const title = line(plan.title) || record?.projectId || 'Untitled'
  const clips = Array.isArray(plan.clips) ? plan.clips : []
  const chars = Array.isArray(plan.characters) ? plan.characters : []
  const dur = Number(plan.durationTargetSec) || clips.reduce((a, c) => a + (c.durationSec || 0), 0)
  const bits = [`# ${title}`, '']
  if (plan.logline) {
    bits.push(`> ${line(plan.logline)}`, '')
  }
  const meta = [
    dur ? `**${dur}s**` : null,
    plan.rating ? `**${plan.rating}**` : null,
    plan.lookTrack ? `**${plan.lookTrack}**` : null,
    clips.length ? `**${clips.length} clips**` : null,
    record?.model ? `Writer \`${record.model}\`` : null,
  ].filter(Boolean)
  if (meta.length) bits.push(meta.join(' · '), '')
  if (record?.userPrompt) {
    bits.push('## Brief', '', line(record.userPrompt), '')
  }
  if (chars.length) {
    bits.push('## Cast', '')
    for (const c of chars) {
      bits.push(`### ${c.id || ''} — ${line(c.name) || 'Unnamed'}`, '')
      if (c.look) bits.push(c.look, '')
      if (c.voice) bits.push(`Voice: ${c.voice}`, '')
    }
  }
  if (plan.musicPalette || plan.song) {
    bits.push('## Score', '')
    if (plan.song) bits.push(`**${plan.song}**`, '')
    if (plan.musicPalette) bits.push(plan.musicPalette, '')
  }
  if (clips.length) {
    bits.push('## Storyboard', '')
    for (const c of clips) {
      const t0 = Number.isFinite(c.t_start) ? c.t_start : ''
      const t1 = Number.isFinite(c.t_end) ? c.t_end : ''
      const span = t0 !== '' && t1 !== '' ? ` · ${t0}–${t1}s` : c.durationSec ? ` · ${c.durationSec}s` : ''
      bits.push(`### ${c.id} · ${line(c.title) || c.id}${span}`, '')
      const flags = [
        c.cut ? 'hard cut' : 'continues',
        c.mood || null,
        c.gun_risk ? 'gun risk' : null,
        c.sexy ? 'X' : null,
      ].filter(Boolean)
      if (flags.length) bits.push(`*${flags.join(' · ')}*`, '')
      const t2v = plan.videoMode === 't2v'
      if (t2v) {
        if (c.motionBrief) bits.push('**Scene**', '', c.motionBrief, '')
      } else {
        if (c.stillBrief) bits.push('**Still**', '', c.stillBrief, '')
        if (c.motionBrief) bits.push('**Motion**', '', c.motionBrief, '')
      }
      if (c.dialogue) bits.push('**Dialogue**', '', c.dialogue, '')
      else bits.push('**Dialogue** — none', '')
      if (c.soundscape) bits.push(`**Sound** — ${c.soundscape}`, '')
      if (c.musicNote) bits.push(`**Music** — ${c.musicNote}`, '')
      bits.push('')
    }
  }
  if (plan.markdown) {
    bits.push('## Production notes', '', line(plan.markdown), '')
  }
  if (Array.isArray(plan.warnings) && plan.warnings.length) {
    bits.push('## Warnings', '')
    for (const w of plan.warnings) bits.push(`- ${w}`)
    bits.push('')
  }
  return bits.join('\n').trim() + '\n'
}

export function writeStoryboard(record) {
  const id = record?.projectId
  if (!id) return null
  const md = buildStoryboardMarkdown(record)
  const dir = projectDir(id)
  fs.mkdirSync(dir, { recursive: true })
  const planMd = path.join(dir, 'plan.md')
  const storyMd = path.join(dir, 'storyboard.md')
  fs.writeFileSync(planMd, md, 'utf8')
  fs.writeFileSync(storyMd, md, 'utf8')
  return { planMd, storyMd, markdown: md }
}

function sidecar(mediaPath) {
  if (!mediaPath || !fs.existsSync(mediaPath)) return { workflowPath: null, apiPath: null }
  const base = mediaPath.replace(/\.[^.]+$/i, '')
  const workflowPath = `${base}.workflow.json`
  const apiPath = `${base}.api.json`
  return {
    workflowPath: fs.existsSync(workflowPath) ? workflowPath : null,
    apiPath: fs.existsSync(apiPath) ? apiPath : null,
  }
}

export function listProjectWorkflows(projectId) {
  const rec = loadProjectRecord(projectId)
  const brain = loadBrain(projectId)
  const planClips = rec?.plan?.clips || []
  const brainClips = brain?.clips || []
  const byId = new Map(brainClips.map((c) => [c.id, c]))
  const studio = loadStudio()
  const comfyUrl = String(studio.comfy?.url || 'http://127.0.0.1:8188').replace(/\/$/, '')
  const clips = (planClips.length ? planClips : brainClips).map((c) => {
    const live = byId.get(c.id) || {}
    const still = live.still || live.pick || null
    const video = live.video || null
    return {
      id: c.id,
      title: c.title || live.title || c.id,
      durationSec: c.durationSec ?? live.durationSec ?? null,
      still,
      video,
      stillWorkflow: sidecar(still),
      videoWorkflow: sidecar(video),
    }
  })
  return {
    projectId,
    title: rec?.plan?.title || brain?.title || projectId,
    comfyUrl,
    clips,
  }
}
