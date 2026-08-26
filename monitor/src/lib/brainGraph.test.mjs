import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  decorateGraph,
  formatSeconds,
  GRAPH_EDGES,
  GRAPH_LAYOUT,
  GRAPH_NODE_META,
  graphHeadline,
  liveOp,
  liveOpLine,
  liveSeconds,
  liveVia,
  markForVia,
  NODE_MARK,
  NODE_OPS,
  nodeOps,
  nodeThumbs,
  nodeProgress,
  nodeX,
  PIPELINE,
  resolveOps,
  resumeTarget,
  spliceTicks,
  timeLabelWidth,
  viaInk,
  viaLabel,
} from './brainGraph.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

function report(partial = {}) {
  return {
    status: 'idle',
    step: 'health',
    running: false,
    steps: [],
    ...partial,
  }
}

describe('brain graph — formatters', () => {
  it('formats missing, zero, short, long, and invalid values', () => {
    assert.equal(formatSeconds(null), '')
    assert.equal(formatSeconds(undefined), '')
    assert.equal(formatSeconds(Number.NaN), '')
    assert.equal(formatSeconds(Number.POSITIVE_INFINITY), '')
    assert.equal(formatSeconds(-3), '0.0s')
    assert.equal(formatSeconds(0), '0.0s')
    assert.equal(formatSeconds(2.4), '2.4s')
    assert.equal(formatSeconds(9.94), '9.9s')
    assert.equal(formatSeconds(12.2), '12s')
    assert.equal(formatSeconds(3600), '3600s')
  })

  it('sizes the time pill to the label', () => {
    assert.ok(timeLabelWidth('2.4s') >= 36)
    assert.ok(timeLabelWidth('3600s') > timeLabelWidth('12s'))
  })
})

describe('brain graph — liveSeconds', () => {
  const t0 = Date.parse('2026-08-14T12:00:00.000Z')

  it('ticks only while running and the step is still open', () => {
    const open = { startedAt: '2026-08-14T12:00:00.000Z', endedAt: null, seconds: 1 }
    assert.equal(liveSeconds(open, t0 + 3500, true), 3.5)
    assert.equal(liveSeconds(open, t0 + 3500, false), 1)
  })

  it('never ticks after endedAt, even if seconds is missing', () => {
    const closed = {
      startedAt: '2026-08-14T12:00:00.000Z',
      endedAt: '2026-08-14T12:00:08.000Z',
    }
    assert.equal(liveSeconds(closed, t0 + 60_000, true), 8)
  })

  it('returns null for empty or garbage rows', () => {
    assert.equal(liveSeconds(undefined, t0, true), null)
    assert.equal(liveSeconds({}, t0, false), null)
    assert.equal(liveSeconds({ startedAt: 'nope', seconds: 4 }, t0, false), 4)
    assert.equal(liveSeconds({ startedAt: 'nope' }, t0, true), null)
  })
})

describe('brain graph — decorateGraph', () => {
  it('marks the active flow edge live and freezes finished edges', () => {
    const view = decorateGraph(
      report({
        status: 'stills',
        step: 'stills',
        running: true,
        steps: [
          { id: 'health', label: 'Ready', state: 'done' },
          { id: 'plan', label: 'Story', state: 'done' },
          { id: 'stills', label: 'Pictures', state: 'active' },
        ],
        timings: {
          health: {
            startedAt: '2026-08-14T12:00:00.000Z',
            endedAt: '2026-08-14T12:00:02.000Z',
            seconds: 2,
          },
          stills: { startedAt: '2026-08-14T12:00:05.000Z', endedAt: null, seconds: 0 },
        },
      }),
      Date.parse('2026-08-14T12:00:09.000Z'),
    )
    const healthPlan = view.edges.find((e) => e.from === 'health' && e.to === 'plan')
    const stillsQa = view.edges.find((e) => e.from === 'stills' && e.to === 'face_qa')
    assert.equal(healthPlan.seconds, 2)
    assert.equal(healthPlan.live, false)
    assert.equal(stillsQa.live, true)
    assert.equal(stillsQa.seconds, 4)
    assert.equal(view.nodes.find((n) => n.id === 'stills')?.state, 'active')
    assert.equal(view.nodes.find((n) => n.id === 'start')?.state, 'done')
    assert.equal(view.nodes.find((n) => n.id === 'end')?.state, 'idle')
  })

  it('does not keep ticking after the process exits', () => {
    const view = decorateGraph(
      report({
        status: 'face_qa',
        step: 'face_qa',
        running: false,
        steps: [{ id: 'face_qa', label: 'Your picks', state: 'active' }],
        timings: {
          face_qa: { startedAt: '2026-08-14T12:00:00.000Z', endedAt: null, seconds: 9 },
        },
      }),
      Date.parse('2026-08-14T13:00:00.000Z'),
    )
    const edge = view.edges.find((e) => e.from === 'face_qa' && e.kind === 'flow')
    assert.equal(edge.live, false)
    assert.equal(edge.seconds, 9)
  })

  it('stamps the stop edge when the run fails or is stopped', () => {
    const failed = decorateGraph(
      report({
        status: 'fail',
        step: 'stills',
        running: false,
        steps: [{ id: 'stills', label: 'Pictures', state: 'fail' }],
        timings: {
          stills: {
            startedAt: '2026-08-14T12:00:00.000Z',
            endedAt: '2026-08-14T12:00:11.000Z',
            seconds: 11,
          },
        },
      }),
    )
    const stop = failed.edges.find((e) => e.from === 'stills' && e.kind === 'stop')
    assert.equal(stop.seconds, 11)

    const halted = decorateGraph(
      report({
        status: 'stopped',
        step: 'video',
        running: false,
        steps: [{ id: 'video', label: 'Motion', state: 'idle' }],
        timings: { video: { startedAt: 't', endedAt: 't2', seconds: 3.5 } },
      }),
    )
    assert.equal(halted.edges.find((e) => e.from === 'video' && e.kind === 'stop')?.seconds, 3.5)
    assert.equal(halted.nodes.find((n) => n.id === 'end')?.state, 'fail')
  })

  it('marks every node done when the film is finished', () => {
    const view = decorateGraph(
      report({
        status: 'done',
        step: 'finish',
        steps: [
          { id: 'health', label: 'Ready', state: 'done' },
          { id: 'plan', label: 'Story', state: 'done' },
          { id: 'stills', label: 'Pictures', state: 'done' },
          { id: 'face_qa', label: 'Your picks', state: 'done' },
          { id: 'video', label: 'Motion', state: 'done' },
          { id: 'free', label: 'Clear', state: 'done' },
          { id: 'finish', label: 'Film', state: 'done' },
        ],
      }),
    )
    assert.equal(view.nodes.find((n) => n.id === 'end')?.state, 'done')
    assert.ok(view.nodes.every((n) => n.state === 'done' || n.id === 'start'))
  })

  it('prefers server graph node states when present', () => {
    const view = decorateGraph(
      report({
        status: 'stills',
        step: 'stills',
        steps: [{ id: 'stills', label: 'Pictures', state: 'idle' }],
        graph: { nodes: [{ id: 'stills', label: 'Pictures', state: 'active' }], edges: [] },
      }),
    )
    assert.equal(view.nodes.find((n) => n.id === 'stills')?.state, 'active')
  })

  it('has a complete, loop-free topology', () => {
    assert.equal(GRAPH_NODE_META.length, 9)
    assert.equal(GRAPH_EDGES.filter((e) => e.kind === 'flow').length, 9)
    const ids = new Set(GRAPH_NODE_META.map((n) => n.id))
    for (const e of GRAPH_EDGES) {
      assert.ok(ids.has(e.from), e.from)
      assert.ok(ids.has(e.to), e.to)
    }
    assert.deepEqual([...PIPELINE], ['health', 'plan', 'stills', 'face_qa', 'video', 'free', 'finish'])
  })

  it('t2v graph skips pictures and packs left', () => {
    const view = decorateGraph(
      report({
        videoMode: 't2v',
        status: 'video',
        step: 'video',
        running: true,
        steps: [
          { id: 'health', label: 'Ready', state: 'done' },
          { id: 'plan', label: 'Story', state: 'done' },
          { id: 'video', label: 'Motion', state: 'active' },
        ],
      }),
    )
    assert.ok(!view.nodes.some((n) => n.id === 'stills' || n.id === 'face_qa'))
    assert.ok(view.edges.some((e) => e.from === 'plan' && e.to === 'video' && e.kind === 'flow'))
    assert.ok(!view.edges.some((e) => e.from === 'stills' || e.to === 'stills'))
    assert.ok(nodeX('video', 't2v') < nodeX('video'))
    assert.ok(nodeX('end', 't2v') < nodeX('end'))
    assert.equal(view.nodes.find((n) => n.id === 'video')?.blurb, 'Prompt to MiniMax')
  })
})

describe('brain graph — layout and resume', () => {
  it('lays nodes left to right without going negative', () => {
    assert.equal(nodeX('start'), GRAPH_LAYOUT.padX)
    assert.ok(nodeX('end') > nodeX('finish'))
    assert.equal(nodeX('nope'), nodeX('start'))
  })

  it('detects a resume jump when health never ran', () => {
    assert.equal(resumeTarget(null), null)
    assert.equal(resumeTarget({ health: { startedAt: 't' }, stills: { startedAt: 't' } }), null)
    assert.equal(resumeTarget({ stills: { startedAt: 't' } }), 'stills')
    assert.equal(resumeTarget({ video: { startedAt: 't' } }), 'video')
  })
})

describe('brain graph — headline and comfy overlay', () => {
  it('builds a human headline from label, clip, and percent', () => {
    assert.equal(graphHeadline({}), 'Graph')
    assert.equal(
      graphHeadline({
        label: 'Painting pictures',
        currentClip: 'S02',
        running: true,
        comfy: { percent: 41.2 },
        steps: [],
      }),
      'Painting pictures · S02 · 41%',
    )
  })

  it('attaches comfy progress only to the live stills or video node', () => {
    const comfy = { active: true, percent: 12, kind: 'still' }
    assert.ok(nodeProgress('stills', { step: 'stills', running: true, comfy }))
    assert.equal(nodeProgress('video', { step: 'stills', running: true, comfy }), null)
    assert.equal(nodeProgress('stills', { step: 'stills', running: false, comfy }), null)
    assert.equal(nodeProgress('stills', { step: 'stills', running: true, comfy: { active: false } }), null)
    assert.ok(nodeProgress('video', { step: 'video', running: true, comfy: { active: true, percent: 0 } }))
  })
})

describe('brain graph — step internals', () => {
  it('lights the live op from phase and marks the rest', () => {
    const ops = resolveOps(
      'stills',
      { step: 'stills', status: 'stills', phase: 'still_wait', running: true, clips: [] },
      'active',
    )
    assert.equal(ops.find((o) => o.id === 'comfy_idle')?.state, 'done')
    assert.equal(ops.find((o) => o.id === 'still_queue')?.state, 'done')
    assert.equal(ops.find((o) => o.id === 'still_wait')?.state, 'active')
    assert.equal(ops.find((o) => o.id === 'still_copy')?.state, 'idle')
    assert.equal(ops.find((o) => o.id === 'still_wait')?.via, 'comfy')
    assert.match(ops.find((o) => o.id === 'still_wait')?.call || '', /\/ws/)
  })

  it('skips the unused plan path', () => {
    const reuse = resolveOps('plan', { step: 'plan', phase: 'plan_reuse', running: true, clips: [{}] }, 'active')
    assert.equal(reuse.find((o) => o.id === 'plan_llm')?.state, 'skip')
    assert.equal(reuse.find((o) => o.id === 'plan_reuse')?.state, 'active')
    const llm = resolveOps('plan', { step: 'plan', phase: 'plan_llm', running: true, clips: [] }, 'active')
    assert.equal(llm.find((o) => o.id === 'plan_reuse')?.state, 'skip')
    assert.equal(llm.find((o) => o.id === 'plan_llm')?.via, 'llm')
  })

  it('marks every op done when the node is done', () => {
    const ops = resolveOps('health', { step: 'plan', status: 'stills', phase: 'comfy_stats' }, 'done')
    assert.ok(ops.every((o) => o.state === 'done'))
  })

  it('builds a live technical headline', () => {
    assert.equal(viaLabel('llm'), 'Writer')
    assert.match(
      liveOpLine({
        step: 'stills',
        phase: 'still_wait',
        currentClip: 'S02',
        running: true,
        comfy: { percent: 40 },
      }) || '',
      /Comfy.*still.*S02.*40%/,
    )
  })

  it('t2v ops drop board picks and still workflows', () => {
    const plan = nodeOps('plan', 't2v')
    const save = plan.find((o) => o.id === 'plan_save')
    assert.equal(save?.label, 'Save the plan')
    assert.equal(save?.call, 'plan.json')
    assert.equal(plan.find((o) => o.id === 'plan_llm')?.label, 'Writer writes the shot list')
    assert.doesNotMatch(JSON.stringify(plan), /board/)
    assert.doesNotMatch(JSON.stringify(plan), /Local LLM/)
    assert.doesNotMatch(JSON.stringify(plan), /LM Studio/)
    const video = nodeOps('video', 't2v')
    assert.equal(video.find((o) => o.id === 'video_wait')?.label, 'Comfy makes the clip')
    assert.equal(video.find((o) => o.id === 'video_queue')?.label, 'Queue MiniMax T2VA')
    assert.doesNotMatch(JSON.stringify(video), /animates/i)
    assert.equal(nodeOps('stills', 't2v').length, 0)
    assert.equal(nodeOps('face_qa', 't2v').length, 0)
    assert.ok(nodeOps('stills').length > 0)
    const live = liveOp({ step: 'video', phase: 'video_wait', running: true, videoMode: 't2v' })
    assert.equal(live?.label, 'Comfy makes the clip')
  })

  it('every graph node has at least one documented op', () => {
    for (const node of GRAPH_NODE_META) {
      assert.ok((NODE_OPS[node.id] || []).length > 0, node.id)
    }
  })

  it('every node has a mark and liveVia follows the active op', () => {
    for (const node of GRAPH_NODE_META) {
      assert.ok(NODE_MARK[node.id], node.id)
    }
    assert.equal(
      liveVia('stills', { step: 'stills', phase: 'still_wait', running: true, clips: [] }, 'active'),
      'comfy',
    )
    assert.equal(
      liveVia('plan', { step: 'plan', phase: 'plan_reuse', running: true, clips: [{}] }, 'active'),
      'disk',
    )
    assert.equal(
      liveVia('face_qa', { step: 'face_qa', status: 'face_qa', phase: 'wait_picks', running: false, clips: [] }, 'active'),
      'human',
    )
    assert.equal(markForVia('ffmpeg'), 'splice')
    assert.equal(markForVia('comfy', 'video'), 'sprocket')
    assert.equal(viaInk('llm'), '#bf5af2')
    assert.equal(liveOp({ step: 'stills', phase: 'still_wait', running: true })?.via, 'comfy')
  })

  it('thumbs and splice ticks follow clip media', () => {
    const clips = [
      { id: 'S01', still: '/a.png', video: '/a.mp4' },
      { id: 'S02', still: '/b.png' },
      { id: 'S03' },
    ]
    const stills = nodeThumbs('stills', { clips, currentClip: 'S02', step: 'stills' })
    assert.deepEqual(
      stills.map((t) => [t.id, t.live, t.kind]),
      [
        ['S01', false, 'still'],
        ['S02', true, 'still'],
      ],
    )
    const motion = nodeThumbs('video', { clips, currentClip: 'S01', step: 'video' })
    assert.equal(motion[0].kind, 'video')
    assert.equal(motion[0].src, '/a.mp4')
    assert.equal(nodeThumbs('plan', { clips }).length, 0)
    const t2v = nodeThumbs('video', {
      clips: [{ id: 'S01', video: '/only.mp4' }],
      currentClip: 'S01',
      step: 'video',
    })
    assert.equal(t2v.length, 1)
    assert.equal(t2v[0].src, '/only.mp4')
    assert.equal(t2v[0].kind, 'video')
    assert.equal(nodeThumbs('stills', { clips: [{ id: 'S01', video: '/only.mp4' }] }).length, 0)
    assert.equal(
      nodeThumbs('video', {
        videoMode: 't2v',
        clips: [{ id: 'S02', still: '/video/S02_from_prev.png' }],
      }).length,
      0,
    )
    assert.equal(
      nodeThumbs('stills', {
        videoMode: 't2v',
        clips: [{ id: 'S01', still: '/a.png', video: '/a.mp4' }],
      }).length,
      0,
    )
    const ticks = spliceTicks({ clips, currentClip: 'S02', step: 'video' })
    assert.deepEqual(
      ticks.map((t) => [t.id, t.ready, t.live]),
      [
        ['S01', true, false],
        ['S02', false, true],
        ['S03', false, false],
      ],
    )
  })
})

describe('brain graph — spec lockstep with Python', () => {
  it('matches GRAPH_EDGES and node ids in brain/graph.py', () => {
    const py = fs.readFileSync(path.resolve(here, '../../../brain/graph.py'), 'utf8')
    for (const node of GRAPH_NODE_META) {
      assert.match(py, new RegExp(`"${node.id}"`))
    }
    for (const edge of GRAPH_EDGES) {
      assert.match(py, new RegExp(`"${edge.from}", "${edge.to}", "${edge.kind}"`))
    }
    for (const ops of Object.values(NODE_OPS)) {
      for (const op of ops) {
        if (op.id === 'route' || op.id === 'halt') continue
        assert.match(py, new RegExp(`["']${op.id}["']`))
      }
    }
  })
})
