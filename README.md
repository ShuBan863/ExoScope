# ExoScope-cli

Command-line exoplanet transit search for Kepler (and, untested so far, TESS) light curves.
The original ExoScope browser tool, rebuilt as a batch tool that analyses the full mission
baseline instead of one quarter. Built by Shuban Langadi and Nafisur Rahman.

The browser app ([exoscope-rho.vercel.app](https://exoscope-rho.vercel.app)) now lives on the `web` branch (a mirror of nafisurr1/ExoScope). The previous
contents of `main` are preserved on the `archive-old-main` branch.

## What it does

    exocli fetch "KIC 11446443"        # download every quarter from MAST, stitch, cache to data/
    exocli search "KIC 11446443"       # detrend + Box Least Squares transit search
    exocli batch - --jobs 8 --out benchmark/results.jsonl < benchmark/targets.txt
    exocli score benchmark/results.jsonl --sample benchmark/sample.json --koi benchmark/koi_cumulative.csv
    python -m exocli.vet benchmark/results.jsonl --out benchmark/vetted.jsonl
python benchmark/classify.py          # cross-validated planet vs false-positive classifier

- fetch: pulls all long-cadence Kepler quarters (or TESS 2-minute sectors) through lightkurve,
  normalises each quarter separately, clips upward outliers only, and caches a compact .npz.
- search: sliding robust (biweight) detrend, then a BLS search over a period grid sized to the baseline.
  Returns up to 5 separate peaks, requires at least 3 observed transits, rejects peaks dominated by a
  single event, and masks harmonics.
- batch: parallel and resumable. Rerunning the same command skips stars already finished.
- score: checks whether the search found the catalogue period in NASA's KOI table.
- vet: measures secondary eclipse, odd/even depth, transit shape, uniqueness against other phases, and
  depth consistency across transits and quarters. These are the features for the planet vs false-positive classifier in `benchmark/classify.py` (random forest, cross-validated).

All commands read targets as `KIC <n>` or `TIC <n>`, from arguments or from stdin, and write JSON lines.

## Install

    python3 -m venv .venv && source .venv/bin/activate
    pip install --only-binary=:all: --no-binary=fbpca -r requirements.txt
    pip install -e .

## Status

Work in progress. On a 170-star labelled sample (85 confirmed planets, 85 false positives) the search recovered the catalogue period for 82 of the 85 confirmed planets.

A random forest on the vetting features gets about 90% accuracy (AUC 0.97) in 5-fold cross-validation on 165 of the 170 stars (85 planets, 80 false positives), against the browser model's reported 73.5% (not necessarily measured the same way). Search features alone give about 80%. The labels come from Kepler's own vetting, so part of this is reproducing those tests. Five false positives were left out: they were found at about 0.26 d with a transit covering over half the orbit, so there was no out-of-transit data to vet, and they look like contact binaries.

Known gap: the minimum search period is 0.25 days, so planets with shorter periods are missed. TESS support is implemented but untested.
