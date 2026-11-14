"""Target parsing and MAST download (the only module that touches the network)."""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from .data import LightCurve, Segment, stitch

_TARGET_RE = re.compile(r"^\s*(kic|tic)[\s_-]*(\d+)\s*$", re.I)


def parse_target(text: str):
    """'KIC 8462852' / 'kic8462852' / 'TIC 261136679' -> (mission, id, canonical)."""
    m = _TARGET_RE.match(text)
    if not m:
        raise ValueError(f"unrecognised target {text!r} (use 'KIC <n>' or 'TIC <n>')")
    kind, num = m.group(1).upper(), str(int(m.group(2)))
    mission = "Kepler" if kind == "KIC" else "TESS"
    return mission, num, f"{kind} {num}"


def _arr(q) -> np.ndarray:
    a = getattr(q, "value", q)
    return np.ma.filled(np.ma.asarray(a, dtype=float), np.nan)


def download_segments(canonical: str, mission: str, cache_dir: Path):
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning)
    import lightkurve as lk

    if mission == "Kepler":
        sr = lk.search_lightcurve(canonical, mission="Kepler", author="Kepler", cadence="long")
        key = "QUARTER"
    else:
        sr = lk.search_lightcurve(canonical, mission="TESS", author="SPOC", exptime=120)
        key = "SECTOR"
    if len(sr) == 0:
        raise LookupError(f"no {mission} light curves found for {canonical}")
    coll = sr.download_all(quality_bitmask="default", download_dir=str(cache_dir))
    if coll is None or len(coll) == 0:
        raise LookupError(f"download returned nothing for {canonical}")
    segs = []
    for i, lc in enumerate(coll):
        label = lc.meta.get(key)
        segs.append(Segment(_arr(lc.time), _arr(lc.flux), _arr(lc.flux_err),
                            int(label) if label is not None else i))
    return segs


def fetch_target(text: str, data_dir: Path, cache_dir: Path, force: bool = False) -> LightCurve:
    mission, num, canonical = parse_target(text)
    path = Path(data_dir) / f"{mission.lower()}_{num}.npz"
    if path.exists() and not force:
        return LightCurve.load(path)
    segs = download_segments(canonical, mission, Path(cache_dir))
    lc = stitch(segs, canonical, mission)
    lc.save(path)
    return lc
