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
    assert.match(msg, /House character lock: OFF/)
    assert.match(msg, /\/no_think/)
    const gits = buildPlanUserMessage('Ghost in the Shell rooftop with the Major')
    assert.match(gits, /House character lock: ON/)
    const denied = buildPlanUserMessage(
      '60 second anime rooftop duel, two adult cyborg women, silent. Not Ghost in the Shell. Not Motoko.',
    )
    assert.match(denied, /House character lock: OFF/)
    const extras = buildPlanUserMessage(
      'Ghost in the Shell anime, the Major Motoko Kusanagi. Two androids attacking her. Not Motoko. Not copies of Motoko.',
    )
    assert.match(extras, /House character lock: ON/)
  })

  it('validateMoviePlan applies Motoko lock when extras say Not Motoko', () => {
    const p = validateMoviePlan(
      {
        projectId: 't',
        title: 'T',
        logline: 'L',
        lookTrack: 'anime',
        characters: [
          {
            id: 'S1',
            name: 'Sable',
            look: 'adult woman early 30s, short cropped black hair shaved sides, amber eyes',
          },
        ],
        clips: [
          {
            id: 'S01',
            durationSec: 12,
            stillBrief:
              'anime, 1girl, adult woman early 30s, short cropped black hair shaved sides, amber eyes, fully cybernetic body, matte charcoal segmented tactical bodysuit, no helmet, medium close-up, face clearly visible, compact SMG raised, rain-wet neon alley',
          },
          {
            id: 'S02',
            durationSec: 12,
            cut: true,
            stillBrief:
              'anime, 1girl lead adult woman early 30s short cropped black hair shaved sides amber eyes fully cybernetic body matte charcoal segmented tactical bodysuit no helmet, wider medium shot face readable, second topless combat android mid-30s pale synthetic skin',
          },
        ],
      },
      {
        userPrompt:
          '24 second Ghost in the Shell anime. The Major Motoko Kusanagi. Two adult androids attacking her. Not Motoko. Not copies of Motoko.',
      },
    )
    assert.equal(p.characters[0].name, 'Motoko')
    assert.match(p.characters[0].look, /gitsstyl/)
    assert.match(p.clips[0].stillBrief, /Motoko Kusanagi/)
    assert.match(p.clips[0].stillBrief, /gitsstyl/)
    assert.match(p.clips[0].stillBrief, /\bsolo\b/)
    assert.doesNotMatch(p.clips[0].stillBrief, /amber eyes/)
    assert.match(p.clips[1].stillBrief, /2girls/)
    assert.doesNotMatch(p.clips[1].stillBrief, /\b1girl\b/)
    assert.match(p.clips[1].stillBrief, /second topless/)
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

  it('inferPlanHints keeps a named score when the user also said silent', () => {
    const h = inferPlanHints(
      '24 second Ghost in the Shell anime. Silent, no dialogue. Music: sparse taiko and distorted cello at moderate tempo.',
    )
    assert.equal(h.noTalk, true)
    assert.equal(h.namedScore, true)
    assert.equal(h.noMusic, false)
    const rooftop = inferPlanHints(
      '60 second anime rooftop duel, two adult cyborg women, no dialogue, silent. Not Motoko.',
    )
    assert.equal(rooftop.noTalk, true)
    assert.equal(rooftop.namedScore, false)
    assert.equal(rooftop.noMusic, true)
  })

  it('validateMoviePlan keeps named score on a silent-speech request', () => {
    const p = validateMoviePlan(
      {
        projectId: 't',
        title: 'T',
        logline: 'L',
        musicPalette: 'sparse taiko and distorted cello at moderate tempo',
        clips: [
          {
            id: 'S01',
            durationSec: 12,
            stillBrief: 'adult woman, standing, alley, night, face visible',
            motionBrief: 'The camera holds static as she raises the SMG.',
            dialogue: '',
            musicNote: 'sparse taiko and distorted cello at moderate tempo',
          },
        ],
      },
      { userPrompt: 'Silent, no dialogue. Music: sparse taiko and distorted cello.' },
    )
    assert.equal(p.clips[0].musicNote, 'sparse taiko and distorted cello at moderate tempo')
    assert.notEqual(p.musicPalette, 'N/A')
    assert.equal(p.clips[0].dialogue, '')
  })

  it('validateMoviePlan caps long clips', () => {
    const p = validateMoviePlan({
      projectId: 't',
      title: 'T',
      logline: 'L',
      clips: [{ id: 'S01', durationSec: 40, title: 'long' }],
    })
    assert.equal(p.clips[0].durationSec, 15)
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

  it('validateMoviePlan raises short continue takes to 10s', () => {
    const p = validateMoviePlan({
      projectId: 't',
      title: 'T',
      logline: 'L',
      clips: [
        { id: 'S01', durationSec: 12, title: 'hold' },
        { id: 'S02', durationSec: 8, title: 'keep walking' },
      ],
    })
    assert.equal(p.clips[1].cut, false)
    assert.equal(p.clips[1].durationSec, 10)
    assert.equal(p.clips[1].t_end - p.clips[1].t_start, 10)
    assert.ok(p.warnings.some((w) => /continue take/i.test(w)))
  })

  it('ensureLeadFaceFraming prefixes a wide first still', () => {
    const p = {
      clips: [{ id: 'S01', stillBrief: 'adult woman, short hair, standing on a rooftop, night' }],
    }
    const warnings = []
    ensureLeadFaceFraming(p, warnings)
    assert.match(p.clips[0].stillBrief, /medium-wide/i)
    assert.match(p.clips[0].stillBrief, /face readable/i)
    assert.ok(warnings.length)
    const talk = {
      clips: [{ id: 'S01', stillBrief: 'adult woman, short hair, standing in a kitchen, night' }],
    }
    ensureLeadFaceFraming(talk, [])
    assert.match(talk.clips[0].stillBrief, /medium close-up/i)
    const already = {
      clips: [{ id: 'S01', stillBrief: 'medium close-up, adult woman, looking at viewer, kitchen' }],
    }
    ensureLeadFaceFraming(already, [])
    assert.equal(already.clips[0].stillBrief.startsWith('medium close-up'), true)
    assert.doesNotMatch(already.clips[0].stillBrief, /medium close-up, face clearly visible, looking toward camera, medium close-up/)
  })

  it('CORE_PLANNER_RULES asks for a face-visible first still', () => {
    assert.match(CORE_PLANNER_RULES, /medium-wide/)
    assert.match(CORE_PLANNER_RULES, /face (clearly visible|readable)/)
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
    assert.match(p, /Hard max 15/)
    assert.match(p, /Continue airlock/)
    assert.match(p, /continue takes are 10–15/)
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
    assert.match(p, /Do NOT write \[Shot 1\]/)
    assert.match(p, /1–4 English sentences/)
    assert.match(p, /Silent \/ no dialogue means no speech/)
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
