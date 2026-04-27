/**
 * featureExtractor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracts the exact same 10 features that the ONNX model was trained on,
 * directly from raw Kepler light curve data.
 *
 * Pipeline:
 *   raw flux → normalize → flatten (Savitzky-Golay) → BLS search →
 *   fold at best period → compute features → return feature vector
 *
 * The feature vector ORDER must match feature_config.json exactly:
 *   [0] period_days
 *   [1] transit_depth_ppm
 *   [2] transit_duration_hr
 *   [3] transit_snr
 *   [4] planet_radius_re
 *   [5] eq_temperature_k
 *   [6] stellar_teff_k
 *   [7] stellar_logg
 *   [8] stellar_radius_rsun
 *   [9] odd_even_depth_diff
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Physical constants
const R_SUN_CM   = 6.957e10;   // Solar radius in cm
const R_EARTH_CM = 6.371e8;    // Earth radius in cm
const AU_CM      = 1.496e13;   // 1 AU in cm
const SIGMA_SB   = 5.6704e-5;  // Stefan-Boltzmann (cgs)
const L_SUN_ERG  = 3.828e33;   // Solar luminosity in erg/s
const T_SUN_K    = 5778;       // Solar Teff in K

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all features from a parsed light curve.
 *
 * @param {Float64Array} time     - BJD times (days)
 * @param {Float64Array} flux     - PDCSAP flux (electrons/s)
 * @param {Float64Array} fluxErr  - Flux uncertainties
 * @param {Object}       meta     - Stellar params from parseFITS()
 * @param {Function}    [onProgress] - Optional callback(pct, message)
 *
 * @returns {{
 *   featureVector: Float32Array,    // 10 features in model order
 *   features: Object,               // named features for UI display
 *   blsResult: Object,              // raw BLS output
 *   foldedLC: Object,               // phase-folded light curve for plotting
 *   planetProps: Object,            // derived planet properties
 * }}
 */
export async function extractFeatures(time, flux, fluxErr, meta, onProgress = () => {}) {
  onProgress(5, "Cleaning light curve…");
  const { cleanTime, cleanFlux, cleanErr } = cleanLightCurve(time, flux, fluxErr);

  onProgress(15, "Flattening light curve…");
  const flatFlux = flattenLightCurve(cleanTime, cleanFlux);

  onProgress(25, "Running Box Least Squares transit search…");
  const blsResult = await runBLS(cleanTime, flatFlux, onProgress);

  onProgress(80, "Folding light curve…");
  const foldedLC = foldLightCurve(cleanTime, flatFlux, cleanErr, blsResult.period, blsResult.t0);

  onProgress(88, "Computing odd/even transit depths…");
  const oddEvenDiff = computeOddEvenDiff(cleanTime, flatFlux, blsResult);

  onProgress(93, "Computing secondary eclipse depth…");
  // (not used as a feature but good for FP flagging in UI)
  const secondaryDepth = computeSecondaryDepth(foldedLC, blsResult.duration_phase);

  onProgress(97, "Deriving planet properties…");
  const planetProps = derivePlanetProperties(blsResult, meta);

  // ── Assemble feature vector (ORDER MUST MATCH feature_config.json)
  const features = {
    period_days:         blsResult.period,
    transit_depth_ppm:   blsResult.depth_ppm,
    transit_duration_hr: blsResult.duration_hr,
    transit_snr:         blsResult.snr,
    planet_radius_re:    planetProps.radiusEarth,
    eq_temperature_k:    planetProps.teqK,
    stellar_teff_k:      meta.stellarTeff   || 5778,
    stellar_logg:        meta.stellarLogg   || 4.44,
    stellar_radius_rsun: meta.stellarRadius || 1.0,
    odd_even_depth_diff: oddEvenDiff,
  };

  const featureVector = new Float32Array([
    features.period_days,
    features.transit_depth_ppm,
    features.transit_duration_hr,
    features.transit_snr,
    features.planet_radius_re,
    features.eq_temperature_k,
    features.stellar_teff_k,
    features.stellar_logg,
    features.stellar_radius_rsun,
    features.odd_even_depth_diff,
  ]);

  onProgress(100, "Done.");
  return {
    featureVector,
    features,
    blsResult,
    foldedLC,
    planetProps,
    secondaryDepth,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Clean light curve — remove NaN, sigma-clip outliers
// ─────────────────────────────────────────────────────────────────────────────

function cleanLightCurve(time, flux, fluxErr) {
  const n = time.length;
  const validIdx = [];

  // First pass: remove NaN and Infinity
  for (let i = 0; i < n; i++) {
    if (isFinite(time[i]) && isFinite(flux[i]) && flux[i] > 0) {
      validIdx.push(i);
    }
  }

  const t = new Float64Array(validIdx.map(i => time[i]));
  let   f = new Float64Array(validIdx.map(i => flux[i]));
  const e = new Float64Array(validIdx.map(i => isFinite(fluxErr[i]) ? fluxErr[i] : 0));

  // Normalize flux to median = 1
  const med = median(f);
  for (let i = 0; i < f.length; i++) f[i] /= med;

  // Sigma-clip: remove 5σ outliers (hot pixels, cosmic rays)
  const sigma = madStd(f);
  const fMed  = 1.0; // after normalization median is 1
  const keepIdx = [];
  for (let i = 0; i < f.length; i++) {
    if (Math.abs(f[i] - fMed) < 5 * sigma) keepIdx.push(i);
  }

  return {
    cleanTime: new Float64Array(keepIdx.map(i => t[i])),
    cleanFlux: new Float64Array(keepIdx.map(i => f[i])),
    cleanErr:  new Float64Array(keepIdx.map(i => e[i] / med)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Flatten — remove long-term trends with a running median filter
// ─────────────────────────────────────────────────────────────────────────────

function flattenLightCurve(time, flux, windowDays = 1.5) {
  const n = flux.length;
  const flat = new Float64Array(n);

  // Estimate cadence
  const dt = n > 1 ? (time[n - 1] - time[0]) / (n - 1) : 0.0208; // ~30 min default
  const halfWindow = Math.max(3, Math.round((windowDays / 2) / dt));

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    const localFlux = Array.from(flux.slice(lo, hi + 1));
    const localMed  = median(localFlux);
    flat[i] = flux[i] / localMed; // normalised to local median
  }

  return flat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Box Least Squares (BLS) period search
// Searches periods from 0.5 to 100 days with adaptive resolution.
// This is the core transit detection algorithm used by Kepler.
// ─────────────────────────────────────────────────────────────────────────────

async function runBLS(time, flux, onProgress) {
  const n = time.length;
  const tspan = time[n - 1] - time[0];

  // Period grid: log-spaced for uniform phase coverage
  const pMin   = 0.5;
  const pMax   = Math.min(tspan / 2, 100); // at least 2 transits required
  const nTrials = 5000;

  const periods = logSpace(pMin, pMax, nTrials);

  // Duration grid: 0.5% – 15% of period (typical transit durations)
  const durationFracs = [0.005, 0.01, 0.02, 0.03, 0.05, 0.07, 0.10, 0.15];

  let bestPower  = -Infinity;
  let bestPeriod = periods[0];
  let bestDurFrac = 0.05;
  let bestPhase  = 0;

  const powers = new Float64Array(nTrials);

  // Precompute fluxes array
  const f = Array.from(flux);
  const fMean = mean(f);
  const fVar  = variance(f, fMean);

  for (let pi = 0; pi < nTrials; pi++) {
    const p = periods[pi];

    // Report progress occasionally
    if (pi % 500 === 0) {
      onProgress(
        25 + Math.round(55 * pi / nTrials),
        `BLS search: ${Math.round(100 * pi / nTrials)}% (P = ${p.toFixed(2)} d)`
      );
      // Yield to event loop so UI doesn't freeze
      await sleep(0);
    }

    let bestLocalPower = -Infinity;
    let bestLocalDur   = durationFracs[0];
    let bestLocalPhase = 0;

    for (const durFrac of durationFracs) {
      const durPhase = durFrac; // in phase units [0,1]

      // Phase-fold times to [0,1)
      // Try phases from 0 to 1 in steps of durPhase/2
      const phaseStep = durPhase / 2;
      const nPhases   = Math.round(1.0 / phaseStep);

      for (let ph = 0; ph < nPhases; ph++) {
        const phaseCenter = ph * phaseStep;
        const phLo = phaseCenter - durPhase / 2;
        const phHi = phaseCenter + durPhase / 2;

        let sumIn = 0, sumOut = 0, nIn = 0, nOut = 0;
        for (let i = 0; i < n; i++) {
          let phase = ((time[i] % p) / p + 1) % 1;
          const inside = (phase >= ((phLo + 1) % 1) && phase < ((phHi + 1) % 1))
                      || (phLo < 0 && (phase >= 1 + phLo || phase < phHi))
                      || (phHi > 1 && (phase >= phLo || phase < phHi - 1));
          if (inside) { sumIn  += f[i]; nIn++; }
          else         { sumOut += f[i]; nOut++; }
        }

        if (nIn < 2 || nOut < 2) continue;

        const meanIn  = sumIn  / nIn;
        const meanOut = sumOut / nOut;
        const depth   = meanOut - meanIn; // positive for transit (dip)

        if (depth <= 0) continue;

        // BLS power: signal residue^2 normalized
        const power = (nIn * nOut * depth * depth) / (nIn + nOut);
        if (power > bestLocalPower) {
          bestLocalPower = power;
          bestLocalDur   = durFrac;
          bestLocalPhase = phaseCenter;
        }
      }
    }

    powers[pi] = bestLocalPower;
    if (bestLocalPower > bestPower) {
      bestPower   = bestLocalPower;
      bestPeriod  = p;
      bestDurFrac = bestLocalDur;
      bestPhase   = bestLocalPhase;
    }
  }

  // ── Refine best period with a finer grid (±5% around best)
  const pRefineMin = bestPeriod * 0.95;
  const pRefineMax = bestPeriod * 1.05;
  const refine = logSpace(pRefineMin, pRefineMax, 500);

  for (const p of refine) {
    for (const durFrac of durationFracs) {
      const durPhase  = durFrac;
      const phaseStep = durPhase / 2;
      const nPhases   = Math.round(1.0 / phaseStep);

      for (let ph = 0; ph < nPhases; ph++) {
        const phaseCenter = ph * phaseStep;
        const phLo = phaseCenter - durPhase / 2;
        const phHi = phaseCenter + durPhase / 2;

        let sumIn = 0, sumOut = 0, nIn = 0, nOut = 0;
        for (let i = 0; i < n; i++) {
          let phase = ((time[i] % p) / p + 1) % 1;
          const inside = (phase >= ((phLo + 1) % 1) && phase < ((phHi + 1) % 1))
                      || (phLo < 0 && (phase >= 1 + phLo || phase < phHi))
                      || (phHi > 1 && (phase >= phLo || phase < phHi - 1));
          if (inside) { sumIn  += f[i]; nIn++; }
          else         { sumOut += f[i]; nOut++; }
        }

        if (nIn < 2 || nOut < 2) continue;
        const meanIn  = sumIn  / nIn;
        const meanOut = sumOut / nOut;
        const depth   = meanOut - meanIn;
        if (depth <= 0) continue;

        const power = (nIn * nOut * depth * depth) / (nIn + nOut);
        if (power > bestPower) {
          bestPower   = power;
          bestPeriod  = p;
          bestDurFrac = durFrac;
          bestPhase   = phaseCenter;
        }
      }
    }
  }

  // ── Compute final depth and SNR
  const finalDepth = computeTransitDepth(time, flux, bestPeriod, bestPhase, bestDurFrac);
  const nTransits  = Math.max(1, Math.floor(tspan / bestPeriod));
  const noisePerPt = madStd(flux);
  const nInTransit = Math.round(n * bestDurFrac);
  const snr        = nInTransit > 0
    ? (finalDepth * Math.sqrt(nInTransit)) / noisePerPt
    : 0;

  // t0: time of first transit
  const t0 = time[0] + bestPhase * bestPeriod;

  return {
    period:        bestPeriod,
    t0:            t0,
    duration_frac: bestDurFrac,
    duration_hr:   bestDurFrac * bestPeriod * 24,
    depth_frac:    finalDepth,
    depth_ppm:     finalDepth * 1e6,
    snr:           Math.max(0, snr),
    n_transits:    nTransits,
    power:         bestPower,
    duration_phase: bestDurFrac,
  };
}

function computeTransitDepth(time, flux, period, phase, durFrac) {
  const n = time.length;
  let sumIn = 0, sumOut = 0, nIn = 0, nOut = 0;
  const phLo = phase - durFrac / 2;
  const phHi = phase + durFrac / 2;

  for (let i = 0; i < n; i++) {
    let ph = ((time[i] % period) / period + 1) % 1;
    const inside = (ph >= ((phLo + 1) % 1) && ph < ((phHi + 1) % 1))
                || (phLo < 0 && (ph >= 1 + phLo || ph < phHi))
                || (phHi > 1 && (ph >= phLo || ph < phHi - 1));
    if (inside) { sumIn  += flux[i]; nIn++; }
    else         { sumOut += flux[i]; nOut++; }
  }
  if (nIn === 0 || nOut === 0) return 0;
  return (sumOut / nOut) - (sumIn / nIn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Phase-fold the light curve at the best period
// ─────────────────────────────────────────────────────────────────────────────

function foldLightCurve(time, flux, fluxErr, period, t0) {
  const n = time.length;
  const phase = new Float64Array(n);
  const foldedFlux = new Float64Array(n);
  const foldedErr  = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    let ph = ((time[i] - t0) % period) / period;
    if (ph > 0.5)  ph -= 1;
    if (ph < -0.5) ph += 1;
    phase[i]      = ph;
    foldedFlux[i] = flux[i];
    foldedErr[i]  = fluxErr[i];
  }

  // Sort by phase for plotting
  const sortIdx = Array.from({ length: n }, (_, i) => i).sort((a, b) => phase[a] - phase[b]);

  return {
    phase:     new Float64Array(sortIdx.map(i => phase[i])),
    flux:      new Float64Array(sortIdx.map(i => foldedFlux[i])),
    fluxErr:   new Float64Array(sortIdx.map(i => foldedErr[i])),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: Odd/Even transit depth comparison
// Real planets: odd ≈ even. Eclipsing binaries: odd ≠ even (secondary eclipse)
// ─────────────────────────────────────────────────────────────────────────────

function computeOddEvenDiff(time, flux, blsResult) {
  const { period, t0, duration_frac } = blsResult;
  const tspan = time[time.length - 1] - time[0];
  const nTransits = Math.floor(tspan / period);

  if (nTransits < 2) return 0;

  const oddDepths  = [];
  const evenDepths = [];

  for (let k = 0; k <= nTransits; k++) {
    const tMid = t0 + k * period;
    const durHalf = (duration_frac * period) / 2;

    // Points in this transit
    const inIdx = [];
    for (let i = 0; i < time.length; i++) {
      if (Math.abs(time[i] - tMid) < durHalf) inIdx.push(i);
    }
    if (inIdx.length < 2) continue;

    // Out-of-transit window (2x duration on each side)
    const outIdx = [];
    for (let i = 0; i < time.length; i++) {
      const dt = Math.abs(time[i] - tMid);
      if (dt > durHalf && dt < 3 * durHalf) outIdx.push(i);
    }
    if (outIdx.length < 2) continue;

    const meanIn  = mean(inIdx.map(i => flux[i]));
    const meanOut = mean(outIdx.map(i => flux[i]));
    const depth   = meanOut - meanIn;

    if (k % 2 === 0) evenDepths.push(depth);
    else             oddDepths.push(depth);
  }

  if (oddDepths.length === 0 || evenDepths.length === 0) return 0;

  const oddMean  = mean(oddDepths);
  const evenMean = mean(evenDepths);
  const pooledStd = Math.sqrt(
    (variance(oddDepths) * oddDepths.length + variance(evenDepths) * evenDepths.length)
    / (oddDepths.length + evenDepths.length)
  );

  // Difference in units of sigma
  return pooledStd > 0 ? Math.abs(oddMean - evenMean) / pooledStd : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: Secondary eclipse depth (indicator of false positive)
// Check flux at phase 0.5 (secondary eclipse position)
// ─────────────────────────────────────────────────────────────────────────────

function computeSecondaryDepth(foldedLC, durFrac) {
  const { phase, flux } = foldedLC;
  const n = phase.length;

  const half = durFrac / 2;
  let sumSec = 0, nSec = 0;
  let sumOut = 0, nOut = 0;

  for (let i = 0; i < n; i++) {
    const ph = phase[i];
    if (Math.abs(ph - 0.5) < half || Math.abs(ph + 0.5) < half) {
      sumSec += flux[i]; nSec++;
    } else if (Math.abs(ph) > 3 * half && Math.abs(Math.abs(ph) - 0.5) > 3 * half) {
      sumOut += flux[i]; nOut++;
    }
  }

  if (nSec < 2 || nOut < 2) return 0;
  return Math.max(0, (sumOut / nOut) - (sumSec / nSec));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 7: Derive planet properties from BLS result + stellar params
// ─────────────────────────────────────────────────────────────────────────────

function derivePlanetProperties(bls, meta) {
  const P_days = bls.period;
  const depth  = bls.depth_frac;

  const R_star  = (meta.stellarRadius || 1.0) * R_SUN_CM;
  const T_star  = meta.stellarTeff    || 5778;
  const M_star  = meta.stellarMass    || 1.0;  // solar masses

  // Planet radius from transit depth: (Rp/Rs)^2 = depth
  const radiusCm    = Math.sqrt(Math.max(0, depth)) * R_star;
  const radiusEarth = radiusCm / R_EARTH_CM;

  // Semi-major axis from Kepler's 3rd law: a^3 = M * P^2 (in solar units)
  const P_years    = P_days / 365.25;
  const a_AU       = Math.pow(M_star * P_years * P_years, 1 / 3);

  // Stellar luminosity (in solar units) from Stefan-Boltzmann
  const L_star = Math.pow(meta.stellarRadius || 1.0, 2) * Math.pow(T_star / T_SUN_K, 4);

  // Equilibrium temperature (assuming bond albedo = 0.3)
  const albedo = 0.3;
  const teqK = T_star
    * Math.pow(meta.stellarRadius || 1.0, 0.5)
    * Math.pow((1 - albedo) / 4, 0.25)
    / Math.pow(a_AU * 215.0, 0.5); // 215 = AU in solar radii

  // Habitable zone: conservative estimate (Kopparapu+ 2013)
  const hz_inner = 0.95 * Math.sqrt(L_star); // AU
  const hz_outer = 1.67 * Math.sqrt(L_star); // AU
  const inHabitableZone = a_AU >= hz_inner && a_AU <= hz_outer;

  return {
    radiusEarth:      isFinite(radiusEarth) ? radiusEarth : 0,
    teqK:             isFinite(teqK)        ? teqK        : 0,
    semiMajorAxisAU:  isFinite(a_AU)        ? a_AU        : 0,
    hz_inner,
    hz_outer,
    inHabitableZone,
    luminositySun:    L_star,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────────────

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function variance(arr, m) {
  const mu = m !== undefined ? m : mean(arr);
  return arr.reduce((s, v) => s + (v - mu) ** 2, 0) / arr.length;
}

/** Median Absolute Deviation — robust standard deviation estimator */
function madStd(arr) {
  const med = median(Array.from(arr));
  const deviations = Array.from(arr).map(v => Math.abs(v - med));
  return 1.4826 * median(deviations); // 1.4826 makes it consistent with Gaussian σ
}

function logSpace(lo, hi, n) {
  const result = new Float64Array(n);
  const logLo  = Math.log(lo);
  const logHi  = Math.log(hi);
  for (let i = 0; i < n; i++) {
    result[i] = Math.exp(logLo + (logHi - logLo) * i / (n - 1));
  }
  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
