import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { applyMinimaxJob, composeH3Prompt, findMp4, loadVideoTemplate } from './comfyVideo.mjs'
import { getVideoWorkflowPath } from './studioConfig.mjs'
import { dryRunVideoPlan } from './director.mjs'

describe('MiniMax H3 video plan', () => {
  it('dry-run exposes motion / dialogue / music', () => {
    const { plan } = dryRunVideoPlan('slow pan')
    assert.match(plan.motion, /slow pan/i)
    assert.equal(typeof plan.dialogue, 'string')
    assert.ok(plan.durationSec >= 4)
    assert.equal(plan.fps, 24)
  })

  it('workflow path comes from yaml (may be empty)', () => {
    const p = getVideoWorkflowPath()
    assert.equal(typeof p, 'string')
  })

  it('applyMinimaxJob writes H3 prompt and frame length', () => {
    const graph = {
      '136': {
        class_type: 'MiniMaxH3ImageToVideo',
        inputs: {
          prompt: 'old template prompt',
          width: 960,
          height: 544,
          length: 158,
        },
      },
      '137': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
    }
    const { prompt, report } = applyMinimaxJob(graph, {
      motion: 'she walks toward the camera in the rain',
      dialogue: '',
      music: 'low synth pulse',
      durationSec: 7,
      fps: 24,
      inputImageName: 'staged.png',
    })
    assert.match(prompt['136'].inputs.prompt, /walks toward the camera/)
    assert.equal(prompt['136'].inputs.length, 168)
    assert.equal(prompt['137'].inputs.image, 'staged.png')
    assert.ok(report.some((r) => r.field === 'prompt'))
    assert.ok(report.some((r) => r.field === 'length_frames'))
  })

  it('composeH3Prompt uses official H3 fields and keeps silent clips silent', () => {
    const cut = composeH3Prompt({ motion: 'she turns', dialogue: '', music: 'N/A' })
    assert.match(cut, /integrated_multimodal_description/)
    assert.match(cut, /overall_soundscape/)
    assert.match(cut, /lips remain completely closed/)
    assert.doesNotMatch(cut, /^No dialogue\.$/m)
    assert.doesNotMatch(cut, /^dialogue:/m)
    const spoken = composeH3Prompt({
      motion: 'she turns',
      dialogue: 'the adult woman (S1) says: <d>[English] Copy.</d>',
      music: 'low cello drone at a slow tempo',
      soundscape: 'wind, distant gunfire',
    })
    assert.match(spoken, /<d>\[English\] Copy\.<\/d>/)
    assert.match(spoken, /overall_soundscape: wind, distant gunfire/)
    assert.match(spoken, /non_diegetic_music: low cello drone/)
    const cont = composeH3Prompt({
      motion: 'she turns',
      dialogue: '',
      music: 'N/A',
      continueFromPrior: true,
    })
    assert.match(cont, /Continue the action from this pose/)
    assert.doesNotMatch(cont, /last frame of the previous shot/)
  })

  it('applyMinimaxJob sets motion, dialogue, and music on named inputs', () => {
    const graph = {
      '1': {
        class_type: 'MiniMax',
        inputs: { motion: 'old', dialogue: 'old', music: 'old', image: 'in.png' },
      },
    }
    const { prompt, report } = applyMinimaxJob(graph, {
      motion: 'slow pan left',
      dialogue: '(S1) hello',
      music: 'radio hiss',
      inputImageName: 'staged.png',
    })
    assert.equal(prompt['1'].inputs.motion, 'slow pan left')
    assert.equal(prompt['1'].inputs.dialogue, '(S1) hello')
    assert.equal(prompt['1'].inputs.music, 'radio hiss')
    assert.equal(prompt['1'].inputs.image, 'staged.png')
    assert.ok(report.some((r) => r.field === 'motion'))
    assert.ok(report.some((r) => r.field === 'dialogue'))
    assert.ok(report.some((r) => r.field === 'music'))
  })

  it('findMp4 stays under the job prefix and ignores other S01 files', () => {
    const root = fs.mkdtempSync(`${os.tmpdir()}/qorlith-mp4-`)
    try {
      const wantDir = path.join(root, 'qorlith', 'anime', 'harbor', 'video')
      fs.mkdirSync(wantDir, { recursive: true })
      fs.mkdirSync(path.join(root, 'other', 'S01'), { recursive: true })
      fs.writeFileSync(path.join(root, 'other', 'S01', 'S01_p1_00001_.mp4'), 'old')
      const now = Date.now()
      assert.equal(findMp4(root, 'qorlith/anime/harbor/video/S01', { sinceMs: now }), null)
      const fresh = path.join(wantDir, 'S01_00001_.mp4')
      fs.writeFileSync(fresh, 'new-video')
      assert.equal(findMp4(root, 'qorlith/anime/harbor/video/S01', { sinceMs: now - 1000 }), fresh)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('empty workflow tells you to set video.workflow', () => {
    const yamlPath = getVideoWorkflowPath()
    if (yamlPath && fs.existsSync(yamlPath)) return
    try {
      loadVideoTemplate()
      assert.fail('should have thrown')
    } catch (e) {
      assert.equal(e.code, 'missing_video_workflow')
      assert.match(String(e.hint), /video\.workflow/)
    }
  })
})
