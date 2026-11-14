"""Box Least Squares transit search on a detrended light curve."""
from __future__ import annotations

import time as _time
from dataclasses import dataclass, asdict

import numpy as np
from astropy.timeseries import BoxLeastSquares
from scipy.ndimage import median_filter

from .data import LightCurve

# transit duration of a central transit across a Sun-like star: T ~ 0.0756 * P**(1/3) days
_T_COEFF = 0.0756


def period_grid(baseline: float, p_min: float, p_max: float, oversample: float = 3.0):
    """Frequency grid whose spacing keeps the transit phase error below a fraction of its
    duration over the whole baseline (uniform in f**(1/3), after Ofir 2014)."""
    step = _T_COEFF / (3.0 * baseline * oversample)
    a, b = (1.0 / p_max) ** (1 / 3), (1.0 / p_min) ** (1 / 3)
    x = np.arange(a, b, step)
    return 1.0 / x ** 3


@dataclass
class Candidate:
    period_d: float
    t0: float
    duration_hr: float
    depth_ppm: float
    depth_snr: float
    sde: float
    n_transits: int
    odd_even_diff_pct: float
    runtime_s: float
    rank: int = 1

    def to_dict(self):
        return {k: (round(v, 6) if isinstance(v, float) else v) for k, v in asdict(self).items()}


def sde(power: np.ndarray, kernel: int = 2001) -> float:
    """Signal detection efficiency of the strongest peak, after removing the slow
    rise of BLS power with period."""
    k = min(kernel, power.size // 2 * 2 - 1)
    resid = power - median_filter(power, size=k, mode="nearest")
    sd = np.std(resid)
    return float(resid.max() / sd) if sd > 0 else 0.0


def _resid(power: np.ndarray, kernel: int = 2001) -> np.ndarray:
    """BLS power with the slow rise over period removed, in units of its own std (SDE per bin)."""
    k = min(kernel, power.size // 2 * 2 - 1)
    r = power - median_filter(power, size=k, mode="nearest")
    sd = np.std(r)
    return r / sd if sd > 0 else r


class _Res:
    """Concatenated BLS output (only the fields search_top reads)."""
    def __init__(self, parts):
        for name in ("period", "power", "depth", "depth_snr", "duration", "transit_time"):
            setattr(self, name, np.concatenate([np.asarray(getattr(q, name)) for q in parts]))


_SHORT_DURATIONS = np.array([0.02, 0.035, 0.05, 0.075, 0.10, 0.15])


def _bls_power(bls, periods, durations):
    """astropy's BLS refuses to run if any trial duration is as long as the shortest period, so
    periods under 1 d get their own, shorter set of durations. With p_min >= 0.6 this is a single
    ordinary call, identical to before."""
    if durations.max() < periods.min():
        return bls.power(periods, durations, objective="likelihood")
    short = periods < 1.0
    parts = []
    if (~short).any():
        parts.append(bls.power(periods[~short], durations, objective="likelihood"))
    ds = _SHORT_DURATIONS[_SHORT_DURATIONS < 0.9 * periods[short].min()]
    if ds.size == 0:
        raise ValueError("minimum period is too short for this search")
    parts.append(bls.power(periods[short], ds, objective="likelihood"))
    return _Res(parts)


def search_top(lc: LightCurve, p_min: float = 0.25, p_max: float | None = None,
               oversample: float = 3.0, n_peaks: int = 5, min_transits: int = 3,
               max_single_frac: float = 0.5):
    """Up to n_peaks separate candidates, strongest first. A peak is skipped if it has fewer than
    min_transits observed transits or if one transit supplies more than max_single_frac of its
    likelihood. If the strongest peak is a single dominant event, that event is cut out of the
    data and the search is rerun (up to twice). Harmonics of accepted peaks are masked."""
    t_clock = _time.time()
    t = np.asarray(lc.time, float)
    f = np.asarray(lc.flux, float)
    e = np.asarray(lc.flux_err, float)
    baseline = lc.span_days
    if p_max is None:
        p_max = baseline / min_transits
    durations = np.array([0.04, 0.07, 0.10, 0.15, 0.20, 0.30])
    periods = period_grid(baseline, p_min, p_max, oversample)

    def _stats(bls, per, dur, t0):
        st = bls.compute_stats(per, dur, t0)
        cnt = np.asarray(st["per_transit_count"])
        ll = np.asarray(st["per_transit_log_likelihood"], float)
        llc = ll[cnt > 0]
        pos = llc[llc > 0]
        frac = float(llc.max() / pos.sum()) if pos.size else 1.0
        return st, int(np.sum(cnt > 0)), frac

    n_mask = 0
    while True:
        bls = BoxLeastSquares(t, f, dy=e)
        res = _bls_power(bls, periods, durations)
        z = _resid(res.power)
        i = int(np.argmax(z))
        per, dur, t0 = float(res.period[i]), float(res.duration[i]), float(res.transit_time[i])
        st, n_tr, frac = _stats(bls, per, dur, t0)
        if frac <= max_single_frac or n_tr < 1 or n_mask >= 2:
            break
        ll = np.asarray(st["per_transit_log_likelihood"], float)
        tc = float(np.asarray(st["transit_times"])[int(np.argmax(ll))])
        keep = np.abs(t - tc) > max(2.0 * dur, 0.3)
        t, f, e = t[keep], f[keep], e[keep]
        n_mask += 1

    work = z.copy()
    peaks, fallback = [], None
    for _ in range(40):
        if len(peaks) >= n_peaks:
            break
        i = int(np.argmax(work))
        if not np.isfinite(work[i]):
            break
        per, dur, t0 = float(res.period[i]), float(res.duration[i]), float(res.transit_time[i])
        for ratio in (1.0, 0.5, 2.0, 1 / 3, 3.0, 0.25, 4.0, 0.2, 5.0, 2 / 3, 1.5):
            c = per * ratio
            work[np.abs(res.period - c) < 0.01 * c] = -np.inf
        st, n_tr, frac = _stats(bls, per, dur, t0)
        d_odd, d_even = st["depth_odd"], st["depth_even"]
        md = (d_odd[0] + d_even[0]) / 2.0
        oe = 100.0 * abs(d_odd[0] - d_even[0]) / md if md > 0 else float("inf")
        cand = Candidate(per, t0, dur * 24.0, float(res.depth[i]) * 1e6,
                         float(res.depth_snr[i]), float(z[i]), n_tr, float(oe), 0.0)
        if fallback is None:
            fallback = cand
        if n_tr >= min_transits and frac <= max_single_frac:
            cand.rank = len(peaks) + 1
            peaks.append(cand)
    if not peaks and fallback is not None:
        peaks = [fallback]
    rt = _time.time() - t_clock
    for c in peaks:
        c.runtime_s = rt
    return peaks


def search(lc: LightCurve, p_min: float = 0.25, p_max: float | None = None,
           oversample: float = 3.0) -> Candidate:
    return search_top(lc, p_min, p_max, oversample, n_peaks=1)[0]
