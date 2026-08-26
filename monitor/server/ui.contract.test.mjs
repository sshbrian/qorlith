/**
 * UI contract: studio shell only. Forbids leftover tool routes and flavor.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const src = path.join(ROOT, 'src')

function read(p) {
  return fs.readFileSync(p, 'utf8')
}

function page(name) {
  return read(path.join(src, 'pages', name))
}

describe('UI contract — App routes & nav', () => {
  it('App only mounts studio, media, and train', () => {
    const t = read(path.join(src, 'App.tsx'))
    assert.match(t, /path="studio"/)
    assert.match(t, /path="studio\/:projectId"/)
    assert.match(t, /path="studio\/:projectId\/plan"/)
    assert.match(t, /path="studio\/:projectId\/make"/)
    assert.match(t, /path="studio\/:projectId\/board"/)
    assert.match(t, /path="studio\/:projectId\/watch"/)
    assert.match(t, /path="studio\/:projectId\/brain"/)
    assert.match(t, /path="studio\/:projectId\/run"/)
    assert.match(t, /StudioPlanner/)
    assert.match(t, /EpisodePlan/)
    assert.match(t, /Watch/)
    assert.match(t, /Brain/)
    assert.match(t, /path="archive"/)
    assert.match(t, /path="media"/)
    assert.match(t, /path="train"/)
    assert.doesNotMatch(t, /path="produce"/)
    assert.doesNotMatch(t, /path="gallery"/)
    assert.doesNotMatch(t, /path="planner"/)
    assert.doesNotMatch(t, /tab=history/)
  })

  it('Layout is a studio shell with project rail', () => {
    const t = read(path.join(src, 'components', 'Layout.tsx'))
    assert.match(t, /studio-rail/)
    assert.match(t, /New project/)
    assert.match(t, /All media/)
    assert.match(t, /Archive/)
    assert.match(t, /Plan/)
    assert.match(t, /Make/)
    assert.match(t, /Board/)
    assert.match(t, /Watch/)
    assert.match(t, /s\.id !== 'board'/)
    assert.match(t, /stage !== 'board'/)
    assert.match(t, /studioProjectCreate/)
    assert.match(t, /videoMode: newVideoMode/)
    assert.doesNotMatch(t, /<Director/)
    assert.match(t, /<Outlet/)
    assert.match(t, /StudioSessionProvider/)
    assert.doesNotMatch(t, /<StudioPlanner/)
    assert.doesNotMatch(t, /<EpisodePlan/)
    assert.doesNotMatch(t, /<Produce/)
    assert.doesNotMatch(t, /function parseArea/)
  })
})

describe('UI contract — stages, not tools', () => {
  it('Train has no Live/History tabs', () => {
    const t = page('Training.tsx')
    assert.doesNotMatch(t, /\?tab=/)
    assert.doesNotMatch(t, /setParams\(\{ tab/)
    assert.match(t, /FailNote/)
  })

  it('errors go through FailNote', () => {
    assert.match(read(path.join(src, 'components', 'FailNote.tsx')), /export function FailNote/)
    for (const f of [
      'StudioPlanner.tsx',
      'Gallery.tsx',
      'Training.tsx',
      'RunDetail.tsx',
      'Floor.tsx',
      'System.tsx',
      'Watch.tsx',
      'Brain.tsx',
      'Archive.tsx',
    ]) {
      assert.match(page(f), /FailNote/, f)
    }
  })

  it('Floor shows overlay friends, including T2V without Board', () => {
    const t = page('Floor.tsx')
    assert.match(t, /s\?\.friends/)
    assert.match(t, /f\.name/)
    assert.match(t, /f\.blurb/)
    assert.match(read(path.join(ROOT, 'server', 'brainStatus.mjs')), /videoMode === 't2v' \? \[\]/)
  })

  it('Make and Watch do not own poll timers', () => {
    assert.doesNotMatch(page('Brain.tsx'), /setInterval/)
    assert.doesNotMatch(page('Watch.tsx'), /setInterval/)
    assert.doesNotMatch(page('StudioHome.tsx'), /setInterval/)
    assert.match(read(path.join(src, 'components', 'StudioSession.tsx')), /StudioSessionProvider/)
  })

  it('studio pages do not mount a Director or Produce factory', () => {
    assert.equal(fs.existsSync(path.join(src, 'pages', 'Director.tsx')), false)
    assert.equal(fs.existsSync(path.join(src, 'pages', 'Produce.tsx')), false)
  })

  it('Board has no markdown engine', () => {
    const t = page('EpisodePlan.tsx')
    assert.doesNotMatch(t, /function parseBlocks/)
    assert.doesNotMatch(t, /function MarkdownView/)
    assert.match(t, /data\.markdown/)
    assert.match(t, /videoMode === 't2v'/)
    assert.match(t, /<Navigate/)
  })

  it('Gallery honors ?archived=only', () => {
    const t = page('Gallery.tsx')
    assert.match(t, /searchParams\.get\('archived'\)/)
    assert.match(t, /archived.*only/)
    assert.match(t, /mediaStudioPath/)
    assert.match(t, /mediaStudioCta/)
    assert.match(read(path.join(src, 'lib', 'studio.ts')), /Open Make/)
    assert.match(read(path.join(src, 'lib', 'studio.ts')), /Open Watch/)
    assert.doesNotMatch(t, /sendToBoard/)
    assert.doesNotMatch(t, /not a start still/)
    assert.match(t, /Nothing in the library yet/)
    assert.doesNotMatch(t, /No pictures yet/)
    assert.match(t, /New renders save a small notes file/)
  })

  it('Plan hides the unused still field in Straight to video', () => {
    const t = page('StudioPlanner.tsx')
    assert.match(t, /plan\.videoMode === 't2v'/)
    assert.match(t, /t2v \? null/)
    assert.match(t, /label="Still"/)
    assert.match(t, /Scene/)
    assert.match(t, /t2v \? 'Scene' : 'Clip'/)
    assert.doesNotMatch(t, /t2v \? 'Scene' : 'Motion'/)
    assert.match(t, /clipJoinNote/)
    assert.match(t, /Open Make to make the film/)
    assert.doesNotMatch(t, /paint the stills/)
    assert.doesNotMatch(t, /\{videoMode === 't2v' \? null/)
  })

  it('Home and Plan expose Straight to video', () => {
    assert.match(read(path.join(src, 'components', 'VideoModeToggle.tsx')), /Straight to video/)
    assert.match(page('StudioHome.tsx'), /VideoModeToggle/)
    assert.match(page('StudioPlanner.tsx'), /VideoModeToggle/)
    assert.match(read(path.join(src, 'lib', 'api.ts')), /videoMode/)
  })

  it('Make hides stills-first chrome in Straight to video', () => {
    const t = page('Brain.tsx')
    assert.match(t, /videoMode === 't2v'/)
    assert.match(t, /Straight to video, then the film/)
    assert.match(t, /The film is not made yet/)
    assert.match(t, /current\?\.videoMode === 't2v'/)
    assert.match(read(path.join(src, 'components', 'StudioSession.tsx')), /current\?\.videoMode === 't2v'/)
    assert.match(t, /t2v \? null/)
    assert.match(t, /more && !t2v/)
    assert.match(t, /Pictures only/)
    assert.match(t, /clipPoster/)
    assert.match(t, /preferBrainComfy/)
    assert.match(t, /currentClip === c\.id \? 'Now'/)
  })

  it('Home posters can use a video cover', () => {
    const card = read(path.join(src, 'components', 'PosterCard.tsx'))
    assert.match(card, /export function CoverThumb/)
    assert.match(card, /kind === 'video'/)
    assert.match(page('StudioHome.tsx'), /coverKind/)
    assert.match(page('Archive.tsx'), /CoverThumb/)
    assert.match(read(path.join(src, 'components', 'Layout.tsx')), /CoverThumb/)
    assert.match(read(path.join(src, 'components', 'Layout.tsx')), /preferBrainComfy/)
  })

  it('Home and Plan share the same prompt chips', () => {
    const studio = read(path.join(src, 'lib', 'studio.ts'))
    assert.match(studio, /PROMPT_STARTERS/)
    assert.match(studio, /VIDEO_MODE_HINT/)
    assert.match(studio, /makes the clip/)
    assert.doesNotMatch(studio, /animates it/)
    const readme = read(path.join(ROOT, '..', 'README.md'))
    assert.doesNotMatch(readme, /animates clips/)
    assert.match(readme, /makes clips/)
    const monitorReadme = read(path.join(ROOT, 'README.md'))
    assert.doesNotMatch(monitorReadme, /stills then motion/)
    assert.match(monitorReadme, /stills then clips/)
    assert.match(page('StudioHome.tsx'), /PROMPT_STARTERS/)
    assert.match(page('StudioPlanner.tsx'), /PROMPT_STARTERS/)
    assert.match(page('StudioHome.tsx'), /VIDEO_MODE_HINT/)
    assert.match(page('StudioPlanner.tsx'), /VIDEO_MODE_HINT/)
    assert.match(read(path.join(src, 'components', 'Layout.tsx')), /VIDEO_MODE_HINT/)
    assert.match(read(path.join(src, 'components', 'Layout.tsx')), /PROMPT_PLACEHOLDER/)
  })

  it('Plan uses ArchiveProjectDialog', () => {
    assert.match(
      read(path.join(src, 'components', 'ArchiveProjectDialog.tsx')),
      /export function ArchiveProjectDialog/,
    )
    assert.match(page('StudioPlanner.tsx'), /ArchiveProjectDialog/)
  })

  it('api client uses one fail reader', () => {
    const t = read(path.join(src, 'lib', 'api.ts'))
    assert.match(t, /function post/)
    assert.match(t, /function put/)
    assert.match(t, /readFail/)
    assert.match(t, /class ApiError/)
    assert.doesNotMatch(t, /producePipelines:/)
    assert.doesNotMatch(t, /studioPlans:/)
    assert.doesNotMatch(t, /directorRun:/)
    assert.doesNotMatch(t, /producePipeline:/)
  })
})

describe('UI contract — brain is shipped', () => {
  it('Brain is a LangGraph control room, not a sketch', () => {
    const t = read(path.join(ROOT, '..', 'brain', 'graph.py'))
    assert.match(t, /StateGraph/)
    assert.match(t, /face_qa/)
    assert.match(t, /Straight to video/)
    assert.doesNotMatch(t, /NotImplementedError/)
    assert.doesNotMatch(t, /sketch only/)
    assert.match(t, /route_start/)
    assert.match(t, /concat_videos/)
  })

  it('Watch is a theater, not a clip dump', () => {
    const t = page('Watch.tsx')
    assert.match(t, /theater-player/)
    assert.match(t, /Tap for sound/)
    assert.match(t, /Make movie/)
    assert.match(t, /The film is not made yet/)
    assert.match(t, /clipJoinNote/)
    assert.match(t, /clipBeat/)
    assert.match(t, /clipPoster/)
    assert.doesNotMatch(t, /stillBrief/)
    assert.match(t, /preferBrainComfy/)
    assert.match(t, /sceneClips/)
    assert.match(t, /Making now/)
    assert.match(t, /clips\.filter\(\(c\) => c\.id\)/)
    assert.doesNotMatch(t, /setInterval/)
  })

  it('Brain page can stop and show a master', () => {
    const t = page('Brain.tsx')
    assert.match(t, /Stills, then the clips/)
    assert.doesNotMatch(t, /Stills, motion/)
    const session = read(path.join(src, 'components', 'StudioSession.tsx'))
    assert.match(session, /brainStop/)
    assert.match(t, /Stop/)
    assert.match(t, /hasMaster/)
    assert.match(t, /brainMasterUrl/)
  })

  it('Make refuses a busy Comfy queue', () => {
    const director = read(path.join(ROOT, 'server', 'director.mjs'))
    const client = read(path.join(ROOT, 'server', 'comfyClient.mjs'))
    assert.match(client, /export async function assertComfyIdle/)
    assert.match(director, /assertComfyIdle/)
  })

  it('Monitor shows live Comfy progress in human language', () => {
    const progress = read(path.join(ROOT, 'server', 'comfyProgress.mjs'))
    const bar = read(path.join(src, 'components', 'ComfyProgress.tsx'))
    assert.match(progress, /COMFY_CLIENT_ID/)
    assert.match(progress, /Painting the still/)
    assert.match(progress, /Making the clip/)
    assert.match(progress, /Opening the first frame/)
    assert.match(progress, /Reading the first frame/)
    assert.doesNotMatch(progress, /Opening the start still/)
    assert.doesNotMatch(progress, /Animating the clip/)
    assert.match(bar, /export function ComfyProgress/)
    assert.match(page('Brain.tsx'), /ComfyProgress/)
    assert.match(read(path.join(src, 'components', 'Layout.tsx')), /ComfyProgress/)
  })

  it('Make shows a LangGraph with timed edges', () => {
    assert.match(page('Brain.tsx'), /BrainGraph/)
    const graph = read(path.join(src, 'components', 'BrainGraph.tsx'))
    assert.match(graph, /BrainGraph/)
    assert.match(graph, /formatSeconds/)
    assert.match(graph, /FlowTime/)
    assert.match(graph, /MachineStrip/)
    assert.match(graph, /GraphMark/)
    const spec = read(path.join(src, 'lib', 'brainGraph.ts'))
    assert.match(spec, /face_qa/)
    assert.match(spec, /kind: 'flow'/)
    assert.match(spec, /NODE_MARK/)
    assert.match(spec, /nodeThumbs/)
    assert.match(spec, /spliceTicks/)
    assert.match(spec, /nodeOps/)
    assert.match(spec, /Save the plan/)
    assert.match(spec, /continue trim \+ 40ms crossfade/)
    assert.doesNotMatch(spec, /concat -c copy/)
    assert.match(spec, /Prompt to MiniMax/)
    assert.match(spec, /id: 'video', label: 'Clips'/)
    assert.match(spec, /Writer writes the story/)
    assert.doesNotMatch(spec, /Local LLM/)
    assert.doesNotMatch(spec, /LM Studio/)
    assert.doesNotMatch(read(path.join(src, 'components', 'StoryboardModal.tsx')), /Local LLM/)
    assert.match(page('Brain.tsx'), /if \(!t2v\) setSheet\('stills'\)/)
    assert.match(page('Brain.tsx'), /if \(!t2v\) navigate/)
    assert.match(graph, /Open the MiniMax workflow/)
    assert.doesNotMatch(graph, /Open video workflows in Comfy/)
    assert.match(graph, /Straight to video — no stills/)
    assert.match(read(path.join(src, 'components', 'WorkflowModal.tsx')), /MiniMax · clips/)
    assert.match(graph, /thumb\.kind === 'video'/)
    assert.match(graph, /<video src=\{api\.mediaUrl\(thumb\.src\)\}/)
    assert.match(spec, /t2v && nodeId === 'stills'/)
  })
})

describe('public repo has no previous-project leftovers', () => {
  const REPO = path.resolve(ROOT, '..')
  const SKIP = new Set(['node_modules', 'dist', '.git', '__pycache__', 'data'])
  const EXT = new Set(['.mjs', '.js', '.ts', '.tsx', '.json', '.md', '.yaml', '.yml', '.html', '.sh'])
  const FORBIDDEN = [
    ['mika', 'mon'],
    ['gits', 'styl'],
    ['paper', 'cut'],
    ['gits', '_reverb'],
    ['gits', 'Strength'],
    ['Moto', 'ko'],
    ['Section', ' 9'],
    ['C:\\\\', 'sd\\\\'],
    ['abliter', 'ated'],
    ['here', 'tic'],
    ['NM', 'KD'],
    ['OpenPose', 'XL2'],
    ['disable', 'Bounce'],
    ['svi', 'Template'],
    ['HOW_TO_CREATE', '_A_MOVIE_PLAN'],
    ['local', '_agents'],
    ['wan', '2'],
    ["PLAN_ID = ", "''"],
    ['2gir', 'ls'],
    ['outside S', '9'],
  ].map(([a, b]) => new RegExp(a + b, 'i'))

  function walk(dir, acc = []) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return acc
    }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, acc)
      else if (EXT.has(path.extname(e.name))) acc.push(full)
    }
    return acc
  }

  it('source and docs do not name previous packs, models, or Windows fallbacks', () => {
    const files = [
      ...walk(path.join(REPO, 'bin')),
      ...walk(path.join(REPO, 'brain')),
      ...walk(path.join(REPO, 'docs')),
      ...walk(path.join(ROOT, 'server')),
      ...walk(path.join(ROOT, 'src')),
      path.join(REPO, 'README.md'),
      path.join(REPO, 'qorlith.yaml'),
      path.join(ROOT, 'README.md'),
      path.join(ROOT, 'package.json'),
    ].filter((f) => fs.existsSync(f) && !/\.test\.mjs$/.test(f))
    const hits = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      for (const re of FORBIDDEN) {
        if (re.test(text)) hits.push(`${path.relative(REPO, file)} ~ ${re}`)
      }
    }
    assert.deepEqual(hits, [])
  })
})
