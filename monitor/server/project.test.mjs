import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-proj-'))
const projects = path.join(tmp, 'projects')
const legacyPlans = path.join(tmp, 'studio_plans')
const legacyBoards = path.join(tmp, 'episode-plans')
fs.mkdirSync(projects, { recursive: true })
fs.mkdirSync(legacyPlans, { recursive: true })
fs.mkdirSync(path.join(legacyBoards, 'old_board'), { recursive: true })

process.env.QORLITH_PROJECTS = projects
process.env.QORLITH_EPISODE_DATA = projects
process.env.QORLITH_LEGACY_PLANS = legacyPlans
process.env.QORLITH_LEGACY_BOARDS = legacyBoards
process.env.QORLITH_MIGRATE = '1'

const {
  coverKindFromPath,
  createStudioProject,
  findProjectCover,
  loadProjectRecord,
  migrateProject,
  planRecordPath,
  projectDir,
  saveProjectRecord,
  suggestedStage,
  syncBoardFromPlan,
} = await import('./project.mjs')
const { approvePlan } = await import('./studioPlanner.mjs')
const { listEpisodePlans } = await import('./episodePlan.mjs')

describe('project folder', () => {
  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('create writes plan.json and a board manifest in one folder', () => {
    const { project, record } = createStudioProject({ title: 'Night Chase', prompt: 'two adults, alley' })
    assert.equal(project.id, 'night_chase')
    assert.ok(fs.existsSync(planRecordPath(project.id)))
    assert.ok(fs.existsSync(path.join(projectDir(project.id), 'manifest.json')))
    assert.ok(fs.existsSync(path.join(projectDir(project.id), 'plan.md')))
    const loaded = loadProjectRecord(project.id)
    assert.equal(loaded.userPrompt, 'two adults, alley')
    assert.equal(loaded.plan.title, 'Night Chase')
    assert.equal(loaded.plan.videoMode, 'stills')
    assert.equal(project.videoMode, 'stills')
    assert.equal(project.hasBoard, true)
    assert.equal(record.projectId, 'night_chase')
  })

  it('T2V create keeps videoMode and skips the empty board', () => {
    const { project, record } = createStudioProject({
      title: 'Straight Cut',
      prompt: 'rooftop, rain, no talking',
      videoMode: 't2v',
    })
    assert.equal(project.videoMode, 't2v')
    assert.equal(project.hasBoard, false)
    assert.equal(project.stage, 'plan')
    assert.equal(record.plan.videoMode, 't2v')
    const loaded = loadProjectRecord(project.id)
    assert.equal(loaded.plan.videoMode, 't2v')
    assert.equal(fs.existsSync(path.join(projectDir(project.id), 'manifest.json')), false)
    assert.equal(suggestedStage(project), 'plan')
  })

  it('T2V plan sync does not seed clip scenes on the board', () => {
    const { project } = createStudioProject({ title: 'No Board Sync', videoMode: 't2v' })
    const rec = loadProjectRecord(project.id)
    rec.plan = {
      ...rec.plan,
      videoMode: 't2v',
      clips: [
        { id: 'S01', title: 'Open', durationSec: 12 },
        { id: 'S02', title: 'Press', durationSec: 12 },
      ],
    }
    saveProjectRecord(rec)
    assert.equal(syncBoardFromPlan(rec.plan), null)
    assert.equal(fs.existsSync(path.join(projectDir(project.id), 'manifest.json')), false)
  })

  it('approve seeds a board from plan clips', () => {
    process.env.QORLITH_DATA = path.join(tmp, 'data')
    process.env.COMFY_OUTPUT = path.join(tmp, 'comfy')
    const { project } = createStudioProject({ title: 'Board Seed' })
    const rec = loadProjectRecord(project.id)
    rec.plan = {
      ...rec.plan,
      clips: [
        { id: 'C01', title: 'Open', durationSec: 6 },
        { id: 'C02', title: 'Close', durationSec: 6 },
      ],
    }
    saveProjectRecord(rec)
    approvePlan(project.id, { startProduction: true })
    const boards = listEpisodePlans()
    const board = boards.find((b) => b.id === project.id)
    assert.ok(board, 'approve should create a board')
    assert.equal(board.sceneCount, 2)
    const man = JSON.parse(fs.readFileSync(path.join(projectDir(project.id), 'manifest.json'), 'utf8'))
    assert.equal(man.scenes.length, 2)
    assert.equal(man.scenes[0].id, 'C01')
  })

  it('T2V approve does not seed clip scenes on the board', () => {
    const { project } = createStudioProject({ title: 'T2V Board Skip' })
    const rec = loadProjectRecord(project.id)
    rec.plan = {
      ...rec.plan,
      videoMode: 't2v',
      clips: [
        { id: 'S01', title: 'Open', durationSec: 12 },
        { id: 'S02', title: 'Press', durationSec: 12 },
      ],
    }
    saveProjectRecord(rec)
    const result = approvePlan(project.id, { startProduction: true })
    assert.equal(result.status.phase, 'approved_pending_video')
    const board = listEpisodePlans().find((b) => b.id === project.id)
    assert.ok(!board || board.sceneCount === 0)
  })

  it('does not reuse an existing project id', () => {
    const a = createStudioProject({ title: 'Twin Alley' })
    const b = createStudioProject({ title: 'Twin Alley' })
    assert.equal(a.project.id, 'twin_alley')
    assert.equal(b.project.id, 'twin_alley_2')
  })

  it('cover prefers a board still, then master.mp4', () => {
    const { project } = createStudioProject({ title: 'Cover Film' })
    const dir = projectDir(project.id)
    assert.equal(findProjectCover(project.id), null)
    const master = path.join(dir, 'master.mp4')
    fs.writeFileSync(master, Buffer.alloc(3000))
    assert.equal(findProjectCover(project.id), master)
    assert.equal(coverKindFromPath(master), 'video')
    const board = path.join(dir, 'board', 'S01')
    fs.mkdirSync(board, { recursive: true })
    const still = path.join(board, 'S01.png')
    fs.writeFileSync(still, Buffer.alloc(3000))
    assert.equal(findProjectCover(project.id), still)
    assert.equal(coverKindFromPath(still), 'image')
  })

  it('migrates a legacy studio_plans json into the project folder', () => {
    fs.writeFileSync(
      path.join(legacyPlans, 'old_film.json'),
      JSON.stringify({
        projectId: 'old_film',
        status: 'draft',
        plan: { projectId: 'old_film', title: 'Old Film', clips: [{ id: 'S01' }] },
      }),
      'utf8',
    )
    fs.writeFileSync(
      path.join(legacyBoards, 'old_board', 'manifest.json'),
      JSON.stringify({ id: 'old_board', title: 'Old Board', scenes: [{ id: 'S01', title: 'Open' }] }),
      'utf8',
    )
    migrateProject('old_film')
    assert.ok(fs.existsSync(planRecordPath('old_film')))
    const rec = loadProjectRecord('old_film')
    assert.equal(rec.plan.title, 'Old Film')
    migrateProject('old_board')
    assert.ok(fs.existsSync(path.join(projectDir('old_board'), 'manifest.json')))
  })
})
