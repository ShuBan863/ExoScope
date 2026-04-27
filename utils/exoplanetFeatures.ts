/**
 * ExoScope Feature Extractor v4.0
 *
 * Pipeline:
 *   1. Load & clean flux
 *   2. Detrend with sliding median (removes stellar variability)
 *   3. BLS on detrended flux (1000 periods, fine duration grid, 20 phases)
 *   4. Compute features for ML model
 *
 * Primary detection: BLS SNR (physics-based)
 * ML model: secondary confidence scorer
 */

import { ParsedFitsData, FitsHeaderCard } from '../types';

export interface ExoplanetFeatures {
  period_days:          number;
  transit_depth_ppm:    number;
  transit_duration_hr:  number;
  stellar_teff_k:       number;
  stellar_logg:         number;
  stellar_radius_rsun:  number;
  depth_per_hr:         number;
  duty_cycle:           number;
  log_depth:            number;
  log_period:           number;
  log_duration:         number;
  depth_x_logg:         number;
  period_x_srad:        number;

  n_transits:               number;
  est_planet_radius_rearth: number;
  eq_temperature_k:         number;
  total_obs_days:           number;
  flux_std:                 number;
  bls_snr:                  number;
}

function medianVal(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function headerNum(header: FitsHeaderCard[], ...keys: string[]): number | null {
  for (const key of keys) {
    const card = header.find(c => c.key.trim().toUpperCase() === key.toUpperCase());
    if (card && card.value !== null) {
      const n = Number(card.value);
      if (isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function runBLS(
  time: number[],
  flux: number[],
  minPeriod: number,
  maxPeriod: number,
): { period: number; depthFrac: number; durationFrac: number; t0: number; snr: number } {

  const n   = time.length;
  const std = Math.sqrt(flux.reduce((s, f) => s + (f - 1) ** 2, 0) / n) + 1e-9;

  const N_PERIODS = 1000;
  const N_PHASES  = 20;
  const DUR_FRACS = [
    0.004, 0.007, 0.010, 0.014, 0.018, 0.023,
    0.029, 0.036, 0.044, 0.054, 0.065, 0.078,
  ];

  let bestPow = -Infinity, bestPeriod = (minPeriod + maxPeriod) / 2;
  let bestDepth = 0, bestDurFrac = 0.02, bestT0 = time[0], bestInN = 0;

  const logMin = Math.log10(minPeriod);
  const logMax = Math.log10(maxPeriod);

  for (let pi = 0; pi < N_PERIODS; pi++) {
    const period = Math.pow(10, logMin + (pi / (N_PERIODS - 1)) * (logMax - logMin));

    for (let di = 0; di < DUR_FRACS.length; di++) {
      const durFrac = DUR_FRACS[di];
      const durDays = durFrac * period;
      const halfDur = durDays / 2;

      for (let ph = 0; ph < N_PHASES; ph++) {
        const t0 = time[0] + (ph / N_PHASES) * period;

        let inSum = 0, inN = 0, outSum = 0, outN = 0;
        for (let i = 0; i < n; i++) {
          const phase = ((time[i] - t0) % period + period) % period;
          const inTransit = phase < halfDur || phase > period - halfDur;
          if (inTransit) { inSum += flux[i]; inN++; }
          else           { outSum += flux[i]; outN++; }
        }

        if (inN < 3 || outN < 10) continue;

        const depth = (outSum / outN) - (inSum / inN);
        if (depth <= 0) continue;

        const power = depth * Math.sqrt(inN) / std;
        if (power > bestPow) {
          bestPow = power; bestPeriod = period; bestDepth = depth;
          bestDurFrac = durFrac; bestT0 = t0; bestInN = inN;
        }
      }
    }
  }

  const snr = bestInN > 0 ? bestDepth * Math.sqrt(bestInN) / std : 0;

  return { period: bestPeriod, depthFrac: Math.max(0, bestDepth),
           durationFrac: bestDurFrac, t0: bestT0, snr };
}

function countTransits(
  time: number[], flux: number[],
  period: number, t0: number, durDays: number, threshold: number,
): number {
  if (period <= 0 || durDays <= 0) return 0;
  let count = 0;
  const tEnd = time[time.length - 1];
  for (let tTr = t0; tTr < tEnd + period; tTr += period) {
    const halfDur = durDays * 1.5;
    const pts = flux.filter((_, i) => time[i] >= tTr - halfDur && time[i] <= tTr + halfDur);
    if (pts.length >= 2 && Math.min(...pts) < threshold) count++;
  }
  return Math.min(count, 99);
}

export function extractFeatures(fitsData: ParsedFitsData): ExoplanetFeatures | null {
  const timeCol = fitsData.columns.find(c => c === 'TIME') ?? fitsData.columns[0];
  const fluxCol =
    fitsData.columns.find(c => c === 'PDCSAP_FLUX') ??
    fitsData.columns.find(c => c === 'SAP_FLUX') ??
    fitsData.columns.find(c => c === 'FLUX');

  if (!timeCol || !fluxCol) return null;

  const rawT: number[] = [], rawF: number[] = [];
  for (let i = 0; i < fitsData.rowCount; i++) {
    const t = fitsData.data[timeCol][i];
    const f = fitsData.data[fluxCol][i];
    if (t !== null && f !== null && isFinite(t) && isFinite(f) && f > 0) {
      rawT.push(t); rawF.push(f);
    }
  }
  if (rawT.length < 100) return null;

  const idx  = rawT.map((_, i) => i).sort((a, b) => rawT[a] - rawT[b]);
  const time = idx.map(i => rawT[i]);
  const flux = idx.map(i => rawF[i]);

  const allHdr        = [...fitsData.primaryHeader, ...fitsData.extensionHeader];
  const stellarTeff   = headerNum(allHdr, 'TEFF',   'TEFF_KIC',   'TEFFKIC')   ?? 5778;
  const stellarLogg   = headerNum(allHdr, 'LOGG',   'LOGG_KIC',   'LOGGKIC')   ?? 4.44;
  const stellarRadius = headerNum(allHdr, 'RADIUS', 'RADIUS_KIC', 'RADIUSKIC') ?? 1.0;

  const totalDays = time[time.length - 1] - time[0];

  // Normalize
  const med = medianVal(flux);
  if (med === 0 || !isFinite(med)) return null;
  const normFlux = flux.map(v => v / med);
  const fmean = normFlux.reduce((a, b) => a + b, 0) / normFlux.length;
  const fstd  = Math.sqrt(normFlux.reduce((a, b) => a + (b - fmean) ** 2, 0) / normFlux.length);

  // Downsample to max 15000 points
  const MAX_PTS = 15000;
  const step = time.length > MAX_PTS ? Math.floor(time.length / MAX_PTS) : 1;
  const t = step > 1 ? time.filter((_, i) => i % step === 0) : time;
  const f = step > 1 ? normFlux.filter((_, i) => i % step === 0) : normFlux;

  // ── DETREND with sliding median ───────────────────────────────────────────
  // Window = 0.75 days: longer than any transit, shorter than stellar rotation
  const windowHalf = 0.75 / 2;
  const detrended  = new Array(t.length).fill(1.0);

  // For speed: use a sorted approach — precompute sorted time indices
  for (let i = 0; i < t.length; i++) {
    const local: number[] = [];
    // Binary search for window bounds
    let lo = i, hi = i;
    while (lo > 0 && t[i] - t[lo - 1] <= windowHalf) lo--;
    while (hi < t.length - 1 && t[hi + 1] - t[i] <= windowHalf) hi++;
    for (let j = lo; j <= hi; j++) local.push(f[j]);
    const localMed = medianVal(local);
    detrended[i] = localMed > 0 ? f[i] / localMed : 1.0;
  }

  // Clip >4σ outliers from detrended flux
  const dMean = detrended.reduce((a, b) => a + b, 0) / detrended.length;
  const dStd  = Math.sqrt(detrended.reduce((a, b) => a + (b - dMean) ** 2, 0) / detrended.length);
  const tBLS: number[] = [], fBLS: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (Math.abs(detrended[i] - 1.0) < 4 * dStd) {
      tBLS.push(t[i]); fBLS.push(detrended[i]);
    }
  }

  // ── BLS ──────────────────────────────────────────────────────────────────
  const minP = 0.3;
  const maxP = Math.min(totalDays * 0.49, 500);
  const bls  = runBLS(
    tBLS.length > 50 ? tBLS : t,
    fBLS.length > 50 ? fBLS : detrended,
    minP, maxP
  );

  const periodDays = bls.period;
  const depthFrac  = bls.depthFrac;
  const depthPpm   = depthFrac * 1e6;

  // Physics cap on duration
  const physMaxDurHr = 13 * Math.pow(stellarRadius, 1/3) * Math.pow(periodDays / 365.25, 1/3);
  const rawDurHr     = bls.durationFrac * periodDays * 24;
  const durationHr   = Math.min(rawDurHr, physMaxDurHr * 2.0);
  const durationDays = durationHr / 24;
  const dutyCycle    = durationHr / (periodDays * 24);

  const depthPerHr  = durationHr > 0 ? depthPpm / durationHr : 0;
  const logDepth    = Math.log10(Math.max(1, depthPpm));
  const logPeriod   = Math.log10(Math.max(0.1, periodDays));
  const logDuration = Math.log10(Math.max(0.01, durationHr));
  const depthXlogg  = depthPpm * stellarLogg;
  const periodXsrad = periodDays / Math.max(stellarRadius, 0.1);

  const tUI = tBLS.length > 50 ? tBLS : t;
  const fUI = fBLS.length > 50 ? fBLS : detrended;
  const nTransits = countTransits(tUI, fUI, periodDays, bls.t0, durationDays, 1 - depthFrac * 0.5);
  const rRatio    = Math.sqrt(Math.max(0, depthFrac));
  const estRadius = rRatio * stellarRadius * 109.076;
  const aAU       = Math.pow((periodDays / 365.25) ** 2, 1/3);
  const eqTemp    = stellarTeff * Math.pow(stellarRadius / (2 * aAU * 215.032), 0.5) *
                    Math.pow(0.7, 0.25);

  const feat: ExoplanetFeatures = {
    period_days:          periodDays,
    transit_depth_ppm:    depthPpm,
    transit_duration_hr:  durationHr,
    stellar_teff_k:       stellarTeff,
    stellar_logg:         stellarLogg,
    stellar_radius_rsun:  stellarRadius,
    depth_per_hr:         depthPerHr,
    duty_cycle:           dutyCycle,
    log_depth:            logDepth,
    log_period:           logPeriod,
    log_duration:         logDuration,
    depth_x_logg:         depthXlogg,
    period_x_srad:        periodXsrad,

    n_transits:               nTransits,
    est_planet_radius_rearth: isFinite(estRadius) ? Math.max(0, estRadius) : 0,
    eq_temperature_k:         isFinite(eqTemp)    ? Math.max(0, eqTemp)    : 0,
    total_obs_days:           totalDays,
    flux_std:                 fstd,
    bls_snr:                  bls.snr,
  };

  for (const k of Object.keys(feat) as (keyof ExoplanetFeatures)[]) {
    if (!isFinite(feat[k])) (feat[k] as number) = 0;
  }

  return feat;
}

export function getPlanetType(r: number): string {
  if (r < 1.25) return 'Earth-like';
  if (r < 2.0)  return 'Super-Earth';
  if (r < 6.0)  return 'Neptune-like';
  return 'Gas Giant';
}

export function getEquilibriumTemp(periodDays: number): number {
  const a = Math.pow(periodDays / 365.25, 2/3);
  return 278 * Math.pow(1 / (a * a), 0.25);
}
