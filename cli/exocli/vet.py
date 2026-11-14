"""Vetting: extra features that help separate planets from false positives, measured on
the detrended light curve at the period the search found. Run with:
    python -m exocli.vet results.jsonl --out vetted.jsonl
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

from .data import LightCurve
from .detrend import detrend
from .fetch import parse_target

_T_COEFF = 0.0756   # central-transit duration of a Sun-like star: T ~ 0.0756 * P**(1/3) days


def _mad_sigma(x):
    return 1.4826 * float(np.median(np.abs(x - np.median(x))))


def _clean(d):
    out = {}
    for k, v in d.items():
        if isinstance(v, (float, np.floating)):
            out[k] = round(float(v), 6) if np.isfinite(v) else None
        else:
            out[k] = v
    return out


def _consistency(ids, flux, sig, min_pts):
    """Per-group transit depths and a reduced chi-square about their weighted mean."""
    u, inv = np.unique(ids, return_inverse=True)
    cnt = np.bincount(inv)
    sm = np.bincount(inv, weights=flux)
    ok = cnt >= min_pts
    k = int(ok.sum())
    if k < 3:
        return k, np.nan, np.nan
    dk = 1.0 - sm[ok] / cnt[ok]
    ek = sig / np.sqrt(cnt[ok])
    w = 1.0 / ek ** 2
    dbar = np.sum(w * dk) / np.sum(w)
    chi2 = float(np.sum(((dk - dbar) / ek) ** 2) / (k - 1))
    med = float(np.median(dk))
    cv = 1.4826 * float(np.median(np.abs(dk - med))) / med if med > 0 else np.nan
    return k, chi2, cv


def vet_curve(flat: LightCurve, period: float, t0: float, dur_d: float) -> dict:
    t, f, seg = flat.time, flat.flux, flat.segment
    ph = (t - t0) / period
    epoch = np.floor(ph + 0.5)
    xd = (ph - epoch) * period                  # days from mid-transit, in [-P/2, P/2)
    oot = np.abs(xd) > dur_d
    if oot.sum() < 20:
        return {"vet_error": "no out-of-transit data"}
    sig = _mad_sigma(f[oot])
    prim = np.abs(xd) < dur_d / 2
    n_in = int(prim.sum())
    if n_in < 3 or sig <= 0:
        return {"vet_error": "too few in-transit points"}

    def depth(mask):
        n = int(mask.sum())
        if n < 3:
            return np.nan, np.nan
        return 1.0 - float(np.mean(f[mask])), sig / math.sqrt(n)

    d0, e0 = depth(prim)
    out = {"vet_depth_ppm": d0 * 1e6, "vet_snr": d0 / e0, "n_in_transit_pts": n_in,
           "noise_ppm": sig * 1e6}

    # transit shape: central third vs whole duration (box ~1.0, V-shape ~1.7)
    dc, _ = depth(np.abs(xd) < dur_d / 6)
    out["shape_ratio"] = dc / d0 if d0 > 0 else np.nan
    out["dur_ratio"] = dur_d / (_T_COEFF * period ** (1.0 / 3.0))

    # secondary eclipse at phase 0.5
    if dur_d < 0.4 * period:
        xs = np.abs(((ph % 1.0) - 0.5) * period)
        ds, es = depth(xs < dur_d / 2)
        out["secondary_depth_ppm"] = ds * 1e6
        out["secondary_snr"] = ds / es
        out["secondary_ratio"] = ds / d0 if d0 > 0 else np.nan

    # does the primary stand out from every other phase? (model-shift style uniqueness)
    order = np.argsort(xd)
    xs_sorted = xd[order]
    cs = np.concatenate(([0.0], np.cumsum(f[order])))
    centers = np.arange(-period / 2 + dur_d / 2, period / 2 - dur_d / 2 + 1e-12, dur_d / 2)
    centers = centers[np.abs(centers) >= dur_d]
    if centers.size >= 6:
        lo = np.searchsorted(xs_sorted, centers - dur_d / 2)
        hi = np.searchsorted(xs_sorted, centers + dur_d / 2)
        n = hi - lo
        med_n = np.median(n[n > 0]) if (n > 0).any() else 0
        good = n >= max(3, 0.3 * med_n)
        if good.sum() >= 6:
            dw = 1.0 - (cs[hi[good]] - cs[lo[good]]) / n[good]
            ew = sig / np.sqrt(n[good])
            other_max = float(dw.max())
            out["uniqueness"] = min(d0 / max(other_max, 1e-9), 1000.0)
            out["other_max_snr"] = float((dw / ew).max())
            out["red_noise"] = float(np.std(dw) / np.median(ew))

    # odd vs even transits
    do, eo = depth(prim & (epoch % 2 == 1))
    de, ee = depth(prim & (epoch % 2 == 0))
    if np.isfinite(do) and np.isfinite(de):
        mean = (do + de) / 2.0
        out["odd_even_pct"] = 100.0 * abs(do - de) / mean if mean > 0 else np.nan
        out["odd_even_sigma"] = abs(do - de) / math.hypot(eo, ee)

    # transit-to-transit and quarter-to-quarter depth consistency
    k, chi2, _ = _consistency(epoch[prim].astype(np.int64), f[prim], sig, 3)
    out["n_epochs"] = k
    out["epoch_chi2"] = chi2
    kq, chi2q, cvq = _consistency(seg[prim], f[prim], sig, 5)
    out["n_quarters"] = kq
    out["quarter_chi2"] = chi2q
    out["quarter_cv"] = cvq
    return _clean(out)


def load_records(path):
    last = {}
    for line in open(path):
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if "error" not in rec:
            last[rec["target"]] = rec
    return last


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m exocli.vet")
    ap.add_argument("results", help="results .jsonl from exocli batch")
    ap.add_argument("--out", help="write vetted rows here (default: stdout)")
    ap.add_argument("--window", type=float, default=1.5, help="detrend window in days")
    args = ap.parse_args(argv)
    data_dir = Path(__file__).resolve().parent.parent / "data"
    recs = load_records(args.results)
    out = open(args.out, "w") if args.out else sys.stdout
    keep = ("period_d", "t0", "duration_hr", "depth_ppm", "depth_snr", "sde",
            "n_transits", "odd_even_diff_pct")
    for i, (target, rec) in enumerate(recs.items(), 1):
        try:
            mission, num, _ = parse_target(target)
            lc = LightCurve.load(data_dir / f"{mission.lower()}_{num}.npz")
            flat = detrend(lc, window_days=args.window)
            v = vet_curve(flat, rec["period_d"], rec["t0"], rec["duration_hr"] / 24.0)
            row = {"target": target, **{k: rec[k] for k in keep if k in rec}, **v}
        except Exception as exc:
            row = {"target": target, "vet_error": f"{type(exc).__name__}: {exc}"}
        print(json.dumps(row), file=out, flush=True)
        print(f"[{i}/{len(recs)}] {target}", file=sys.stderr, flush=True)
    if args.out:
        out.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
