# ExoScope

A browser-based tool for exploring NASA Kepler light curve data. Load a `.fits`
file to parse the binary format, plot the light curve, search it for a repeating
transit signal, and get a classifier's read on whether it looks like a planet.
Nothing is uploaded — the file is parsed and analysed entirely in your browser.

**Built by Shuban Langadi & Nafisur Rahman** — ISTA Period 4

For how the code works internally, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## What it does

- Parses Kepler `.fits` binary tables in the browser, with no backend
- Displays FITS header metadata — object, telescope, instrument, observation date
- Plots flux vs. time, LTTB-downsampled to 3,000 points, with a zoom brush
- Toggles PDCSAP (corrected) vs. SAP (raw) flux, normalized vs. raw counts
- Runs a **Box Least Squares** search for a repeating transit dip
- Scores the result with a **RandomForest** classifier trained on NASA KOI data
- Shows a verdict, a confidence score, and generated reasoning citing the
  measured depth, duration, duty cycle, and stellar parameters

---

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 19 + TypeScript |
| Build | Vite 6 |
| Charts | Recharts |
| Icons | Lucide React |
| Styling | Tailwind (via CDN) |
| ML inference | onnxruntime-web (WASM) |
| Model training | scikit-learn → ONNX via skl2onnx |

---

## Running locally

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Two example files are built into the home page — one planet candidate
(KIC 3115833) and one false positive (KIC 2445129) — so you can try it without
downloading anything.

> **Note:** the NASA archive search on the home page calls `/api/mast`, which is
> a Vercel serverless function. It returns HTTP 500 under `npm run dev` and does
> not work on GitHub Pages. Use the example buttons or a local file instead. See
> issue 3 in [ARCHITECTURE.md](ARCHITECTURE.md#known-issues).

### Production build

```bash
npm run build
```

Output goes to `dist/`.

---

## Getting your own `.fits` files

Kepler light curves are free from NASA's MAST archive:

1. Go to [archive.stsci.edu/kepler/data_search](https://archive.stsci.edu/kepler/data_search/search.php)
2. Search a KIC ID (e.g. `2306756`, the Kepler-18 host)
3. Download a file ending in `llc.fits` (long cadence)
4. Drag it into ExoScope

Or fetch directly:

```bash
curl -LO "https://archive.stsci.edu/pub/kepler/lightcurves/0024/002445129/kplr002445129-2009166043257_llc.fits"
```

Files follow the pattern `kplr{9-digit KIC}-{timestamp}_llc.fits`.

---

## How the detection works

1. The FITS binary table is parsed for the `TIME` and `PDCSAP_FLUX` columns.
2. Flux is normalized and **detrended** with a 0.75-day sliding median, which
   removes slow stellar variability while preserving a sharp transit dip.
3. **BLS** searches for a repeating dip. Each candidate period folds the light
   curve into 400 phase bins once, then every duration and epoch is scored
   against those bins via prefix sums. A coarse scan of 500 periods locates the
   neighbourhood, a fine pass pins the period down, and a sub-harmonic check
   rejects 2:1 and 3:1 aliases. Yields period, depth, duration and a
   signal-to-noise ratio in ~100 ms.
4. Thirteen features — the BLS results, stellar parameters from the FITS header,
   and derived ratios — are fed to a 150-tree RandomForest exported to ONNX.
5. The BLS signal-to-noise and the classifier probability are blended
   `0.6 / 0.4` and thresholded at `0.45` to produce the final verdict.

**Training data:** 7,586 Kepler Objects of Interest from the NASA KOI Cumulative
Catalog — 2,747 `CONFIRMED` and 4,839 `FALSE POSITIVE`. `CANDIDATE` entries are
excluded.

---

## Status and limitations

This is a student project with known, documented problems. Be skeptical of its
output.

- **False positives land near the decision threshold.** The bundled false
  positive scores 42% against a 45% cutoff. The blend weights and cutoff in
  `combineSignals` were tuned when the transit search was much less sensitive,
  and are due a re-tune against a labelled sample.
- **Analysis blocks the tab for ~180 ms.** Short enough not to notice, but the
  search still runs on the main thread rather than in a Web Worker.
- **There is no validated accuracy figure.** Earlier versions of this README
  quoted numbers that cannot be reproduced from anything in this repository.
  Measuring a real one requires evaluating the corrected pipeline against a
  labelled sample.
- **The classifier is applied outside its training distribution.** It learned
  from NASA catalog values measured across the full mission; it receives
  single-quarter BLS estimates. It also only ever saw objects that had already
  passed NASA's detection pipeline.
- Only tested on Kepler long-cadence (`llc`) files. TESS may work; untested.
- Single-quarter data cannot show planets whose orbital period exceeds the
  ~90-day observation window.

---

## References

- FITS standard — [fits.gsfc.nasa.gov](https://fits.gsfc.nasa.gov/fits_documentation.html)
- Kepler mission data — [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/docs/KeplerMission.html)
- MAST Kepler archive — [archive.stsci.edu](https://archive.stsci.edu/pub/kepler/lightcurves)
- Kovács, Zucker & Mazeh (2002) — *A box-fitting algorithm in the search for periodic transits*, A&A 391, 369
- Winn (2010) — *Transits and Occultations*, in *Exoplanets* (transit duration relation)
- Steinarsson (2013) — *Downsampling Time Series for Visual Representation*, University of Iceland (LTTB)
- Pedregosa et al. (2011) — *Scikit-learn: Machine Learning in Python*, JMLR 12, 2825–2830
