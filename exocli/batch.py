"""Parallel, resumable batch runner: fetch -> detrend -> search for many targets."""
from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from .fetch import parse_target


def _work(target, data_dir, cache_dir, window, min_period, max_period):
    os.environ["OMP_NUM_THREADS"] = "1"
    try:
        from .detrend import detrend
        from .fetch import fetch_target
        from .search import search_top
        lc = fetch_target(target, Path(data_dir), Path(cache_dir))
        flat = detrend(lc, window_days=window)
        peaks = search_top(flat, p_min=min_period, p_max=max_period, n_peaks=5)
        return {"target": lc.target, **peaks[0].to_dict(),
                "peaks": [c.to_dict() for c in peaks]}
    except Exception as exc:
        return {"target": target, "error": f"{type(exc).__name__}: {exc}"}


def _already_done(out_path):
    done = set()
    if out_path and Path(out_path).exists():
        for line in Path(out_path).read_text().splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if "error" not in rec:
                done.add(rec["target"])
    return done


def run_batch(targets, data_dir, cache_dir, jobs, out_path=None,
              window=1.5, min_period=0.25, max_period=None) -> int:
    done = _already_done(out_path)
    todo, seen, failed = [], set(), 0
    for t in targets:
        try:
            canon = parse_target(t)[2]
        except ValueError as exc:
            failed += 1
            print(json.dumps({"target": t, "error": f"ValueError: {exc}"}), flush=True)
            continue
        if canon not in done and canon not in seen:
            seen.add(canon)
            todo.append(canon)
    print(f"{len(todo)} to run, {len(done)} already done, {jobs} workers", file=sys.stderr, flush=True)
    if not todo:
        return 1 if failed else 0

    # compile the numba detrender once here so workers just load the cache
    import numpy as np
    from .detrend import _sliding_biweight
    _sliding_biweight(np.arange(20.0), np.ones(20), 1.0, 3)

    out = open(out_path, "a") if out_path else None
    t0, n_done = time.time(), 0
    pool = ProcessPoolExecutor(max_workers=jobs)
    try:
        futs = [pool.submit(_work, t, str(data_dir), str(cache_dir), window, min_period, max_period)
                for t in todo]
        for fut in as_completed(futs):
            rec = fut.result()
            n_done += 1
            if "error" in rec:
                failed += 1
            line = json.dumps(rec)
            print(line, flush=True)
            if out:
                out.write(line + "\n")
                out.flush()
            el = time.time() - t0
            eta = el / n_done * (len(todo) - n_done)
            print(f"[{n_done}/{len(todo)}] {rec['target']}  elapsed {el/60:.1f} min, ~{eta/60:.1f} min left",
                  file=sys.stderr, flush=True)
    except KeyboardInterrupt:
        print("interrupted; finished stars are saved, rerun the same command to resume",
              file=sys.stderr, flush=True)
        pool.shutdown(wait=False, cancel_futures=True)
        return 130
    finally:
        if out:
            out.close()
    pool.shutdown()
    return 1 if failed else 0
