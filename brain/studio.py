"""HTTP to Monitor and Comfy. Brain never POSTs Comfy /prompt."""

from __future__ import annotations

import time
from typing import Any

import httpx

from .config import BrainConfig


class BrainError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        hint: str | None = None,
        state: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.hint = hint
        self.state = state or {}

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": False,
            "error": str(self),
            "code": self.code,
            "hint": self.hint,
            "status": self.status,
        }


def _raise_http(r: httpx.Response, fallback: str) -> None:
    try:
        body = r.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    raise BrainError(
        r.status_code,
        str(body.get("code") or "upstream"),
        str(body.get("error") or r.text or fallback),
        body.get("hint"),
    )


class Studio:
    def __init__(self, cfg: BrainConfig, client: httpx.Client | None = None):
        self.cfg = cfg
        self.http = client or httpx.Client(timeout=60.0)

    def close(self) -> None:
        self.http.close()

    def _get(self, url: str) -> Any:
        r = self.http.get(url)
        if r.status_code >= 400:
            _raise_http(r, f"GET {url} failed")
        return r.json() if r.content else {}

    def _post(self, url: str, body: dict[str, Any]) -> Any:
        r = self.http.post(url, json=body)
        if r.status_code >= 400:
            _raise_http(r, f"POST {url} failed")
        return r.json() if r.content else {}

    def monitor_health(self) -> dict[str, Any]:
        return self._get(f"{self.cfg.monitor_url}/api/health")

    def comfy_stats(self) -> dict[str, Any]:
        return self._get(f"{self.cfg.comfy_url}/system_stats")

    def comfy_queue(self) -> dict[str, Any]:
        return self._get(f"{self.cfg.comfy_url}/queue")

    def comfy_busy(self) -> bool:
        q = self.comfy_queue()
        running = q.get("queue_running") or []
        pending = q.get("queue_pending") or []
        return bool(running or pending)

    def comfy_free(self) -> dict[str, Any]:
        r = self.http.post(
            f"{self.cfg.comfy_url}/free",
            json={"unload_models": True, "free_memory": True},
        )
        if r.status_code >= 400:
            _raise_http(r, "Comfy /free failed")
        return {"ok": True}

    def wait_comfy_idle(self, timeout_s: float = 1800, poll_s: float = 2.0, should_stop: Any = None) -> None:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if should_stop and should_stop():
                raise BrainError(
                    409,
                    "stopped",
                    "Stopped from the UI",
                    "Resume to continue from this node.",
                )
            if not self.comfy_busy():
                return
            time.sleep(poll_s)
        raise BrainError(
            409,
            "comfy_busy",
            "Comfy already has work in the queue",
            "Wait for the current render, then resume. Brain will not clear the queue.",
        )

    def _post_when_idle(self, url: str, body: dict[str, Any], *, retries: int = 40, delay: float = 3.0) -> dict[str, Any]:
        last: BrainError | None = None
        for attempt in range(retries):
            try:
                return self._post(url, body)
            except BrainError as err:
                last = err
                if err.code != "comfy_busy" or attempt == retries - 1:
                    raise
                time.sleep(delay)
        raise last or BrainError(409, "comfy_busy", "Comfy already has work in the queue")

    def create_project(self, title: str, prompt: str = "", video_mode: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title, "prompt": prompt}
        if video_mode:
            body["videoMode"] = video_mode
        return self._post(f"{self.cfg.monitor_url}/api/studio/projects", body)

    def get_plan(self, project_id: str) -> dict[str, Any] | None:
        r = self.http.get(f"{self.cfg.monitor_url}/api/studio/plans/{project_id}")
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            _raise_http(r, "plan get failed")
        return r.json()

    def generate_plan(
        self,
        prompt: str,
        project_id: str | None = None,
        dry_run: bool = False,
        video_mode: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"prompt": prompt, "dryRun": dry_run}
        if project_id:
            body["projectId"] = project_id
        if video_mode:
            body["videoMode"] = video_mode
        return self._post(f"{self.cfg.monitor_url}/api/studio/plan", body)

    def board(self, project_id: str) -> dict[str, Any]:
        return self._get(f"{self.cfg.monitor_url}/api/episode-plans/{project_id}")

    def inventory(self) -> dict[str, Any]:
        return self._get(f"{self.cfg.monitor_url}/api/director/inventory")

    def queue_still(self, plan: dict[str, Any], **extra: Any) -> dict[str, Any]:
        body = {"plan": plan, "async": True, **extra}
        return self._post_when_idle(f"{self.cfg.monitor_url}/api/director/queue", body)

    def queue_video(self, source_image: str, plan: dict[str, Any], **extra: Any) -> dict[str, Any]:
        body = {"plan": plan, "async": True, "keepModels": True, **extra}
        if source_image:
            body["sourceImage"] = source_image
        return self._post_when_idle(f"{self.cfg.monitor_url}/api/director/video/run", body)

    def job(self, job_id: str) -> dict[str, Any]:
        return self._get(f"{self.cfg.monitor_url}/api/director/jobs/{job_id}")

    def wait_job(
        self,
        job_id: str,
        timeout_s: float = 900,
        poll_s: float = 2.0,
        should_stop: Any = None,
        find_output: Any = None,
    ) -> dict[str, Any]:
        deadline = time.time() + timeout_s
        last: dict[str, Any] = {}
        missing = 0
        while time.time() < deadline:
            if should_stop and should_stop():
                raise BrainError(
                    409,
                    "stopped",
                    "Stopped from the UI",
                    "Resume to continue from this node.",
                )
            found = find_output() if find_output else None
            if found:
                return {
                    "id": job_id,
                    "status": "success",
                    "result": {"generation": {"imagePath": found, "videoPath": found}},
                }
            try:
                payload = self.job(job_id)
                missing = 0
            except BrainError as err:
                if err.status != 404:
                    raise
                missing += 1
                if missing >= 4 and not self.comfy_busy():
                    raise BrainError(
                        404,
                        "job_not_found",
                        "The render job was lost (Monitor may have restarted)",
                        "Press Continue. If Comfy already wrote the file, it will be picked up.",
                    ) from err
                time.sleep(poll_s)
                continue
            last = payload.get("job") or payload
            status = last.get("status")
            if status == "success":
                return last
            if status == "error":
                raise BrainError(
                    502,
                    "director_job",
                    last.get("error") or "Render job failed",
                    "Check Comfy, then press Continue.",
                )
            time.sleep(poll_s)
        raise BrainError(
            504,
            "director_timeout",
            f"Render job {job_id} timed out",
            "Press Continue. The job may still finish on Comfy.",
        )


def still_path_from_job(job: dict[str, Any]) -> str | None:
    result = job.get("result") or {}
    gens = result.get("generations") or []
    if gens and gens[0].get("imagePath"):
        return str(gens[0]["imagePath"])
    gen = result.get("generation") or {}
    return gen.get("imagePath")


def video_path_from_job(job: dict[str, Any]) -> str | None:
    result = job.get("result") or {}
    gen = result.get("generation") or {}
    return gen.get("videoPath")
