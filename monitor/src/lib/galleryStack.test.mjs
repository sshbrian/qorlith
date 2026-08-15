import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSmartStacks, familyStem } from './galleryStack.ts'

describe('gallery smart stack', () => {
  it('families comfy numbered outputs', () => {
    assert.equal(familyStem('style_v1_test_00001_.png'), 'style_v1_test')
    assert.equal(familyStem('style_v1_test_00002_.png'), 'style_v1_test')
    assert.equal(familyStem('ComfyUI_00002_.png'), 'ComfyUI')
  })

  it('stacks same family in same folder', () => {
    const imgs = [
      { id: '1', name: 'shot_00001_.png', rel: 'qorlith/anime/shot_00001_.png', root: 'R', mtime: 2, stackHints: null },
      { id: '2', name: 'shot_00002_.png', rel: 'qorlith/anime/shot_00002_.png', root: 'R', mtime: 3, stackHints: null },
      { id: '3', name: 'other_00001_.png', rel: 'qorlith/anime/other_00001_.png', root: 'R', mtime: 1, stackHints: null },
    ]
    const stacks = buildSmartStacks(imgs)
    assert.equal(stacks.length, 2)
    const pair = stacks.find((s) => s.count === 2)
    assert.ok(pair)
    assert.equal(pair.cover.id, '2')
  })

  it('prefers meta batchId over filename', () => {
    const imgs = [
      { id: 'a', name: 'a_00001_.png', rel: 'a_00001_.png', root: 'R', mtime: 1, stackHints: { batchId: 'B1' } },
      { id: 'b', name: 'totally_different.png', rel: 'totally_different.png', root: 'R', mtime: 2, stackHints: { batchId: 'B1' } },
    ]
    const stacks = buildSmartStacks(imgs)
    assert.equal(stacks.length, 1)
    assert.equal(stacks[0].count, 2)
  })

  it('super-stacks still + video by clipId+project', () => {
    const imgs = [
      {
        id: '1',
        name: 'C07_PICK.png',
        rel: 'qorlith/anime/demo_pack/stills/C07/C07_PICK.png',
        root: 'R',
        mtime: 1,
        clipId: 'C07',
        project: 'demo_pack',
        stackHints: null,
      },
      {
        id: '2',
        name: 'C07_p1_00001_.mp4',
        rel: 'qorlith/anime/video/demo_pack/C07_p1_00001_.mp4',
        root: 'R',
        mtime: 3,
        clipId: 'C07',
        project: 'demo_pack',
        stackHints: null,
      },
    ]
    const stacks = buildSmartStacks(imgs)
    assert.equal(stacks.length, 1)
    assert.equal(stacks[0].count, 2)
    const c07 = stacks[0]
    assert.equal(c07.reason, 'clip id')
  })

  it('labels stack reason for batch id', () => {
    const stacks = buildSmartStacks([
      { id: 'a', name: 'a.png', rel: 'a.png', root: 'R', mtime: 1, stackHints: { batchId: 'B9' } },
      { id: 'b', name: 'b.png', rel: 'b.png', root: 'R', mtime: 2, stackHints: { batchId: 'B9' } },
    ])
    assert.equal(stacks.length, 1)
    assert.equal(stacks[0].reason, 'batch id')
  })
})
