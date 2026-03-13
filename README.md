# ExoScope

A browser-based tool for exploring NASA Kepler light curve data. Upload a `.fits` file to parse the binary data, visualize the light curve, and get an ML-powered exoplanet prediction — all without sending data to a server.

**Built by Shuban Langadi & Nafisur Rahman** — ISTA Period 4

---

## What It Does

- Parses NASA Kepler `.fits` binary files entirely in the browser (no backend)
- Displays FITS header metadata: object name, telescope, instrument, observation date
- Renders an interactive light curve chart with LTTB downsampling (up to 65,000 points)
- Toggles between PDCSAP (corrected) and SAP (raw) flux, normalized or raw counts
- Runs a machine learning model to predict whether an exoplanet is present
- Shows a confidence score with per-model breakdown (Random Forest + Gradient Boosting ensemble)

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | React 19 + TypeScript |
| Build tool | Vite 6 |
| Charts | Recharts |
| Icons | Lucide React |
| Styling | Tailwind CSS |
| ML inference | Custom TypeScript scoring (trained weights from scikit-learn) |

---

## Project Structure

```
ExoScope/
├── App.tsx                        # Root component, demo light curve, routing
├── index.tsx                      # React entry point
├── index.html                     # HTML shell
├── types.ts                       # Shared TypeScript interfaces
├── vite.config.ts                 # Vite configuration
├── package.json
├── tsconfig.json
├── components/
│   ├── FileUpload.tsx             # Drag-and-drop .fits file upload
│   ├── LightCurveChart.tsx        # Interactive flux vs time chart
│   ├── MetadataViewer.tsx         # FITS header display
│   └── ExoplanetResult.tsx        # ML prediction result card
└── utils/
    ├── fitsParser.ts              # Custom FITS binary parser (TypeScript)
    ├── exoplanetFeatures.ts       # Extracts 26 numerical features from light curve
    └── exoplanetModel.ts          # RF + GB ensemble scoring, physics override rules
```

---

## Prerequisites

- **Node.js** v18 or higher — [nodejs.org](https://nodejs.org)
- **npm** (comes with Node)

Check your version:
```bash
node --version
npm --version
```

---

## Installation

Clone the repo and install dependencies:

```bash
git clone https://github.com/ShuBan863/ExoScope.git
cd ExoScope
npm install
```

---

## Running Locally

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

To stop the server, press `Ctrl+C` in the terminal.

---

## Getting a `.fits` File to Test With

Kepler light curve files are free to download from NASA's MAST archive:

1. Go to [archive.stsci.edu/kepler/data_search](https://archive.stsci.edu/kepler/data_search/search.php)
2. Search for a KIC ID (e.g. `2306756` — a confirmed planet host, Kepler-18)
3. Download any file ending in `llc.fits` (long-cadence light curve)
4. Drag it into ExoScope

Or download directly from the MAST bulk archive:
```
https://archive.stsci.edu/pub/kepler/lightcurves/
```

Files follow the naming pattern: `kplr{KIC_ID}-{quarter}_llc.fits`

---

## How the ML Works

1. The FITS binary table is parsed to extract the TIME and PDCSAP_FLUX columns
2. **26 numerical features** are computed from the flux array — transit depth, period (via Lomb-Scargle periodogram), transit shape score, even/odd depth ratio, and others
3. Two scoring functions — `rfScore()` (Random Forest) and `gbScore()` (Gradient Boosting) — run on those features using weights derived from a real scikit-learn model trained on 7,489 labeled Kepler files
4. Scores are averaged (soft voting ensemble) to produce a 0–100% confidence value
5. Three physics-based override rules can force a NO PLANET result regardless of score (e.g. if no transits were detected but the estimated period is very short)

Training data: 2,805 confirmed planets + 4,684 false positives from the NASA KOI Cumulative Catalog.  
Training accuracy: 99.5% (RF), 99.4% (GB). Real-world accuracy on 170 Kepler files: ~80.9%.

---

## Build for Production

```bash
npm run build
```

Output goes to `dist/`. You can serve it with any static file host.

---

## Known Limitations

- Only tested with Kepler long-cadence (llc) files. TESS files may work but are not guaranteed.
- ML accuracy drops on single-quarter files where a planet's orbital period is longer than the observation window — the model may miss the transit entirely.
- Very short period signals (< 1 day) may alias with stellar rotation.

---

## References

- NASA FITS Documentation — [fits.gsfc.nasa.gov](https://fits.gsfc.nasa.gov/fits_documentation.html)
- Kepler Mission Data — [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/docs/KeplerMission.html)
- MAST Kepler Archive — [archive.stsci.edu](https://archive.stsci.edu/pub/kepler/lightcurves)
- Steinarsson, S. — *Downsampling Time Series for Visual Representation*, University of Iceland, 2013
- Pedregosa et al. — *Scikit-learn: Machine Learning in Python*, JMLR 12, 2011, pp. 2825–2830
- Recharts — [recharts.org](https://recharts.org)
