import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeStudioProjects, suggestedStage } from './project.mjs'

describe('studioProjects merge', () => {
  it('unifies plan, board, and produce by id', () => {
    const list = mergeStudioProjects({
      plans: [
        {
          projectId: 'demo_film',
          title: 'Demo Film',
          status: 'draft',
          clipCount: 3,
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      boards: [{ id: 'demo_film', title: 'Demo Film', sceneCount: 3 }],
      produce: [{ id: 'demo_film', name: 'Demo Film', okCount: 1, clipTotal: 3, active: false }],
    })
    assert.equal(list.length, 1)
    assert.equal(list[0].id, 'demo_film')
    assert.equal(list[0].hasPlan, true)
    assert.equal(list[0].hasBoard, true)
    assert.equal(list[0].hasProduce, true)
    assert.equal(list[0].clipCount, 3)
    assert.equal(list[0].okCount, 1)
  })

  it('includes a board-only project', () => {
    const list = mergeStudioProjects({
      plans: [],
      boards: [{ id: 'board_only', title: 'Board', sceneCount: 2 }],
      produce: [],
    })
    assert.equal(list[0].id, 'board_only')
    assert.equal(list[0].hasBoard, true)
    assert.equal(list[0].hasPlan, false)
    assert.equal(suggestedStage(list[0]), 'board')
  })

  it('skips archived plans', () => {
    const list = mergeStudioProjects({
      plans: [{ projectId: 'gone', title: 'Gone', archived: true, clipCount: 1 }],
      boards: [],
      produce: [],
    })
    assert.equal(list.length, 0)
  })

  it('suggests make when a plan already has clips', () => {
    assert.equal(
      suggestedStage({ hasProduce: true, hasBoard: true, sceneCount: 4, hasPlan: true, clipCount: 4 }),
      'make',
    )
  })

  it('marks a running brain as live', () => {
    const list = mergeStudioProjects({
      plans: [{ projectId: 'harbor', title: 'Harbor', clipCount: 3, updatedAt: '2026-08-01T00:00:00.000Z' }],
      boards: [{ id: 'harbor', title: 'Harbor', sceneCount: 3 }],
      brains: [
        {
          projectId: 'harbor',
          title: 'Harbor',
          running: true,
          status: 'stills',
          clips: [{ id: 'S01', video: null }],
          updatedAt: '2026-08-02T00:00:00.000Z',
        },
      ],
    })
    assert.equal(list[0].active, true)
    assert.equal(list[0].updatedAt, '2026-08-02T00:00:00.000Z')
  })
})
