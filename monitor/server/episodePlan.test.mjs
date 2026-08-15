import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qorlith-ep-'))
const planDir = path.join(tmp, 'demo')
const board = path.join(planDir, 'board', 'E01')
fs.mkdirSync(board, { recursive: true })
fs.writeFileSync(path.join(planDir, 'plan.md'), '# Demo\n\n### E01 — Open\n')
fs.writeFileSync(
  path.join(planDir, 'manifest.json'),
  JSON.stringify({
    id: 'demo',
    title: 'Demo episode',
    markdownPath: 'plan.md',
    boardDir: path.join(planDir, 'board'),
    scenes: [{ id: 'E01', title: 'Open', heading: '### E01 — Open' }],
  }),
)
fs.writeFileSync(path.join(board, 'E01_v01.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
process.env.QORLITH_EPISODE_DATA = tmp

const {
  addComment,
  deleteComment,
  getRegistry,
  isPickCopyName,
  listEpisodePlans,
  loadComments,
  loadEpisodePlan,
  resolveBoardFile,
  setPick,
  stillSortKey,
} = await import('./episodePlan.mjs')

describe('episodePlan', () => {
  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('lists registered plans from manifests', () => {
    const plans = listEpisodePlans()
    const p = plans.find((x) => x.id === 'demo')
    assert.ok(p)
    assert.equal(p.sceneCount, 1)
  })

  it('loads markdown from the plan file', () => {
    const d = loadEpisodePlan('demo')
    assert.match(d.markdown, /Demo/)
  })

  it('sorts versioned stills', () => {
    assert.ok(stillSortKey('E01_v02.png')[1] === 2)
    assert.equal(isPickCopyName('E01_PICK.png'), true)
  })

  it('rejects unknown ids', () => {
    assert.throws(() => getRegistry('nope'))
  })

  it('rejects path traversal on board files', () => {
    const reg = getRegistry('demo')
    assert.throws(() => resolveBoardFile(reg, '../secret.png'), (e) => e.code === 'invalid_rel')
    assert.throws(() => resolveBoardFile(reg, '..\\secret.png'), (e) => e.code === 'invalid_rel')
  })

  it('round-trips a comment and pick', () => {
    const before = loadComments('demo').length
    const rec = addComment('demo', { body: 'test note', anchor: 'E01' })
    assert.equal(loadComments('demo').length, before + 1)
    deleteComment('demo', rec.id)
    assert.equal(loadComments('demo').length, before)
    const e01 = loadEpisodePlan('demo').scenes.find((s) => s.id === 'E01')
    if (e01?.stills?.[0]) setPick('demo', 'E01', e01.stills[0].rel)
  })
})
