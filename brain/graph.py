"""LangGraph movie factory.

Stills-first: health → plan → stills → board → video → done.
Straight to video skips stills and board: health → plan → video → done.

Clip media on disk and plan.json are the resume protocol. LangGraph only
checkpoints at node boundaries; stills/video loops skip finished files.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from .config import BrainConfig
from .studio import (
    BrainError,
    Studio,
    still_path_from_job,
    video_path_from_job,
)

Status = Literal["pending", "stills", "face_qa", "video", "recut", "done", "fail", "stopped"]
GRAPH_NODES = ("health", "plan", "stills", "face_qa", "video", "free", "finish")
_STOP = threading.Event()


class BrainState(TypedDict, total=False):
    status: Status
    project_id: str
    prompt: str
    look_track: str
    title: str
    clips: list[dict[str, Any]]
    picks: dict[str, str]
    still_paths: dict[str, str]
    hero_paths: dict[str, str]
    video_paths: dict[str, str]
    review_ok: bool
    auto_pick: bool
    last_error: str
    thread_id: str
    stop_after: str
    quality: str
    dry_run: bool
    video_mode: str
    job_ids: list[str]
    step: str
    current_clip: str
    master_path: str
    run_id: str
    phase: str


def empty_state(**kwargs: Any) -> BrainState:
    state: BrainState = {
        "status": "pending",
        "project_id": "",
        "prompt": "",
        "look_track": "live",
        "title": "",
        "clips": [],
        "picks": {},
        "still_paths": {},
        "hero_paths": {},
        "video_paths": {},
        "review_ok": False,
        "auto_pick": False,
        "last_error": "",
        "thread_id": "",
        "stop_after": "",
        "quality": "standard",
        "dry_run": False,
        "video_mode": "stills",
        "job_ids": [],
        "step": "health",
        "current_clip": "",
        "master_path": "",
        "run_id": "",
        "phase": "",
    }
    for key, value in kwargs.items():
        if value is not None:
            state[key] = value  # type: ignore[literal-required]
    if not state.get("thread_id") and state.get("project_id"):
        state["thread_id"] = state["project_id"]
    return state


def _look(clips_plan: dict[str, Any] | None) -> str:
    raw = str((clips_plan or {}).get("lookTrack") or "live").lower()
    return "anime" if raw == "anime" else "live"


def normalize_video_mode(raw: Any) -> str:
    v = str(raw or "").strip().lower()
    if v in {"t2v", "t2va", "text", "text-to-video", "straight"}:
        return "t2v"
    return "stills"


def _is_t2v(state: BrainState | None) -> bool:
    return normalize_video_mode((state or {}).get("video_mode")) == "t2v"


STEPS = (
    ("health", "Ready"),
    ("plan", "Story"),
    ("stills", "Pictures"),
    ("face_qa", "Your picks"),
    ("video", "Motion"),
    ("free", "Clear"),
    ("finish", "Film"),
)
T2V_SKIP_STEPS = frozenset({"stills", "face_qa"})

# Drawn graph — must stay in lockstep with build_graph().
GRAPH_NODE_META = (
    ("start", "Start", "This run"),
    ("health", "Ready", "Check Monitor and Comfy"),
    ("plan", "Story", "Write the clip list"),
    ("stills", "Pictures", "Paint each still"),
    ("face_qa", "Your picks", "You choose the frames"),
    ("video", "Motion", "Make each clip"),
    ("free", "Clear", "Unload Comfy models"),
    ("finish", "Film", "Join the clips"),
    ("end", "End", "Stop or done"),
)
GRAPH_EDGES = (
    ("start", "health", "flow"),
    ("health", "plan", "flow"),
    ("plan", "stills", "flow"),
    ("plan", "video", "flow"),
    ("stills", "face_qa", "flow"),
    ("face_qa", "video", "flow"),
    ("video", "free", "flow"),
    ("free", "finish", "flow"),
    ("finish", "end", "flow"),
    ("health", "end", "stop"),
    ("plan", "end", "stop"),
    ("stills", "end", "stop"),
    ("face_qa", "end", "stop"),
    ("video", "end", "stop"),
    ("free", "end", "stop"),
    ("start", "plan", "resume"),
    ("start", "stills", "resume"),
    ("start", "face_qa", "resume"),
    ("start", "video", "resume"),
    ("start", "free", "resume"),
    ("start", "finish", "resume"),
)

STATUS_STEP = {
    "pending": "health",
    "stills": "stills",
    "face_qa": "face_qa",
    "video": "video",
    "recut": "free",
    "done": "finish",
    "fail": "health",
    "stopped": "health",
}


def pipeline_steps(video_mode: Any = None) -> tuple[tuple[str, str], ...]:
    if normalize_video_mode(video_mode) == "t2v":
        return tuple(item for item in STEPS if item[0] not in T2V_SKIP_STEPS)
    return STEPS


def step_states(
    status: str,
    current: str,
    stop_after: str | None = None,
    video_mode: str | None = None,
) -> list[dict[str, str]]:
    steps = pipeline_steps(video_mode)
    order = [sid for sid, _ in steps]
    cur = current if current in order else STATUS_STEP.get(status, "health")
    if cur not in order:
        cur = "finish" if status == "done" else order[0]
    if stop_after == "plan" and cur == "stills":
        cur = "plan"
    if cur not in order:
        cur = order[0]
    idx = order.index(cur)
    out: list[dict[str, str]] = []
    for i, (sid, label) in enumerate(steps):
        if status == "done":
            state = "done"
        elif status == "fail" and i == idx:
            state = "fail"
        elif i < idx:
            state = "done"
        elif i == idx:
            if status == "fail":
                state = "fail"
            elif status == "stopped":
                state = "idle"
            elif stop_after == cur:
                state = "done"
            else:
                state = "active"
        else:
            state = "idle"
        out.append({"id": sid, "label": label, "state": state})
    return out


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def apply_step_timing(
    timings: dict[str, Any],
    step: str,
    *,
    now: datetime | None = None,
    close: bool = False,
) -> dict[str, Any]:
    """Close the previous open step and keep a running clock on `step`."""
    moment = now or datetime.now(timezone.utc)
    now_iso = _iso(moment)
    now_ts = moment.timestamp()
    out: dict[str, Any] = {}
    for sid, row in (timings or {}).items():
        if not isinstance(row, dict):
            continue
        copied = dict(row)
        if sid != step and copied.get("startedAt") and not copied.get("endedAt"):
            started = _parse_iso(str(copied.get("startedAt")))
            if started:
                copied["endedAt"] = now_iso
                copied["seconds"] = max(0.0, round(now_ts - started.timestamp(), 1))
        out[sid] = copied
    row = dict(out.get(step) or {})
    if close and row.get("startedAt") and row.get("endedAt"):
        out[step] = row
        return out
    if not row.get("startedAt") or row.get("endedAt"):
        row = {"startedAt": now_iso, "endedAt": None, "seconds": 0.0}
    else:
        started = _parse_iso(str(row.get("startedAt")))
        if started:
            row["seconds"] = max(0.0, round(now_ts - started.timestamp(), 1))
    if close:
        row["endedAt"] = now_iso
        if row.get("seconds") is None:
            started = _parse_iso(str(row.get("startedAt")))
            if started:
                row["seconds"] = max(0.0, round(now_ts - started.timestamp(), 1))
    out[step] = row
    return out


def graph_view(
    steps: list[dict[str, str]],
    timings: dict[str, Any],
    current: str,
    status: str = "",
    video_mode: str | None = None,
) -> dict[str, Any]:
    by_id = {s["id"]: s for s in steps}
    begun = any(s.get("state") in {"done", "active", "fail"} for s in steps)
    skip = T2V_SKIP_STEPS if normalize_video_mode(video_mode) == "t2v" else frozenset()
    nodes = []
    for sid, label, blurb in GRAPH_NODE_META:
        if sid in skip:
            continue
        if sid == "start":
            state = "done" if begun else "idle"
        elif sid == "end":
            if status == "done":
                state = "done"
            elif status in {"fail", "stopped"}:
                state = "fail"
            else:
                state = "idle"
        else:
            state = (by_id.get(sid) or {}).get("state") or "idle"
        nodes.append({"id": sid, "label": label, "blurb": blurb, "state": state})
    edges = []
    for src, dest, kind in GRAPH_EDGES:
        if src in skip or dest in skip:
            continue
        row = timings.get(src) if isinstance(timings.get(src), dict) else None
        seconds = None
        live = False
        if kind == "flow" and row:
            seconds = row.get("seconds")
            live = bool(src == current and row.get("startedAt") and not row.get("endedAt"))
        elif kind == "stop" and row:
            src_state = (by_id.get(src) or {}).get("state")
            if src_state == "fail" or (status in {"fail", "stopped"} and src == current):
                seconds = row.get("seconds")
        edges.append(
            {
                "id": f"{src}->{dest}:{kind}",
                "from": src,
                "to": dest,
                "kind": kind,
                "seconds": seconds,
                "live": live,
            }
        )
    return {"nodes": nodes, "edges": edges}


def public_report(
    state: BrainState,
    *,
    step: str | None = None,
    current_clip: str | None = None,
    prev: dict[str, Any] | None = None,
    phase: str | None = None,
) -> dict[str, Any]:
    status = str(state.get("status") or "pending")
    now = step or state.get("step") or STATUS_STEP.get(status) or "health"
    clip_id = current_clip if current_clip is not None else state.get("current_clip") or ""
    stills = state.get("still_paths") or {}
    videos = state.get("video_paths") or {}
    picks = state.get("picks") or {}
    clips = []
    for clip in state.get("clips") or []:
        cid = clip.get("id")
        clips.append(
            {
                "id": cid,
                "title": clip.get("title") or cid,
                "durationSec": clip.get("durationSec"),
                "cut": bool(clip.get("cut")),
                "stillBrief": clip.get("stillBrief"),
                "motionBrief": clip.get("motionBrief"),
                "dialogue": clip.get("dialogue"),
                "soundscape": clip.get("soundscape"),
                "musicNote": clip.get("musicNote"),
                "still": stills.get(cid) if cid else None,
                "video": videos.get(cid) if cid else None,
                "pick": picks.get(cid) if cid else None,
            }
        )
    prev = prev or {}
    run_id = str(state.get("run_id") or prev.get("runId") or "")
    prev_times = prev.get("timings") if isinstance(prev.get("timings"), dict) else {}
    if run_id and prev.get("runId") and prev.get("runId") != run_id:
        prev_times = {}
    close = status in {"done", "fail", "stopped"}
    timings = apply_step_timing(prev_times, now, close=close) if now in dict(STEPS) else dict(prev_times)
    steps = step_states(status, now, state.get("stop_after") or None, state.get("video_mode"))
    return {
        "schema": "qorlith.brain.v1",
        "projectId": state.get("project_id") or "",
        "title": state.get("title") or state.get("project_id") or "",
        "lookTrack": state.get("look_track") or "live",
        "videoMode": normalize_video_mode(state.get("video_mode")),
        "status": status,
        "step": now,
        "stopAfter": state.get("stop_after") or None,
        "reviewOk": bool(state.get("review_ok")),
        "lastError": state.get("last_error") or None,
        "currentClip": clip_id or None,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "steps": steps,
        "clips": clips,
        "jobIds": list(state.get("job_ids") or []),
        "master": state.get("master_path") or None,
        "runId": run_id or None,
        "phase": phase or state.get("phase") or None,
        "timings": timings,
        "graph": graph_view(steps, timings, now, status, state.get("video_mode")),
    }


def write_report(cfg: BrainConfig, state: BrainState, **kwargs: Any) -> Path | None:
    pid = state.get("project_id")
    if not pid:
        return None
    dest = cfg.project_dir / pid / "brain.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    phase = kwargs.get("phase")
    if phase:
        state = {**state, "phase": str(phase)}
    prev: dict[str, Any] = {}
    if dest.is_file():
        try:
            loaded = json.loads(dest.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                prev = loaded
        except json.JSONDecodeError:
            prev = {}
    payload = json.dumps(public_report(state, prev=prev, **kwargs), indent=2) + "\n"
    tmp = dest.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(dest)
    return dest


def _fail(state: BrainState, err: Exception) -> BrainState:
    hint = getattr(err, "hint", None)
    msg = str(err)
    if hint:
        msg = f"{msg} ({hint})"
    extra = getattr(err, "state", None) or {}
    code = getattr(err, "code", None)
    status: Status = "stopped" if code == "stopped" else "fail"
    return {**state, **extra, "status": status, "last_error": msg}


def request_stop() -> None:
    _STOP.set()


def reset_stop() -> None:
    _STOP.clear()


def stopping() -> bool:
    return _STOP.is_set()


def _raise_if_stopped(extra: dict[str, Any] | None = None) -> None:
    if stopping():
        raise BrainError(
            409,
            "stopped",
            "Stopped from the UI",
            "Resume to continue from this node.",
            state=extra,
        )


def clip_needs_painted_still(clip: dict[str, Any], index: int) -> bool:
    """Continue takes start from the previous last frame, not a new txt2img."""
    if index <= 0:
        return True
    return bool(clip.get("cut"))


def painted_stills_complete(clips, stills) -> bool:
    if not clips:
        return False
    for i, clip in enumerate(clips):
        cid = str(clip.get("id") or "")
        if not cid:
            continue
        if clip_needs_painted_still(clip, i) and not (stills or {}).get(cid):
            return False
    return True


def infer_step(state: BrainState) -> str:
    status = str(state.get("status") or "pending")
    step = str(state.get("step") or "")
    clips = state.get("clips") or []
    stills = state.get("still_paths") or {}
    videos = state.get("video_paths") or {}
    if status == "done":
        return "finish"
    if clips and videos and len(videos) >= len(clips) and not state.get("comfy_freed"):
        return "free"
    if step in GRAPH_NODES:
        return step
    if clips and videos and len(videos) >= len(clips):
        return "finish"
    if _is_t2v(state) and clips:
        return "video"
    if clips and stills and (state.get("review_ok") or status == "video"):
        return "video" if painted_stills_complete(clips, stills) else "stills"
    if clips and stills and painted_stills_complete(clips, stills):
        return "face_qa"
    if clips:
        return "stills"
    if status in STATUS_STEP:
        return STATUS_STEP[status]
    return "health"


def route_start(state: BrainState) -> str:
    """Jump to the current node. Resume must not re-walk health → plan."""
    if state.get("status") == "done":
        return "end"
    return infer_step(state)


def load_report(cfg: BrainConfig, project_id: str) -> dict[str, Any] | None:
    if not project_id:
        return None
    path = cfg.project_dir / project_id / "brain.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def merge_report(state: BrainState, report: dict[str, Any] | None) -> BrainState:
    if not report:
        return state
    stills = dict(state.get("still_paths") or {})
    videos = dict(state.get("video_paths") or {})
    picks = dict(state.get("picks") or {})
    for clip in report.get("clips") or []:
        cid = clip.get("id")
        if not cid:
            continue
        if clip.get("still"):
            stills.setdefault(str(cid), str(clip["still"]))
        if clip.get("video"):
            videos.setdefault(str(cid), str(clip["video"]))
        if clip.get("pick"):
            picks.setdefault(str(cid), str(clip["pick"]))
    out: BrainState = {**state, "still_paths": stills, "video_paths": videos, "picks": picks}
    if report.get("master") and not out.get("master_path"):
        out["master_path"] = str(report["master"])
    if not out.get("clips") and report.get("clips"):
        out["clips"] = [
            {
                "id": c.get("id"),
                "title": c.get("title") or c.get("id"),
                "durationSec": c.get("durationSec"),
                "cut": bool(c.get("cut")),
                "stillBrief": c.get("stillBrief") or "",
                "motionBrief": c.get("motionBrief") or "",
                "dialogue": c.get("dialogue") or "",
                "soundscape": c.get("soundscape") or "",
                "musicNote": c.get("musicNote") or "",
            }
            for c in report["clips"]
            if c.get("id")
        ]
    elif out.get("clips") and report.get("clips"):
        by_id = {str(c.get("id")): c for c in report["clips"] if c.get("id")}
        filled = []
        for clip in out["clips"]:
            src = by_id.get(str(clip.get("id"))) or {}
            row = dict(clip)
            for key in ("stillBrief", "motionBrief", "dialogue", "soundscape", "musicNote", "title", "durationSec"):
                if row.get(key) in (None, "") and src.get(key) not in (None, ""):
                    row[key] = src[key]
            if "cut" not in row and "cut" in src:
                row["cut"] = bool(src.get("cut"))
            filled.append(row)
        out["clips"] = filled
    if report.get("step") in GRAPH_NODES and (
        report.get("status") in {"stopped", "fail", "stills", "face_qa", "video", "recut"}
        or not state.get("step")
    ):
        out["step"] = str(report["step"])
    if report.get("currentClip"):
        out["current_clip"] = str(report["currentClip"])
    if report.get("status") == "stopped" and state.get("status") != "done":
        out["status"] = "stopped"
    if report.get("runId") and not out.get("run_id"):
        out["run_id"] = str(report["runId"])
    return out


def _picks_from_board(studio: Studio, project_id: str) -> dict[str, str]:
    board = studio.board(project_id)
    picks: dict[str, str] = {}
    for scene in board.get("scenes") or []:
        sid = scene.get("id")
        pick = scene.get("pick") or {}
        rel = scene.get("pickRel") or pick.get("rel")
        abs_pick = (pick or {}).get("abs")
        if sid and abs_pick:
            picks[str(sid)] = str(abs_pick)
        elif sid and rel:
            picks[str(sid)] = str(rel)
    return picks


def master_dest(cfg: BrainConfig, project_id: str) -> Path:
    return cfg.project_dir / project_id / "master.mp4"


def media_ok(path: str | Path | None, *, kind: str) -> bool:
    """True when a clip file is on disk. Videos must be large enough to be a finished render."""
    if not path:
        return False
    dest = Path(str(path))
    minimum = 50_000 if kind == "video" else 1
    try:
        return dest.is_file() and dest.stat().st_size >= minimum
    except OSError:
        return False


def collect_disk_media(cfg: BrainConfig, state: BrainState) -> BrainState:
    """Disk is the clip-level checkpointer. Drop stale paths and refill from Comfy output."""
    look = str(state.get("look_track") or "live")
    project_id = str(state.get("project_id") or "")
    stills = dict(state.get("still_paths") or {})
    t2v = normalize_video_mode(state.get("video_mode")) == "t2v"
    if t2v:
        stills = {
            k: v for k, v in stills.items() if v and not str(v).replace("\\", "/").endswith("_from_prev.png")
        }
    videos = {k: v for k, v in (state.get("video_paths") or {}).items() if media_ok(v, kind="video")}
    looks = [look]
    alt = "live" if look == "anime" else "anime"
    if alt not in looks:
        looks.append(alt)
    for clip in state.get("clips") or []:
        cid = clip.get("id")
        if not cid:
            continue
        key = str(cid)
        if not stills.get(key):
            for track in looks:
                found = find_clip_output(cfg, track, project_id, key, "still", 0)
                if found:
                    stills[key] = found
                    break
        if stills.get(key) and not t2v:
            copy_still_to_board(cfg, project_id, key, stills[key])
        local = project_clip_video(cfg, project_id, key)
        if media_ok(local, kind="video"):
            videos[key] = str(local)
            continue
        if not videos.get(key):
            for track in looks:
                found = find_clip_output(cfg, track, project_id, key, "video", 0)
                if found:
                    videos[key] = found
                    break
        if videos.get(key):
            videos[key] = copy_video_to_project(cfg, project_id, key, str(videos[key]))
    return {**state, "still_paths": stills, "video_paths": videos}


def project_clip_video(cfg: BrainConfig, project_id: str, clip_id: str) -> Path:
    return cfg.project_dir / project_id / "video" / f"{clip_id}.mp4"


def continue_frame_path(cfg: BrainConfig, project_id: str, clip_id: str, *, t2v: bool) -> Path:
    """Last-frame source for a continue take. T2V keeps it next to the clip, not on the board."""
    if t2v:
        return cfg.project_dir / project_id / "video" / f"{clip_id}_from_prev.png"
    return cfg.project_dir / project_id / "board" / clip_id / f"{clip_id}_from_prev.png"


def copy_video_to_project(cfg: BrainConfig, project_id: str, clip_id: str, src: str) -> str:
    """Keep a project-local copy so T2V covers and resume do not depend on Comfy output."""
    path = Path(src)
    if not project_id or not clip_id or not path.is_file():
        return str(path)
    dest = project_clip_video(cfg, project_id, clip_id)
    try:
        if dest.resolve() == path.resolve():
            return str(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and dest.stat().st_size == path.stat().st_size:
            return str(dest)
        shutil.copy2(path, dest)
    except OSError:
        return str(path)
    return str(dest)


def copy_still_to_board(cfg: BrainConfig, project_id: str, clip_id: str, src: str) -> None:
    path = Path(src)
    if not project_id or not clip_id or not path.is_file():
        return
    dest_dir = cfg.project_dir / project_id / "board" / clip_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix or ".png"
    dest = dest_dir / f"{clip_id}_v1{suffix}"
    n = 1
    while dest.exists():
        try:
            if dest.stat().st_size == path.stat().st_size:
                return
        except OSError:
            return
        n += 1
        dest = dest_dir / f"{clip_id}_v{n}{suffix}"
    try:
        shutil.copy2(path, dest)
    except OSError:
        return


def find_clip_output(cfg: BrainConfig, look: str, project_id: str, clip_id: str, kind: str, since: float) -> str | None:
    root = cfg.comfy_output
    if root is None:
        return None
    folder = "video" if kind == "video" else "heroes" if kind == "hero" else "stills"
    dest = root / "qorlith" / look / project_id / folder
    if not dest.is_dir():
        return None
    suffix = ".mp4" if kind == "video" else ".png"
    hits = []
    for path in dest.glob(f"{clip_id}_*{suffix}"):
        try:
            if path.is_file() and path.stat().st_mtime >= since - 2 and path.stat().st_size > 50_000:
                hits.append(path)
        except OSError:
            continue
    if not hits:
        return None
    hits.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return str(hits[0])


def clip_video_files(state: BrainState) -> list[Path]:
    videos = state.get("video_paths") or {}
    out: list[Path] = []
    for clip in state.get("clips") or []:
        cid = clip.get("id")
        raw = videos.get(cid) if cid else None
        if not raw:
            continue
        path = Path(str(raw))
        if path.is_file():
            out.append(path)
    return out


def _concat_list_line(path: Path) -> str:
    escaped = path.resolve().as_posix().replace("'", r"'\''")
    return f"file '{escaped}'\n"


def concat_videos(paths: list[Path], dest: Path) -> Path:
    if not paths:
        raise BrainError(400, "no_videos", "No clip videos to concat", "Run video first.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    if len(paths) == 1:
        shutil.copy2(paths[0], dest)
        return dest
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise BrainError(500, "ffmpeg_missing", "ffmpeg is not installed", "Install ffmpeg, then resume finish.")
    list_file = dest.with_suffix(".concat.txt")
    list_file.write_text("".join(_concat_list_line(p) for p in paths), encoding="utf-8")
    try:
        copied = subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(dest)],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if copied.returncode != 0 or not dest.is_file() or dest.stat().st_size == 0:
            encoded = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(list_file),
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                    str(dest),
                ],
                capture_output=True,
                text=True,
                timeout=600,
            )
            if encoded.returncode != 0 or not dest.is_file() or dest.stat().st_size == 0:
                err = (encoded.stderr or copied.stderr or "ffmpeg failed").strip()
                raise BrainError(
                    500,
                    "concat_failed",
                    err[:400] or "ffmpeg could not concat the clips",
                    "Check the clip videos, then resume finish.",
                )
        return dest
    finally:
        try:
            list_file.unlink()
        except FileNotFoundError:
            pass


WELD_FADE_SEC = 0.04
CONTINUE_TRIM_FRAMES = 1


def _has_audio_stream(path: Path) -> bool:
    probe = shutil.which("ffprobe")
    if not probe:
        return False
    ran = subprocess.run(
        [
            probe,
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    return bool((ran.stdout or "").strip())


def _normalize_join_clip(src: Path, dest: Path, *, trim_frames: int = 0) -> Path:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise BrainError(500, "ffmpeg_missing", "ffmpeg is not installed", "Install ffmpeg, then resume finish.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    vf = "setpts=PTS-STARTPTS,fps=24,format=yuv420p"
    if trim_frames > 0:
        vf = f"trim=start_frame={trim_frames},{vf}"
    if _has_audio_stream(src):
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(src),
            "-vf",
            vf,
            "-af",
            "aresample=32000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "32000",
            "-ac",
            "2",
            "-shortest",
            str(dest),
        ]
    else:
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(src),
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=32000",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "32000",
            "-ac",
            "2",
            "-shortest",
            str(dest),
        ]
    ran = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if ran.returncode != 0 or not dest.is_file() or dest.stat().st_size == 0:
        err = (ran.stderr or ran.stdout or "ffmpeg normalize failed").strip()
        raise BrainError(500, "weld_normalize", err[:400], "Check the clip videos, then resume finish.")
    return dest


def _ffmpeg_join_pair(left: Path, right: Path, dest: Path, *, fade: bool) -> Path:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise BrainError(500, "ffmpeg_missing", "ffmpeg is not installed", "Install ffmpeg, then resume finish.")
    if fade:
        filt = (
            f"[0:v][1:v]concat=n=2:v=1:a=0[v];"
            f"[0:a][1:a]acrossfade=d={WELD_FADE_SEC}:c1=tri:c2=tri[a]"
        )
    else:
        filt = "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]"
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(left),
        "-i",
        str(right),
        "-filter_complex",
        filt,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "32000",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        str(dest),
    ]
    ran = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if ran.returncode != 0 or not dest.is_file() or dest.stat().st_size == 0:
        err = (ran.stderr or ran.stdout or "ffmpeg weld failed").strip()
        raise BrainError(500, "weld_failed", err[:400], "Check the clip videos, then resume finish.")
    return dest


def weld_videos(segments: list[tuple[Path, str]], dest: Path) -> Path:
    """Join clips. Continue seams drop the duplicate first frame and 40ms-crossfade audio."""
    if not segments:
        raise BrainError(400, "no_videos", "No clip videos to concat", "Run video first.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        dest.unlink()
    if len(segments) == 1:
        shutil.copy2(segments[0][0], dest)
        return dest
    if all(kind == "cut" for _, kind in segments[1:]):
        return concat_videos([path for path, _ in segments], dest)
    tmp = dest.parent / f".weld_{dest.stem}"
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        norms: list[Path] = []
        for i, (path, kind) in enumerate(segments):
            trim = CONTINUE_TRIM_FRAMES if i > 0 and kind == "continue" else 0
            norms.append(_normalize_join_clip(path, tmp / f"n{i:02d}.mp4", trim_frames=trim))
        acc = norms[0]
        for i in range(1, len(norms)):
            nxt = tmp / f"j{i:02d}.mp4"
            _ffmpeg_join_pair(acc, norms[i], nxt, fade=segments[i][1] == "continue")
            acc = nxt
        shutil.copy2(acc, dest)
        return dest
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def weld_clip_videos(clips: list[dict[str, Any]], video_paths: dict[str, Any], dest: Path) -> Path:
    segments: list[tuple[Path, str]] = []
    for i, clip in enumerate(clips or []):
        cid = clip.get("id")
        raw = video_paths.get(cid) if cid else None
        if not raw:
            continue
        path = Path(str(raw))
        if not path.is_file():
            continue
        kind = "continue" if i > 0 and not clip.get("cut") else "cut"
        segments.append((path, kind))
    return weld_videos(segments, dest)


def node_health(studio: Studio, state: BrainState) -> BrainState:
    live = {**state, "status": "pending", "step": "health"}
    write_report(studio.cfg, live, phase="monitor_get")
    mon = studio.monitor_health()
    if not mon.get("ok"):
        raise BrainError(503, "monitor_down", "Monitor is not ok", "Start the monitor, then retry.")
    write_report(studio.cfg, live, phase="comfy_stats")
    studio.comfy_stats()
    return {**state, "status": "pending", "step": "plan", "last_error": "", "phase": "comfy_stats"}


def node_plan(studio: Studio, state: BrainState) -> BrainState:
    prompt = (state.get("prompt") or "").strip()
    project_id = (state.get("project_id") or "").strip()
    if not prompt and not project_id:
        raise BrainError(400, "missing_prompt", "prompt or project_id required", "Pass --prompt or --project.")

    write_report(studio.cfg, {**state, "step": "plan"}, phase="plan_get")
    existing = studio.get_plan(project_id) if project_id else None
    record = (existing or {}).get("record") if existing else None
    plan = (record or {}).get("plan") if record else None
    if not prompt:
        prompt = str((record or {}).get("userPrompt") or "").strip()
    mode = normalize_video_mode((plan or {}).get("videoMode") or state.get("video_mode"))
    if plan and plan.get("clips"):
        write_report(studio.cfg, {**state, "step": "plan"}, phase="plan_reuse")
        nxt = "video" if mode == "t2v" else "stills"
        return {
            **state,
            "project_id": plan.get("projectId") or project_id,
            "title": plan.get("title") or state.get("title") or "",
            "look_track": _look(plan),
            "clips": list(plan.get("clips") or []),
            "video_mode": mode,
            "review_ok": True if mode == "t2v" else bool(state.get("review_ok")),
            "auto_pick": True if mode == "t2v" else bool(state.get("auto_pick")),
            "status": nxt,
            "step": nxt,
            "phase": "plan_reuse",
        }

    if not prompt:
        raise BrainError(
            400,
            "empty_plan",
            f"Project {project_id} has no clips yet",
            "Pass --prompt so Brain can generate a plan.",
        )

    if not project_id:
        created = studio.create_project(state.get("title") or "Untitled project", prompt, video_mode=mode)
        project_id = (created.get("project") or created).get("id") or ""
        if not project_id:
            raise BrainError(502, "create_failed", "Monitor did not return a project id", "Check POST /api/studio/projects.")

    write_report(studio.cfg, {**state, "project_id": project_id, "step": "plan"}, phase="plan_llm")
    result = studio.generate_plan(
        prompt, project_id=project_id, dry_run=bool(state.get("dry_run")), video_mode=mode
    )
    plan = result.get("plan") or (result.get("record") or {}).get("plan") or {}
    clips = list(plan.get("clips") or [])
    if not clips:
        raise BrainError(502, "empty_plan", "Planner returned no clips", "Generate again, or use --dry-run.")
    pid = plan.get("projectId") or project_id
    write_report(studio.cfg, {**state, "project_id": pid, "step": "plan"}, phase="plan_save")
    mode = normalize_video_mode(plan.get("videoMode") or mode)
    nxt = "video" if mode == "t2v" else "stills"
    return {
        **state,
        "project_id": pid,
        "thread_id": state.get("thread_id") or pid,
        "title": plan.get("title") or state.get("title") or pid,
        "look_track": _look(plan),
        "clips": clips,
        "video_mode": mode,
        "review_ok": True if mode == "t2v" else bool(state.get("review_ok")),
        "auto_pick": True if mode == "t2v" else bool(state.get("auto_pick")),
        "status": nxt,
        "step": nxt,
        "last_error": "",
        "phase": "plan_save",
    }


_GITS_DENY = re.compile(
    r"\b(?:not|no)\s+(?:ghost in the shell|gits|section\s*9|motoko|kusanagi|the major)"
    r"(?:\s+copies(?:\s+of\s+motoko)?)?\b",
    re.I,
)
_GITS_ASK = re.compile(
    r"\b(?:ghost in the shell|section\s*9|gitsstyl|\bgits\b|motoko|kusanagi|thermoptic|the major)\b",
    re.I,
)


def _text_wants_gits(text: str) -> bool:
    stripped = _GITS_DENY.sub(" ", text or "")
    return bool(_GITS_ASK.search(stripped))


def _lora_is_gits(item: dict[str, Any]) -> bool:
    name = str(item.get("name") or "").lower()
    role = str(item.get("role") or "").lower()
    if role == "gits" or "gitsstyl" in name:
        return True
    return any(str(t).lower() == "gitsstyl" for t in item.get("triggers") or [])


def _still_plan(
    studio: Studio,
    brief: str,
    quality: str,
    *,
    size: dict[str, Any] | None = None,
    ipadapter_image: str | None = None,
) -> dict[str, Any]:
    inv = studio.inventory()
    want_gits = _text_wants_gits(brief)
    loras = []
    for item in inv.get("loras") or []:
        name = item.get("name")
        if not name:
            continue
        if _lora_is_gits(item) and not want_gits:
            continue
        strength = item.get("default_strength", 0.65)
        loras.append({"name": name, "strength_model": strength, "strength_clip": strength})
    defaults = inv.get("defaults") or {}
    steps = 28 if quality == "draft" else 34
    cfg = 5.5 if quality == "draft" else 6.0
    plan: dict[str, Any] = {
        "positive": brief,
        "negative": "",
        "size": size or {"width": 1280, "height": 720, "aspectRatio": "16:9"},
        "loras": loras,
        "controlnet": {"enabled": False, "type": "none", "strength": 0},
        "sampler": {
            "steps": steps,
            "cfg": cfg,
            "sampler_name": "euler_ancestral",
            "scheduler": "normal",
            "seed": -1,
        },
        "quality": quality,
        "notes": defaults.get("checkpoint") or "",
    }
    if ipadapter_image:
        # Last-resort identity only. Scene clips should not pass a hero
        # portrait — plus-face IPAdapter copies MCU composition.
        plan["ipadapter"] = {
            "enabled": True,
            "image": ipadapter_image,
            "weight": 0.28,
            "weight_type": "ease out",
            "start_at": 0.0,
            "end_at": 0.62,
        }
    return plan


_ACTION_FRAME_RE = re.compile(
    r"\b(smg|rifle|pistol|shotgun|gun|weapon|rooftop|alley|chase|raid|fight|combat)\b",
    re.I,
)
_WIDE_FRAME_RE = re.compile(
    r"\b(medium-wide|wide shot|from the thighs|full body|environment visible|cowboy shot)\b",
    re.I,
)
_MCU_FRAME_RE = re.compile(
    r"\b(close[- ]?up|closeup|portrait|head and shoulders|looking toward camera)\b",
    re.I,
)


def widen_action_brief(brief: str) -> str:
    """Keep action stills as a readable body + set, not a face crop."""
    s = str(brief or "").strip()
    if not s or not _ACTION_FRAME_RE.search(s):
        return s
    s = _MCU_FRAME_RE.sub(" ", s)
    if not _WIDE_FRAME_RE.search(s):
        s = "medium-wide shot, from the thighs up, face readable, environment visible, " + s
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r"(?:,\s*){2,}", ", ", s).strip(" ,")
    return s[:800]


def _plan_characters(studio: Studio, project_id: str) -> list[dict[str, Any]]:
    existing = studio.get_plan(project_id) if project_id else None
    record = (existing or {}).get("record") if existing else None
    plan = (record or {}).get("plan") if record else None
    chars = list((plan or {}).get("characters") or [])
    return [c for c in chars if isinstance(c, dict) and (c.get("id") or c.get("name"))]


def _hero_brief(look: str, character: dict[str, Any]) -> str:
    lock = str(character.get("look") or character.get("name") or "adult").strip()
    name = str(character.get("name") or "").strip()
    who = f"{name}, {lock}" if name and name.lower() not in lock.lower() else lock
    if look == "anime":
        return (
            f"1girl, adult woman, {who}, portrait, head and shoulders, face centered, "
            "looking at viewer, sharp eyes, detailed face, detailed iris, clean linework, studio lighting"
        )
    return (
        f"adult, {who}, photographic portrait, head and shoulders, face centered, "
        "looking at camera, sharp eyes, detailed face, natural skin, studio lighting"
    )


def hero_board_path(cfg: BrainConfig, project_id: str, char_id: str) -> Path:
    return cfg.project_dir / project_id / "board" / "heroes" / f"{char_id}_v1.png"


def copy_hero_to_board(cfg: BrainConfig, project_id: str, char_id: str, src: str) -> str | None:
    path = Path(src)
    if not project_id or not char_id or not path.is_file():
        return None
    dest = hero_board_path(cfg, project_id, char_id)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.suffix != (path.suffix or ".png"):
        dest = dest.with_suffix(path.suffix or ".png")
    try:
        if dest.exists() and dest.stat().st_size == path.stat().st_size:
            return str(dest)
        shutil.copy2(path, dest)
        return str(dest)
    except OSError:
        return str(path)


def _existing_hero(cfg: BrainConfig, project_id: str, char_id: str) -> str | None:
    dest = hero_board_path(cfg, project_id, char_id)
    try:
        if dest.is_file() and dest.stat().st_size > 20_000:
            return str(dest)
    except OSError:
        return None
    return None


def _ipadapter_enabled(studio: Studio) -> bool:
    inv = studio.inventory() or {}
    defaults = inv.get("defaults") or {}
    return bool(defaults.get("ipadapterEnabled"))


def node_stills(studio: Studio, state: BrainState) -> BrainState:
    state = hydrate_production_state(studio, state)
    if _is_t2v(state):
        return {
            **state,
            "status": "video",
            "step": "video",
            "review_ok": True,
            "auto_pick": True,
            "phase": "t2v_skip_stills",
        }
    write_report(studio.cfg, {**state, "status": "stills", "step": "stills"}, phase="comfy_idle")
    if hasattr(studio, "wait_comfy_idle"):
        studio.wait_comfy_idle(should_stop=stopping)
    elif studio.comfy_busy():
        raise BrainError(
            409,
            "comfy_busy",
            "Comfy already has work in the queue",
            "Wait for the current render, then resume. Brain will not clear the queue.",
        )
    quality = state.get("quality") or "standard"
    look = state.get("look_track") or "live"
    project_id = state["project_id"]
    stills = dict(state.get("still_paths") or {})
    heroes = dict(state.get("hero_paths") or {})
    jobs = list(state.get("job_ids") or [])
    live = {
        **state,
        "status": "stills",
        "step": "stills",
        "still_paths": stills,
        "hero_paths": heroes,
        "job_ids": jobs,
    }
    write_report(studio.cfg, live, phase="comfy_idle")

    clips = list(state.get("clips") or [])
    for i, clip in enumerate(clips):
        cid = clip.get("id")
        if not cid or stills.get(cid):
            continue
        if not clip_needs_painted_still(clip, i):
            continue
        progress = {"still_paths": stills, "job_ids": jobs, "current_clip": cid, "step": "stills", "status": "stills"}
        _raise_if_stopped(progress)
        live["current_clip"] = cid
        write_report(studio.cfg, live, current_clip=cid, phase="comfy_idle")
        brief = widen_action_brief((clip.get("stillBrief") or clip.get("title") or cid).strip())
        prefix = f"qorlith/{look}/{project_id}/stills/{cid}"
        if hasattr(studio, "wait_comfy_idle"):
            studio.wait_comfy_idle(should_stop=stopping)
        write_report(studio.cfg, live, current_clip=cid, phase="still_queue")
        queued = studio.queue_still(
            _still_plan(studio, brief, quality),
            instruction=brief,
            sizeHint="16:9",
            quality=quality,
            filenamePrefix=prefix,
            count=1,
        )
        job_id = queued.get("jobId")
        if not job_id:
            raise BrainError(502, "no_job", "Monitor did not return a still job", "Retry stills.", state=progress)
        jobs.append(job_id)
        started = time.time()
        write_report(studio.cfg, {**live, "job_ids": jobs}, current_clip=cid, phase="still_wait")
        try:
            done = studio.wait_job(
                job_id,
                should_stop=stopping,
                find_output=lambda: find_clip_output(studio.cfg, look, project_id, cid, "still", started),
            )
        except BrainError as err:
            err.state = {**progress, "job_ids": jobs}
            raise
        path = still_path_from_job(done)
        if not path:
            raise BrainError(502, "no_still", f"Job {job_id} produced no still", "Check Comfy output.", state=progress)
        write_report(studio.cfg, {**live, "job_ids": jobs}, current_clip=cid, phase="still_copy")
        stills[cid] = path
        copy_still_to_board(studio.cfg, project_id, cid, path)
        live["still_paths"] = stills
        live["job_ids"] = jobs
        write_report(studio.cfg, live, current_clip=cid, phase="still_copy")
    return {
        **state,
        "still_paths": stills,
        "hero_paths": heroes,
        "job_ids": jobs,
        "status": "face_qa",
        "step": "face_qa",
        "current_clip": "",
        "last_error": "",
        "phase": "still_copy",
    }


def node_face_qa(studio: Studio, state: BrainState) -> BrainState:
    write_report(studio.cfg, {**state, "step": "face_qa"}, phase="board_get")
    picks = _picks_from_board(studio, state["project_id"])
    stills = state.get("still_paths") or {}
    clips = state.get("clips") or []
    if state.get("auto_pick"):
        for clip in clips:
            cid = str(clip.get("id") or "")
            if cid and cid not in picks and stills.get(cid):
                picks[cid] = str(stills[cid])
    have_all = painted_stills_complete(clips, stills)
    needed = [c for i, c in enumerate(clips) if clip_needs_painted_still(c, i)]
    review_ok = bool(
        state.get("review_ok")
        or state.get("auto_pick")
        or (have_all and all(str(c.get("id") or "") in picks for c in needed))
    )
    status: Status = "video" if review_ok else "face_qa"
    phase = "wait_picks" if not review_ok else "board_get"
    write_report(studio.cfg, {**state, "step": "face_qa" if not review_ok else "video"}, phase=phase)
    return {
        **state,
        "picks": picks,
        "review_ok": review_ok,
        "status": status,
        "step": "video" if review_ok else "face_qa",
        "phase": phase,
    }


def extract_last_frame(video_path: str | Path, dest: str | Path) -> Path:
    """Grab the last decoded frame of a clip so the next I2VA take can continue it."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise BrainError(500, "ffmpeg_missing", "ffmpeg is not installed", "Install ffmpeg to chain last frames.")
    src = Path(video_path)
    out = Path(dest)
    if not src.is_file():
        raise BrainError(400, "missing_video", f"No video to pull a last frame from: {src}", "Render the previous clip first.")
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-y",
        "-sseof",
        "-0.12",
        "-i",
        str(src),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(out),
    ]
    ran = subprocess.run(cmd, capture_output=True, text=True)
    if ran.returncode != 0 or not out.is_file() or out.stat().st_size < 80:
        fallback = [
            ffmpeg,
            "-y",
            "-i",
            str(src),
            "-update",
            "1",
            "-q:v",
            "2",
            str(out),
        ]
        ran = subprocess.run(fallback, capture_output=True, text=True)
    if ran.returncode != 0 or not out.is_file() or out.stat().st_size < 80:
        err = (ran.stderr or ran.stdout or "ffmpeg last-frame failed").strip()
        raise BrainError(502, "last_frame", err[:400], "Check the previous mp4, then retry video.")
    return out


def clip_take_seconds(
    clip: dict[str, Any],
    cfg: BrainConfig | None,
    *,
    continue_from_prior: bool = False,
) -> int:
    fallback = int(getattr(cfg, "video_duration_sec", 12) or 12)
    lo = int(getattr(cfg, "video_duration_min", 6) or 6)
    hi = int(getattr(cfg, "video_duration_max", 15) or 15)
    floor = int(getattr(cfg, "video_continue_min", 10) or 10)
    try:
        n = int(clip.get("durationSec") or fallback)
    except (TypeError, ValueError):
        n = fallback
    if continue_from_prior:
        lo = max(lo, min(floor, hi))
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def hydrate_production_state(studio: Studio, state: BrainState) -> BrainState:
    """Plan.json owns clip briefs. Disk owns finished media. LangGraph does not."""
    project_id = str(state.get("project_id") or "")
    plan: dict[str, Any] = {}
    if project_id and hasattr(studio, "get_plan"):
        try:
            rec = studio.get_plan(project_id)
            plan = ((rec or {}).get("record") or {}).get("plan") or {}
        except Exception:
            plan = {}
    plan_clips = [c for c in (plan.get("clips") or []) if isinstance(c, dict) and c.get("id")]
    by_id = {str(c["id"]): c for c in plan_clips}
    clips = [c for c in (state.get("clips") or []) if isinstance(c, dict) and c.get("id")]
    if not clips:
        clips = plan_clips
    else:
        filled = []
        for clip in clips:
            src = by_id.get(str(clip["id"])) or {}
            row = {**src, **clip}
            for key in (
                "motionBrief",
                "dialogue",
                "soundscape",
                "musicNote",
                "stillBrief",
                "durationSec",
                "title",
            ):
                if src.get(key) not in (None, ""):
                    row[key] = src[key]
            filled.append(row)
        clips = filled
    if plan.get("lookTrack") or plan.get("look"):
        look = _look(plan)
    else:
        look = state.get("look_track") or "live"
    mode = normalize_video_mode(plan.get("videoMode") or state.get("video_mode"))
    out: BrainState = {**state, "clips": clips, "look_track": look or "live", "video_mode": mode}
    if plan.get("title") and not out.get("title"):
        out["title"] = str(plan["title"])
    return collect_disk_media(studio.cfg, out)


def resolve_video_source(
    clip: dict[str, Any],
    *,
    still: str,
    prev_video: str | None,
    dest: Path,
    extract=None,
) -> tuple[str, str]:
    """Still on a cut / first clip; last frame of the previous take otherwise."""
    if clip.get("cut") or not prev_video:
        return still, "still"
    pull = extract if extract is not None else extract_last_frame
    try:
        return str(pull(prev_video, dest)), "continue"
    except BrainError:
        return still, "still_fallback"


def node_video(studio: Studio, state: BrainState) -> BrainState:
    if not state.get("review_ok") and not _is_t2v(state):
        raise BrainError(403, "need_review", "Board review is not done", "Set picks, then resume --review-ok.")
    state = hydrate_production_state(studio, state)
    write_report(studio.cfg, {**state, "status": "video", "step": "video"}, phase="comfy_idle")
    if hasattr(studio, "wait_comfy_idle"):
        studio.wait_comfy_idle(should_stop=stopping)
    elif studio.comfy_busy():
        raise BrainError(
            409,
            "comfy_busy",
            "Comfy already has work in the queue",
            "Wait for the current render, then resume video.",
        )
    look = state.get("look_track") or "live"
    project_id = state["project_id"]
    characters = [
        {"id": c.get("id"), "name": c.get("name")}
        for c in _plan_characters(studio, project_id)
    ]
    stills = dict(state.get("still_paths") or {})
    videos = dict(state.get("video_paths") or {})
    jobs = list(state.get("job_ids") or [])
    live = {
        **state,
        "status": "video",
        "step": "video",
        "video_paths": videos,
        "still_paths": stills,
        "job_ids": jobs,
    }
    write_report(studio.cfg, live, phase="comfy_idle")
    prev_video: str | None = None
    for clip in state.get("clips") or []:
        cid = clip.get("id")
        if not cid:
            continue
        if media_ok(videos.get(cid), kind="video"):
            prev_video = videos[cid]
            continue
        videos.pop(cid, None)
        progress = {"video_paths": videos, "job_ids": jobs, "current_clip": cid, "step": "video", "status": "video"}
        _raise_if_stopped(progress)
        live["current_clip"] = cid
        write_report(studio.cfg, live, current_clip=cid, phase="comfy_idle")
        t2v_open = _is_t2v(state) and (bool(clip.get("cut")) or not prev_video)
        if t2v_open:
            source, source_kind = "", "t2v"
        else:
            pick = (state.get("picks") or {}).get(cid)
            still = pick if pick and Path(str(pick)).is_file() else stills.get(cid)
            if not still and (clip.get("cut") or not prev_video):
                raise BrainError(400, "missing_still", f"No still for {cid}", "Run stills first.", state=progress)
            t2v = _is_t2v(state)
            frame_dest = continue_frame_path(studio.cfg, project_id, cid, t2v=t2v)
            source, source_kind = resolve_video_source(
                clip,
                still=str(still or ""),
                prev_video=prev_video,
                dest=frame_dest,
            )
            if source_kind == "continue" and source and not stills.get(cid) and not t2v:
                stills[cid] = source
                copy_still_to_board(studio.cfg, project_id, cid, source)
                live["still_paths"] = stills
        if hasattr(studio, "wait_comfy_idle"):
            studio.wait_comfy_idle(should_stop=stopping)
        duration = clip_take_seconds(
            clip,
            studio.cfg,
            continue_from_prior=source_kind == "continue",
        )
        motion = (clip.get("motionBrief") or clip.get("title") or cid).strip()
        dialogue = clip.get("dialogue") or ""
        plan = {
            "motion": motion,
            "dialogue": dialogue,
            "music": clip.get("musicNote") or "N/A",
            "soundscape": clip.get("soundscape") or "",
            "lookTrack": look,
            "characters": characters,
            "allowSinging": bool(clip.get("allowSinging") or clip.get("singing"))
            or bool(re.search(r"\b(sings?|singing|chorus|lyrics?)\b", f"{motion} {dialogue}", re.I)),
            "durationSec": duration,
            "megapixels": float(getattr(studio.cfg, "video_megapixels", None) or 0.6),
            "continueFromPrior": source_kind == "continue",
            "t2v": source_kind == "t2v",
            "videoMode": "t2v" if source_kind == "t2v" else "stills",
        }
        prefix = f"qorlith/{look}/{project_id}/video/{cid}"
        write_report(studio.cfg, live, current_clip=cid, phase="video_queue")
        extra = {"instruction": motion, "filenamePrefix": prefix}
        if source_kind == "t2v":
            extra["t2v"] = True
        queued = studio.queue_video(source, plan, **extra)
        job_id = queued.get("jobId")
        if not job_id:
            raise BrainError(502, "no_job", "Monitor did not return a video job", "Retry video.", state=progress)
        jobs.append(job_id)
        started = time.time()
        write_report(studio.cfg, {**live, "job_ids": jobs}, current_clip=cid, phase="video_wait")
        try:
            done = studio.wait_job(
                job_id,
                timeout_s=2700,
                should_stop=stopping,
                find_output=lambda: find_clip_output(studio.cfg, look, project_id, cid, "video", started),
            )
        except BrainError as err:
            err.state = {**progress, "job_ids": jobs}
            raise
        path = video_path_from_job(done)
        if not path:
            raise BrainError(502, "no_video", f"Job {job_id} produced no video", "Check Comfy output.", state=progress)
        copied = copy_video_to_project(studio.cfg, project_id, cid, path)
        videos[cid] = copied
        prev_video = copied
        live["video_paths"] = videos
        live["job_ids"] = jobs
        write_report(studio.cfg, live, current_clip=cid, phase="video_wait")
    return {
        **state,
        "still_paths": stills,
        "video_paths": videos,
        "job_ids": jobs,
        "status": "recut",
        "step": "free",
        "comfy_freed": False,
        "current_clip": "",
        "last_error": "",
        "phase": "video_wait",
    }


def node_free(studio: Studio, state: BrainState) -> BrainState:
    """Unload Comfy models after every video take is on disk. Soft-fail so the film still joins."""
    live = {**state, "step": "free", "status": state.get("status") or "recut"}
    write_report(studio.cfg, live, phase="comfy_free")
    phase = "comfy_free"
    try:
        studio.comfy_free()
    except Exception:
        phase = "comfy_free_error"
    ok = _ok(state)
    return {
        **state,
        "comfy_freed": True,
        "status": state.get("status") or "recut",
        "step": "finish" if ok else "free",
        "phase": phase,
        "last_error": state.get("last_error") or "",
    }


def node_finish(cfg: BrainConfig, state: BrainState) -> BrainState:
    _raise_if_stopped({"step": "finish"})
    write_report(cfg, {**state, "step": "finish"}, phase="ffmpeg")
    clips = state.get("clips") or []
    files = clip_video_files(state)
    master = str(state.get("master_path") or "")
    if clips and len(files) == len(clips):
        dest = master_dest(cfg, state["project_id"])
        weld_clip_videos(clips, state.get("video_paths") or {}, dest)
        master = str(dest)
    done = {**state, "status": "done", "step": "finish", "master_path": master, "last_error": "", "phase": "master"}
    write_report(cfg, done, phase="master")
    return done


def _ok(state: BrainState) -> bool:
    return state.get("status") not in {"fail", "stopped"}


def after_health(state: BrainState) -> str:
    return "plan" if _ok(state) else "end"


def after_plan(state: BrainState) -> str:
    if not _ok(state) or state.get("stop_after") == "plan":
        return "end"
    if _is_t2v(state):
        return "end" if state.get("stop_after") == "stills" else "video"
    return "stills"


def after_stills(state: BrainState) -> str:
    return "face_qa" if _ok(state) else "end"


def after_qa(state: BrainState) -> str:
    if not _ok(state) or state.get("stop_after") == "plan":
        return "end"
    if state.get("stop_after") == "stills" and not state.get("auto_pick"):
        return "end"
    if state.get("review_ok") and state.get("status") == "video":
        return "video"
    return "end"


def after_video(state: BrainState) -> str:
    return "free"


def after_free(state: BrainState) -> str:
    return "finish" if _ok(state) else "end"


def _safe(fn, cfg: BrainConfig):
    def wrapped(state: BrainState) -> BrainState:
        try:
            _raise_if_stopped({"step": state.get("step") or infer_step(state)})
            out = fn(state)
            write_report(cfg, out)
            return out
        except BrainError as err:
            failed = _fail(state, err)
            write_report(cfg, failed)
            return failed

    return wrapped


def build_graph(studio: Studio, cfg: BrainConfig | None = None, checkpointer=None):
    cfg = cfg or studio.cfg

    graph = StateGraph(BrainState)
    graph.add_node("health", _safe(lambda s: node_health(studio, s), cfg))
    graph.add_node("plan", _safe(lambda s: node_plan(studio, s), cfg))
    graph.add_node("stills", _safe(lambda s: node_stills(studio, s), cfg))
    graph.add_node("face_qa", _safe(lambda s: node_face_qa(studio, s), cfg))
    graph.add_node("video", _safe(lambda s: node_video(studio, s), cfg))
    graph.add_node("free", _safe(lambda s: node_free(studio, s), cfg))
    graph.add_node("finish", _safe(lambda s: node_finish(cfg, s), cfg))

    graph.add_conditional_edges(
        START,
        route_start,
        {
            "health": "health",
            "plan": "plan",
            "stills": "stills",
            "face_qa": "face_qa",
            "video": "video",
            "free": "free",
            "finish": "finish",
            "end": END,
        },
    )
    graph.add_conditional_edges("health", after_health, {"plan": "plan", "end": END})
    graph.add_conditional_edges("plan", after_plan, {"stills": "stills", "video": "video", "end": END})
    graph.add_conditional_edges("stills", after_stills, {"face_qa": "face_qa", "end": END})
    graph.add_conditional_edges("face_qa", after_qa, {"video": "video", "end": END})
    graph.add_conditional_edges("video", after_video, {"free": "free"})
    graph.add_conditional_edges("free", after_free, {"finish": "finish", "end": END})
    graph.add_edge("finish", END)
    return graph.compile(checkpointer=checkpointer)


def memory_saver():
    try:
        from langgraph.checkpoint.memory import InMemorySaver

        return InMemorySaver()
    except ImportError:
        from langgraph.checkpoint.memory import MemorySaver

        return MemorySaver()


def sqlite_saver(path: Path):
    import sqlite3

    from langgraph.checkpoint.sqlite import SqliteSaver

    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    return SqliteSaver(conn)


def _pid_path(cfg: BrainConfig, project_id: str) -> Path:
    return cfg.project_dir / project_id / "brain.pid"


def write_pid(cfg: BrainConfig, project_id: str) -> None:
    if not project_id:
        return
    path = _pid_path(cfg, project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(os.getpid()), encoding="utf-8")


def clear_pid(cfg: BrainConfig, project_id: str) -> None:
    if not project_id:
        return
    try:
        _pid_path(cfg, project_id).unlink()
    except FileNotFoundError:
        return


def read_pid(cfg: BrainConfig, project_id: str) -> int | None:
    path = _pid_path(cfg, project_id)
    if not path.is_file():
        return None
    try:
        pid = int(path.read_text(encoding="utf-8").strip())
    except ValueError:
        return None
    return pid if pid > 0 else None


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def stop_process(cfg: BrainConfig, project_id: str) -> dict[str, Any]:
    pid = read_pid(cfg, project_id)
    if pid is None or not pid_alive(pid):
        clear_pid(cfg, project_id)
        raise BrainError(409, "brain_not_running", "Brain is not running", "Nothing to stop.")
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError as err:
        raise BrainError(409, "brain_not_running", f"Could not signal {pid}", str(err)) from err
    return {"ok": True, "pid": pid}


def _install_stop_signals() -> tuple[Any, Any]:
    reset_stop()

    def _handle(_signum: int, _frame: Any) -> None:
        request_stop()

    prev_term = signal.getsignal(signal.SIGTERM)
    prev_int = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)
    return prev_term, prev_int


def _restore_stop_signals(prev_term: Any, prev_int: Any) -> None:
    signal.signal(signal.SIGTERM, prev_term)
    signal.signal(signal.SIGINT, prev_int)
    reset_stop()


def run(
    studio: Studio,
    state: BrainState,
    *,
    checkpointer=None,
    persist: bool = True,
) -> BrainState:
    cfg = studio.cfg
    saver = checkpointer
    if saver is None and persist:
        saver = sqlite_saver(cfg.checkpoint_path)
    elif saver is None:
        saver = memory_saver()
    app = build_graph(studio, cfg, checkpointer=saver)
    thread = state.get("thread_id") or state.get("project_id") or "brain"
    if not state.get("run_id"):
        state = {
            **state,
            "run_id": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f"),
        }
    state = hydrate_production_state(studio, state)
    prev = _install_stop_signals() if persist else None
    if persist:
        write_pid(cfg, thread)
    try:
        return app.invoke(state, {"configurable": {"thread_id": thread}})
    finally:
        if persist:
            clear_pid(cfg, thread)
        if prev:
            _restore_stop_signals(*prev)


def resume(
    studio: Studio,
    thread_id: str,
    *,
    review_ok: bool | None = None,
    stop_after: str | None = None,
    checkpointer=None,
) -> BrainState:
    saver = checkpointer or sqlite_saver(studio.cfg.checkpoint_path)
    app = build_graph(studio, studio.cfg, checkpointer=saver)
    config = {"configurable": {"thread_id": thread_id}}
    snap = app.get_state(config)
    values = dict(snap.values or {})
    report = load_report(studio.cfg, thread_id)
    if not values and report:
        values = empty_state(project_id=thread_id, thread_id=thread_id)
    if not values:
        raise BrainError(404, "no_thread", f"No checkpoint for {thread_id}", "Start the graph first.")
    values = merge_report(values, report)
    values = hydrate_production_state(studio, values)
    if review_ok is not None:
        values["review_ok"] = review_ok
    if review_ok:
        try:
            board_picks = _picks_from_board(studio, thread_id)
            if board_picks:
                values["picks"] = {**(values.get("picks") or {}), **board_picks}
        except BrainError:
            pass
        if infer_step(values) in {"face_qa", "stills"} and values.get("review_ok"):
            stills = values.get("still_paths") or {}
            clips = values.get("clips") or []
            if clips and all(c.get("id") in stills for c in clips):
                values["step"] = "video"
                values["status"] = "video"
    if stop_after is not None:
        values["stop_after"] = stop_after
    else:
        values["stop_after"] = ""
    values["thread_id"] = thread_id
    values["project_id"] = values.get("project_id") or thread_id
    if values.get("status") in {"fail", "stopped"}:
        values["last_error"] = ""
    prev = _install_stop_signals()
    write_pid(studio.cfg, thread_id)
    try:
        return app.invoke(values, config)
    finally:
        clear_pid(studio.cfg, thread_id)
        _restore_stop_signals(*prev)
