# Qorlith docs

| File | What it is |
|------|------------|
| This page | Public notes |
| `../qorlith.yaml` | **The** configuration file — models, LoRAs, prompts, ports |
| `../README.md` | Product overview |
| `../brain/README.md` | LangGraph control room |

How to add an episode board: put `monitor/data/projects/<id>/manifest.json` plus `plan.md` and a `board/` folder of stills (legacy `episode-plans/` are copied on first load). Nothing is hardcoded.

Brain (`../brain/`) is the stills-first orchestrator: health → plan → stills → board → video. Artists start it from Make. It talks to Monitor over HTTP.
