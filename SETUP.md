# ExoScope ML — Complete Setup Guide
## From scratch to a working exoplanet detector

---

## Architecture Overview

```
1. Python (one-time, on your laptop)
   train_model.py
     └── downloads NASA KOI catalog (~10k labeled examples)
     └── trains Random Forest classifier
     └── exports  →  exoscope_model.onnx
     └── writes   →  feature_config.json

2. Browser (every time a user uploads a file)
   fitsReader.js      → parse Kepler FITS → time, flux, metadata
   featureExtractor.js → BLS transit search → 10 feature vector
   modelPredictor.js   → ONNX Runtime Web → prediction + explanation
```

---

## Step 0 — Clean out the old ML code

In your ExoScope repo, delete everything ML-related:

```bash
cd ~/Documents/ExoScope

# Remove old model files (adjust paths to match your actual structure)
rm -rf src/ml/ src/model/ public/model/
rm -f *.onnx *.pkl *.joblib *.h5
```

---

## Step 1 — Train the new model (Python, ~5–10 min)

### 1a. Install dependencies

```bash
# Create a dedicated virtualenv (keeps things clean)
cd ~/Documents/ExoScope
python3 -m venv ml_env
source ml_env/bin/activate          # Linux/Mac
# ml_env\Scripts\activate           # Windows

pip install -r ml/requirements.txt
```

### 1b. Run the training script

```bash
cd ml/
python train_model.py
```

What it does:
- Downloads the NASA Kepler KOI cumulative catalog (~5 MB CSV, cached after first run)
- Trains a Random Forest on ~7,000 labeled objects (CONFIRMED vs FALSE POSITIVE)
- Cross-validates with 5-fold CV — expect ~96–98% accuracy, ~0.98 ROC-AUC
- Exports the model as `exoscope_model.onnx`
- Writes `feature_config.json`

Expected output (approximate):
```
[Dataset]
  Total labeled KOIs  : 7,193
  Confirmed planets   : 2,345  (32.6%)
  False positives     : 4,848  (67.4%)

[Results on held-out test set]
  Accuracy : 0.9712  (97.12%)
  ROC-AUC  : 0.9883

[5-fold cross-validation]
  Mean ± Std : 0.9871 ± 0.0041

[✓] ONNX model saved → exoscope_model.onnx  (2.4 MB)
```

### 1c. Copy model files to your web app

```bash
mkdir -p ../public/model
cp exoscope_model.onnx  ../public/model/
cp feature_config.json  ../public/model/
```

---

## Step 2 — Set up the web app

### 2a. Install JS dependencies

```bash
cd ~/Documents/ExoScope
npm install onnxruntime-web
```

### 2b. Copy the utility files

```bash
cp src/utils/fitsReader.js       src/utils/
cp src/utils/featureExtractor.js src/utils/
cp src/utils/modelPredictor.js   src/utils/
cp src/components/ExoAnalyzer.jsx src/components/
```

### 2c. Copy ONNX WASM files to public/

The ONNX Runtime Web needs its WebAssembly files served from the root:

```bash
# Find where npm installed the wasm files
WASM_DIR=$(node -e "require.resolve('onnxruntime-web')" | sed 's|/dist/.*||')/dist/

cp $WASM_DIR/ort-wasm*.wasm public/
cp $WASM_DIR/ort-wasm*.js   public/    # if any .js shim files exist
```

Or manually copy from `node_modules/onnxruntime-web/dist/*.wasm` to `public/`.

### 2d. Configure Next.js for WASM (if using Next.js)

In `next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Allow .wasm imports
    config.resolve.fallback = { fs: false };
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
  // Serve WASM files correctly
  async headers() {
    return [
      {
        source: "/:path*.wasm",
        headers: [{ key: "Content-Type", value: "application/wasm" }],
      },
    ];
  },
};

module.exports = nextConfig;
```

### 2e. Use the component in your page

```jsx
// app/page.jsx  or  pages/index.jsx
import ExoAnalyzer from "@/components/ExoAnalyzer";

export default function Home() {
  return <ExoAnalyzer />;
}
```

### 2f. Run it

```bash
npm run dev
```

Open http://localhost:3000, upload a Kepler FITS file, and watch it go.

---

## Step 3 — Test with real Kepler files

Download test FITS files from MAST (free, no account needed):

```bash
# Example: Download a confirmed planet (Kepler-7b, KIC 5780885)
curl -L "https://archive.stsci.edu/pub/kepler/lightcurves/0057/005780885/kplr005780885-2009166044711_llc.fits" \
  -o test_planet.fits

# Example: Download a false positive
# Search at: https://archive.stsci.edu/kepler/data_search/search.php
```

Or search the MAST portal: https://mast.stsci.edu/portal/Mashup/Clients/Mast/Portal.html
Filter: Mission = Kepler, file type = LC (long cadence), download any `.fits` file.

---

## Step 4 — Vercel deployment

Once it works on localhost:

```bash
npm install -g vercel
vercel
```

The model and WASM files in `/public/` are served as static assets.
Everything runs in the browser — zero server cost, zero data leaves the user's machine.

One important note for Vercel: add this to `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*).wasm",
      "headers": [
        { "key": "Content-Type",             "value": "application/wasm" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Opener-Policy",   "value": "same-origin" }
      ]
    }
  ]
}
```

---

## How the ML model works

### Training data
- Source: NASA Exoplanet Archive KOI Cumulative table
- ~7,000 labeled objects: CONFIRMED planets vs FALSE POSITIVES
- Features are computed by the Kepler pipeline (same calculation we replicate in JS)

### Features (10 total)
| Feature | Why it matters |
|---------|----------------|
| `period_days` | Real planets have stable, repeating periods |
| `transit_depth_ppm` | Planets block <1% of starlight; deep transits often mean binaries |
| `transit_duration_hr` | Duration encodes orbital geometry |
| `transit_snr` | Kepler requires SNR > 7.1; below this is noise |
| `planet_radius_re` | Sub-stellar companions have R > 0.08 R☉ ≈ 89 R⊕ |
| `eq_temperature_k` | Sanity check on orbital distance |
| `stellar_teff_k` | Some FP behaviors depend on stellar type |
| `stellar_logg` | Evolved stars have lower log g, affect transit shapes |
| `stellar_radius_rsun` | Needed to convert depth → radius |
| `odd_even_depth_diff` | #1 eclipsing binary discriminator — planets have odd ≈ even |

### Algorithm
Random Forest (500 trees, max_depth=12, balanced class weights)
- Pros: robust to missing data, interpretable, no scaling issues, fast inference
- Achieves ~97% accuracy and ~0.99 AUC on this dataset
- Much better than a neural network for tabular data with 10 features

### Why your old model was struggling
Common reasons:
- Wrong/insufficient training data (not using the KOI catalog)
- Wrong features (using raw flux pixels instead of transit parameters)
- No preprocessing (NaN values, not normalized)
- Wrong model architecture for tabular ML (deep learning overkill here)
- Class imbalance not handled

---

## File structure after setup

```
ExoScope/
├── public/
│   ├── model/
│   │   ├── exoscope_model.onnx      ← ML model (generated by Python)
│   │   └── feature_config.json      ← Feature metadata (generated by Python)
│   ├── ort-wasm.wasm                ← ONNX Runtime WebAssembly
│   └── ort-wasm-simd.wasm
├── ml/
│   ├── requirements.txt
│   ├── train_model.py               ← Run this once to generate the model
│   ├── koi_cumulative.csv           ← Auto-downloaded and cached
│   ├── exoscope_model.onnx          ← Copy to public/model/
│   ├── feature_config.json          ← Copy to public/model/
│   └── training_report.txt
├── src/
│   ├── utils/
│   │   ├── fitsReader.js            ← FITS binary parser
│   │   ├── featureExtractor.js      ← BLS + feature computation
│   │   └── modelPredictor.js        ← ONNX inference + interpretation
│   └── components/
│       └── ExoAnalyzer.jsx          ← Main UI component
└── next.config.js                   ← Updated for WASM support
```

---

## Troubleshooting

**"Could not find LIGHTCURVE extension"**
→ Make sure you're uploading a Kepler LC (long cadence) file, not a target pixel file (TPF).
  LC files end in `_llc.fits`. TPF files end in `_lpd-targ.fits`.

**Model loads but gives 0%/100% confidence for everything**
→ Check browser console for ONNX errors. Usually means the WASM files aren't being served.
  Verify `public/ort-wasm.wasm` exists and is being served with Content-Type `application/wasm`.

**BLS search takes too long**
→ Expected: 5–15 sec for a Kepler quarter (~4,000 data points).
  If it's hanging, check for infinite loops in the feature extractor.
  The `await sleep(0)` calls in BLS yield to the event loop every 500 iterations.

**Training script fails with "missing columns"**
→ The KOI table format occasionally changes. Check `koi_cumulative.csv` column names
  and update the FEATURE_SPEC in `train_model.py` accordingly.
