/**
 * Studio Planner — local LLM movie plans.
 * Uses LM Studio. Does not queue Comfy — Make (Brain) is the factory.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { directorConfigFromApp, lmstudioHealth, parsePlanJson } from './director.mjs'
import { ensureServer, preparePlanModel, releasePlanModel, resolveLmsPath } from './lms.mjs'
import { clipDurationBounds, loadStudio } from './studioConfig.mjs'
import { ensureEpisodePlan } from './episodePlan.mjs'
import { slugifyProjectId } from './ids.mjs'
import { loadProjectRecord, planRecordPath, projectDir, saveProjectRecord } from './project.mjs'
import { loadStudioProducePipelines, saveStudioProducePipelines } from './produce.mjs'
import { info as logInfo } from './log.mjs'
import { fail } from './errors.mjs'
import { writeStoryboard } from './storyboard.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/**
 * Always-on planner rules. Distilled from the studio stills-first + I2VA
 * pipeline. Do not name machine-local checkpoints or LoRA files here —
 * those belong in qorlith.local.yaml planner.system / planner.style.
 */
export const CORE_PLANNER_RULES = `PIPELINE
Stills-first: each clip is (1) one SDXL/Pony-family start still, then (2) MiniMax H3 image-to-video-audio from that still. You do not queue Comfy. You only write the plan JSON.

CLIP MATH (hard)
- Each MiniMax take is 6–12 s. Default 12. Shorter when the beat is a punch-in or hold. Never lock every clip to 8.
- n ≈ ceil(durationTargetSec / 10). Never one 30–120 s MiniMax job.
- ids are stable S01, S02, … (used as resume keys).
- t_start / t_end are consecutive on the master timeline. sum(durationSec) ≈ durationTargetSec.
- Prefer one continuous shot per clip.

CONTINUITY
- Default cut=false. Video N+1 starts from the last frame of video N (same body, costume, space).
- Set cut=true only for a purposeful hard cut: new location, time jump, or a still the previous last frame cannot continue.
- Do not mark every clip as a cut. A chase or fight in one space is one continue chain.

LOOK
- lookTrack is only "anime" or "live".
- anime = 2D / cel / GitS-like. live = photoreal / camcorder / found-footage.
- If the user names a look, honor it.
- Office, kitchen, hotel, handshake, documentary, found-footage, hidden cam, camcorder, photoreal, real_movie → live. STYLE anime cannot override those.
- GitS / anime / rooftop duel anime → anime when the user said so.
- If still unspecified, follow the STYLE block, else live.
- Do not mix tracks inside one plan.

CHARACTERS
- 1–3 adults. Each has look (visual lock for every still) and voice (frozen for every spoken clip).
- Same face, costume, and location language across clips unless a beat changes them.
- Adults only. Never teen / child / loli / shota / minor framing. Fictional cast.

STILL BRIEF = start-frame prompt BODY for SDXL/Pony txt2img
The app prepends the house quality prefix and LoRA triggers. You write only the frame.
- One frozen image: subject count, adult age lock, hair/eyes/body, outfit, pose, framing, location, lighting.
- Comma-separated visual tags or short concrete nouns. This string is sent to the still engine as-is.
- Repeat the character visual lock on EVERY clip (identity drift kills the film).
- Do NOT write camera moves, dialogue, music, checkpoint names, LoRA filenames, Wan tags, or "masterpiece / best quality / score_9_up".
- Forbidden in stillBrief (those belong in motionBrief): walking, walking past, passing, approaching, navigating, running, advancing, marching, jumping, flickering, chasing, firing, shooting, kissing mid-action. Use a frozen pose (standing, paused, mid-stride).
- Do NOT put negatives in stillBrief.
- Pose words that freeze a frame are ok (crouched, standing, seated, holding). Motion paragraphs are not.
- Anime stills: booru-like tags + 2D lighting. Live stills: camera + practical light + real-world location.
- First clip (S01) is a medium shot or closer with the lead face clearly visible (head and shoulders or medium close-up). Do not open on a distant figure or a wide establishing where the face is a few pixels.
- Later clips may go wider, but if a person is in frame keep the face readable unless the beat is landscape-only.

MOTION BRIEF = MiniMax H3 I2VA motion only
The start still IS frame 0. The app wraps your text as I2VA + identity lock. You write only what CHANGES.
- Path: first-frame hold → action onset → continuous development → result/reaction.
- Camera as prose: motion type + optional amplitude + optional speed.
  Verbs: push in, pull out, pan left/right, truck left/right, tilt up/down, pedestal, arc, tracking, static, POV, shake slightly/strongly, roll.
  Amplitude: with small amplitude / with large amplitude. Speed: at slow speed / at fast speed. Omit medium.
- Keep identity, costume, colors, props, and space consistent with the still.
- Do NOT re-describe wardrobe or the set. Do NOT use Wan "At 0 seconds / At 1 second" beat lists. Do NOT name video models or LoRAs.
- Prefer one [Shot 1] worth of action. If you must cut: "the camera cuts to".

DIALOGUE (H3 spoken field)
- If the user did not ask for speech, a line, a shout, or radio talk, every dialogue field is empty.
- Silent / no dialogue / no people talking → every dialogue is empty.
- Stable speaker IDs (S1), (S2) matching characters[]. Silent people get no ID.
- When there IS speech, write real names and voices from characters[] — never placeholders:
  the adult woman with a dry mid voice (S1) says: <d>[English] Copy.</d>
- Inside <d>: [English] or [Japanese] then the exact words. No quotes, no "en:".
- Preserve user-supplied lines verbatim (including Japanese).
- Voiceover: "says in an off-screen voiceover" and lips remain closed.
- Keep the voice-lock string identical across clips.
- NEVER output curly braces { } or leftover template tokens in any field.

SOUNDSCAPE
- Diegetic only: rain, footsteps, gunfire, servos, breath, radio hiss.
- Never dialogue, never audience score. N/A only if the clip is truly silent.

MUSIC
- musicPalette = global non_diegetic_music: at least two named instruments + tempo + dynamics. No vocals. Drops under dialogue.
- musicNote = THAT CLIP's non_diegetic_music string (named instruments + tempo + dynamics) or N/A.
- musicNote is fed to MiniMax as non_diegetic_music.
- Never write only "soft" / "loud" / "epic" / "emotional" / "orchestral" / "dynamic".
- If the user named drums, piano, guitar, etc., those instruments MUST appear in musicPalette and musicNote.
- Diegetic radio/TV/phone music belongs in dialogue or motion, not musicNote.
- If the user asked for silent / no music / no score: musicPalette is N/A AND every musicNote is N/A. This overrides house style.

DEFAULTS when the user is vague
- 30 s · R · look from STYLE or live · MiniMax score · 10–12 s clips.
- Invent a tight logline and label assumed defaults in markdown. Do not ask questions.

DURATION
- durationSec is 6–12 (prefer 10–12). Never 4 or 5. Hard max 12.
- A 24 s beat is 12+12, not 3×8. A 20 s beat is 12+8.
- sum(durationSec) must match durationTargetSec (off by at most 1 second).

TEMPLATES (fill from the USER request — do not invent a leftover example cast)
stillBrief: adult lock, outfit, frozen pose, location, lighting, framing (S01 = medium/close, face visible)
motionBrief: The camera VERB with small amplitude at slow speed as BODY ACTION.
musicNote: two named instruments at a TEMPO, DYNAMICS, music drops under dialogue
Never copy a character, location, or spoken line that the user did not ask for.
Never leave angle brackets or curly braces in the JSON.`

export const PLAN_JSON_SCHEMA = `{
  "projectId": "snake_case_id",
  "title": "Human title",
  "logline": "one sentence",
  "rating": "R|X|PG-13|G",
  "durationTargetSec": 30,
  "lookTrack": "live" | "anime",
  "song": "short music label",
  "musicPalette": "instruments + tempo + dynamics for MiniMax non_diegetic_music",
  "characters": [{ "id": "S1", "name": "", "look": "visual lock", "voice": "frozen voice lock" }],
  "clips": [{
    "id": "S01",
    "title": "snake_title",
    "section": "act1",
    "mood": "tension",
    "t_start": 0,
    "t_end": 12,
    "durationSec": 12,
    "cut": false,
    "gun_risk": false,
    "sexy": false,
    "stillBrief": "frozen start-frame prompt body (no motion, no score tags)",
    "motionBrief": "camera + body action only",
    "dialogue": "H3 spoken line or empty",
    "soundscape": "diegetic SFX only",
    "musicNote": "instruments + tempo + dynamics, or N/A"
  }],
  "markdown": "short production notes: defaults assumed, clip math, risks"
}`

export function buildMoviePlanSystemPrompt(extra = {}) {
  const system = String(extra.system || '').trim()
  const style = String(extra.style || '').trim()
  const custom = [system && `--- STUDIO NOTES ---\n${system}`, style && `--- STYLE ---\n${style}`]
    .filter(Boolean)
    .join('\n\n')
  return `You are the Studio Planner for Qorlith offline movie production.
Write complete stills-first MiniMax H3 plans. Reply with ONE JSON object only (optional markdown fence). No prose outside JSON.

${CORE_PLANNER_RULES}

CRITICAL OUTPUT
- JSON only, matching this schema:
${PLAN_JSON_SCHEMA}
- Each clip durationSec MUST be 6–12 (max 12). cut defaults to false.
- stillBrief ≤ 800 characters. motionBrief ≤ 800 characters.
- Adults only.
- If the user asked for graphic sex: rating X. stillBrief is a frozen explicit frame that names the act (mouth, tongue, vulva, penetration). motionBrief continues that act. No fade-to-black, no silhouette, no "intimacy" euphemism.
${custom ? `\n${custom}\n` : ''}`
}

export function parseJsonFromModel(text) {
  return parsePlanJson(text)
}

const SPEECH_ACT_RE =
  /\b(calls?(?:\s+in)?|shouts?|yells?|radios?|tells?|asks?|receives\s+mission)\b/i
const SFX_TALK_RE = /\b(radio(?:\s+communication)?|voices?|cheers?|communication|spoken|dialogue)\b/i
const CURLY_RE = /\{[^}]+\}/g
const FACE_FRAME_RE =
  /\b(close[- ]?up|closeup|medium close|medium shot|portrait|head and shoulders|face (?:visible|clear|large)|bust shot|from the chest|looking (?:at|toward) (?:the )?(?:viewer|camera))\b/i

/** S01 must name a readable face. Wide-only first stills get a medium close-up prefix. */
export function ensureLeadFaceFraming(plan, warnings = []) {
  const first = Array.isArray(plan?.clips) ? plan.clips[0] : null
  if (!first) return plan
  const brief = String(first.stillBrief || '')
  if (!brief.trim() || FACE_FRAME_RE.test(brief)) return plan
  first.stillBrief = `medium close-up, face clearly visible, looking toward camera, ${brief}`.slice(0, 800)
  warnings.push(`${first.id || 'S01'}: prepended face-visible medium close-up`)
  return plan
}

export function inferPlanHints(userPrompt) {
  const t = String(userPrompt || '')
  const gitsAsked = /\b(motoko|major|gits|section\s*9|ghost in the shell)\b/i.test(t)
  const gitsDenied = /\b(not motoko|no motoko|not ghost in the shell|not gits|no gits)\b/i.test(t)
  const gits = gitsAsked && !gitsDenied
  const liveHit =
    /\b(live|found-?footage|photoreal|real_movie|camcorder|hidden\s*cam|kitchen|office|hotel|handshake|documentary)\b/i.test(
      t,
    )
  const animeHit = /\b(anime|gits|ghost in the shell|2d|cel[- ]?shad)\b/i.test(t)
  const silentWord = /\bsilent\b/i.test(t)
  const noMusic = /\bno music\b|\bno score\b/i.test(t) || silentWord
  const wantsTalk =
    /\b(dialogue|talking|\btalk\b|one line|shout|radio|says|dirty talk|japanese|任務)\b/i.test(t) &&
    !/\bno dialogue\b|\bno (?:people )?talk/i.test(t)
  const noTalk = /\bno dialogue\b|\bno (?:people )?talk/i.test(t) || (silentWord && !wantsTalk)
  const wantsX = /\b(\bx-?rated\b|\bx\b|xxx|explicit|hardcore|graphic lesbian|graphic sex)\b/i.test(t)
  let durationSec = null
  const min = t.match(/\b(\d+)\s*min(?:ute)?s?\b/i)
  const sec = t.match(/\b(\d+)\s*(?:s|sec|secs|second)s?\b/i)
  if (min) durationSec = Number(min[1]) * 60
  else if (sec) durationSec = Number(sec[1])
  if (!Number.isFinite(durationSec) || durationSec < 6) durationSec = 30
  if (durationSec > 600) durationSec = 600
  const n = Math.max(1, Math.ceil(durationSec / 10))
  let look = 'anime'
  if (liveHit && !animeHit) look = 'live'
  else if (animeHit) look = 'anime'
  else if (liveHit) look = 'live'
  return {
    durationSec,
    clipCount: n,
    look,
    gits,
    noMusic,
    noTalk,
    wantsTalk,
    wantsX,
    liveHit,
    animeHit,
  }
}

export function buildPlanUserMessage(userPrompt) {
  const h = inferPlanHints(userPrompt)
  const musicLine = h.noMusic
    ? 'ALL musicPalette and musicNote fields are N/A'
    : 'named instruments + tempo + dynamics on musicPalette and every musicNote'
  const talkLine = h.noTalk
    ? 'every dialogue field is empty; motionBrief has no speech-acts (calls/shouts/radio/tells)'
    : h.wantsTalk
      ? 'write real spoken lines with (S1) says: <d>[lang] words</d>'
      : 'dialogue empty unless the user asked for a line, shout, or radio talk'
  const gitsLine = h.gits
    ? 'ON — repeat the Motoko visual lock on every still'
    : 'OFF — invent a NEW adult lock; do not use Motoko, thermoptic, gitsstyl, or red-violet eyes'
  const xLine = h.wantsX
    ? '- rating X. stillBrief names the explicit act (mouth, tongue, vulva, fingers, strap-on). motionBrief is that act continuing. No "intimacy", no fade-to-black, no "lowers her head toward her lap" euphemism.\n'
    : ''
  return `Create a complete movie production plan for this request:

${userPrompt}

REQUEST CHECKLIST (follow exactly)
- durationTargetSec: ${h.durationSec}; about ${h.clipCount} takes of 6–12s (prefer 10–12). Never pad by repeating beats with _2 titles.${h.durationSec >= 60 ? ' Keep each stillBrief under 350 characters so the JSON fits.' : ''}
- lookTrack: ${h.look}
- music: ${musicLine}
- dialogue: ${talkLine}
- GitS Motoko lock: ${gitsLine}
- cut=false continues the same space from the last frame; cut=true only on location or time jumps
- S01 stillBrief is a medium or close shot with the lead face clearly visible
- adults only. One new beat per clip.
${xLine}- Reply with ONE JSON object. No <think>. No prose outside JSON.

/no_think`
}

const SPEECH_CLAUSE_RE =
  /\b(?:and\s+)?(?:as\s+)?(?:the\s+)?(?:Major|[A-Za-z][\w-]*)?\s*(?:calls?(?:\s+in)?|shouts?|yells?|radios?|tells?|asks?|receives\s+mission)\b[^.]*\.?/gi

export function sanitizeMoviePlanFields(plan, userPrompt, warnings) {
  const h = inferPlanHints(userPrompt)
  if (h.noMusic) {
    if (String(plan.musicPalette || '').trim() && !/^n\/a$/i.test(String(plan.musicPalette).trim())) {
      warnings.push('silent/no-music request: forced musicPalette to N/A')
    }
    plan.musicPalette = 'N/A'
  }
  for (const c of plan.clips || []) {
    if (h.noMusic) {
      if (c.musicNote && !/^n\/a$/i.test(String(c.musicNote).trim())) {
        warnings.push(`${c.id}: silent/no-music request: forced musicNote to N/A`)
      }
      c.musicNote = 'N/A'
    }
    if (h.noTalk && String(c.dialogue || '').trim()) {
      warnings.push(`${c.id}: no-talk request: cleared dialogue`)
      c.dialogue = ''
    }
    const talk = String(c.dialogue || '').trim()
    if (!talk && SPEECH_ACT_RE.test(c.motionBrief || '')) {
      const next = String(c.motionBrief || '').replace(SPEECH_CLAUSE_RE, '').replace(/\s{2,}/g, ' ').trim()
      if (next !== c.motionBrief) {
        warnings.push(`${c.id}: stripped speech-act from motionBrief`)
        c.motionBrief = next
      }
    }
    if (!talk && SFX_TALK_RE.test(c.soundscape || '')) {
      c.soundscape = String(c.soundscape || '')
        .replace(SFX_TALK_RE, '')
        .replace(/,\s*,/g, ',')
        .replace(/^\s*,|,\s*$/g, '')
        .trim()
      if (!c.soundscape) c.soundscape = 'Distant wind and light debris.'
      warnings.push(`${c.id}: stripped talk-like sfx from soundscape`)
    }
    for (const field of ['stillBrief', 'motionBrief', 'dialogue']) {
      const v = String(c[field] || '')
      if (v.includes('{') && CURLY_RE.test(v)) {
        CURLY_RE.lastIndex = 0
        c[field] = v.replace(CURLY_RE, '').replace(/\s{2,}/g, ' ').trim()
        warnings.push(`${c.id}: stripped {template} from ${field}`)
      }
    }
  }
  ensureLeadFaceFraming(plan, warnings)
  return plan
}

function looksLikePlanJson(text) {
  try {
    const o = parsePlanJson(text)
    return o && typeof o === 'object' && (Array.isArray(o.clips) || o.projectId || o.title)
  } catch {
    return false
  }
}

/**
 * Chat the planner model. Sends enable_thinking=false; retries without it on 400.
 * If the model dumps a think-essay with no JSON, one hard retry: JSON only.
 */
export async function plannerChat({ baseUrl, model, system, user, temperature, maxTokens, timeoutMs }) {
  const url = `${String(baseUrl || '').replace(/\/$/, '')}/chat/completions`

  async function once(userContent, budgetMs) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), budgetMs)
    const baseBody = {
      model,
      temperature: temperature ?? 0.2,
      max_tokens: maxTokens || 8192,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }
    try {
      let r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...baseBody, enable_thinking: false }),
        signal: ctrl.signal,
      })
      if (r.status === 400) {
        r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(baseBody),
          signal: ctrl.signal,
        })
      }
      if (!r.ok) {
        const errText = await r.text().catch(() => '')
        throw new Error(`LMS ${r.status} ${errText.slice(0, 300)}`)
      }
      const data = await r.json()
      const msg = data?.choices?.[0]?.message || {}
      return String(msg.content || msg.text || msg.reasoning_content || '')
    } finally {
      clearTimeout(t)
    }
  }

  const budget = timeoutMs || 180_000
  const first = await once(user, budget)
  if (looksLikePlanJson(first)) return first
  const retryUser = `${user}\n\nSTOP. Your last reply was not JSON. Reply with ONE JSON object only. No thinking. No prose.`
  return once(retryUser, Math.min(budget, 180_000))
}

export function validateMoviePlan(raw, { userPrompt = '' } = {}) {
  const warnings = []
  if (!raw || typeof raw !== 'object') {
    fail(400, 'bad_plan', 'plan must be a JSON object', {
      hint: 'Generate again, or use dry-run to see a demo plan.',
    })
  }
  let projectId = slugifyProjectId(raw.projectId || raw.id || raw.title || 'untitled')
  const title = String(raw.title || projectId).slice(0, 120)
  const logline = String(raw.logline || '').slice(0, 800)
  const rating = String(raw.rating || 'R').slice(0, 16)
  let durationTargetSec = Number(raw.durationTargetSec ?? raw.durationSec ?? 30)
  if (!Number.isFinite(durationTargetSec) || durationTargetSec < 6) durationTargetSec = 30
  if (durationTargetSec > 600) {
    warnings.push('durationTargetSec capped at 600')
    durationTargetSec = 600
  }
  let lookTrack = String(raw.lookTrack || raw.look || 'live').toLowerCase()
  if (!['live', 'anime'].includes(lookTrack)) {
    warnings.push(`unknown lookTrack ${lookTrack}, using live`)
    lookTrack = 'live'
  }
  const song = String(raw.song || raw.music || 'MiniMax non-diegetic score').slice(0, 200)
  const musicPalette = String(raw.musicPalette || raw.non_diegetic_music || '').slice(0, 1200)
  const markdown = String(raw.markdown || raw.planMarkdown || '').slice(0, 80_000)

  const characters = Array.isArray(raw.characters)
    ? raw.characters.slice(0, 8).map((c, i) => ({
        id: String(c.id || `S${i + 1}`).slice(0, 16),
        name: String(c.name || `Character ${i + 1}`).slice(0, 64),
        look: String(c.look || '').slice(0, 400),
        voice: String(c.voice || '').slice(0, 200),
      }))
    : []

  let clipsIn = Array.isArray(raw.clips) ? raw.clips : []
  if (!clipsIn.length) {
    fail(400, 'missing_clips', 'plan.clips[] required (at least one clip)', {
      hint: 'Generate again so the model returns at least one shot.',
    })
  }
  const bounds = clipDurationBounds()
  const clips = []
  let cursor = 0
  for (const [i, c] of clipsIn.slice(0, 64).entries()) {
    const id = String(c.id || `S${String(i + 1).padStart(2, '0')}`)
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 12) || `S${i + 1}`
    let durationSec = Number(
      c.durationSec ?? (c.t_end != null && c.t_start != null ? c.t_end - c.t_start : bounds.fallback),
    )
    if (!Number.isFinite(durationSec) || durationSec < 4) durationSec = bounds.fallback
    if (durationSec > bounds.max) {
      warnings.push(`${id}: durationSec ${durationSec} > ${bounds.max}, capped`)
      durationSec = bounds.max
    }
    const t_start = Number.isFinite(Number(c.t_start)) ? Number(c.t_start) : cursor
    const t_end = Number.isFinite(Number(c.t_end)) ? Number(c.t_end) : t_start + durationSec
    clips.push({
      id,
      title: String(c.title || id).slice(0, 64),
      section: String(c.section || 'main').slice(0, 32),
      mood: String(c.mood || 'neutral').slice(0, 32),
      t_start,
      t_end,
      durationSec,
      cut: Boolean(c.cut),
      gun_risk: Boolean(c.gun_risk),
      sexy: Boolean(c.sexy),
      stillBrief: String(c.stillBrief || c.still || '').slice(0, 800),
      motionBrief: String(c.motionBrief || c.motion || '').slice(0, 800),
      dialogue: String(c.dialogue || '').slice(0, 600),
      soundscape: String(c.soundscape || '').slice(0, 400),
      musicNote: String(c.musicNote || '').slice(0, 300),
    })
    cursor = t_start + durationSec
  }

  // uniqueness of ids
  const seen = new Set()
  for (const c of clips) {
    let id = c.id
    let n = 2
    while (seen.has(id)) {
      id = `${c.id}${n++}`.slice(0, 12)
    }
    c.id = id
    seen.add(id)
  }

  if (clips.length === 1 && durationTargetSec > bounds.max) {
    warnings.push('Single clip longer than MiniMax limit — consider splitting when producing')
  }

  const plan = {
    projectId,
    title,
    logline,
    rating,
    durationTargetSec,
    lookTrack,
    song,
    musicPalette,
    characters,
    clips,
    markdown:
      markdown ||
      `# ${title}\n\n${logline}\n\nClips: ${clips.map((c) => c.id).join(', ')}\n\n(User: ${userPrompt.slice(0, 200)})`,
    warnings,
  }
  sanitizeMoviePlanFields(plan, userPrompt, warnings)
  return plan
}

export function dryRunMoviePlan(userPrompt) {
  const plan = validateMoviePlan(
    {
      projectId: 'demo_plan',
      title: 'Demo Plan (dry-run)',
      logline: 'A dry-run plan when the local LLM is offline or dryRun is set.',
      rating: 'R',
      durationTargetSec: 24,
      lookTrack: 'live',
      song: 'MiniMax pulse score',
      musicPalette:
        'Low pulsing synth bass at moderate tempo, sparse snare, no vocals, drops under dialogue',
      characters: [
        {
          id: 'S1',
          name: 'Alex',
          look: 'Adult, short dark hair, jacket',
          voice: 'calm mid voice',
        },
      ],
      clips: [
        {
          id: 'S01',
          title: 'setup',
          t_start: 0,
          t_end: 8,
          durationSec: 8,
          stillBrief: 'Handheld night street, adult lead walks',
          motionBrief: 'Walk toward camera, small shake',
          dialogue: 'S1: Stay on me.',
          soundscape: 'traffic, footsteps',
          musicNote: 'Low pulsing synth bass at moderate tempo, music stays under speech',
        },
        {
          id: 'S02',
          title: 'turn',
          t_start: 8,
          t_end: 16,
          durationSec: 8,
          stillBrief: 'Doorway, flash light',
          motionBrief: 'Turn and run',
          dialogue: 'S1: Go!',
          soundscape: 'door, breath',
          musicNote: 'Low pulsing synth bass at moderate tempo, dry snare hits, louder',
        },
        {
          id: 'S03',
          title: 'tag',
          t_start: 16,
          t_end: 24,
          durationSec: 8,
          stillBrief: 'Car interior, night',
          motionBrief: 'Sit, look back',
          dialogue: 'S1: We are clear.',
          soundscape: 'engine idle',
          musicNote: 'Sparse synth bass, fade out',
        },
      ],
      markdown: `# Demo Plan\n\nDry-run for: ${String(userPrompt || '').slice(0, 200)}`,
    },
    { userPrompt },
  )
  return plan
}

export async function generateMoviePlan({ userPrompt, dryRun = false, appConfig }) {
  const prompt = String(userPrompt || '').trim()
  if (!prompt) {
    fail(400, 'missing_prompt', 'prompt required', {
      hint: 'Describe the short, then generate.',
    })
  }

  if (dryRun) {
    const plan = dryRunMoviePlan(prompt)
    logInfo('director.plan', { kind: 'movie', projectId: plan.projectId, dryRun: true })
    return { plan, dryRun: true, model: null, rawModelText: null }
  }

  const dcfg = directorConfigFromApp()
  let prepared = null
  if (dcfg.autoManageModels !== false) {
    try {
      prepared = await preparePlanModel(dcfg)
      dcfg.apiModel = prepared.apiModel
      dcfg.planModelKey = prepared.modelKey
    } catch {
      try {
        const lmsPath = resolveLmsPath(dcfg)
        await ensureServer(lmsPath, { port: dcfg.serverPort || 1234 })
      } catch {
        /* health will fail clearly */
      }
    }
  }

  const health = await lmstudioHealth(dcfg)
  if (!health.ok) {
    fail(503, 'lms_offline', health.error || 'LM Studio not available — enable server or use dryRun', {
      hint: 'Start LM Studio on :1234, or check dry-run.',
      health,
    })
  }

  const model =
    dcfg.apiModel ||
    dcfg.planModelKey ||
    dcfg.model ||
    health.loadedHint ||
    health.models?.[0] ||
    'local-model'

  const system = buildMoviePlanSystemPrompt({
    system: dcfg.plannerSystem,
    style: dcfg.plannerStyle,
  })
  const user = buildPlanUserMessage(prompt)
  let rawText = ''
  try {
    rawText = await plannerChat({
      baseUrl: dcfg.lmstudioBaseUrl,
      model,
      system,
      user,
      temperature: dcfg.temperature ?? 0.2,
      maxTokens: dcfg.maxTokens || 8192,
      timeoutMs: dcfg.timeoutMs || 180_000,
    })

    let parsed
    try {
      parsed = parsePlanJson(rawText)
    } catch (e) {
      fail(502, 'bad_model_json', `Model returned non-JSON plan: ${e instanceof Error ? e.message : e}`, {
        hint: 'Use dry-run, or try generate again.',
        raw: rawText.slice(0, 3000),
      })
    }

    const plan = validateMoviePlan(parsed, { userPrompt: prompt })
    logInfo('director.plan', { kind: 'movie', projectId: plan.projectId, dryRun: false, model })
    return { plan, dryRun: false, model, rawModelText: rawText.slice(0, 50_000) }
  } catch (e) {
    if (e?.name === 'AbortError') {
      fail(504, 'lms_timeout', 'LM Studio request timed out', {
        hint: 'Raise planner.timeout_ms in qorlith.yaml, or shorten the prompt.',
      })
    }
    if (e instanceof Error && /^LMS \d+/.test(e.message)) {
      fail(502, 'lms_chat', `LM Studio chat failed: ${e.message}`, {
        hint: 'Check planner.model in qorlith.yaml / qorlith.local.yaml, and that LM Studio can load it.',
      })
    }
    throw e
  } finally {
    if (prepared && dcfg.unloadAfterPlan !== false) {
      await releasePlanModel(dcfg).catch(() => {})
    }
  }
}

export function planPaths(projectId, { lookTrack } = {}) {
  const id = slugifyProjectId(projectId)
  const studio = loadStudio()
  const comfyOut =
    process.env.COMFY_OUTPUT ||
    String(studio.comfy.output || '').trim() ||
    (String(studio.comfy.root || '').trim()
      ? path.join(String(studio.comfy.root).trim(), 'output')
      : path.join(ROOT, 'data', 'comfy-output'))
  const track =
    String(lookTrack || 'live').toLowerCase() === 'anime' ? 'anime' : 'live'
  const dir = projectDir(id)
  return {
    planJson: planRecordPath(id),
    planMd: path.join(dir, 'plan.md'),
    shotlistPath: path.join(dir, 'shotlist.json'),
    statusPath: path.join(dir, 'status.json'),
    logPath: path.join(dir, 'produce.log'),
    stillRoot: path.join(comfyOut, 'qorlith', track, id, 'stills'),
    videoRoot: path.join(comfyOut, 'qorlith', track, id, 'video'),
    projectRoot: path.join(comfyOut, 'qorlith', track, id),
  }
}

const MEDIA_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
])

function walkMediaFiles(dir, { maxDepth = 8, depth = 0 } = {}) {
  if (depth > maxDepth || !dir) return []
  const out = []
  try {
    if (!fs.existsSync(dir)) return []
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        out.push(...walkMediaFiles(p, { maxDepth, depth: depth + 1 }))
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase()
        if (MEDIA_EXT.has(ext)) out.push(p)
      }
    }
  } catch {
    /* permission / race */
  }
  return out
}

/**
 * Collect still/video media for a studio project (does not delete files).
 */
export function collectProjectMediaPaths(projectId, { lookTrack } = {}) {
  const id = slugifyProjectId(projectId)
  const rec = loadProjectRecord(id)
  const track = lookTrack || rec?.plan?.lookTrack || rec?.paths?.lookTrack
  const paths = rec?.paths?.stillRoot
    ? {
        stillRoot: rec.paths.stillRoot,
        videoRoot: rec.paths.videoRoot,
        projectRoot: rec.paths.projectRoot || path.dirname(rec.paths.stillRoot || rec.paths.videoRoot || ''),
      }
    : planPaths(id, { lookTrack: track })

  const roots = new Set()
  if (paths.stillRoot) roots.add(paths.stillRoot)
  if (paths.videoRoot) roots.add(paths.videoRoot)
  if (paths.projectRoot) roots.add(paths.projectRoot)
  // Also scan alternate track folder if plan used wrong track historically
  const alt = planPaths(id, {
    lookTrack: String(track || '').toLowerCase() === 'anime' ? 'live' : 'anime',
  })
  if (alt.projectRoot) roots.add(alt.projectRoot)

  const media = []
  const seen = new Set()
  for (const root of roots) {
    for (const f of walkMediaFiles(root)) {
      const key = path.resolve(f).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      media.push(path.resolve(f))
    }
  }
  return { projectId: id, roots: [...roots], media, paths }
}

/**
 * Mark studio plan archived + drop from Produce studio registry (no media scan).
 * Used by Produce page archive for any pipeline that also has a plan record.
 */
export function markStudioProjectArchived(projectId, { mediaCount = 0, roots = [] } = {}) {
  const id = slugifyProjectId(projectId)
  const rec = loadProjectRecord(id)
  const now = new Date().toISOString()
  const reg = loadStudioProducePipelines().filter((p) => p.id !== id)
  saveStudioProducePipelines(reg)
  if (!rec) {
    return { projectId: id, record: null, updated: false }
  }
  rec.archived = true
  rec.archivedAt = now
  rec.status = 'archived'
  rec.produceRegistered = false
  rec.updatedAt = now
  rec.archive = {
    mediaCount,
    roots,
    at: now,
  }
  saveProjectRecord(rec)
  try {
    const logPath = rec.paths?.logPath || planPaths(id).logPath
    fs.appendFileSync(
      logPath,
      `[${now}] archived via Produce UI · mediaFiles=${mediaCount}\n`,
      'utf8',
    )
  } catch {
    /* ignore */
  }
  return { projectId: id, record: rec, updated: true }
}

/**
 * Mark plan archived + remove from Produce studio registry.
 * Media paths are returned for the caller to add to gallery archive store.
 */
export function archivePlanProject(projectId) {
  const id = slugifyProjectId(projectId)
  const rec = loadProjectRecord(id)
  if (!rec?.plan && !rec?.projectId) {
    fail(404, 'plan_not_found', 'plan not found', {
      hint: 'Generate a plan in Plan, then archive.',
    })
  }
  const collected = collectProjectMediaPaths(id, { lookTrack: rec?.plan?.lookTrack })
  const now = new Date().toISOString()

  // Drop from Produce studio registry
  const reg = loadStudioProducePipelines().filter((p) => p.id !== id)
  saveStudioProducePipelines(reg)

  rec.archived = true
  rec.archivedAt = now
  rec.status = 'archived'
  rec.produceRegistered = false
  rec.updatedAt = now
  rec.archive = {
    mediaCount: collected.media.length,
    roots: collected.roots,
    at: now,
  }
  saveProjectRecord(rec)

  // Append log line if log path exists / known
  try {
    const logPath = rec.paths?.logPath || planPaths(id).logPath
    fs.appendFileSync(
      logPath,
      `[${now}] archived via Studio Planner · mediaFiles=${collected.media.length}\n`,
      'utf8',
    )
  } catch {
    /* ignore */
  }

  return {
    projectId: id,
    title: rec.plan?.title || id,
    mediaPaths: collected.media,
    mediaCount: collected.media.length,
    roots: collected.roots,
    record: rec,
    message:
      collected.media.length > 0
        ? `Archived ${collected.media.length} media file(s) for ${id} (hidden from Gallery; files kept on disk).`
        : `Project ${id} marked archived (no media files found under project stills/video roots).`,
  }
}

/**
 * Approve plan: lock the story, write shotlist + board, register the project
 * for archive/floor. Does not queue Comfy — Make (Brain) is the factory.
 */
export function approvePlan(projectId, { startProduction = true } = {}) {
  const rec = loadProjectRecord(projectId)
  if (!rec?.plan) {
    fail(404, 'plan_not_found', 'plan not found', {
      hint: 'Generate a plan in Plan, then approve.',
    })
  }
  const plan = rec.plan
  const id = plan.projectId
  const paths = planPaths(id, { lookTrack: plan.lookTrack })
  const now = new Date().toISOString()

  // Shotlist for Produce
  const shotlist = {
    id,
    title: plan.title,
    rating: plan.rating,
    durationTargetSec: plan.durationTargetSec,
    song: plan.song,
    notes: `Studio Planner approved ${now}. See ${paths.planMd}`,
    lookTrack: plan.lookTrack,
    characters: plan.characters,
    musicPalette: plan.musicPalette,
    clips: plan.clips.map((c) => ({
      id: c.id,
      title: c.title,
      section: c.section,
      mood: c.mood,
      t_start: c.t_start,
      t_end: c.t_end,
      durationSec: c.durationSec,
      cut: Boolean(c.cut),
      gun_risk: c.gun_risk,
      sexy: c.sexy,
      stillBrief: c.stillBrief,
      motionBrief: c.motionBrief,
      dialogue: c.dialogue,
    })),
  }
  fs.mkdirSync(path.dirname(paths.shotlistPath), { recursive: true })
  fs.writeFileSync(paths.shotlistPath, JSON.stringify(shotlist, null, 2), 'utf8')

  // Markdown plan on disk — full storyboard, not just the model's notes line
  fs.mkdirSync(path.dirname(paths.planMd), { recursive: true })
  writeStoryboard(rec)

  // Resume status JSON (empty done → all pending in Produce)
  const status = {
    startedAt: startProduction ? now : null,
    updatedAt: now,
    approvedAt: now,
    productionRequested: Boolean(startProduction),
    phase: startProduction ? 'approved_pending_stills' : 'approved',
    config: {
      lookTrack: plan.lookTrack,
      duration_default: Math.round(
        plan.clips.reduce((a, c) => a + c.durationSec, 0) / Math.max(1, plan.clips.length),
      ),
      mp: 0.5,
      source: 'studio_planner',
    },
    planId: id,
    done: {},
  }
  // If prior status exists, merge done (resume-safe re-approve)
  try {
    if (fs.existsSync(paths.statusPath)) {
      const prev = JSON.parse(fs.readFileSync(paths.statusPath, 'utf8'))
      if (prev.done && typeof prev.done === 'object') status.done = prev.done
      if (prev.startedAt) status.startedAt = prev.startedAt
    }
  } catch {
    /* ignore */
  }
  fs.writeFileSync(paths.statusPath, JSON.stringify(status, null, 2), 'utf8')

  // Touch log
  fs.appendFileSync(
    paths.logPath,
    `[${now}] approved via Studio Planner · clips=${plan.clips.length} · productionRequested=${startProduction}\n`,
    'utf8',
  )

  // Register Produce pipeline
  const entry = {
    id,
    name: plan.title,
    statusPath: paths.statusPath,
    logPath: paths.logPath,
    shotlistPath: paths.shotlistPath,
    stillRoot: paths.stillRoot,
    videoRoot: paths.videoRoot,
    song: plan.song,
  }
  const reg = loadStudioProducePipelines().filter((p) => p.id !== id)
  reg.unshift(entry)
  saveStudioProducePipelines(reg)

  rec.approved = true
  rec.produceRegistered = true
  rec.status = 'approved'
  rec.updatedAt = now
  rec.paths = paths
  rec.shotlist = shotlist
  saveProjectRecord(rec)
  logInfo('studio.approve', { projectId: id, clips: plan.clips.length, startProduction })

  try {
    ensureEpisodePlan(id, {
      title: plan.title,
      markdown: plan.markdown,
      scenes: (plan.clips || []).map((c) => ({
        id: c.id,
        title: c.title,
        heading: `### ${c.id} — ${c.title}`,
      })),
    })
  } catch {
    /* board is optional if disk is read-only */
  }

  return {
    projectId: id,
    paths,
    producePipelineId: id,
    status,
    message: 'Plan locked. Open Make and press Make the film when you are ready.',
  }
}
