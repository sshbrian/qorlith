# Qorlith Brain

LangGraph control room. It does not render pixels and it does not replace the Monitor.

```
you → Make (Brain) → Monitor API → Comfy
```

Process:

Stills-first: `health → plan → stills → face_qa (you pick) → video → free → finish`

Straight to video: `health → plan → video → free → finish`

- Plan and jobs go through Monitor. Brain never `POST`s Comfy `/prompt`.
- Stills-first finishes stills before clips. Straight to video skips stills and the board.
- Stills-first video waits until the board has picks or you pass `--review-ok`.
- Resume is clip-level on disk (`plan.json` + Comfy stills/video files), not LangGraph mid-node. A crash after S07 wrote an mp4 will skip S07 on the next resume.
- Continue joins (`cut=false`) weld like H3 Multishot: drop the duplicate first frame and 40 ms audio crossfade. Hard cuts stay a concat.
- URLs come from `qorlith.yaml`. Model names stay in that file.

## Install

```bash
cd /path/to/qorlith
python3 -m venv brain/.venv
brain/.venv/bin/pip install -e brain
```

## Use

Monitor and Comfy must be up.

```bash
# Write a plan only — no GPU
./bin/brain start --title "Harbor" --prompt "30s anime night street, 4 clips" --stop-after plan

# Plan + stills, then stop for the board
./bin/brain start --project harbor --prompt "…" --stop-after stills

# After you set picks in the UI
./bin/brain resume --thread harbor --review-ok

./bin/brain status --thread harbor
```

`--dry-run` asks Monitor for a demo plan (no LLM). Watch the graph in Monitor **Make** (`/studio/<id>/make`). Start stills, **Stop** a run (kills the pid), or **Continue** from the current node — resume does not re-walk health → plan. After video, finish concats the clips into `data/projects/<id>/master.mp4`. Make refuses to queue if Comfy is already busy.

```
./bin/brain stop --thread harbor
```

Checkpoints live in `brain/checkpointer.sqlite` (gitignored).

## Tests

```bash
PYTHONPATH=. brain/.venv/bin/pytest -q brain/tests
```
