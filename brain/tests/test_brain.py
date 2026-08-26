from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
import yaml

from brain.config import BrainConfig, load_config
from brain.graph import (
    clip_take_seconds,
    collect_disk_media,
    extract_last_frame,
    hydrate_production_state,
    widen_action_brief,
    media_ok,
    weld_videos,
    resolve_video_source,
    GRAPH_EDGES,
    GRAPH_NODE_META,
    GRAPH_NODES,
    after_plan,
    after_qa,
    apply_step_timing,
    build_graph,
    concat_videos,
    empty_state,
    infer_step,
    clip_needs_painted_still,
    painted_stills_complete,
    memory_saver,
    public_report,
    request_stop,
    reset_stop,
    resume,
    route_start,
    step_states,
    node_face_qa,
    node_free,
    node_finish,
    node_health,
    node_plan,
    node_stills,
    node_video,
    run,
)
from brain.studio import BrainError, still_path_from_job, video_path_from_job


def _temp_cfg() -> BrainConfig:
    root = Path(tempfile.mkdtemp(prefix="qorlith-brain-"))
    return BrainConfig(
        root=root,
        monitor_url="http://127.0.0.1:3921",
        comfy_url="http://127.0.0.1:8188",
        planner_url="http://127.0.0.1:1234/v1",
        checkpoint_path=root / "brain" / "checkpointer.sqlite",
    )


class FakeStudio:
    def __init__(self, cfg=None):
        self.cfg = cfg or _temp_cfg()
        self.calls = []
        self.mon_ok = True
        self.comfy_ok = True
        self.busy = False
        self.plans = {}
        self.boards = {}
        self.jobs = {}
        self.next_job = 1
        self.ipadapter = False

    def monitor_health(self):
        self.calls.append("monitor_health")
        return {"ok": self.mon_ok, "product": "Qorlith"}

    def comfy_stats(self):
        self.calls.append("comfy_stats")
        if not self.comfy_ok:
            raise BrainError(503, "comfy_down", "Comfy down", "Start ComfyUI.")
        return {"system": {"os": "linux"}}

    def comfy_busy(self):
        return self.busy

    def comfy_free(self):
        self.calls.append(("comfy_free",))
        return {"ok": True}

    def wait_comfy_idle(self, timeout_s=1800, poll_s=2.0, should_stop=None):
        if self.busy:
            raise BrainError(409, "comfy_busy", "Comfy already has work in the queue", "Wait.")

    def get_plan(self, project_id):
        rec = self.plans.get(project_id)
        return {"record": rec} if rec else None

    def create_project(self, title, prompt=""):
        self.calls.append(("create", title))
        return {"project": {"id": "harbor"}}

    def generate_plan(self, prompt, project_id=None, dry_run=False):
        self.calls.append(("plan", prompt, project_id, dry_run))
        plan = {
            "projectId": project_id or "harbor",
            "title": "Harbor",
            "lookTrack": "anime",
            "clips": [
                {
                    "id": "S01",
                    "title": "Approach",
                    "durationSec": 7,
                    "stillBrief": "rain alley",
                    "motionBrief": "walk in",
                    "dialogue": "",
                    "musicNote": "N/A",
                },
                {
                    "id": "S02",
                    "title": "Lookout",
                    "durationSec": 7,
                    "stillBrief": "rooftop",
                    "motionBrief": "hold",
                    "dialogue": "",
                    "musicNote": "N/A",
                },
            ],
        }
        self.plans[plan["projectId"]] = {"projectId": plan["projectId"], "plan": plan}
        return {"ok": True, "plan": plan, "record": {"plan": plan}}

    def inventory(self):
        return {
            "loras": [{"name": "style.safetensors", "default_strength": 0.6}],
            "defaults": {"ipadapterEnabled": bool(self.ipadapter)},
        }

    def queue_still(self, plan, **extra):
        assert extra.get("filenamePrefix")
        assert plan["sampler"]["scheduler"] == "normal"
        ip = plan.get("ipadapter") or {}
        self.calls.append(
            ("still", extra.get("filenamePrefix"), plan.get("size"), ip.get("image"), ip, plan.get("positive"))
        )
        jid = f"still-{self.next_job}"
        self.next_job += 1
        self.jobs[jid] = {
            "id": jid,
            "status": "success",
            "result": {"generation": {"imagePath": f"/tmp/{jid}.png"}},
        }
        return {"ok": True, "jobId": jid}

    def queue_video(self, source, plan, **extra):
        if source:
            assert Path(source).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".mp4"}
        self.calls.append(("video", source, plan))
        jid = f"vid-{self.next_job}"
        self.next_job += 1
        self.jobs[jid] = {
            "id": jid,
            "status": "success",
            "result": {"generation": {"videoPath": f"/tmp/{jid}.mp4"}},
        }
        return {"ok": True, "jobId": jid}

    def wait_job(self, job_id, timeout_s=900, poll_s=2.0, should_stop=None, find_output=None):
        if should_stop and should_stop():
            raise BrainError(409, "stopped", "Stopped from the UI", "Resume to continue from this node.")
        return self.jobs[job_id]

    def board(self, project_id):
        return self.boards.get(
            project_id,
            {"id": project_id, "scenes": [{"id": "S01", "pickRel": None}, {"id": "S02", "pickRel": None}]},
        )


def test_health_fails_closed_when_comfy_is_down():
    s = FakeStudio()
    s.comfy_ok = False
    with pytest.raises(BrainError) as err:
        node_health(s, empty_state())
    assert err.value.code == "comfy_down"


def test_plan_creates_project_and_clips():
    s = FakeStudio()
    out = node_plan(s, empty_state(prompt="30s anime night"))
    assert out["project_id"] == "harbor"
    assert out["look_track"] == "anime"
    assert len(out["clips"]) == 2
    assert ("plan", "30s anime night", "harbor", False) in s.calls


def test_stills_skip_when_comfy_busy():
    s = FakeStudio()
    s.busy = True
    with pytest.raises(BrainError) as err:
        node_stills(s, empty_state(project_id="harbor", clips=[{"id": "S01", "stillBrief": "x"}]))
    assert err.value.code == "comfy_busy"


def test_stills_queue_one_job_per_clip():
    s = FakeStudio()
    out = node_stills(
        s,
        empty_state(
            project_id="harbor",
            look_track="anime",
            clips=[
                {"id": "S01", "stillBrief": "rain"},
                {"id": "S02", "stillBrief": "roof", "cut": True},
            ],
        ),
    )
    assert out["status"] == "face_qa"
    assert out["still_paths"]["S01"].endswith(".png")
    assert out["still_paths"]["S02"].endswith(".png")
    assert len(out["job_ids"]) == 2


def test_face_qa_auto_pick_uses_stills():
    s = FakeStudio()
    out = node_face_qa(
        s,
        empty_state(
            project_id="harbor",
            auto_pick=True,
            clips=[{"id": "S01"}, {"id": "S02"}],
            still_paths={"S01": "/tmp/a.png", "S02": "/tmp/b.png"},
        ),
    )
    assert out["review_ok"] is True
    assert out["status"] == "video"
    assert out["picks"]["S01"] == "/tmp/a.png"


def test_face_qa_waits_without_picks():
    s = FakeStudio()
    out = node_face_qa(
        s,
        empty_state(
            project_id="harbor",
            clips=[{"id": "S01"}, {"id": "S02"}],
            still_paths={"S01": "/tmp/a.png", "S02": "/tmp/b.png"},
        ),
    )
    assert out["status"] == "face_qa"
    assert out["review_ok"] is False


def test_face_qa_passes_when_board_has_picks():
    s = FakeStudio()
    s.boards["harbor"] = {
        "scenes": [
            {"id": "S01", "pickRel": "S01/a.png"},
            {"id": "S02", "pickRel": "S02/b.png"},
        ]
    }
    out = node_face_qa(
        s,
        empty_state(
            project_id="harbor",
            clips=[{"id": "S01"}, {"id": "S02"}],
            still_paths={"S01": "/tmp/a.png", "S02": "/tmp/b.png"},
        ),
    )
    assert out["review_ok"] is True
    assert out["status"] == "video"


def test_video_refuses_without_review():
    s = FakeStudio()
    with pytest.raises(BrainError) as err:
        node_video(s, empty_state(project_id="harbor", clips=[{"id": "S01"}], still_paths={"S01": "/tmp/a.png"}))
    assert err.value.code == "need_review"


def test_video_prefers_board_pick(tmp_path: Path):
    s = FakeStudio()
    pick = tmp_path / "pick.png"
    pick.write_bytes(b"png")
    out = node_video(
        s,
        empty_state(
            project_id="harbor",
            review_ok=True,
            clips=[{"id": "S01", "motionBrief": "walk", "durationSec": 7}],
            still_paths={"S01": "/tmp/a.png"},
            picks={"S01": str(pick)},
        ),
    )
    assert out["video_paths"]["S01"].endswith(".mp4")


def test_clip_take_seconds_uses_yaml_max():
    cfg = _temp_cfg()
    object.__setattr__(cfg, "video_duration_sec", 12)
    object.__setattr__(cfg, "video_duration_min", 6)
    object.__setattr__(cfg, "video_duration_max", 12)
    assert clip_take_seconds({"durationSec": 8}, cfg) == 8
    assert clip_take_seconds({"durationSec": 12}, cfg) == 12
    assert clip_take_seconds({"durationSec": 20}, cfg) == 12
    assert clip_take_seconds({}, cfg) == 12
    object.__setattr__(cfg, "video_duration_max", 15)
    object.__setattr__(cfg, "video_continue_min", 10)
    assert clip_take_seconds({"durationSec": 8}, cfg, continue_from_prior=True) == 10
    assert clip_take_seconds({"durationSec": 8}, cfg, continue_from_prior=False) == 8
    assert clip_take_seconds({"durationSec": 20}, cfg) == 15


def test_resolve_video_source_continues_unless_cut(tmp_path: Path):
    still = str(tmp_path / "still.png")
    Path(still).write_bytes(b"png")
    prev = str(tmp_path / "prev.mp4")
    dest = tmp_path / "S02_from_prev.png"

    def extract(_video, out):
        Path(out).write_bytes(b"frame")
        return Path(out)

    src, kind = resolve_video_source(
        {"id": "S02"},
        still=still,
        prev_video=prev,
        dest=dest,
        extract=extract,
    )
    assert kind == "continue"
    assert src.endswith("S02_from_prev.png")

    src, kind = resolve_video_source(
        {"id": "S03", "cut": True},
        still=still,
        prev_video=prev,
        dest=dest,
        extract=extract,
    )
    assert kind == "still"
    assert src == still


def test_video_feeds_last_frame_into_next_clip(tmp_path: Path, monkeypatch):
    s = FakeStudio()
    still_a = tmp_path / "a.png"
    still_b = tmp_path / "b.png"
    still_c = tmp_path / "c.png"
    still_a.write_bytes(b"a")
    still_b.write_bytes(b"b")
    still_c.write_bytes(b"c")

    def fake_extract(_video, dest):
        p = Path(dest)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"last")
        return p

    monkeypatch.setattr("brain.graph.extract_last_frame", fake_extract)
    out = node_video(
        s,
        empty_state(
            project_id="harbor",
            look_track="anime",
            review_ok=True,
            clips=[
                {"id": "S01", "motionBrief": "walk", "durationSec": 12},
                {"id": "S02", "motionBrief": "keep walking", "durationSec": 8},
                {"id": "S03", "motionBrief": "new room", "durationSec": 10, "cut": True},
            ],
            still_paths={"S01": str(still_a), "S02": str(still_b), "S03": str(still_c)},
        ),
    )
    assert out["video_paths"]["S03"].endswith(".mp4")
    sources = [c[1] for c in s.calls if c and c[0] == "video"]
    assert sources[0] == str(still_a)
    assert sources[1].endswith("S02_from_prev.png")
    assert sources[2] == str(still_c)
    plans = [c[2] for c in s.calls if c and c[0] == "video"]
    assert plans[0]["durationSec"] == 12
    assert plans[1]["durationSec"] == 10
    assert plans[0]["continueFromPrior"] is False
    assert plans[1]["continueFromPrior"] is True
    assert plans[2]["continueFromPrior"] is False
    assert plans[0]["lookTrack"] == "anime"
    assert plans[0]["characters"] == []


def test_video_continue_without_a_second_still(tmp_path: Path, monkeypatch):
    s = FakeStudio()
    still_a = tmp_path / "a.png"
    still_a.write_bytes(b"a")

    def fake_extract(_video, dest):
        p = Path(dest)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"last")
        return p

    monkeypatch.setattr("brain.graph.extract_last_frame", fake_extract)
    out = node_video(
        s,
        empty_state(
            project_id="harbor",
            look_track="anime",
            review_ok=True,
            clips=[
                {"id": "S01", "motionBrief": "walk", "durationSec": 12},
                {"id": "S02", "motionBrief": "keep walking", "durationSec": 10},
            ],
            still_paths={"S01": str(still_a)},
        ),
    )
    sources = [c[1] for c in s.calls if c and c[0] == "video"]
    assert sources[0] == str(still_a)
    assert sources[1].endswith("S02_from_prev.png")
    assert out["still_paths"]["S02"].endswith("S02_from_prev.png")
    assert [c[2]["continueFromPrior"] for c in s.calls if c and c[0] == "video"] == [False, True]


def test_clip_needs_painted_still():
    assert clip_needs_painted_still({"id": "S01"}, 0) is True
    assert clip_needs_painted_still({"id": "S02"}, 1) is False
    assert clip_needs_painted_still({"id": "S02", "cut": True}, 1) is True
    assert painted_stills_complete(
        [{"id": "S01"}, {"id": "S02"}],
        {"S01": "/a.png"},
    )


def test_video_passes_look_characters_and_singing():
    s = FakeStudio()
    s.plans["harbor"] = {"plan": {"characters": [{"id": "S1", "name": "Ava"}]}}
    node_video(
        s,
        empty_state(
            project_id="harbor",
            look_track="live",
            review_ok=True,
            clips=[{"id": "S01", "motionBrief": "she hits the chorus", "durationSec": 7}],
            still_paths={"S01": "/tmp/a.png"},
        ),
    )
    plans = [c[2] for c in s.calls if c and c[0] == "video"]
    assert plans[0]["lookTrack"] == "live"
    assert plans[0]["characters"][0]["name"] == "Ava"
    assert plans[0]["allowSinging"] is True


def test_video_queues_from_still():
    s = FakeStudio()
    out = node_video(
        s,
        empty_state(
            project_id="harbor",
            look_track="anime",
            review_ok=True,
            clips=[{"id": "S01", "motionBrief": "walk", "durationSec": 7}],
            still_paths={"S01": "/tmp/a.png"},
        ),
    )
    assert out["video_paths"]["S01"].endswith(".mp4")
    assert out["status"] == "recut"
    assert out["step"] == "free"
    assert out["comfy_freed"] is False


def test_free_unloads_comfy_after_videos():
    s = FakeStudio()
    out = node_free(
        s,
        empty_state(
            project_id="harbor",
            status="recut",
            step="free",
            clips=[{"id": "S01"}],
            video_paths={"S01": "/tmp/a.mp4"},
        ),
    )
    assert out["comfy_freed"] is True
    assert out["step"] == "finish"
    assert ("comfy_free",) in s.calls
    assert infer_step(out) == "finish"
    stuck = empty_state(
        project_id="harbor",
        status="recut",
        step="",
        clips=[{"id": "S01"}],
        video_paths={"S01": "/tmp/a.mp4"},
    )
    assert infer_step(stuck) == "free"


def test_stop_after_plan_does_not_enter_stills():
    assert after_plan(empty_state(status="stills", stop_after="plan")) == "end"
    assert after_plan(empty_state(status="stills")) == "stills"
    assert after_qa(empty_state(status="face_qa", review_ok=False)) == "end"
    assert after_qa(empty_state(status="video", review_ok=True)) == "video"
    assert after_qa(empty_state(status="video", review_ok=True, auto_pick=True, stop_after="stills")) == "video"


def test_graph_plan_only(tmp_path: Path):
    s = FakeStudio()
    out = run(
        s,
        empty_state(prompt="30s anime", stop_after="plan"),
        checkpointer=memory_saver(),
        persist=False,
    )
    assert out["status"] == "stills"
    assert out["clips"]
    assert "queue_still" not in str(s.calls)


def test_graph_one_click_auto_picks_through_video():
    s = FakeStudio()
    out = run(
        s,
        empty_state(prompt="30s anime", stop_after="", auto_pick=True, quality="draft"),
        checkpointer=memory_saver(),
        persist=False,
    )
    assert out["status"] == "done"
    assert out["review_ok"] is True
    assert len(out["still_paths"]) == 1
    assert len(out["video_paths"]) == 2


def test_graph_stops_at_board():
    s = FakeStudio()
    out = run(
        s,
        empty_state(prompt="30s anime", stop_after="stills", quality="draft"),
        checkpointer=memory_saver(),
        persist=False,
    )
    assert out["status"] == "face_qa"
    assert len(out["still_paths"]) == 1
    assert not out["review_ok"]


def test_empty_state_defaults_to_standard_quality():
    assert empty_state()["quality"] == "standard"


def test_widen_action_brief_opens_the_frame():
    wide = widen_action_brief("1girl, holding compact SMG, rain-slick rooftop")
    assert "medium-wide" in wide
    assert "thighs up" in wide
    talk = widen_action_brief("1girl, standing in a kitchen, looking at viewer")
    assert "medium-wide" not in talk


def test_stills_skip_hero_ipadapter_on_clips():
    s = FakeStudio()
    s.ipadapter = True
    plan = {
        "projectId": "harbor",
        "characters": [{"id": "S1", "name": "Ava", "look": "adult short dark hair, red eyes"}],
        "clips": [
            {"id": "S01", "title": "Approach", "stillBrief": "rain alley, compact SMG", "durationSec": 12},
            {"id": "S02", "title": "Lookout", "stillBrief": "rooftop", "durationSec": 12},
        ],
    }
    s.plans["harbor"] = {"projectId": "harbor", "plan": plan}
    out = node_stills(
        s,
        empty_state(project_id="harbor", clips=plan["clips"], look_track="anime", quality="standard"),
    )
    still_calls = [c for c in s.calls if isinstance(c, tuple) and c[0] == "still"]
    assert not any(c[1] and "heroes/" in str(c[1]) for c in still_calls)
    clip_calls = [c for c in still_calls if c[1] and "stills/S01" in str(c[1])]
    assert clip_calls
    assert not clip_calls[0][3]
    assert "medium-wide" in str(clip_calls[0][5])
    assert len(out["still_paths"]) == 1
    assert "S02" not in out["still_paths"]


def test_yaml_urls_come_from_file(tmp_path: Path, monkeypatch):
    (tmp_path / "qorlith.yaml").write_text(
        yaml.safe_dump({"monitor": {"api_port": 3999}, "comfy": {"url": "http://127.0.0.1:8111"}}),
        encoding="utf-8",
    )
    monkeypatch.setenv("QORLITH_ROOT", str(tmp_path))
    cfg = load_config(tmp_path)
    assert cfg.monitor_url == "http://127.0.0.1:3999"
    assert cfg.comfy_url == "http://127.0.0.1:8111"
    assert cfg.video_megapixels == 0.6


def test_local_yaml_sets_video_megapixels(tmp_path: Path, monkeypatch):
    (tmp_path / "qorlith.yaml").write_text(
        yaml.safe_dump({"video": {"megapixels": 0.6}}),
        encoding="utf-8",
    )
    (tmp_path / "qorlith.local.yaml").write_text(
        yaml.safe_dump({"video": {"megapixels": 0.2}}),
        encoding="utf-8",
    )
    monkeypatch.setenv("QORLITH_ROOT", str(tmp_path))
    cfg = load_config(tmp_path)
    assert cfg.video_megapixels == 0.2


def test_job_path_readers():
    assert still_path_from_job({"result": {"generation": {"imagePath": "/a.png"}}}) == "/a.png"
    assert video_path_from_job({"result": {"generation": {"videoPath": "/a.mp4"}}}) == "/a.mp4"


def test_source_has_no_not_implemented():
    text = Path(__file__).resolve().parents[1].joinpath("graph.py").read_text(encoding="utf-8")
    assert "NotImplementedError" not in text
    assert "StateGraph" in text


def test_graph_compiles():
    app = build_graph(FakeStudio(), checkpointer=memory_saver())
    assert app is not None


def test_step_states_mark_current_and_done():
    steps = step_states("stills", "stills")
    assert [s["state"] for s in steps] == ["done", "done", "active", "idle", "idle", "idle", "idle"]
    stopped = step_states("stills", "stills", "plan")
    assert [s["state"] for s in stopped] == ["done", "done", "idle", "idle", "idle", "idle", "idle"]
    done = step_states("done", "finish")
    assert all(s["state"] == "done" for s in done)
    failed = step_states("fail", "stills")
    assert failed[2]["state"] == "fail"


def test_public_report_lists_clip_media():
    report = public_report(
        empty_state(
            project_id="harbor",
            title="Harbor",
            status="face_qa",
            step="face_qa",
            clips=[{"id": "S01", "title": "Approach", "durationSec": 7}],
            still_paths={"S01": "/tmp/a.png"},
        )
    )
    assert report["schema"] == "qorlith.brain.v1"
    assert report["steps"][3]["state"] == "active"
    assert report["clips"][0]["still"] == "/tmp/a.png"


def test_finish_writes_report(tmp_path: Path, monkeypatch):
    from brain.config import BrainConfig

    cfg = BrainConfig(
        root=tmp_path,
        monitor_url="http://127.0.0.1:3921",
        comfy_url="http://127.0.0.1:8188",
        planner_url="http://127.0.0.1:1234/v1",
        checkpoint_path=tmp_path / "ck.sqlite",
    )
    out = node_finish(
        cfg,
        empty_state(
            project_id="harbor",
            title="Harbor",
            look_track="anime",
            clips=[{"id": "S01"}],
            still_paths={"S01": "/tmp/a.png"},
            video_paths={"S01": "/tmp/a.mp4"},
        ),
    )
    report = tmp_path / "monitor" / "data" / "projects" / "harbor" / "brain.json"
    assert out["status"] == "done"
    assert report.is_file()
    assert "S01" in report.read_text(encoding="utf-8")


def test_route_start_jumps_to_current_node():
    fresh = empty_state(prompt="x")
    assert route_start(fresh) == "health"
    assert route_start(empty_state(status="stills", step="stills", clips=[{"id": "S01"}])) == "stills"
    assert route_start(empty_state(status="stopped", step="stills", clips=[{"id": "S01"}])) == "stills"
    assert route_start(empty_state(status="face_qa", step="face_qa")) == "face_qa"
    assert route_start(empty_state(status="done", step="finish")) == "end"
    inferred = empty_state(
        status="stopped",
        step="",
        clips=[{"id": "S01"}, {"id": "S02"}],
        still_paths={"S01": "/tmp/a.png"},
    )
    assert infer_step(inferred) == "face_qa"
    cut_missing = empty_state(
        status="stopped",
        step="",
        clips=[{"id": "S01"}, {"id": "S02", "cut": True}],
        still_paths={"S01": "/tmp/a.png"},
    )
    assert infer_step(cut_missing) == "stills"


def test_resume_does_not_rewalk_health_or_plan():
    s = FakeStudio()
    saver = memory_saver()
    first = run(
        s,
        empty_state(prompt="30s anime", stop_after="plan", thread_id="harbor", project_id="harbor"),
        checkpointer=saver,
        persist=False,
    )
    assert first["status"] == "stills"
    assert first["clips"]
    s.calls.clear()
    out = resume(s, "harbor", checkpointer=saver, stop_after="stills")
    assert "monitor_health" not in s.calls
    assert not any(isinstance(c, tuple) and c[0] == "plan" for c in s.calls)
    assert out["status"] == "face_qa"
    assert len(out["still_paths"]) == 1


def test_graph_spec_matches_compiled_nodes():
    ids = [row[0] for row in GRAPH_NODE_META]
    assert tuple(sid for sid in ids if sid not in {"start", "end"}) == GRAPH_NODES
    known = set(ids)
    for src, dest, kind in GRAPH_EDGES:
        assert src in known
        assert dest in known
        assert kind in {"flow", "stop", "resume"}


def test_apply_step_timing_closes_previous_and_tracks_live():
    from datetime import datetime, timedelta, timezone

    t0 = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)
    first = apply_step_timing({}, "health", now=t0)
    assert first["health"]["startedAt"]
    assert first["health"]["endedAt"] is None
    t1 = t0 + timedelta(seconds=2.4)
    second = apply_step_timing(first, "plan", now=t1)
    assert second["health"]["endedAt"]
    assert second["health"]["seconds"] == 2.4
    assert second["plan"]["endedAt"] is None
    t2 = t1 + timedelta(seconds=5)
    closed = apply_step_timing(second, "plan", now=t2, close=True)
    assert closed["plan"]["seconds"] == 5.0
    assert closed["plan"]["endedAt"]


def test_public_report_includes_graph_and_timings():
    report = public_report(
        empty_state(project_id="harbor", status="stills", step="stills", clips=[{"id": "S01"}])
    )
    assert report["graph"]["nodes"]
    assert any(e["from"] == "stills" and e["to"] == "face_qa" for e in report["graph"]["edges"])
    assert "stills" in report["timings"]
    assert report["timings"]["stills"]["startedAt"]


def test_public_report_includes_master():
    report = public_report(
        empty_state(
            project_id="harbor",
            status="done",
            step="finish",
            clips=[{"id": "S01", "title": "Approach", "durationSec": 7}],
            video_paths={"S01": "/tmp/a.mp4"},
            master_path="/tmp/harbor/master.mp4",
        )
    )
    assert report["master"] == "/tmp/harbor/master.mp4"


def test_collect_disk_media_fills_missing_paths(tmp_path: Path):
    from brain.config import BrainConfig

    out = tmp_path / "comfy" / "output"
    dest = out / "qorlith" / "anime" / "harbor" / "video"
    dest.mkdir(parents=True)
    clip = dest / "S01_00001_.mp4"
    clip.write_bytes(b"x" * 60_000)
    cfg = BrainConfig(
        root=tmp_path,
        monitor_url="http://127.0.0.1:3921",
        comfy_url="http://127.0.0.1:8188",
        planner_url="http://127.0.0.1:1234/v1",
        checkpoint_path=tmp_path / "ck.sqlite",
        comfy_output=out,
    )
    state = empty_state(
        project_id="harbor",
        look_track="anime",
        clips=[{"id": "S01"}],
    )
    merged = collect_disk_media(cfg, state)
    assert merged["video_paths"]["S01"] == str(clip)


def test_copy_still_to_board_versions_new_takes(tmp_path: Path):
    from brain.config import BrainConfig
    from brain.graph import copy_still_to_board

    cfg = BrainConfig(
        root=tmp_path,
        monitor_url="http://127.0.0.1:3921",
        comfy_url="http://127.0.0.1:8188",
        planner_url="http://127.0.0.1:1234/v1",
        checkpoint_path=tmp_path / "ck.sqlite",
    )
    src1 = tmp_path / "a.png"
    src1.write_bytes(b"one")
    copy_still_to_board(cfg, "harbor", "S01", str(src1))
    board = tmp_path / "monitor" / "data" / "projects" / "harbor" / "board" / "S01"
    first = board / "S01_v1.png"
    assert first.read_bytes() == b"one"
    src2 = tmp_path / "b.png"
    src2.write_bytes(b"two!")
    copy_still_to_board(cfg, "harbor", "S01", str(src2))
    second = board / "S01_v2.png"
    assert second.read_bytes() == b"two!"
    copy_still_to_board(cfg, "harbor", "S01", str(src2))
    assert not (board / "S01_v3.png").exists()


def test_concat_videos_copies_single_file(tmp_path: Path):
    src = tmp_path / "a.mp4"
    src.write_bytes(b"fake-mp4")
    dest = tmp_path / "master.mp4"
    out = concat_videos([src], dest)
    assert out == dest
    assert dest.read_bytes() == b"fake-mp4"


def test_concat_videos_joins_with_ffmpeg(tmp_path: Path):
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    clips = []
    for name in ("a", "b"):
        dest = tmp_path / f"{name}.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=16x16:d=0.2",
                "-pix_fmt",
                "yuv420p",
                str(dest),
            ],
            check=True,
            capture_output=True,
        )
        clips.append(dest)
    master = tmp_path / "master.mp4"
    concat_videos(clips, master)
    assert master.is_file()
    assert master.stat().st_size > 0


def test_weld_videos_trims_continue_and_hard_cuts(tmp_path: Path):
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")

    def make_clip(name: str) -> Path:
        dest = tmp_path / f"{name}.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=32x32:d=0.4:r=24",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.4:sample_rate=32000",
                "-pix_fmt",
                "yuv420p",
                "-shortest",
                str(dest),
            ],
            check=True,
            capture_output=True,
        )
        return dest

    a = make_clip("a")
    b = make_clip("b")
    c = make_clip("c")
    cont = tmp_path / "continue.mp4"
    weld_videos([(a, "cut"), (b, "continue")], cont)
    assert cont.is_file() and cont.stat().st_size > 0
    cut = tmp_path / "cut.mp4"
    weld_videos([(a, "cut"), (c, "cut")], cut)
    assert cut.is_file() and cut.stat().st_size > 0


def test_hydrate_fills_briefs_from_plan():
    s = FakeStudio()
    s.plans["harbor"] = {
        "plan": {
            "lookTrack": "anime",
            "clips": [
                {
                    "id": "S01",
                    "motionBrief": "hold",
                    "dialogue": "",
                    "cut": False,
                    "durationSec": 12,
                },
                {
                    "id": "S02",
                    "motionBrief": "keep walking",
                    "cut": False,
                    "durationSec": 12,
                },
            ],
        }
    }
    out = hydrate_production_state(
        s,
        empty_state(project_id="harbor", clips=[{"id": "S01"}, {"id": "S02"}]),
    )
    assert out["clips"][1]["motionBrief"] == "keep walking"
    assert out["look_track"] == "anime"


def test_hydrate_plan_briefs_win_over_stale_state():
    s = FakeStudio()
    s.plans["harbor"] = {
        "plan": {
            "lookTrack": "anime",
            "clips": [
                {
                    "id": "S01",
                    "stillBrief": "1girl, motoko, SMG raised, neon alley",
                    "motionBrief": "she fires",
                    "durationSec": 12,
                }
            ],
        }
    }
    out = hydrate_production_state(
        s,
        empty_state(
            project_id="harbor",
            clips=[{"id": "S01", "stillBrief": "sable, amber eyes", "motionBrief": "old"}],
        ),
    )
    assert out["clips"][0]["stillBrief"] == "1girl, motoko, SMG raised, neon alley"
    assert out["clips"][0]["motionBrief"] == "she fires"


def test_collect_disk_media_drops_stale_paths(tmp_path: Path):
    from brain.config import BrainConfig

    out = tmp_path / "comfy" / "output"
    dest = out / "qorlith" / "anime" / "harbor" / "video"
    dest.mkdir(parents=True)
    clip = dest / "S01_00001_.mp4"
    clip.write_bytes(b"x" * 60_000)
    cfg = BrainConfig(
        root=tmp_path,
        monitor_url="http://127.0.0.1:3921",
        comfy_url="http://127.0.0.1:8188",
        planner_url="http://127.0.0.1:1234/v1",
        checkpoint_path=tmp_path / "ck.sqlite",
        comfy_output=out,
    )
    state = empty_state(
        project_id="harbor",
        look_track="anime",
        clips=[{"id": "S01"}],
        video_paths={"S01": str(tmp_path / "missing.mp4")},
    )
    merged = collect_disk_media(cfg, state)
    assert merged["video_paths"]["S01"] == str(clip)
    assert media_ok(clip, kind="video")
    assert not media_ok(tmp_path / "missing.mp4", kind="video")


def test_stop_flag_aborts_stills():
    s = FakeStudio()
    reset_stop()
    request_stop()
    try:
        with pytest.raises(BrainError) as err:
            node_stills(
                s,
                empty_state(project_id="harbor", clips=[{"id": "S01", "stillBrief": "rain"}]),
            )
        assert err.value.code == "stopped"
    finally:
        reset_stop()
