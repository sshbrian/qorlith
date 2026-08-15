#!/usr/bin/env bash
# Graph + monitoring harness: unit then integration, JS then Python.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/monitor"
echo "== graph unit =="
node --test src/lib/brainGraph.test.mjs src/lib/studioSession.test.mjs server/brainStatus.test.mjs server/comfyProgress.test.mjs
echo "== graph integration =="
node --test server/brain.graph.integration.test.mjs
echo "== graph python =="
cd "$ROOT"
PYTHONPATH=. brain/.venv/bin/python -m pytest -q brain/tests/test_brain_graph.py brain/tests/test_brain.py
echo "graph harness ok"
