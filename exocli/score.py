"""Score batch results against NASA's KOI table: did the search find the catalog period?"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from statistics import median


def _load_koi(path):
    by_star = defaultdict(list)
    with open(path, newline="") as f:
        rows = (ln for ln in f if not ln.startswith("#"))
        for r in csv.DictReader(rows):
            try:
                by_star[r["kepid"].strip()].append(
                    (r["koi_disposition"].strip(), float(r["koi_period"])))
            except (ValueError, KeyError):
                continue
    return by_star


def _match(found, cat, tol=0.01):
    for ratio, name in ((1.0, "exact"), (2.0, "2x"), (0.5, "half")):
        if abs(found - ratio * cat) <= tol * ratio * cat:
            return name
    return None


def run_score(results_path, sample_path, koi_path) -> int:
    koi = _load_koi(koi_path)
    sample = {s["kepid"]: s["label"] for s in json.load(open(sample_path))}
    res = {}
    for line in open(results_path):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if "error" not in r:
            res[r["target"].split()[-1]] = r

    stats = {1: defaultdict(list), 0: defaultdict(list)}
    missing = {1: 0, 0: 0}
    topn = {1: 0, 0: 0}
    misses = []
    for kepid, label in sample.items():
        r = res.get(kepid)
        if r is None:
            missing[label] += 1
            continue
        def _kind(per):
            best = None
            for _disp, cat in koi.get(kepid, []):
                m = _match(per, cat)
                if m == "exact" or (m and best is None):
                    best = m
            return best or "none"
        peaks = r.get("peaks") or [r]
        kind = _kind(peaks[0]["period_d"])
        if any(_kind(pk["period_d"]) == "exact" for pk in peaks):
            topn[label] += 1
        stats[label][kind].append(r)
        stats[label]["all"].append(r)
        if kind == "none" and label == 1:
            misses.append((kepid, r["period_d"], [round(c, 3) for _d, c in koi.get(kepid, [])], r["sde"]))

    names = {1: "confirmed planets", 0: "false positives"}
    for label in (1, 0):
        allr = stats[label]["all"]
        n = len(allr)
        print(f"\n{names[label]}: {n} searched ({missing[label]} not run/failed)")
        if not n:
            continue
        for kind in ("exact", "2x", "half", "none"):
            k = len(stats[label][kind])
            print(f"  catalog period {kind:>5}: {k:3d}  ({100*k/n:4.1f}%)")
        print(f"  exact match in any top peak: {topn[label]:3d}  ({100*topn[label]/n:4.1f}%)")
        print(f"  median SDE {median(r['sde'] for r in allr):.1f}   "
              f"median depth_snr {median(r['depth_snr'] for r in allr):.1f}   "
              f"median transits {median(r['n_transits'] for r in allr):.0f}")
    if misses:
        print("\nconfirmed planets whose catalog period we did not find (first 10):")
        for kepid, found, cats, s in misses[:10]:
            print(f"  KIC {kepid}: found {found:.4f} d (SDE {s:.1f}), catalog {cats}")
    return 0
