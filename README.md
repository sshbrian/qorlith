# Qorlith

Self-hosted stills-first studio for local image and video production.

Plan a multi-clip episode with a local LLM, pick stills on the board, then let Brain (LangGraph) paint stills and animate clips through ComfyUI. Stills are SDXL. Video is MiniMax H3. Style lives in the start still and in **`qorlith.yaml`** — the app does not invent model names or prompt recipes.

```
you
 └─ Qorlith Monitor     studio UI (monitor/)
     ├─ Plan            write the story
     ├─ Make            Brain / LangGraph
     ├─ Board           pick stills
     └─ Watch           the film
 └─ ComfyUI             renderer (your install)
 └─ Brain               LangGraph (brain/)
```

Brain talks to the Monitor API only. It never posts a raw Comfy graph. There is one artist path: Plan → Make → Board → Watch.

## Configure

Copy and edit **`qorlith.yaml`**. That file is the only place that should name:

- Comfy URL / root / output
- Monitor ports
- Planner URL, exact model key, prefer hints, temperature, tokens, system/style notes
- SDXL checkpoint, LoRAs, ControlNet, upscale
- Still prefix / suffix / negative
- MiniMax H3 workflow path, duration, megapixels
- Video motion prefix / negative / default music

A filled local override can live in `qorlith.local.yaml` (gitignored).

## Boot

1. Start ComfyUI on the URL in `qorlith.yaml`.
2. Start LM Studio (or any OpenAI-compatible planner) on `planner.url`.
3. Install and run the monitor:

```bash
cd monitor && npm ci
../bin/start-monitor
```

| Service | Default |
|---------|---------|
| ComfyUI | `http://127.0.0.1:8188` |
| Monitor API | `http://127.0.0.1:3921` |
| Monitor UI | `http://127.0.0.1:5173` |
| Planner | `http://127.0.0.1:1234/v1` |

Ports come from `qorlith.yaml` (`monitor.*`).

## Doctrine

1. Local only (`127.0.0.1`).
2. Sidecar every still and clip (`qorlith.gen.v1`).
3. Stills-first: all stills → board review → video.
4. Unload the planner before Comfy takes the GPU.
5. LangGraph (Make) is the only production path.

## Brain

Stills-first control room. Plan and stills, pause for the board, then video.

```bash
./bin/brain start --prompt "30s anime night street" --stop-after stills
./bin/brain resume --thread <project_id> --review-ok
```

See `brain/README.md`.

## Tests

```bash
cd monitor && npm test
PYTHONPATH=. brain/.venv/bin/pytest -q brain/tests
```

## License

MIT. See `LICENSE`.
