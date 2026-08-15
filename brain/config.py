"""Read qorlith.yaml. URLs only — never invent model names."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]


def _read_yaml(path: Path) -> dict:
    if not path.is_file():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def repo_root() -> Path:
    env = os.environ.get("QORLITH_ROOT")
    return Path(env).resolve() if env else REPO


def load_studio_yaml(root: Path | None = None) -> dict:
    root = root or repo_root()
    env_yaml = os.environ.get("QORLITH_YAML")
    base = _read_yaml(Path(env_yaml) if env_yaml else root / "qorlith.yaml")
    local = _read_yaml(root / "qorlith.local.yaml")
    return _merge(base, local)


def _merge(base: dict, overlay: dict) -> dict:
    out = dict(base)
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


@dataclass(frozen=True)
class BrainConfig:
    root: Path
    monitor_url: str
    comfy_url: str
    planner_url: str
    checkpoint_path: Path
    video_megapixels: float = 0.6
    video_duration_sec: int = 12
    video_duration_min: int = 6
    video_duration_max: int = 12
    comfy_output: Path | None = None

    @property
    def project_dir(self) -> Path:
        return self.root / "monitor" / "data" / "projects"


def load_config(root: Path | None = None) -> BrainConfig:
    root = root or repo_root()
    raw = load_studio_yaml(root)
    monitor = raw.get("monitor") or {}
    comfy = raw.get("comfy") or {}
    planner = raw.get("planner") or {}
    video = raw.get("video") or {}
    api_port = int(monitor.get("api_port") or 3921)
    comfy_url = str(comfy.get("url") or "http://127.0.0.1:8188").rstrip("/")
    planner_url = str(planner.get("url") or "http://127.0.0.1:1234/v1").rstrip("/")
    try:
        megapixels = float(video.get("megapixels") or 0.6)
    except (TypeError, ValueError):
        megapixels = 0.6
    if megapixels <= 0:
        megapixels = 0.6

    def _int(key: str, default: int) -> int:
        try:
            n = int(video.get(key) or default)
        except (TypeError, ValueError):
            return default
        return n if n > 0 else default

    duration_sec = _int("duration_sec", 12)
    duration_min = _int("duration_min", 6)
    duration_max = _int("duration_max", 12)
    if duration_min > duration_max:
        duration_min = duration_max
    if duration_sec > duration_max:
        duration_sec = duration_max
    out = str(comfy.get("output") or "").strip()
    ckpt = root / "brain" / "checkpointer.sqlite"
    return BrainConfig(
        root=root,
        monitor_url=f"http://127.0.0.1:{api_port}",
        comfy_url=comfy_url,
        planner_url=planner_url,
        checkpoint_path=ckpt,
        video_megapixels=megapixels,
        video_duration_sec=duration_sec,
        video_duration_min=duration_min,
        video_duration_max=duration_max,
        comfy_output=Path(out) if out else None,
    )
