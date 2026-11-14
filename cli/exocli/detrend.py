"""Remove slow stellar/instrument trends while preserving transits."""
from __future__ import annotations

import numpy as np
from numba import njit

from .data import LightCurve


@njit(cache=True)
def _biweight_location(x, c=5.0, n_iter=10):
    m = np.median(x)
    for _ in range(n_iter):
        mad = np.median(np.abs(x - m))
        if mad == 0.0:
            return m
        num = 0.0
        den = 0.0
        for v in x:
            u = (v - m) / (c * mad)
            if abs(u) < 1.0:
                w = (1.0 - u * u) ** 2
                num += w * (v - m)
                den += w
        if den == 0.0:
            return m
        step = num / den
        m += step
        if abs(step) < 1e-9:
            break
    return m


@njit(cache=True)
def _sliding_biweight(t, f, window, min_points):
    n = t.size
    out = np.full(n, np.nan)
    half = window / 2.0
    lo = 0
    hi = 0
    for i in range(n):
        while t[lo] < t[i] - half:
            lo += 1
        if hi < i:
            hi = i
        while hi < n and t[hi] <= t[i] + half:
            hi += 1
        if hi - lo >= min_points:
            out[i] = _biweight_location(f[lo:hi])
    return out


def detrend(lc: LightCurve, window_days: float = 1.5, min_points: int = 12) -> LightCurve:
    """Divide by a sliding robust (biweight) trend. The window should be about 3x the
    longest transit you want to keep: 1.5 d protects transits up to ~12 h."""
    trend = _sliding_biweight(lc.time.astype(np.float64), lc.flux.astype(np.float64),
                              float(window_days), int(min_points))
    ok = np.isfinite(trend) & (trend > 0)
    return LightCurve(lc.target, lc.mission, lc.time[ok], lc.flux[ok] / trend[ok],
                      lc.flux_err[ok] / trend[ok], lc.segment[ok])
