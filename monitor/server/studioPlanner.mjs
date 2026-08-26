/**
 * Studio Planner — local LLM movie plans.
 * Uses LM Studio. Does not queue Comfy — Make (Brain) is the factory.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { directorConfigFromApp, lmstudioHealth, parsePlanJson } from './director.mjs'
import { ensureServer, preparePlanModel, releasePlanModel, resolveLmsPath } from './lms.mjs'
import {
  chatCompletions,
  normalizePlannerProvider,
  plannerNeedsLms,
  resolvePlanner,
} from './plannerProvider.mjs'
import { clipDurationBounds, loadStudio, normalizeVideoMode } from './studioConfig.mjs'
import { ensureEpisodePlan } from './episodePlan.mjs'
import { slugifyProjectId } from './ids.mjs'
import { loadProjectRecord, planRecordPath, projectDir, saveProjectRecord } from './project.mjs'
import { loadStudioProducePipelines, saveStudioProducePipelines } from './produce.mjs'
import { info as logInfo } from './log.mjs'
import { fail } from './errors.mjs'
import { writeStoryboard } from './storyboard.mjs'
import { applyHouseLockToPlan, textWantsGits } from './gitsLock.mjs'

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
- Each MiniMax take is 6–15 s. Default 12. First clip and cut=true may be 6–15 (punch-in / hold may be 6–8).
- cut=false continue takes are 10–15 s (prefer 12). Never 6–8 on a continue — the join needs ~2 s quiet + ~2 s settle.
- n ≈ ceil(durationTargetSec / 10). Never one 30–120 s MiniMax job.
- ids are stable S01, S02, … (used as resume keys).
- t_start / t_end are consecutive on the master timeline. sum(durationSec) ≈ durationTargetSec.
- Prefer one continuous shot per clip.

CONTINUITY
- Default cut=false. Video N+1 starts from the last frame of video N (same body, costume, space).
- Set cut=true only for a purposeful hard cut: new location, time jump, or a still the previous last frame cannot continue.
- Do not mark every clip as a cut. A chase or fight in one space is one continue chain.
- Continue airlock (cut=false, not S01): the app holds the previous closing pose for ~2 s (breath / weight shift only, no speech), then your motionBrief, then ~2 s settle. Write the action AFTER that hold. Do not start or end a spoken line on the weld. Never split one line across two clips.
- Each continue take must change a physical, irreversible world state (not only a look or a camera move).

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
- Action stills (weapon, rooftop, alley, chase, raid): medium-wide from the thighs up. Face readable, body, weapon, and location in frame. Never a head-and-shoulders crop.
- Talk or portrait stills: medium shot or closer with the lead face clearly visible.
- Do not open on a distant figure where the face is a few pixels. Do not make every still a face close-up.

MOTION BRIEF = MiniMax H3 I2VA motion only
The start still IS frame 0. The app wraps your text as I2VA + identity lock. You write only what CHANGES.
- Path: action onset → continuous development → result/reaction. The app holds the still for about one second, then your motion, then ~2 s settle on continue takes.
- Do not write the hold or the settle yourself. Do not walk the subject into frame from off-screen — they are already in the still.
- Camera as prose: motion type + optional amplitude + optional speed.
  Verbs: push in, pull out, pan left/right, truck left/right, tilt up/down, pedestal, arc, tracking, static, POV, shake slightly/strongly, roll.
  Amplitude: with small amplitude / with large amplitude. Speed: at slow speed / at fast speed. Omit medium.
- Keep identity, costume, colors, props, and space consistent with the still.
- Do NOT re-describe wardrobe or the set. Do NOT use Wan "At 0 seconds / At 1 second" beat lists. Do NOT name video models or LoRAs.
- Do NOT write [Shot 1] — the app wraps I2VA + style + identity lock. Prefer one continuous shot. If you must cut inside a take: "the camera cuts to".

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
- 1–4 English sentences. Ambient + physical action + non-verbal human sound (rain, footsteps, gunfire, breath).
- Never dialogue, never audience score. N/A only if the clip has no diegetic sound.

MUSIC
- musicPalette = global non_diegetic_music: at least two named instruments + tempo + dynamics. No vocals. Drops under dialogue.
- musicNote = THAT CLIP's non_diegetic_music string (named instruments + tempo + dynamics) or N/A.
- musicNote is fed to MiniMax as non_diegetic_music.
- Never write only "soft" / "loud" / "epic" / "emotional" / "orchestral" / "dynamic".
- If the user named drums, piano, guitar, etc., those instruments MUST appear in musicPalette and musicNote.
- Diegetic radio/TV/phone music belongs in dialogue or motion, not musicNote.
- Silent / no dialogue means no speech. Do not clear the score unless they also said no music / no score, or said silent without naming instruments or a score.
- If the user asked for no music / no score, or silent with no named score: musicPalette is N/A AND every musicNote is N/A. This overrides house style.

DEFAULTS when the user is vague
- 30 s · R · look from STYLE or live · MiniMax score · 10–12 s clips.
- Invent a tight logline and label assumed defaults in markdown. Do not ask questions.

DURATION
- durationSec is 6–15 (prefer 10–12). Never 4 or 5. Hard max 15.
- A 24 s beat is 12+12, not 3×8. A 20 s continue chain is 10+10, not 12+8.
- sum(durationSec) must match durationTargetSec (off by at most 1 second).

TEMPLATES (fill from the USER request — do not invent a leftover example cast)
stillBrief: adult lock, outfit, frozen pose, location, lighting, framing (action = medium-wide thighs up; talk = medium/close)
motionBrief: The camera VERB with small amplitude at slow speed as BODY ACTION.
musicNote: two named instruments at a TEMPO, DYNAMICS, music drops under dialogue
Never copy a character, location, or spoken line that the user did not ask for.
Never leave angle brackets or curly braces in the JSON.`

/** Straight to video: no painted still. motionBrief is the whole MiniMax T2VA scene. */
export const T2V_PLANNER_RULES = `PIPELINE
Straight to video: each clip is MiniMax H3 text-to-video-audio. No start still is painted. You do not queue Comfy. You only write the plan JSON.

CLIP MATH (hard)
- Each MiniMax take is 6–15 s. Default 12. First clip and cut=true may be 6–15 (punch-in / hold may be 6–8).
- cut=false continue takes are 10–15 s (prefer 12). Never 6–8 on a continue — the join needs ~2 s quiet + ~2 s settle.
- n ≈ ceil(durationTargetSec / 10). Never one 30–120 s MiniMax job.
- ids are stable S01, S02, … (used as resume keys).
- t_start / t_end are consecutive on the master timeline. sum(durationSec) ≈ durationTargetSec.
- Prefer one continuous shot per clip.

CONTINUITY
- Default cut=false. Video N+1 starts from the last frame of video N (same body, costume, space) as I2VA.
- S01 and cut=true are T2VA (no Picture 1). cut=false continues from the previous last frame.
- Set cut=true only for a purposeful hard cut: new location, time jump, or a still the previous last frame cannot continue.
- Do not mark every clip as a cut. A chase or fight in one space is one continue chain.
- Continue airlock (cut=false, not S01): the app holds the previous closing pose for ~2 s (breath / weight shift only, no speech), then your motionBrief, then ~2 s settle. Write the action AFTER that hold. Do not start or end a spoken line on the weld. Never split one line across two clips.
- Each continue take must change a physical, irreversible world state (not only a look or a camera move).

LOOK
- lookTrack is only "anime" or "live".
- anime = 2D / cel / GitS-like. live = photoreal / camcorder / found-footage.
- If the user names a look, honor it.
- Office, kitchen, hotel, handshake, documentary, found-footage, hidden cam, camcorder, photoreal, real_movie → live. STYLE anime cannot override those.
- GitS / anime / rooftop duel anime → anime when the user said so.
- If still unspecified, follow the STYLE block, else live.
- Do not mix tracks inside one plan.

CHARACTERS
- 1–3 adults. Each has look (visual lock repeated in motionBrief) and voice (frozen for every spoken clip).
- Same face, costume, and location language across clips unless a beat changes them.
- Adults only. Never teen / child / loli / shota / minor framing. Fictional cast.

STILL BRIEF = unused place note
- A short location string is enough. It is NOT sent to MiniMax. No SDXL tags, no frozen pose lists, no 1girl/solo.

MOTION BRIEF
S01 and cut=true are T2VA (no Picture 1). Continue (cut=false, not S01) is I2VA from the previous last frame.
- T2VA (S01 / cut=true): the FULL MiniMax T2VA scene. Open with "a medium-wide shot frames LOCATION." Then who, action, camera. Include the lead's appearance unless a house lock already did. Do NOT write Picture 1 or [Shot 1].
- Continue I2VA: camera + body action only AFTER the hold. Do NOT reopen the shot ("a medium-wide shot frames"). Do NOT re-describe wardrobe, hair, or the lead look — they are already in the last frame.
- Path: action onset → continuous development → result/reaction. Do not write the continue hold or settle yourself.
- Camera as prose: motion type + optional amplitude + optional speed.
  Verbs: push in, pull out, pan left/right, truck left/right, tilt up/down, pedestal, arc, tracking, static, POV, shake slightly/strongly, roll.
  Amplitude: with small amplitude / with large amplitude. Speed: at slow speed / at fast speed. Omit medium.
- Do NOT write SDXL tags, Wan "At 0 seconds" beat lists, or video model names.
- Prefer one continuous shot. If you must cut inside a take: "the camera cuts to".

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
- 1–4 English sentences. Ambient + physical action + non-verbal human sound (rain, footsteps, gunfire, breath).
- Never dialogue, never audience score. N/A only if the clip has no diegetic sound.

MUSIC
- musicPalette = global non_diegetic_music: at least two named instruments + tempo + dynamics. No vocals. Drops under dialogue.
- musicNote = THAT CLIP's non_diegetic_music string (named instruments + tempo + dynamics) or N/A.
- musicNote is fed to MiniMax as non_diegetic_music.
- Never write only "soft" / "loud" / "epic" / "emotional" / "orchestral" / "dynamic".
- If the user named drums, piano, guitar, etc., those instruments MUST appear in musicPalette and musicNote.
- Diegetic radio/TV/phone music belongs in dialogue or motion, not musicNote.
- Silent / no dialogue means no speech. Do not clear the score unless they also said no music / no score, or said silent without naming instruments or a score.
- If the user asked for no music / no score, or silent with no named score: musicPalette is N/A AND every musicNote is N/A. This overrides house style.

DEFAULTS when the user is vague
- 30 s · R · look from STYLE or live · MiniMax score · 10–12 s clips.
- Invent a tight logline and label assumed defaults in markdown. Do not ask questions.

DURATION
- durationSec is 6–15 (prefer 10–12). Never 4 or 5. Hard max 15.
- A 24 s beat is 12+12, not 3×8. A 20 s continue chain is 10+10, not 12+8.
- sum(durationSec) must match durationTargetSec (off by at most 1 second).

TEMPLATES (fill from the USER request — do not invent a leftover example cast)
stillBrief: short location only
motionBrief (S01 / cut=true): a medium-wide shot frames LOCATION. The camera VERB with small amplitude at slow speed as BODY ACTION.
motionBrief (continue): The camera VERB with small amplitude at slow speed as BODY ACTION.
musicNote: two named instruments at a TEMPO, DYNAMICS, music drops under dialogue
Never copy a character, location, or spoken line that the user did not ask for.
Never leave angle brackets or curly braces in the JSON.`

export function plannerCoreRules(videoMode) {
  return normalizeVideoMode(videoMode) === 't2v' ? T2V_PLANNER_RULES : CORE_PLANNER_RULES
}

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
    "soundscape": "1-4 diegetic sentences or N/A",
    "musicNote": "instruments + tempo + dynamics, or N/A"
  }],
  "markdown": "short production notes: defaults assumed, clip math, risks"
}`

export function buildMoviePlanSystemPrompt(extra = {}) {
  const system = String(extra.system || '').trim()
  const style = String(extra.style || '').trim()
  const t2v = normalizeVideoMode(extra.videoMode) === 't2v'
  const custom = [system && `--- STUDIO NOTES ---\n${system}`, style && `--- STYLE ---\n${style}`]
    .filter(Boolean)
    .join('\n\n')
  const sex = t2v
    ? '- If the user asked for graphic sex: rating X. motionBrief names the explicit act continuing (mouth, tongue, vulva, penetration). stillBrief may be short. No fade-to-black, no silhouette, no "intimacy" euphemism.\n'
    : '- If the user asked for graphic sex: rating X. stillBrief is a frozen explicit frame that names the act (mouth, tongue, vulva, penetration). motionBrief continues that act. No fade-to-black, no silhouette, no "intimacy" euphemism.\n'
  return `You are the Studio Planner for Qorlith offline movie production.
Write complete ${t2v ? 'Straight to video MiniMax H3 T2VA' : 'stills-first MiniMax H3'} plans. Reply with ONE JSON object only (optional markdown fence). No prose outside JSON.

${plannerCoreRules(extra.videoMode)}

CRITICAL OUTPUT
- JSON only, matching this schema:
${PLAN_JSON_SCHEMA}
- Each clip durationSec MUST be 6–15 (max 15). Continue (cut=false) takes MUST be ≥10. cut defaults to false.
- stillBrief ≤ 800 characters. motionBrief ≤ 800 characters.
- Adults only.
${sex}${custom ? `\n${custom}\n` : ''}`
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
const ACTION_FRAME_RE =
  /\b(smg|rifle|pistol|shotgun|gun|weapon|rooftop|alley|chase|raid|fight|combat)\b/i
const WIDE_FRAME_RE =
  /\b(medium-wide|wide shot|from the thighs|full body|environment visible|cowboy shot)\b/i

/** S01 must keep a readable face. Action stills go medium-wide, talk stills go closer. */
export function ensureLeadFaceFraming(plan, warnings = []) {
  if (normalizeVideoMode(plan?.videoMode) === 't2v') return plan
  const first = Array.isArray(plan?.clips) ? plan.clips[0] : null
  if (!first) return plan
  let brief = String(first.stillBrief || '')
  if (!brief.trim()) return plan
  if (ACTION_FRAME_RE.test(brief)) {
    if (!WIDE_FRAME_RE.test(brief)) {
      first.stillBrief = `medium-wide shot, from the thighs up, face readable, environment visible, ${brief}`.slice(
        0,
        800,
      )
      warnings.push(`${first.id || 'S01'}: prepended medium-wide action frame`)
    }
    return plan
  }
  if (FACE_FRAME_RE.test(brief)) return plan
  first.stillBrief = `medium close-up, face clearly visible, looking toward camera, ${brief}`.slice(0, 800)
  warnings.push(`${first.id || 'S01'}: prepended face-visible medium close-up`)
  return plan
}

export function inferPlanHints(userPrompt) {
  const t = String(userPrompt || '')
  const gits = textWantsGits(t)
  const liveHit =
    /\b(live|found-?footage|photoreal|real_movie|camcorder|hidden\s*cam|kitchen|office|hotel|handshake|documentary)\b/i.test(
      t,
    )
  const animeHit = /\b(anime|gits|ghost in the shell|2d|cel[- ]?shad)\b/i.test(t)
  const silentWord = /\bsilent\b/i.test(t)
  const namedScore =
    /\bminimax\s+music\b/i.test(t) ||
    (/\bmusic\b/i.test(t) && !/\bno music\b/i.test(t)) ||
    (/\bscore\b/i.test(t) && !/\bno score\b/i.test(t)) ||
    /\b(taiko|cello|piano|guitar|drums?|synth|bass|strings?|violin|brass|snare|organ|harp|flute)\b/i.test(t)
  const noMusic = /\bno music\b|\bno score\b/i.test(t) || (silentWord && !namedScore)
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
    namedScore,
    noTalk,
    wantsTalk,
    wantsX,
    liveHit,
    animeHit,
  }
}

export function buildPlanUserMessage(userPrompt, extra = {}) {
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
    ? 'ON — repeat the house visual lock on every still. Comma-separated tags. If a second adult is in frame, mark two people. Deny phrases on extras do not turn this off.'
    : 'OFF — invent a NEW adult lock; do not paste a house character lock'
  const xLine = h.wantsX
    ? '- rating X. stillBrief names the explicit act (mouth, tongue, vulva, fingers, strap-on). motionBrief is that act continuing. No "intimacy", no fade-to-black, no "lowers her head toward her lap" euphemism.\n'
    : ''
  return `Create a complete movie production plan for this request:

${userPrompt}

REQUEST CHECKLIST (follow exactly)
- durationTargetSec: ${h.durationSec}; about ${h.clipCount} takes of 6–15s (prefer 10–12). Continue (cut=false) takes are 10–15s. Never pad by repeating beats with _2 titles.${h.durationSec >= 60 ? ' Keep each stillBrief under 350 characters so the JSON fits.' : ''}
- lookTrack: ${h.look}
- music: ${musicLine}
- dialogue: ${talkLine}
- House character lock: ${gitsLine}
- cut=false continues the same space from the last frame; cut=true only on location or time jumps
- Action S01 stillBrief is medium-wide from the thighs up with the face, weapon, and location readable. Talk S01 is medium or close with the lead face clearly visible.
- adults only. One new beat per clip.
${
    normalizeVideoMode(extra.videoMode) === 't2v'
      ? '- videoMode is t2v. stillBrief may be short. motionBrief is the FULL MiniMax scene (style, composition, action, camera). Do not write Picture 1. No start still will be painted.\n'
      : '- videoMode is stills (default). Frozen stillBrief plus motion-only motionBrief.\n'
  }
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
      if (!c.soundscape) c.soundscape = ''
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
  applyHouseLockToPlan(plan, userPrompt, warnings)
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
export async function plannerChat({
  baseUrl,
  model,
  system,
  user,
  temperature,
  maxTokens,
  timeoutMs,
  apiKey,
  tryDisableThinking = true,
}) {
  const args = { baseUrl, apiKey, model, system, user, temperature, maxTokens, timeoutMs }
  async function once(userContent, extraBody) {
    return chatCompletions({ ...args, user: userContent, extraBody })
  }
  let first
  try {
    first = tryDisableThinking
      ? await once(user, { enable_thinking: false })
      : await once(user)
  } catch (e) {
    if (tryDisableThinking && /PLANNER 400/.test(String(e?.message || ''))) {
      first = await once(user)
    } else {
      throw e
    }
  }
  if (looksLikePlanJson(first)) return first
  const retryUser = `${user}\n\nSTOP. Your last reply was not JSON. Reply with ONE JSON object only. No thinking. No prose.`
  return once(retryUser, tryDisableThinking ? { enable_thinking: false } : undefined)
}

export function validateMoviePlan(raw, { userPrompt = '', videoMode } = {}) {
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
    const cut = Boolean(c.cut)
    const continueMin = Number(bounds.continueMin) > 0 ? Number(bounds.continueMin) : 10
    if (i > 0 && !cut && durationSec < continueMin) {
      warnings.push(`${id}: continue take ${durationSec}s < ${continueMin}s, raised`)
      durationSec = Math.min(continueMin, bounds.max)
    }
    const t_start = Number.isFinite(Number(c.t_start)) ? Number(c.t_start) : cursor
    const t_end = t_start + durationSec
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
    videoMode: normalizeVideoMode(videoMode ?? raw.videoMode),
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

export function splitClipDurations(totalSec, bounds = clipDurationBounds()) {
  const max = Number(bounds.max) > 0 ? Number(bounds.max) : 15
  const continueMin = Number(bounds.continueMin) > 0 ? Number(bounds.continueMin) : 10
  const prefer = Math.min(12, max)
  const total = Math.max(6, Math.round(Number(totalSec) || 30))
  if (total <= max) return [total]
  const takes = []
  let left = total
  while (left > 0) {
    if (left <= max) {
      if (takes.length && left < continueMin) {
        const steal = continueMin - left
        const prev = takes[takes.length - 1]
        if (prev - steal >= continueMin) {
          takes[takes.length - 1] = prev - steal
          left += steal
        }
      }
      takes.push(Math.min(max, Math.max(takes.length ? continueMin : 6, left)))
      break
    }
    let d = prefer
    const rest = left - d
    if (rest > 0 && rest < continueMin) d = left - continueMin
    d = Math.min(max, Math.max(continueMin, d))
    takes.push(d)
    left -= d
  }
  return takes
}

function titleFromPrompt(prompt) {
  let t = String(prompt || '')
    .replace(/^\s*\d+\s*(?:seconds?|secs?|minutes?|mins?|s)\b\s*/i, '')
    .trim()
  t = t.split(/[.,]/)[0].trim()
  const words = t.split(/\s+/).filter(Boolean).slice(0, 4)
  if (!words.length) return 'Untitled film'
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').slice(0, 48)
}

function locationFromPrompt(t) {
  if (/\brooftop\b/i.test(t)) return 'rain-slick rooftop, neon city behind, wet concrete'
  if (/\balley\b/i.test(t)) return 'rain-wet neon alley, wet brick, puddles'
  if (/\bserver|raid\b/i.test(t)) return 'night server floor, rows of racks, cold LEDs'
  if (/\bkitchen\b/i.test(t)) return 'small kitchen, practical overhead light'
  if (/\bhotel\b/i.test(t)) return 'hotel room, lamp light, drawn curtains'
  if (/\bstreet|chase\b/i.test(t)) return 'night street, wet asphalt, sodium lamps'
  return 'night exterior, practical light'
}

function propFromPrompt(t) {
  if (/\bsmg\b/i.test(t)) return 'holding compact SMG two-handed, gun clearly in frame'
  if (/\b(rifle|pistol|gunfire|gun)\b/i.test(t)) return 'holding a compact firearm two-handed, weapon clearly in frame'
  return ''
}

function motionFromPrompt(t, index) {
  let action = 'the lead shifts weight, rain moves, a slow breath'
  if (/\b(smg|gunfire|gun|rifle|pistol)\b/i.test(t)) {
    action =
      index === 0
        ? 'the lead holds the weapon steady, then a short burst, muzzle flash, casings drop'
        : 'another short burst, casings bounce, the lead holds aim'
  } else if (/\bchase|run\b/i.test(t)) {
    action = index === 0 ? 'the lead runs forward, feet splash' : 'the chase continues, rain streaks'
  } else if (/\bfight|raid\b/i.test(t)) {
    action = index === 0 ? 'the lead strikes, recoil in the rain' : 'the fight continues, an irreversible hit lands'
  }
  return `The camera holds static with small amplitude at slow speed as ${action}.`
}

function soundFromPrompt(t) {
  const bits = []
  if (/\brain\b/i.test(t)) bits.push('Heavy rain')
  if (/\b(smg|gunfire|gun)\b/i.test(t)) bits.push('A short burst cracks. Casings tinkle')
  if (/\bchase\b/i.test(t)) bits.push('Footsteps splash')
  if (!bits.length) bits.push('Ambient night air')
  return `${bits.join('. ')}.`
}

/** Deterministic stills-first plan when no writer is available. House lock still applies. */
export function draftMoviePlanFromPrompt(userPrompt, { reason = 'draft', videoMode } = {}) {
  const prompt = String(userPrompt || '').trim()
  const mode = normalizeVideoMode(videoMode)
  const h = inferPlanHints(prompt)
  const takes = splitClipDurations(h.durationSec)
  const title = titleFromPrompt(prompt)
  const loc = locationFromPrompt(prompt)
  const prop = propFromPrompt(prompt)
  const gun = Boolean(prop)
  const anime = h.look === 'anime'
  const leadLook = anime ? 'adult woman, short dark hair' : 'adult, short dark hair, dark jacket'
  const stillCore = [anime ? '1girl, solo, adult woman' : 'adult', prop, loc, anime ? '2D cel shading' : 'cinematic lighting']
    .filter(Boolean)
    .join(', ')
  const palette = h.noMusic
    ? 'N/A'
    : 'sparse taiko drums and distorted cello at moderate tempo, staccato dynamics, no vocals'
  let t = 0
  const clips = takes.map((durationSec, i) => {
    const id = `S${String(i + 1).padStart(2, '0')}`
    const clip = {
      id,
      title: i === 0 ? 'open' : i === takes.length - 1 ? 'close' : 'press',
      section: 'main',
      mood: gun ? 'tense' : 'neutral',
      t_start: t,
      t_end: t + durationSec,
      durationSec,
      cut: false,
      gun_risk: gun,
      sexy: false,
      stillBrief: mode === 't2v' ? loc : stillCore,
      motionBrief:
        mode === 't2v' && i === 0
          ? `a medium-wide shot frames ${loc}. ${motionFromPrompt(prompt, i)}`
          : motionFromPrompt(prompt, i),
      dialogue: h.noTalk ? '' : '',
      soundscape: soundFromPrompt(prompt),
      musicNote: palette,
    }
    t += durationSec
    return clip
  })
  const plan = validateMoviePlan(
    {
      projectId: slugifyProjectId(title),
      title,
      logline: prompt.slice(0, 240) || title,
      rating: h.wantsX ? 'X' : 'R',
      durationTargetSec: takes.reduce((a, n) => a + n, 0),
      lookTrack: h.look,
      videoMode: mode,
      song: h.noMusic ? 'N/A' : 'taiko and cello',
      musicPalette: palette,
      characters: [
        {
          id: 'S1',
          name: 'Lead',
          look: leadLook,
          voice: h.noTalk ? 'unused' : 'calm mid voice',
        },
      ],
      clips,
      markdown: `# ${title}\n\nDrafted from the prompt (${reason}).\n\n${prompt.slice(0, 400)}`,
    },
    { userPrompt: prompt, videoMode: mode },
  )
  plan.warnings = [
    ...(plan.warnings || []),
    `Drafted without a writer (${reason}). Start the planner or POST a plan JSON for a full story.`,
  ]
  return plan
}

export function dryRunMoviePlan(userPrompt, extra = {}) {
  return draftMoviePlanFromPrompt(userPrompt, { reason: 'dry-run', ...extra })
}

export function plannerSpec() {
  const studio = loadStudio()
  const resolved = resolvePlanner(studio.planner)
  return {
    provider: resolved.provider,
    url: resolved.url,
    model: resolved.model || null,
    local: resolved.local,
    system: buildMoviePlanSystemPrompt({
      system: studio.planner.system,
      style: studio.planner.style,
    }),
    userTemplate: buildPlanUserMessage('YOUR PROMPT HERE'),
    schema: PLAN_JSON_SCHEMA,
    howTo:
      'POST /api/studio/plan with { prompt, plan } to skip the LLM, or POST /api/studio/film for one-click stills+video. GET this spec, write JSON matching the schema, then POST it back.',
  }
}

export async function generateMoviePlan({ userPrompt, dryRun = false, appConfig, plan: imported, videoMode } = {}) {
  const prompt = String(userPrompt || '').trim()
  const hasImport = imported && typeof imported === 'object'
  const mode = normalizeVideoMode(videoMode || imported?.videoMode)
  if (!prompt && !hasImport) {
    fail(400, 'missing_prompt', 'prompt required', {
      hint: 'Describe the short, or POST a plan JSON.',
    })
  }

  if (hasImport) {
    const plan = validateMoviePlan(imported, {
      userPrompt: prompt || String(imported.logline || imported.title || ''),
      videoMode: mode,
    })
    logInfo('director.plan', { kind: 'movie', projectId: plan.projectId, dryRun: false, model: 'imported' })
    return { plan, dryRun: false, model: 'imported', provider: 'none', rawModelText: null }
  }

  if (dryRun) {
    const plan = dryRunMoviePlan(prompt, { videoMode: mode })
    logInfo('director.plan', { kind: 'movie', projectId: plan.projectId, dryRun: true })
    return { plan, dryRun: true, model: null, provider: 'none', rawModelText: null }
  }

  const dcfg = directorConfigFromApp()
  const resolved = resolvePlanner({
    provider: dcfg.plannerProvider,
    url: dcfg.lmstudioBaseUrl,
    model: dcfg.planModelKey || dcfg.model,
    api_key: dcfg.plannerApiKey,
  })
  const provider = resolved.provider

  if (provider === 'none') {
    const plan = draftMoviePlanFromPrompt(prompt, { reason: 'provider none', videoMode: mode })
    logInfo('director.plan', { kind: 'movie', projectId: plan.projectId, dryRun: false, model: 'draft', provider })
    return { plan, dryRun: false, model: 'draft', provider: 'none', rawModelText: null }
  }

  if (resolved.needsKey && !resolved.apiKey) {
    fail(503, 'planner_key', 'Planner API key missing', {
      hint: 'Set planner.api_key or QORLITH_PLANNER_KEY / XAI_API_KEY / OPENAI_API_KEY.',
    })
  }

  let prepared = null
  let model = resolved.model || 'planner'
  if (plannerNeedsLms(provider)) {
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
      const plan = draftMoviePlanFromPrompt(prompt, { reason: 'local writer offline', videoMode: mode })
      logInfo('director.plan', {
        kind: 'movie',
        projectId: plan.projectId,
        dryRun: false,
        model: 'draft',
        provider,
      })
      return { plan, dryRun: false, model: 'draft', provider, rawModelText: null }
    }
    model =
      dcfg.apiModel ||
      dcfg.planModelKey ||
      dcfg.model ||
      health.loadedHint ||
      health.models?.[0] ||
      'local-model'
  }

  const system = buildMoviePlanSystemPrompt({
    system: dcfg.plannerSystem,
    style: dcfg.plannerStyle,
    videoMode: mode,
  })
  const user = buildPlanUserMessage(prompt, { videoMode: mode })
  let rawText = ''
  try {
    rawText = await plannerChat({
      baseUrl: resolved.url,
      apiKey: resolved.apiKey,
      model,
      system,
      user,
      temperature: dcfg.temperature ?? 0.2,
      maxTokens: dcfg.maxTokens || 8192,
      timeoutMs: dcfg.timeoutMs || 180_000,
      tryDisableThinking: plannerNeedsLms(provider),
    })

    let parsed
    try {
      parsed = parsePlanJson(rawText)
    } catch (e) {
      fail(502, 'bad_model_json', `Model returned non-JSON plan: ${e instanceof Error ? e.message : e}`, {
        hint: 'Use dry-run, import a plan JSON, or generate again.',
        raw: rawText.slice(0, 3000),
      })
    }

    const plan = validateMoviePlan(parsed, { userPrompt: prompt, videoMode: mode })
    logInfo('director.plan', { kind: 'movie', projectId: plan.projectId, dryRun: false, model, provider })
    return { plan, dryRun: false, model, provider, rawModelText: rawText.slice(0, 50_000) }
  } catch (e) {
    if (e?.name === 'AbortError') {
      fail(504, 'planner_timeout', 'Planner request timed out', {
        hint: 'Raise planner.timeout_ms in qorlith.yaml, or shorten the prompt.',
      })
    }
    if (e instanceof Error && /^(LMS|PLANNER) \d+/.test(e.message)) {
      fail(502, 'planner_chat', `Planner chat failed: ${e.message}`, {
        hint: 'Check planner.provider / model / api_key, or POST a plan JSON instead.',
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

/** Bring an archived project back to the rail. Media paths go back to Gallery. */
export function unarchivePlanProject(projectId) {
  const id = slugifyProjectId(projectId)
  const rec = loadProjectRecord(id)
  if (!rec?.plan && !rec?.projectId) {
    fail(404, 'plan_not_found', 'plan not found', {
      hint: 'Open Archive and pick a project that is still on disk.',
    })
  }
  const collected = collectProjectMediaPaths(id, { lookTrack: rec?.plan?.lookTrack })
  const now = new Date().toISOString()
  rec.archived = false
  rec.archivedAt = null
  if (rec.status === 'archived' || !rec.status) {
    rec.status = rec.approved ? 'approved' : 'draft'
  }
  rec.updatedAt = now
  rec.archive = {
    ...(rec.archive || {}),
    restoredAt: now,
  }
  saveProjectRecord(rec)
  try {
    const logPath = rec.paths?.logPath || planPaths(id).logPath
    fs.appendFileSync(logPath, `[${now}] restored from Archive\n`, 'utf8')
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
    message: `Restored ${rec.plan?.title || id} to the project rail.`,
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
  const t2v = normalizeVideoMode(plan.videoMode) === 't2v'
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
      soundscape: c.soundscape,
      musicNote: c.musicNote,
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
    phase: startProduction ? (t2v ? 'approved_pending_video' : 'approved_pending_stills') : 'approved',
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

  if (!t2v) {
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
  }

  return {
    projectId: id,
    paths,
    producePipelineId: id,
    status,
    message: 'Plan locked. Press Make movie when you are ready.',
  }
}
