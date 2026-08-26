# Qorlith MiniMax H3 — Comfy Kitchen Attention

Kitchen is ComfyUI ≥ 0.32 built-in INT8 attention (`ModelAttentionBackend` = `comfy kitchen attention`). It replaces Sage on MiniMax H3. Do **not** also add a Sage patch node, and do **not** launch Comfy with `--use-sage-attention`.

Qorlith queues the graph named in `video.workflow` (`qorlith.yaml` / `qorlith.local.yaml`) and **rewrites** `ModelAttentionBackend` to `comfy kitchen attention` at queue time so an old Sage graph cannot slip through.

EasyCache is **off** on H3. It can wreck MiniMax audio.

## Wiring

```text
UNETLoader (minimax_h3_fl2va_…)
  → ModelAttentionBackend  attention = "comfy kitchen attention"
    → BasicGuider
    → BasicScheduler
```

On the Qorlith I2VA API graph the Kitchen node id is **`138`**.

## Reload

If a shot is already open in Comfy, reload it from the workflow browser so the Kitchen node is on the graph. Queue as usual.
