/**
 * Shared Comfy API workflow snapshot writer for stills + video.
 */
import fs from 'fs'
import path from 'path'

/**
 * Persist the exact API prompt graph that was queued.
 * - Next to media: *.workflow.json + *.api.json
 * - Into Comfy user/default/workflows/qorlith/
 *
 * @param {{
 *   prompt: object,
 *   mediaPath?: string,
 *   mp4Path?: string,
 *   outputRoot?: string,
 *   comfyRoot?: string,
 *   promptId?: string,
 *   seed?: number,
 *   templatePath?: string,
 *   kind?: string,
 *   extra?: object
 * }} opts
 */
export function saveWorkflowSnapshot({
  prompt,
  mediaPath,
  mp4Path,
  outputRoot,
  comfyRoot,
  promptId,
  seed,
  templatePath,
  kind = 'unknown',
  extra = {},
}) {
  const media = mediaPath || mp4Path
  if (!media) throw new Error('saveWorkflowSnapshot: mediaPath required')
  const base = media.replace(/\.[^.]+$/i, '')
  const workflowPath = `${base}.workflow.json`
  const payload = {
    _qorlith: {
      schema: 'qorlith.workflow.v1',
      kind: 'comfy_api_prompt',
      mediaKind: kind,
      savedAt: new Date().toISOString(),
      promptId: promptId || null,
      seed: seed ?? null,
      templatePath: templatePath || null,
      sourceMedia: media,
      sourceVideo: kind === 'video' ? media : null,
      sourceImage: kind === 'image' ? media : null,
      note: 'API-format graph (class_type nodes). In Comfy: drag onto canvas, or Workflows → qorlith.',
      ...extra,
    },
    prompt,
  }
  fs.writeFileSync(workflowPath, JSON.stringify(payload, null, 2), 'utf8')

  const barePath = `${base}.api.json`
  fs.writeFileSync(barePath, JSON.stringify(prompt, null, 2), 'utf8')

  let comfyWorkflowPath = null
  let comfyWorkflowName = null
  try {
    const root = String(comfyRoot || '').trim()
    if (!root) throw new Error('no comfyRoot')
    const wfDir = path.join(root, 'user', 'default', 'workflows', 'qorlith')
    fs.mkdirSync(wfDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const short = path.basename(base).replace(/_+$/, '').slice(0, 60)
    comfyWorkflowName = `qorlith/${short}_${stamp}`
    comfyWorkflowPath = path.join(wfDir, `${short}_${stamp}.json`)
    fs.writeFileSync(comfyWorkflowPath, JSON.stringify(payload, null, 2), 'utf8')
    fs.writeFileSync(
      path.join(wfDir, `${short}_${stamp}.api.json`),
      JSON.stringify(prompt, null, 2),
      'utf8',
    )
  } catch {
    comfyWorkflowPath = null
    comfyWorkflowName = null
  }

  let workflowRel = workflowPath
  try {
    if (outputRoot) {
      workflowRel = path.relative(outputRoot, workflowPath).replace(/\\/g, '/')
    }
  } catch {
    /* keep abs */
  }

  return {
    workflowPath,
    workflowRel,
    bareApiPath: barePath,
    workflowApiPath: barePath,
    comfyWorkflowPath,
    comfyWorkflowName,
  }
}
