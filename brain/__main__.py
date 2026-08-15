"""CLI: python -m brain start|resume|status"""

from __future__ import annotations

import argparse
import json
import sys

from .config import load_config
from .graph import empty_state, resume, run, stop_process
from .studio import BrainError, Studio


def _print(state: dict) -> None:
    clips = state.get("clips") or []
    summary = {
        "status": state.get("status"),
        "project_id": state.get("project_id"),
        "look_track": state.get("look_track"),
        "clip_count": len(clips),
        "stills": len(state.get("still_paths") or {}),
        "videos": len(state.get("video_paths") or {}),
        "review_ok": state.get("review_ok"),
        "last_error": state.get("last_error") or None,
    }
    print(json.dumps(summary, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="brain", description="Qorlith Brain — stills-first control room")
    sub = parser.add_subparsers(dest="cmd", required=True)

    start = sub.add_parser("start", help="health → plan → stills → wait for board")
    start.add_argument("--project", dest="project_id", default="")
    start.add_argument("--title", default="")
    start.add_argument("--prompt", default="")
    start.add_argument("--stop-after", choices=["plan", "stills"], default="stills")
    start.add_argument("--quality", choices=["draft", "standard", "hero"], default="standard")
    start.add_argument("--dry-run", action="store_true")
    start.add_argument("--no-persist", action="store_true")

    go = sub.add_parser("resume", help="continue a thread after board review")
    go.add_argument("--thread", required=True)
    go.add_argument("--review-ok", action="store_true")
    go.add_argument("--stop-after", choices=["plan", "stills", "video"], default=None)

    st = sub.add_parser("status", help="print the last checkpoint")
    st.add_argument("--thread", required=True)

    halt = sub.add_parser("stop", help="stop a running brain process")
    halt.add_argument("--thread", required=True)

    args = parser.parse_args(argv)
    cfg = load_config()
    studio = Studio(cfg)
    try:
        if args.cmd == "start":
            state = empty_state(
                project_id=args.project_id,
                title=args.title,
                prompt=args.prompt,
                stop_after=args.stop_after,
                quality=args.quality,
                dry_run=args.dry_run,
                thread_id=args.project_id or "",
            )
            out = run(studio, state, persist=not args.no_persist)
            _print(out)
            return 1 if out.get("status") == "fail" else 0
        if args.cmd == "resume":
            out = resume(studio, args.thread, review_ok=True if args.review_ok else None, stop_after=args.stop_after)
            _print(out)
            return 1 if out.get("status") == "fail" else 0
        if args.cmd == "status":
            from .graph import build_graph, sqlite_saver

            app = build_graph(studio, cfg, checkpointer=sqlite_saver(cfg.checkpoint_path))
            snap = app.get_state({"configurable": {"thread_id": args.thread}})
            if not snap.values:
                print(json.dumps({"error": "no checkpoint", "thread": args.thread}))
                return 1
            _print(dict(snap.values))
            return 0
        if args.cmd == "stop":
            print(json.dumps(stop_process(cfg, args.thread), indent=2))
            return 0
    except BrainError as err:
        print(json.dumps(err.as_dict(), indent=2), file=sys.stderr)
        return 2
    finally:
        studio.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
