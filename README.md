# Qorlith

Self-hosted stills-first studio for local image and video production.

Plan a multi-clip episode with **any writer** (local LM Studio, Grok / xAI, OpenAI-compatible, or a Grok bot that POSTs plan JSON). Then Brain paints stills and animates clips through ComfyUI. Stills are SDXL. Video is MiniMax H3 with **Comfy Kitchen Attention**. Style lives in the start still and in **`qorlith.yaml`**.

```
you / Grok / remote LLM
 └─ Qorlith Monitor     studio UI (monitor/)
     ├─ Plan            write or import the story
     ├─ Make            Brain / LangGraph  (Make movie = one click)
     ├─ Board           pick stills (skipped on one-click)
     └─ Watch           the film
 └─ ComfyUI             renderer (your install)
 └─ Brain               LangGraph (brain/)
```

Brain talks to the Monitor API only. It never posts a raw Comfy graph.

**One click:** Plan → **Make movie**. Default is stills-first (paint a still, then MiniMax H3 I2VA). **Straight to video** skips the still and runs MiniMax H3 T2VA from the prompt.

## Configure

Copy and edit **`qorlith.yaml`**. That file is the only place that should name:

- Comfy URL / root / output
- Monitor ports
- Planner **provider** (`local` | `openai` | `xai` | `none`), URL, model, API key, temperature, tokens, system/style notes
- SDXL checkpoint, LoRAs, ControlNet, upscale
- Still prefix / suffix / negative
- MiniMax H3 workflow path, duration, megapixels
- Video motion prefix / negative / default music

A filled local override can live in `qorlith.local.yaml` (gitignored).

## Boot

1. Start ComfyUI on the URL in `qorlith.yaml`.
2. Pick a planner in `qorlith.yaml`:
   - `provider: local` — LM Studio on `planner.url` (optional `auto_manage`)
   - `provider: xai` — Grok via `https://api.x.ai/v1` (`XAI_API_KEY` or `planner.api_key`)
   - `provider: openai` — any OpenAI-compatible URL
   - `provider: none` — no LLM; POST a plan JSON (Grok bot / another agent)
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
| Planner | `planner.url` (local `:1234` or `https://api.x.ai/v1`) |

Ports come from `qorlith.yaml` (`monitor.*`).

## Doctrine

1. Render is local (`127.0.0.1` Comfy). The **writer** can be local, remote, or imported JSON.
2. Sidecar every still and clip (`qorlith.gen.v1`).
3. Stills-first: all stills → (optional board review) → video. **Make movie** auto-picks.
4. Unload a **local** planner before Comfy takes the GPU. Remote planners skip LM Studio.
5. LangGraph (Make) is the only production path.
6. MiniMax H3 uses **Comfy Kitchen Attention** — see `H3_KITCHEN.md`. Do not add Sage on H3.

## Brain

Stills-first control room. Plan and stills, pause for the board, then video.

```bash
./bin/brain start --prompt "30s anime night street" --stop-after stills
./bin/brain start --project <id> --stop-after film --auto-pick
./bin/brain resume --thread <project_id> --review-ok

Grok / another agent: `GET /api/studio/planner` for the schema, then `POST /api/studio/plan` with `{ prompt, plan }` or `POST /api/studio/film` for one-click.
```

See `brain/README.md`.

## Tests

```bash
cd monitor && npm test
PYTHONPATH=. brain/.venv/bin/pytest -q brain/tests
```

## License

MIT. See `LICENSE`.
