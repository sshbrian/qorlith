# Qorlith Monitor

Local studio for Qorlith: plan a film, make it with LangGraph, pick stills, watch the result. Training watch and a media library sit beside that path.

This package is the **monitor** — the same product as the rest of Qorlith, not a second brand.

## Stack

- React + TypeScript + Vite + Tailwind CSS v4
- Express API (`server/index.js`) on **127.0.0.1:3921**
- UI on **127.0.0.1:5173**

## Run

From the Qorlith repo root:

```bash
# or: ../bin/start-monitor
cd monitor
npm ci
export QORLITH_PORT=3921 QORLITH_WEB_PORT=5173
npm run dev
```

API only:

```bash
export QORLITH_PORT=3921
node server/index.js
```

Config: `qorlith.yaml` (`comfy.output`, `train.output_roots`). `data/config.json` is only a leftover overlay for tests / extra watch roots.

## Routes

| Route | Purpose |
|-------|---------|
| `/studio` | Empty studio / last project |
| `/studio/:id/plan` | Write / approve the story |
| `/studio/:id/make` | Brain — stills then motion |
| `/studio/:id/board` | Pick stills |
| `/studio/:id/watch` | Play the film |
| `/media` | All Comfy media |
| `/train` | Kohya / train status |
| `/settings` | Watch paths (also the gear overlay) |

## Product

**Qorlith** — self-hosted stills-first studio. Monitor is this UI.
