# ExoScope — Architecture

How the code actually works, mapped to real files and line numbers.

This document describes **what is in the repository**, verified by running it.
Where a behaviour is wrong or a claim is unproven, it says so. If this file ever
disagrees with the code, the code wins — fix this file.

---

## What it does

A telescope records how bright a star is, over and over, for months. That
recording is a **light curve**. If a planet orbits the star and its orbit is
edge-on from our viewpoint, the planet passes in front of the star and the
brightness dips by a fraction of a percent for a few hours, then repeats every
orbit. That repeating dip is a **transit**.

ExoScope takes a Kepler light curve file, searches it for a repeating dip,
and estimates whether that dip looks like a planet. Everything runs in the
browser — the FITS file is never uploaded anywhere.

---

## Pipeline

```mermaid
flowchart TD
    A["FITS file<br/>(upload / example / MAST)"] --> B["parseFitsFile()<br/>fitsParser.ts:3"]
    B --> C["ParsedFitsData<br/>TIME + FLUX columns, header cards"]
    C --> D["extractFeatures()<br/>exoplanetFeatures.ts:134"]
    D --> D1["normalise + sliding-median detrend<br/>:165-192"]
    D1 --> D2["runBLS() — brute-force transit search<br/>:57"]
    D2 --> E["ExoplanetFeatures<br/>13 model inputs + 6 display values"]
    E --> F["runPrediction()<br/>exoplanetModel.ts:104"]
    F --> F1["buildFeatureVector() → Float32Array[13]<br/>:35"]
    F1 --> F2["ONNX RandomForest → P(planet)<br/>:104-120"]
    F2 --> G["combineSignals()<br/>0.6·SNR + 0.4·ML, cutoff 0.45<br/>:89"]
    G --> H["ExoplanetResult.tsx:214<br/>verdict + reasoning"]
    C --> I["LightCurveChart.tsx:73<br/>LTTB-downsampled plot"]
    C --> J["MetadataViewer.tsx:10<br/>FITS header display"]
```

Orchestration is `handleDataLoaded` in [`App.tsx:410`](App.tsx). All three entry
points — upload, example buttons, archive search — call it with the same
`ParsedFitsData`.

---

## Step 1 — Read the FITS file

**`utils/fitsParser.ts`** (311 lines)

FITS is a 1980s astronomy container format: fixed 2880-byte blocks, an ASCII
header of 80-character "cards", then a binary table.

| Function | Line | Does |
|---|---|---|
| `parseFitsFile` | 3 | Walks HDUs until it finds the `BINTABLE` extension |
| `parseHeaderUnit` | 94 | Reads 80-char cards, handles `''` quote escaping |
| `parseColumnDefinitions` | 202 | Reads `TFORM`/`TTYPE`, computes byte offsets |
| `readBinaryTable` | 269 | Big-endian reads of each column, `NaN` → `null` |

Numbers are big-endian (`getFloat64(pos, false)`). Kepler marks bad cadences as
`NaN`, which becomes `null` and is filtered downstream.

**Verified working.** Parsing a real `kplr002445129-2009166043257_llc.fits`
downloaded live from MAST reads all 20 columns in ~2 ms, and the stellar values
it pulls from the header (`TEFF=5927`, `RADIUS=1.06`) match the NASA catalog
entry for that star exactly.

Caveats: `TSCALn`/`TZEROn` column scaling is not applied (Kepler light curves
don't use it); columns with `TFORM` repeat > 1 are skipped but still counted for
byte alignment; there's no check that the file starts with `SIMPLE  =`, so a
non-FITS upload produces a confusing error rather than a clear one.

---

## Step 2 — Clean up the brightness data

**`utils/exoplanetFeatures.ts:134-202`** (`extractFeatures`)

1. Keep rows where TIME and FLUX are both present and flux > 0 (`:143-151`)
2. Sort by time (`:153-155`)
3. Divide by the median so out-of-transit sits at 1.0 (`:165-167`)
4. Downsample to at most 15,000 points (`MAX_PTS`, `:172`)
5. **Detrend** with a sliding median over a 0.75-day window (`:179-192`)
6. Clip points more than 4σ from 1.0 (`:194-202`)

Step 5 is the important one. Stars are intrinsically variable — spots and
rotation cause slow brightness swings much larger than a transit. Dividing by a
local median over a window *longer than a transit but shorter than stellar
rotation* flattens the slow variation while leaving the sharp dip intact.

Tradeoff: transits longer than about 9 hours start contaminating their own
median window, which suppresses the measured depth.

---

## Step 3 — Search for a repeating dip (BLS)

**`utils/exoplanetFeatures.ts:57-190`** (`runBLS`)

A transit is defined by three unknowns that must be found *together*:
**period** (how often), **duration** (how long), **epoch** (when it happens).
BLS — Box Least Squares — searches combinations of all three, scoring each by
how much dimmer the in-transit points are than the rest:

```
depth = mean(out) − mean(in)
power = depth · √(N_in) / σ
```

Rather than rescan every data point for every trial, the search folds the light
curve into `N_BINS = 400` phase bins once per trial period, then evaluates every
(duration, epoch) pair against those bins using prefix sums — O(1) per pair.
Bins are duplicated end-to-end before the prefix pass so a transit straddling
phase 1.0 → 0.0 is still one contiguous slice, with no branch in the hot loop.

Three passes:

| Pass | Trials | Purpose |
|---|---|---|
| 1. Coarse | 500 log-spaced periods, 0.3 d → min(baseline × 0.49, 500 d) | Locate the neighbourhood |
| 2. Refine | 50–400 periods in a ±3% window | Pin the period precisely |
| 3. Sub-harmonic | P/2 and P/3, each refined | Reject 2:1 and 3:1 aliases |

Pass 2 exists because the coarse grid alone lands ~1% off, and small period
errors compound: on KIC 3115833 a 0.0195 d offset accumulates to 1.16× the
transit duration across 8.7 orbits, smearing the transits out of the window.
The step size is chosen so drift over the full baseline stays under 10% of one
transit duration.

Pass 3 exists because a real transit at period P also produces power at 2P and
3P — folding at a multiple still stacks a subset of transits coherently — and a
coarse grid actively *favours* the alias, since longer periods fit fewer cycles
into the baseline and so accumulate less drift from grid error. Without this
pass the search reports 20.360 d for KIC 3115833, exactly twice the truth. A
genuinely long-period planet is unaffected: no transits exist at the halved
spacing, so the sub-harmonic simply scores worse and loses.

Measured on the bundled `KIC 3115833` example (true period 10.1816 d):

| | Period found | SNR | Search time |
|---|---|---|---|
| Previous 1000 × 12 × 20 scan | 7.99 d | 4.80 | 8,689 ms |
| Current binned search | **10.1808 d** | **10.60** | **107 ms** |

`DUR_FRACS`, the minimum point counts (≥3 in, ≥10 out), and the `power` formula
are unchanged from the previous implementation — `combineSignals` hardcodes
SNR 8 as marginal and 15 as strong, so the output scale had to be preserved.

---

## Step 4 — Classify

**`utils/exoplanetModel.ts`** (153 lines)

`buildFeatureVector` (`:35`) packs 13 numbers, in this exact order:

```
0  period_days          4  stellar_logg          8  log_depth
1  transit_depth_ppm    5  stellar_radius_rsun   9  log_period
2  transit_duration_hr  6  depth_per_hr         10  log_duration
3  stellar_teff_k       7  duty_cycle           11  depth × logg
                                                12  period ÷ stellar_radius
```

Stellar values come from the FITS header (`TEFF`, `LOGG`, `RADIUS`), falling
back to solar values (5778 K, 4.44, 1.0) when absent — `:158-160` of
`exoplanetFeatures.ts`. The two bundled example files have these keys stripped,
so they run on solar defaults.

### What the model actually is

Verified by parsing `public/model/exoscope_model.onnx` directly:

| Property | Value |
|---|---|
| Graph | `Imputer → Scaler → TreeEnsembleClassifier` |
| Algorithm | **RandomForest** (`post_transform=NONE`, leaf weights are multiples of 1/150) |
| Trees | **150** |
| Inputs | 13 float32 |
| Outputs | `label`, `probabilities` (shape `[N,2]`) |
| Exported by | skl2onnx 1.20.0 |

Trained on **7,586 rows** of `ml/koi_cumulative.csv` — every entry dispositioned
`CONFIRMED` (2,747) or `FALSE POSITIVE` (4,839); `CANDIDATE` rows are excluded.
Confirmed by comparing the ONNX `Scaler` offsets against column means computed
from that CSV: `koi_period` 51.65589, `koi_duration` 5.71288, `duty_cycle`
0.04789 — matching to five decimal places.

> **`ml/train_model.py` does not reproduce this model.** It builds 10 features
> and a `GradientBoostingClassifier`; the shipped model has 13 features and is a
> 150-tree RandomForest. The script that produced `exoscope_model.onnx` is not in
> the repository. Retraining requires reconstructing it first.

> `ml/feature_config.json` and `public/model/feature_config.json` are **not read
> by the application**. Their `threshold: 0.25` has no effect; the live cutoff is
> 0.45 in `combineSignals`.

---

## Step 5 — Decide

**`utils/exoplanetModel.ts:89-101`** (`combineSignals`)

```
snrScore = 1 / (1 + e^(−(SNR − 8) / 2))     // squash SNR into 0–1
combined = 0.60 · snrScore + 0.40 · mlProb
verdict  = combined ≥ 0.45
```

Because the ML term spans at most 0.40 of the range, it cannot always affect
the outcome:

| BLS SNR | Effect of the ML score |
|---|---|
| < 3.2 | none — always "no planet" |
| 3.2 – 10.2 | decisive |
| > 10.2 | none — always "planet" |

The `PredictionResult` fields are **misnamed**: `rfConfidence` holds the BLS
`snrScore` and `gbConfidence` holds the ML probability (`:147-148`). The UI
labels them correctly ("BLS + Physics" / "ML Score"), but the field names are
left over from an earlier two-model design.

`overridden` / `overrideReason` are always `false`/`undefined` (`:149-150`), so
the "Physics Override" banner in `ExoplanetResult.tsx:245` is dead UI.

---

## Repository layout

```
App.tsx                       Root component, animated demo, orchestration (:410)
index.tsx                     React entry point
types.ts                      Shared interfaces
components/
  FileUpload.tsx              Drag-and-drop .fits upload
  ExampleFiles.tsx            Two Kepler files embedded as base64
  ArchiveSearch.tsx           NASA Exoplanet Archive search + MAST fetch
  LightCurveChart.tsx         Flux vs time, LTTB downsampled to 3,000 points
  MetadataViewer.tsx          FITS header display
  ExoplanetResult.tsx         Verdict card + generated scientific reasoning
utils/
  fitsParser.ts               FITS binary reader
  exoplanetFeatures.ts        Detrending, BLS, feature computation
  exoplanetModel.ts           ONNX inference + decision logic
api/mast.ts                   Vercel serverless proxy for MAST downloads
ml/
  train_model.py              ⚠️ stale — does not build the shipped model
  koi_cumulative.csv          NASA KOI catalog (9,564 rows)
  exoscope_model.onnx         Copy of the shipped model
public/model/                 Model served to the browser
```

`public/ort*` (the onnxruntime-web distribution, ~96 MB) is **gitignored**. The
runtime loads WASM from a CDN, so those files are never served. They existed for
a removed predictor that set `wasmPaths = "/"`.

---

## Known issues

Ordered by impact.

1. **False positives now sit close to the decision threshold.** With the search
   fixed, KIC 2445129 (a known false positive) scores 42% against a 45% cutoff —
   a 3-point margin, where the old, blind search left 25 points. The narrowing
   comes from the classifier, not the search: it now reads the recovered signal
   (P = 3.41 d, 513 ppm, 0.82 hr) as fairly planet-like, returning 0.77 where it
   previously returned 0.28. This is the train/serve skew in issue 5 becoming
   visible. Re-tuning the `0.6 / 0.4` blend and the `0.45` cutoff in
   `combineSignals` against a labelled sample is the natural next step — the
   current constants were chosen when the SNR term was effectively noise.

2. **~180 ms UI freeze.** `extractFeatures` is synchronous on the main thread
   (`App.tsx:416`) with no worker and no yields. Down from ~9 s before the
   search was rewritten; longest blocking task now measured at 178 ms, which is
   no longer perceptible, but a Web Worker would still be the correct structure.

3. **Archive search only works on Vercel.** `ArchiveSearch.tsx:160,177` requests
   `/api/mast`, implemented as a Vercel function in `api/mast.ts`. In `npm run
   dev` that path returns HTTP 500. `vite.config.ts:11-18` already defines a
   working `/mast-proxy` route that nothing calls.

4. **`.github/workflows/deploy.yml` targets GitHub Pages**, but upstream history
   shows the project moved to Vercel and reverted the Pages base path. With no
   `base` set, absolute asset paths break on a project-page URL, and `/api/mast`
   cannot exist on Pages at all. The workflow is likely stale.

5. **Train/serve skew.** The model learned from NASA's catalog values, measured
   across the full multi-year mission. At inference it receives BLS estimates
   from a single ~90-day quarter. `duty_cycle` — the highest-importance feature —
   can only take the 12 values in `DUR_FRACS`, having been continuous in
   training. The model also only ever saw objects that already passed NASA's
   detection pipeline, so "no signal at all" is outside its training
   distribution.

6. **Wrong equilibrium temperature displayed.** `ExoplanetResult.tsx:217` calls
   `getEquilibriumTemp(period)` (`exoplanetFeatures.ts:277`), which assumes a
   Sun-like host. `features.eq_temperature_k` already holds the correct value
   using the actual `TEFF` and `RADIUS`. The habitable-zone flag uses the wrong
   one.

7. **`index.html` links `/index.css`, which does not exist** — the build warns
   and the request 404s at runtime.

8. **Leftover scaffolding.** `vite.config.ts:21-24` inlines `GEMINI_API_KEY`
   into the bundle via `define`; the key is never used, but a `.env.local`
   present at build time would be baked into public JavaScript. The
   `importmap` in `index.html:25-35` points at `aistudiocdn.com` and is
   overridden by Vite.

---

## Things earlier documentation claimed that are not true

The old README and SETUP.md described designs that never shipped in this form:

| Claim | Reality |
|---|---|
| "Random Forest + Gradient Boosting ensemble" | One RandomForest. No gradient boosting anywhere. |
| "26 features" / "10 features" | 13 |
| "Lomb-Scargle periodogram" | BLS |
| "`rfScore()` / `gbScore()` in TypeScript" | ONNX inference; no such functions |
| "Three physics override rules" | `overridden` is hardcoded `false` |
| "500 trees, max_depth 12" | 150 trees |
| "99.5% / 97.12% accuracy" | Unverifiable; not reproducible from this repo |
| "~80.9% real-world accuracy on 170 files" | No such evaluation exists here |
| "up to 65,000 points" charted | `MAX_DISPLAY_POINTS = 3000` |

There is currently **no defensible accuracy number** for this project. Producing
one means running the corrected pipeline over a labelled sample of Kepler files
and measuring it.
