#!/usr/bin/env bash
# Load Muse then Qwen, run studio + adult planner evals.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LMS="${HOME}/.lmstudio/bin/lms"
CTX="${PLANNER_EVAL_CTX:-16384}"
cd "$ROOT"

load() {
  local key="$1"
  echo "=== load $key ctx=$CTX ==="
  "$LMS" unload --all || true
  curl -sS -m 10 -X POST http://127.0.0.1:8188/free -H 'Content-Type: application/json' \
    -d '{"unload_models":true,"free_memory":true}' >/dev/null || true
  sleep 2
  "$LMS" load "$key" --gpu max --context-length "$CTX" --identifier qorlith-planner -y
  "$LMS" ps
}

run_pair() {
  local key="$1"
  local tag="$2"
  node scripts/planner-eval.mjs --model "$key" --tag "${tag}-studio"
  node scripts/planner-eval.mjs --model "$key" --tag "${tag}-adult" \
    --cases scripts/planner-eval-adult-cases.json
}

load muse-glimmer-30b
run_pair muse-glimmer-30b muse

load qwen3.8-27b-uncensored
run_pair qwen3.8-27b-uncensored qwen38

echo "=== done ==="
ls -1 data/_planner-eval/*-latest.md
