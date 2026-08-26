# Qorlith docs

| File | What it is |
|------|------------|
| This page | Public notes |
| `../H3_KITCHEN.md` | MiniMax H3 Comfy Kitchen Attention |
| `../qorlith.yaml` | **The** configuration file — models, LoRAs, prompts, ports, planner provider |
| `../README.md` | Product overview |
| `../brain/README.md` | LangGraph control room |

How to add an episode board: put `monitor/data/projects/<id>/manifest.json` plus `plan.md` and a `board/` folder of stills (legacy `episode-plans/` are copied on first load). Nothing is hardcoded.

Brain (`../brain/`) is the stills-first orchestrator: health → plan → stills → board → video. Artists start it from Make. It talks to Monitor over HTTP.
