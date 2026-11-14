"""exocli command line. Results are JSON lines on stdout, progress/errors on stderr."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .fetch import fetch_target

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CACHE_DIR = ROOT / ".cache"


def _read_targets(args_targets):
    if args_targets and args_targets != ["-"]:
        return args_targets
    lines = (ln.strip() for ln in sys.stdin)
    return [ln for ln in lines if ln and not ln.startswith("#")]


def cmd_fetch(args) -> int:
    failed = 0
    for t in _read_targets(args.targets):
        try:
            lc = fetch_target(t, DATA_DIR, CACHE_DIR, force=args.force)
            print(json.dumps({
                "target": lc.target, "mission": lc.mission,
                "segments": lc.n_segments, "points": lc.n_points,
                "span_days": round(lc.span_days, 1),
                "cadence_min": round(lc.cadence_minutes, 2),
            }), flush=True)
        except Exception as exc:  # keep going so one bad ID doesn't kill a batch
            failed += 1
            print(json.dumps({"target": t, "error": f"{type(exc).__name__}: {exc}"}), flush=True)
    return 1 if failed else 0


def cmd_search(args) -> int:
    from .detrend import detrend
    from .search import search
    failed = 0
    for t in _read_targets(args.targets):
        try:
            lc = fetch_target(t, DATA_DIR, CACHE_DIR)
            flat = detrend(lc, window_days=args.window)
            cand = search(flat, p_min=args.min_period, p_max=args.max_period)
            print(json.dumps({"target": lc.target, **cand.to_dict()}), flush=True)
        except Exception as exc:
            failed += 1
            print(json.dumps({"target": t, "error": f"{type(exc).__name__}: {exc}"}), flush=True)
    return 1 if failed else 0


def cmd_batch(args) -> int:
    from .batch import run_batch
    import os
    jobs = args.jobs or max(1, min(8, (os.cpu_count() or 2) // 2))
    out = Path(args.out) if args.out else None
    return run_batch(_read_targets(args.targets), DATA_DIR, CACHE_DIR, jobs, out,
                     window=args.window, min_period=args.min_period, max_period=args.max_period)


def cmd_score(args) -> int:
    from .score import run_score
    return run_score(args.results, args.sample, args.koi)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="exocli", description="Kepler/TESS transit search")
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="download and stitch light curves")
    f.add_argument("targets", nargs="*", help="KIC/TIC IDs; omit or '-' to read from stdin")
    f.add_argument("--force", action="store_true", help="re-download even if cached")
    f.set_defaults(func=cmd_fetch)
    s = sub.add_parser("search", help="detrend and run a BLS transit search")
    s.add_argument("targets", nargs="*", help="KIC/TIC IDs; omit or '-' to read from stdin")
    s.add_argument("--window", type=float, default=1.5, help="detrend window in days")
    s.add_argument("--min-period", type=float, default=0.25)
    s.add_argument("--max-period", type=float, default=None)
    s.set_defaults(func=cmd_search)
    b = sub.add_parser("batch", help="run fetch+detrend+search on many targets in parallel (resumable)")
    b.add_argument("targets", nargs="*", help="KIC/TIC IDs; omit or '-' to read from stdin")
    b.add_argument("--jobs", type=int, default=0, help="worker processes (default: half your cores, max 8)")
    b.add_argument("--out", help="append results to this .jsonl file; reruns skip finished targets")
    b.add_argument("--window", type=float, default=1.5)
    b.add_argument("--min-period", type=float, default=0.25)
    b.add_argument("--max-period", type=float, default=None)
    b.set_defaults(func=cmd_batch)
    sc = sub.add_parser("score", help="score batch results against the KOI table")
    sc.add_argument("results", help="results .jsonl from exocli batch")
    sc.add_argument("--sample", required=True, help="benchmark sample.json")
    sc.add_argument("--koi", required=True, help="koi_cumulative.csv")
    sc.set_defaults(func=cmd_score)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
