import { ParsedFitsData } from '../types';

export interface ExoplanetFeatures {
  flux_std: number;
  flux_range: number;
  flux_skewness: number;
  frac_below_1sigma: number;
  transit_depth_ppm: number;
  n_transits: number;
  mean_transit_duration_hrs: number;
  median_transit_depth_frac: number;
  transit_depth_consistency: number;
  period_days: number;
  total_obs_days: number;
  expected_n_transits: number;
  transit_count_ratio: number;
  transit_v_shape_score: number;
  even_odd_depth_ratio: number;
  r_ratio: number;
  est_planet_radius_rearth: number;
  duration_period_ratio: number;
  ls_peak_power: number;
  ls_best_period: number;
  log_depth: number;
  log_period: number;
  log_n_transits: number;
  zero_transit_flag: number;
  short_period_no_transit: number;
  transit_reality_score: number;
}

function medianVal(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function findPeaks(arr: number[], minHeight: number, minDist: number): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] > minHeight && arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist) peaks.push(i);
    }
  }
  return peaks;
}

function autocorrelation(fc: number[]): number[] {
  const n = fc.length;
  const denom = fc.reduce((a, b) => a + b * b, 0) + 1e-12;
  const ac: number[] = [];
  for (let lag = 0; lag < n; lag++) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += fc[i] * fc[i + lag];
    ac.push(s / denom);
  }
  return ac;
}

function lombScargle(time: number[], flux: number[], minP: number, maxP: number): { power: number; period: number } {
  const n = flux.length;
  const mean = flux.reduce((a, b) => a + b, 0) / n;
  const fc = flux.map(x => x - mean);
  const variance = fc.reduce((a, b) => a + b * b, 0) / n + 1e-12;
  const nFreqs = 300;
  const minF = 1.0 / maxP;
  const maxF = 1.0 / minP;
  const step = (maxF - minF) / nFreqs;
  let bestPow = 0, bestPer = (minP + maxP) / 2;
  for (let fi = 0; fi <= nFreqs; fi++) {
    const freq = minF + fi * step;
    const omega = 2 * Math.PI * freq;
    let sc = 0, ss = 0, scc = 0, sss = 0;
    for (let i = 0; i < n; i++) {
      const ph = omega * time[i];
      const c = Math.cos(ph), s = Math.sin(ph);
      sc += fc[i] * c; ss += fc[i] * s;
      scc += c * c; sss += s * s;
    }
    const pow = (sc * sc / (scc + 1e-12) + ss * ss / (sss + 1e-12)) / (2 * variance);
    if (pow > bestPow) { bestPow = pow; bestPer = 1 / freq; }
  }
  return { power: Math.min(bestPow, 1.0), period: bestPer };
}

export function extractFeatures(fitsData: ParsedFitsData): ExoplanetFeatures | null {
  const timeCol = fitsData.columns.find(c => c === 'TIME') || fitsData.columns[0];
  const fluxCol = fitsData.columns.find(c => c === 'PDCSAP_FLUX')
    || fitsData.columns.find(c => c === 'SAP_FLUX')
    || fitsData.columns.find(c => c === 'FLUX');
  if (!timeCol || !fluxCol) return null;

  const time: number[] = [], flux: number[] = [];
  for (let i = 0; i < fitsData.rowCount; i++) {
    const t = fitsData.data[timeCol][i], f = fitsData.data[fluxCol][i];
    if (t !== null && f !== null && isFinite(t) && isFinite(f)) { time.push(t); flux.push(f); }
  }
  if (flux.length < 200) return null;

  const idx = time.map((_, i) => i).sort((a, b) => time[a] - time[b]);
  const st = idx.map(i => time[i]);
  const sf = idx.map(i => flux[i]);
  const med = medianVal(sf);
  if (med === 0) return null;
  const nf = sf.map(f => f / med);

  const totalDays = st[st.length - 1] - st[0];
  const diffs = st.slice(1).map((t, i) => t - st[i]);
  const cadence = medianVal(diffs);

  const fmean = nf.reduce((a, b) => a + b, 0) / nf.length;
  const fvar = nf.reduce((a, b) => a + (b - fmean) ** 2, 0) / nf.length;
  const fstd = Math.sqrt(fvar);
  const skew = fstd > 0 ? nf.reduce((a, b) => a + ((b - fmean) / fstd) ** 3, 0) / nf.length : 0;
  const fracBelow = nf.filter(f => f < 1 - fstd).length / nf.length;

  const sorted = [...nf].sort((a, b) => a - b);
  const p2 = sorted[Math.floor(0.02 * sorted.length)];
  const p50 = sorted[Math.floor(0.50 * sorted.length)];
  const depthPpm = Math.max(0, (p50 - p2) / p50 * 1e6);

  
  const thresh = Math.min(1.0 - 3 * fstd, 0.999);
  const durHrsList: number[] = [], depthList: number[] = [], midList: number[] = [];
  let k = 0;
  while (k < nf.length) {
    if (nf[k] < thresh) {
      let j = k;
      while (j < nf.length && nf[j] < thresh) j++;
      const segT = st.slice(k, j), segF = nf.slice(k, j);
      if (segT.length >= 3) {
        const dur = (segT[segT.length - 1] - segT[0]) * 24;
        if (dur > 0.1 && dur < 48) {
          durHrsList.push(dur);
          depthList.push(1.0 - Math.min(...segF));
          midList.push(segT.reduce((a, b) => a + b, 0) / segT.length);
        }
      }
      k = j;
    } else k++;
  }

  const nTr = durHrsList.length;
  const meanDur = nTr > 0 ? durHrsList.reduce((a, b) => a + b, 0) / nTr : 0;
  const medDepth = nTr > 0 ? medianVal(depthList) : 0;
  const depthConsistency = nTr > 0
    ? Math.sqrt(depthList.reduce((a, b) => a + (b - medDepth) ** 2, 0) / nTr) / (depthList.reduce((a, b) => a + b, 0) / nTr + 1e-9)
    : 1.0;

  
  let period: number | null = null;
  if (nTr >= 2) {
    const sm = [...midList].sort((a, b) => a - b);
    const gaps = sm.slice(1).map((t, i) => t - sm[i]).filter(g => g > 0.3 && g < totalDays * 0.9);
    if (gaps.length > 0) { const c = medianVal(gaps); if (c > 0.3 && c < 600) period = c; }
  }
  if (period === null) {
    const fc0 = nf.map(x => x - fmean);
    const ac = autocorrelation(fc0);
    const minLag = Math.max(2, Math.floor(0.3 / cadence));
    const maxLag = Math.min(nf.length - 1, Math.floor(totalDays * 0.5 / cadence));
    if (maxLag > minLag) {
      const search = ac.slice(minLag, maxLag);
      const minD = Math.max(1, Math.floor(0.3 / cadence));
      const peaks = findPeaks(search, 0.05, minD);
      if (peaks.length > 0) {
        const best = peaks.reduce((b, p) => search[p] > search[b] ? p : b, peaks[0]);
        const c = (best + minLag) * cadence;
        if (c > 0.3 && c < 600) period = c;
      }
    }
  }
  if (period === null) period = Math.max(0.3, Math.min(600, totalDays / Math.max(nTr, 2)));

  const expNTr = period > 0 ? totalDays / period : 1;
  const tcRatio = Math.min(nTr, expNTr) / Math.max(nTr, expNTr, 1);

  let vShape = 0;
  if (nTr > 0) vShape = depthList[depthList.indexOf(Math.max(...depthList))] * 0.5;

  let eoRatio = 0;
  if (nTr >= 4) {
    const ev = depthList.filter((_, i) => i % 2 === 0), od = depthList.filter((_, i) => i % 2 === 1);
    const em = ev.reduce((a, b) => a + b, 0) / ev.length, om = od.reduce((a, b) => a + b, 0) / od.length;
    const am = depthList.reduce((a, b) => a + b, 0) / nTr;
    eoRatio = Math.abs(em - om) / (am + 1e-9);
  }

  const rRatio = Math.sqrt(Math.max(depthPpm / 1e6, 0));
  const estRadius = rRatio * 109;
  const durPerRatio = period > 0 && meanDur > 0 ? meanDur / (period * 24) : 0;

  const ls = st.length > 100 ? lombScargle(st, nf, 0.3, Math.min(300, totalDays * 0.9)) : { power: 0, period };

  const feat: ExoplanetFeatures = {
    flux_std: fstd,
    flux_range: Math.max(...nf) - Math.min(...nf),
    flux_skewness: skew,
    frac_below_1sigma: fracBelow,
    transit_depth_ppm: depthPpm,
    n_transits: nTr,
    mean_transit_duration_hrs: meanDur,
    median_transit_depth_frac: medDepth,
    transit_depth_consistency: depthConsistency,
    period_days: period,
    total_obs_days: totalDays,
    expected_n_transits: expNTr,
    transit_count_ratio: tcRatio,
    transit_v_shape_score: vShape,
    even_odd_depth_ratio: eoRatio,
    r_ratio: rRatio,
    est_planet_radius_rearth: estRadius,
    duration_period_ratio: durPerRatio,
    ls_peak_power: ls.power,
    ls_best_period: ls.period,
    log_depth: Math.log10(depthPpm + 1),
    log_period: Math.log10(period + 0.01),
    log_n_transits: Math.log10(nTr + 1),
    zero_transit_flag: nTr === 0 ? 1 : 0,
    short_period_no_transit: (nTr === 0 && period < 2.0) ? 1 : 0,
    transit_reality_score: nTr === 0 ? 0 : Math.min(1, nTr / Math.max(expNTr, 1)),
  };

  for (const k of Object.keys(feat) as (keyof ExoplanetFeatures)[]) {
    if (!isFinite(feat[k])) feat[k] = 0;
  }
  return feat;
}

export function getPlanetType(r: number): string {
  if (r < 1.25) return 'Earth-like';
  if (r < 2.0) return 'Super-Earth';
  if (r < 6.0) return 'Neptune-like';
  return 'Gas Giant';
}

export function getEquilibriumTemp(periodDays: number): number {
  const a = Math.pow(periodDays / 365.25, 2 / 3);
  return 278 * Math.pow(1 / (a * a), 0.25);
}
