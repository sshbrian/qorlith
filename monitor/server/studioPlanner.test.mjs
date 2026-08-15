import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { slugifyProjectId } from './ids.mjs'
import {
  buildMoviePlanSystemPrompt,
  buildPlanUserMessage,
  collectProjectMediaPaths,
  CORE_PLANNER_RULES,
  dryRunMoviePlan,
  ensureLeadFaceFraming,
  inferPlanHints,
  parseJsonFromModel,
  planPaths,
  validateMoviePlan,
} from './studioPlanner.mjs'

describe('studioPlanner', () => {
  it('slugifyProjectId', () => {
    assert.equal(slugifyProjectId('Action Pack!'), 'action_pack')
    assert.ok(slugifyProjectId('').startsWith('film_'))
  })

  it('parseJsonFromModel handles fences', () => {
    const j = parseJsonFromModel('Here:\n```json\n{"a":1}\n```\n')
    assert.equal(j.a, 1)
  })

  it('parseJsonFromModel strips think tags', () => {
    const j = parseJsonFromModel('<think>wait I should plan</think>\n{"a":2,"clips":[]}')
    assert.equal(j.a, 2)
  })

  it('CORE_PLANNER_RULES does not name Motoko', () => {
    assert.doesNotMatch(CORE_PLANNER_RULES, /Motoko/i)
    const p = buildMoviePlanSystemPrompt({ system: 'HOUSE_ONLY', style: 'STYLE_ONLY' })
    assert.doesNotMatch(p, /Motoko/)
  })

  it('buildPlanUserMessage turns GitS lock off for vague prompts', () => {
    const msg = buildPlanUserMessage('make a cool action short')
    assert.match(msg, /GitS Motoko lock: OFF/)
    assert.match(msg, /\/no_think/)
    const gits = buildPlanUserMessage('Ghost in the Shell rooftop with the Major')
    assert.match(gits, /GitS Motoko lock: ON/)
    const denied = buildPlanUserMessage(
      '60 second anime rooftop duel, two adult cyborg women, silent. Not Ghost in the Shell. Not Motoko.',
    )
    assert.match(denied, /GitS Motoko lock: OFF/)
  })

  it('validateMoviePlan sanitizes silent music and speech-acts', () => {
    const p = validateMoviePlan(
      {
        projectId: 't',
        title: 'T',
        logline: 'A silent rooftop hold.',
        musicPalette: 'epic drums',
        clips: [
          {
            id: 'S01',
            durationSec: 12,
            title: 'hold',
            stillBrief: 'adult woman, short hair, standing on a rooftop, night',
            motionBrief: 'The camera pushes in with small amplitude as the Major calls in an airstrike.',
            dialogue: '',
            soundscape: 'radio communication, distant wind',
            musicNote: 'war drums',
          },
        ],
      },
      { userPrompt: '60 second anime rooftop, no dialogue, silent' },
    )
    assert.equal(p.musicPalette, 'N/A')
    assert.equal(p.clips[0].musicNote, 'N/A')
    assert.equal(p.clips[0].dialogue, '')
    assert.doesNotMatch(p.clips[0].motionBrief, /calls in/i)
    assert.doesNotMatch(p.clips[0].soundscape, /radio/i)
    assert.ok(p.warnings.length)
  })

  it('inferPlanHints keeps kitchen talking when only music is silent', () => {
    const h = inferPlanHints('24s kitchen argument, two adult men, lots of talking, no music')
    assert.equal(h.noMusic, true)
    assert.equal(h.wantsTalk, true)
    assert.equal(h.noTalk, false)
    assert.equal(h.look, 'live')
  })

  it('validateMoviePlan caps long clips', () => {
    const p = validateMoviePlan({
      projectId: 't',
      title: 'T',
      logline: 'L',
      clips: [{ id: 'S01', durationSec: 40, title: 'long' }],
    })
    assert.equal(p.clips[0].durationSec, 12)
    assert.ok(p.warnings?.length)
    assert.equal(p.clips[0].cut, false)
  })

  it('validateMoviePlan keeps shorter takes and cut flags', () => {
    const p = validateMoviePlan({
      projectId: 't',
      title: 'T',
      logline: 'L',
      clips: [
        { id: 'S01', durationSec: 12, title: 'hold' },
        { id: 'S02', durationSec: 8, title: 'punch', cut: true },
      ],
    })
    assert.equal(p.clips[0].durationSec, 12)
    assert.equal(p.clips[1].durationSec, 8)
    assert.equal(p.clips[0].cut, false)
    assert.equal(p.clips[1].cut, true)
    assert.equal(p.clips[1].t_start, 12)
  })

  it('ensureLeadFaceFraming prefixes a wide first still', () => {
    const p = {
      clips: [{ id: 'S01', stillBrief: 'adult woman, short hair, standing on a rooftop, night' }],
    }
    const warnings = []
    ensureLeadFaceFraming(p, warnings)
    assert.match(p.clips[0].stillBrief, /medium close-up/i)
    assert.match(p.clips[0].stillBrief, /face clearly visible/i)
    assert.ok(warnings.length)
    const already = {
      clips: [{ id: 'S01', stillBrief: 'medium close-up, adult woman, looking at viewer, rooftop' }],
    }
    ensureLeadFaceFraming(already, [])
    assert.equal(already.clips[0].stillBrief.startsWith('medium close-up'), true)
    assert.doesNotMatch(already.clips[0].stillBrief, /medium close-up, face clearly visible, looking toward camera, medium close-up/)
  })

  it('CORE_PLANNER_RULES asks for a face-visible first still', () => {
    assert.match(CORE_PLANNER_RULES, /medium shot or closer/)
    assert.match(CORE_PLANNER_RULES, /face clearly visible/)
  })

  it('dryRunMoviePlan has multi clips', () => {
    const p = dryRunMoviePlan('test prompt')
    assert.ok(p.clips.length >= 2)
    assert.ok(p.projectId)
  })

  it('buildMoviePlanSystemPrompt teaches SDXL stills and H3 motion split', () => {
    const p = buildMoviePlanSystemPrompt({
      system: 'HOUSE_TRIGGER_xyz',
      style: 'HOUSE_STYLE_xyz',
    })
    assert.match(p, /STILL BRIEF/)
    assert.match(p, /MOTION BRIEF/)
    assert.match(p, /ceil\(durationTargetSec \/ 10\)/)
    assert.match(p, /cut=false/)
    assert.match(p, /Hard max 12/)
    assert.match(p, /score_9_up/)
    assert.match(p, /non_diegetic_music/)
    assert.match(p, /with small amplitude/)
    assert.doesNotMatch(p, /musicNote": "soft\|loud\|none/)
    assert.match(p, /HOUSE_TRIGGER_xyz/)
    assert.match(p, /HOUSE_STYLE_xyz/)
    assert.ok(CORE_PLANNER_RULES.includes('Never one 30–120'))
    assert.match(p, /TEMPLATES/)
    assert.match(p, /Do not invent a leftover example cast|do not invent a leftover example cast/i)
    assert.match(p, /NEVER output curly braces/)
    assert.match(p, /every musicNote is N\/A/)
    assert.doesNotMatch(p, /the adult \{who\}/)
  })

  it('planPaths uses lookTrack folders', () => {
    const rm = planPaths('demo_film', { lookTrack: 'live' })
    assert.match(rm.stillRoot.replace(/\\/g, '/'), /qorlith\/live\/demo_film\/stills/)
    const g = planPaths('demo_film', { lookTrack: 'anime' })
    assert.match(g.stillRoot.replace(/\\/g, '/'), /qorlith\/anime\/demo_film\/stills/)
    assert.match(rm.planMd.replace(/\\/g, '/'), /projects\/demo_film\/plan\.md/)
    assert.match(rm.shotlistPath.replace(/\\/g, '/'), /projects\/demo_film\/shotlist\.json/)
    assert.doesNotMatch(rm.planMd, /docs/)
  })

  it('collectProjectMediaPaths finds media under project roots', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-arch-'))
    const prev = process.env.COMFY_OUTPUT
    process.env.COMFY_OUTPUT = tmp
    try {
      const id = 'arch_test_proj'
      const paths = planPaths(id, { lookTrack: 'live' })
      fs.mkdirSync(paths.stillRoot, { recursive: true })
      fs.mkdirSync(paths.videoRoot, { recursive: true })
      fs.writeFileSync(path.join(paths.stillRoot, 'H01_PICK.png'), Buffer.from([1, 2, 3]))
      fs.writeFileSync(path.join(paths.videoRoot, 'H01_p1.mp4'), Buffer.from([1, 2, 3, 4]))
      fs.writeFileSync(path.join(paths.stillRoot, 'note.txt'), 'skip')
      const col = collectProjectMediaPaths(id, { lookTrack: 'live' })
      assert.equal(col.media.length, 2)
      assert.ok(col.media.some((p) => p.endsWith('H01_PICK.png')))
      assert.ok(col.media.some((p) => p.endsWith('H01_p1.mp4')))
    } finally {
      if (prev === undefined) delete process.env.COMFY_OUTPUT
      else process.env.COMFY_OUTPUT = prev
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
