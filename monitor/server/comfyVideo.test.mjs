import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  applyMinimaxJob,
  composeH3Prompt,
  expandSoundscape,
  findMp4,
  h3ShotStyle,
  loadVideoTemplate,
  stripFrameImages,
  stripShotLabel,
  subjectLock,
} from './comfyVideo.mjs'
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
    const live = applyMinimaxJob(graph, {
      motion: 'he turns',
      lookTrack: 'live',
      durationSec: 6,
      fps: 24,
    })
    assert.match(live.prompt['136'].inputs.prompt, /Live-action, cinematic/)
    assert.doesNotMatch(live.prompt['136'].inputs.prompt, /2D-animated/)
    assert.match(live.h3Prompt, /Live-action, cinematic/)
  })

  it('composeH3Prompt uses official H3 fields and keeps silent clips silent', () => {
    const cut = composeH3Prompt({ motion: 'she turns', dialogue: '', music: 'N/A' })
    assert.match(cut, /integrated_multimodal_description/)
    assert.match(cut, /overall_soundscape: N\/A/)
    assert.match(cut, /Hold <Picture 1> for about one second/)
    assert.match(cut, /Then she turns/)
    assert.match(cut, /On-screen lips remain completely closed/)
    assert.match(cut, /No singing/)
    assert.doesNotMatch(cut, /Her lips/)
    assert.doesNotMatch(cut, /^No dialogue\.$/m)
    assert.doesNotMatch(cut, /^dialogue:/m)
    const spoken = composeH3Prompt({
      motion: 'she turns',
      dialogue: 'the adult woman (S1) says: <d>[English] Copy.</d>',
      music: 'low cello drone at a slow tempo',
      soundscape: 'wind, distant gunfire',
    })
    assert.match(spoken, /<d>\[English\] Copy\.<\/d>/)
    assert.match(spoken, /overall_soundscape: wind, and distant gunfire\./)
    assert.match(spoken, /non_diegetic_music: low cello drone/)
    const cont = composeH3Prompt({
      motion: 'she turns',
      dialogue: '',
      music: 'N/A',
      continueFromPrior: true,
    })
    assert.match(cont, /seamless continuation/)
    assert.match(cont, /first couple of seconds/)
    assert.match(cont, /about two seconds spare/)
    assert.match(cont, /Then she turns/)
    assert.doesNotMatch(cont, /Hold <Picture 1> for about one second/)
    assert.doesNotMatch(cont, /last frame of the previous shot/)
    const spokenCont = composeH3Prompt({
      motion: 'she turns',
      dialogue: 'the adult woman (S1) says: <d>[English] Copy.</d>',
      continueFromPrior: true,
    })
    assert.match(spokenCont, /After the opening hold/)
    assert.match(spokenCont, /<d>\[English\] Copy\.<\/d>/)
  })

  it('composeH3Prompt styles live vs anime and never stacks [Shot 1]', () => {
    const live = composeH3Prompt({
      motion: '[Shot 1] The camera pushes in as he turns',
      dialogue: '',
      music: 'N/A',
      lookTrack: 'live',
      characters: [
        { id: 'S1', name: 'Ben' },
        { id: 'S2', name: 'Cal' },
      ],
    })
    assert.match(live, /\[Shot 1\] Live-action, cinematic/)
    assert.match(live, /Ben and Cal shown in <Picture 1> remain/)
    assert.doesNotMatch(live, /2D-animated/)
    assert.doesNotMatch(live, /\[Shot 1\].*\[Shot 1\]/)
    const anime = composeH3Prompt({
      motion: 'The camera holds static as she raises the SMG',
      lookTrack: 'anime',
      characters: [{ id: 'S1', name: 'Major Motoko Kusanagi' }],
      music: 'sparse taiko and distorted cello at moderate tempo',
      soundscape: 'SMG gunfire, brass casings clattering on wet pavement, heavy rain',
    })
    assert.match(anime, /\[Shot 1\] 2D-animated,/)
    assert.match(anime, /Major Motoko Kusanagi shown in <Picture 1> remains/)
    assert.doesNotMatch(anime, /Then The camera/)
    assert.match(anime, /non_diegetic_music: sparse taiko/)
    assert.match(anime, /and heavy rain\./)
    assert.match(anime, /No spoken words/)
    const t2v = composeH3Prompt({
      motion: '2D-animated, a medium-wide shot frames a neon alley. The camera holds static as rain falls.',
      dialogue: '',
      music: 'N/A',
      lookTrack: 'anime',
      t2v: true,
    })
    assert.match(t2v, /integrated_multimodal_description/)
    assert.doesNotMatch(t2v, /Picture 1/)
    assert.doesNotMatch(t2v, /Then 2D-animated/)
    assert.equal((t2v.match(/2D-animated/g) || []).length, 1)
    assert.match(t2v, /\[Shot 1\] 2D-animated, a medium-wide shot frames a neon alley/)
    const t2vLock = composeH3Prompt({
      motion: 'a medium-wide shot frames a neon alley. The camera holds static as rain falls.',
      dialogue: '',
      music: 'N/A',
      lookTrack: 'anime',
      t2v: true,
      characters: [{ id: 'S1', name: 'Motoko', look: 'adult woman, gitsstyl' }],
    })
    assert.match(t2vLock, /Motoko/)
    assert.match(t2vLock, /gitsstyl/)
    assert.doesNotMatch(t2vLock, /Picture 1/)
    const already = composeH3Prompt({
      motion: 'Motoko, adult woman, gitsstyl, a medium-wide shot frames a neon alley.',
      t2v: true,
      lookTrack: 'anime',
      characters: [{ name: 'Motoko', look: 'adult woman, gitsstyl' }],
    })
    assert.equal((already.match(/gitsstyl/g) || []).length, 1)
  })

  it('composeH3Prompt ignores anime motionPrefix on live and keeps singing', () => {
    assert.equal(h3ShotStyle({ lookTrack: 'live', motionPrefix: '2D-animated, cinematic anime' }), 'Live-action, cinematic')
    assert.equal(h3ShotStyle({ lookTrack: 'anime', motionPrefix: '2D-animated, cinematic anime' }), '2D-animated, cinematic anime')
    const sung = composeH3Prompt({
      motion: 'She steps into the chorus and sings',
      lookTrack: 'anime',
      music: 'synth bass at 120 BPM',
    })
    assert.match(sung, /sings/)
    assert.doesNotMatch(sung, /No singing/)
    assert.equal(stripShotLabel('[Shot 1] she turns'), 'she turns')
    assert.equal(expandSoundscape(''), 'N/A')
    const stripped = stripFrameImages({
      '136': { class_type: 'MiniMaxH3ImageToVideo', inputs: { prompt: 'x', first_frame: ['137', 0] } },
      '137': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
    })
    assert.equal(stripped['137'], undefined)
    assert.equal(stripped['136'].inputs.first_frame, undefined)
    const long = expandSoundscape('Rain. Wind. A burst. Casings. A distant siren.')
    assert.match(long, /Rain/)
    assert.doesNotMatch(long, /siren/)
    assert.match(subjectLock({ characters: [{ name: 'Ava' }] }), /Ava shown/)
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
