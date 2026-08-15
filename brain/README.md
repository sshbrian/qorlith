# Qorlith Brain

LangGraph control room. It does not render pixels and it does not replace the Monitor.

```
you → Make (Brain) → Monitor API → Comfy
```

Process:

`health → plan → stills → face_qa (you pick) → video → done`

- Plan and jobs go through Monitor. Brain never `POST`s Comfy `/prompt`.
- Stills finish before video starts.
- Video waits until the board has picks or you pass `--review-ok`.
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
