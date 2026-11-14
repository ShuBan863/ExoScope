"""Pure-numpy light curve container and stitching. No network, no lightkurve."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Segment:
    """One quarter (Kepler) or sector (TESS) of raw flux."""
    time: np.ndarray
    flux: np.ndarray
    flux_err: np.ndarray
    label: int


@dataclass
class LightCurve:
    target: str
    mission: str
    time: np.ndarray
    flux: np.ndarray        # normalised, median ~ 1
    flux_err: np.ndarray
    segment: np.ndarray     # quarter/sector label for every point

    @property
    def n_points(self) -> int:
        return int(self.time.size)

    @property
    def span_days(self) -> float:
        return float(self.time[-1] - self.time[0]) if self.n_points else 0.0

    @property
    def cadence_minutes(self) -> float:
        return float(np.median(np.diff(self.time)) * 1440.0) if self.n_points > 1 else 0.0

    @property
    def n_segments(self) -> int:
        return int(np.unique(self.segment).size)

    def save(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            path, target=self.target, mission=self.mission, time=self.time,
            flux=self.flux, flux_err=self.flux_err, segment=self.segment,
        )

    @classmethod
    def load(cls, path: Path) -> "LightCurve":
        z = np.load(Path(path), allow_pickle=False)
        return cls(str(z["target"]), str(z["mission"]), z["time"], z["flux"],
                   z["flux_err"], z["segment"])


def normalize_segment(seg: Segment, min_points: int = 50):
    """Drop non-finite points and divide by the segment median.
    Returns (time, flux, err) arrays, or None if the segment is unusable."""
    ok = np.isfinite(seg.time) & np.isfinite(seg.flux) & np.isfinite(seg.flux_err)
    if ok.sum() < min_points:
        return None
    t, f, e = seg.time[ok], seg.flux[ok], seg.flux_err[ok]
    med = np.median(f)
    if not np.isfinite(med) or med <= 0:
        return None
    return t, f / med, e / med


def upward_clip_mask(flux: np.ndarray, sigma: float = 4.0) -> np.ndarray:
    """True for points to keep. Clips only upward outliers (flares, cosmic rays),
    never downward ones, because transits are downward."""
    med = np.median(flux)
    scale = 1.4826 * np.median(np.abs(flux - med))
    if scale == 0:
        return np.ones(flux.shape, dtype=bool)
    return flux <= med + sigma * scale


def stitch(segments, target: str, mission: str, clip_sigma: float = 4.0) -> LightCurve:
    """Normalise each quarter/sector separately, join, sort by time, clip upward outliers."""
    ts, fs, es, ls = [], [], [], []
    for seg in segments:
        out = normalize_segment(seg)
        if out is None:
            continue
        t, f, e = out
        ts.append(t); fs.append(f); es.append(e)
        ls.append(np.full(t.shape, seg.label, dtype=np.int32))
    if not ts:
        raise ValueError("no usable data in any quarter/sector")
    t = np.concatenate(ts); f = np.concatenate(fs)
    e = np.concatenate(es); l = np.concatenate(ls)
    order = np.argsort(t, kind="stable")
    t, f, e, l = t[order], f[order], e[order], l[order]
    keep = upward_clip_mask(f, clip_sigma)
    return LightCurve(target, mission, t[keep], f[keep], e[keep], l[keep])
