"""Unit harness for LangGraph topology, timings, and public graph reports."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from brain.config import BrainConfig
from brain.graph import (
    GRAPH_EDGES,
    GRAPH_NODE_META,
    GRAPH_NODES,
    apply_step_timing,
    empty_state,
    graph_view,
    public_report,
    step_states,
    write_report,
)


def _cfg(tmp_path: Path) -> BrainConfig:
    return BrainConfig(
        root=tmp_path,
        monitor_url="http://127.0.0.1:3921",
        comfy_url="http://127.0.0.1:8188",
        planner_url="http://127.0.0.1:1234/v1",
        checkpoint_path=tmp_path / "ck.sqlite",
    )


def test_graph_spec_is_closed():
    ids = [row[0] for row in GRAPH_NODE_META]
    assert next(row[1] for row in GRAPH_NODE_META if row[0] == "video") == "Clips"
    assert tuple(sid for sid in ids if sid not in {"start", "end"}) == GRAPH_NODES
    known = set(ids)
    kinds = set()
    for src, dest, kind in GRAPH_EDGES:
        assert src in known
        assert dest in known
        kinds.add(kind)
    assert kinds == {"flow", "stop", "resume"}


def test_apply_step_timing_closes_previous_and_tracks_live():
    t0 = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)
    first = apply_step_timing({}, "health", now=t0)
    assert first["health"]["endedAt"] is None
    t1 = t0 + timedelta(seconds=2.4)
    second = apply_step_timing(first, "plan", now=t1)
    assert second["health"]["seconds"] == 2.4
    assert second["plan"]["endedAt"] is None
    t2 = t1 + timedelta(seconds=5)
    closed = apply_step_timing(second, "plan", now=t2, close=True)
    assert closed["plan"]["seconds"] == 5.0
    assert closed["plan"]["endedAt"]


def test_apply_step_timing_does_not_reset_a_closed_step():
    t0 = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)
    first = apply_step_timing({}, "finish", now=t0, close=True)
    first["finish"]["seconds"] = 12.0
    later = apply_step_timing(first, "finish", now=t0 + timedelta(seconds=40), close=True)
    assert later["finish"]["seconds"] == 12.0
    assert later["finish"]["startedAt"] == first["finish"]["startedAt"]


def test_apply_step_timing_skips_garbage_rows():
    out = apply_step_timing({"plan": "nope", "stills": {"startedAt": "bad"}}, "video")
    assert "plan" not in out
    assert out["stills"]["startedAt"] == "bad"
    assert "video" in out


def test_graph_view_stop_edge_keeps_seconds_on_fail_and_stop():
    steps = step_states("fail", "stills")
    timings = {"stills": {"startedAt": "t0", "endedAt": "t1", "seconds": 7.5}}
    view = graph_view(steps, timings, "stills", "fail")
    stop = next(e for e in view["edges"] if e["from"] == "stills" and e["kind"] == "stop")
    assert stop["seconds"] == 7.5
    assert next(n for n in view["nodes"] if n["id"] == "end")["state"] == "fail"

    halted = graph_view(step_states("stopped", "video"), timings | {"video": {"seconds": 3}}, "video", "stopped")
    stop_v = next(e for e in halted["edges"] if e["from"] == "video" and e["kind"] == "stop")
    assert stop_v["seconds"] == 3


def test_graph_view_done_marks_end_and_start():
    steps = step_states("done", "finish")
    view = graph_view(steps, {}, "finish", "done")
    assert next(n for n in view["nodes"] if n["id"] == "start")["state"] == "done"
    assert next(n for n in view["nodes"] if n["id"] == "end")["state"] == "done"


def test_public_report_resets_timings_on_new_run_id():
    prev = {
        "runId": "run-a",
        "timings": {
            "stills": {
                "startedAt": "2026-08-14T12:00:00Z",
                "endedAt": "2026-08-14T12:01:00Z",
                "seconds": 60,
            }
        },
    }
    report = public_report(
        empty_state(project_id="harbor", status="stills", step="stills", run_id="run-b"),
        prev=prev,
    )
    assert report["runId"] == "run-b"
    assert report["timings"]["stills"]["endedAt"] is None
    assert report["timings"]["stills"].get("seconds") in (0, 0.0)
    assert report["timings"].get("stills", {}).get("startedAt") != "2026-08-14T12:00:00Z"


def test_public_report_keeps_timings_when_run_id_matches():
    prev = {
        "runId": "run-a",
        "timings": {
            "health": {
                "startedAt": "2026-08-14T12:00:00+00:00",
                "endedAt": "2026-08-14T12:00:02+00:00",
                "seconds": 2,
            }
        },
    }
    report = public_report(
        empty_state(project_id="harbor", status="plan", step="plan", run_id="run-a"),
        prev=prev,
    )
    assert report["timings"]["health"]["seconds"] == 2
    assert report["timings"]["plan"]["endedAt"] is None


def test_write_report_round_trips_graph(tmp_path: Path):
    cfg = _cfg(tmp_path)
    state = empty_state(project_id="harbor", status="stills", step="stills", run_id="r1", clips=[{"id": "S01"}])
    dest = write_report(cfg, state)
    assert dest is not None
    text = dest.read_text(encoding="utf-8")
    assert '"graph"' in text
    assert '"timings"' in text
    again = write_report(cfg, {**state, "status": "done", "step": "finish"})
    assert again is not None
    import json

    payload = json.loads(again.read_text(encoding="utf-8"))
    assert payload["status"] == "done"
    assert payload["timings"]["finish"]["endedAt"]
    third = write_report(cfg, {**state, "status": "done", "step": "finish"})
    again_seconds = payload["timings"]["finish"]["seconds"]
    kept = json.loads(third.read_text(encoding="utf-8"))
    assert kept["timings"]["finish"]["seconds"] == again_seconds


def test_write_report_without_project_is_noop(tmp_path: Path):
    cfg = _cfg(tmp_path)
    assert write_report(cfg, empty_state(status="stills", step="stills")) is None


def test_write_report_persists_phase(tmp_path: Path):
    cfg = _cfg(tmp_path)
    dest = write_report(
        cfg,
        empty_state(project_id="harbor", status="stills", step="stills", run_id="r1"),
        phase="still_wait",
    )
    assert dest is not None
    import json

    payload = json.loads(dest.read_text(encoding="utf-8"))
    assert payload["phase"] == "still_wait"
