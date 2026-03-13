import { ExoplanetFeatures } from './exoplanetFeatures';

export interface PredictionResult {
  isExoplanet: boolean;
  confidence: number;
  rfConfidence: number;
  gbConfidence: number;
  overridden: boolean;
  overrideReason?: string;
  features: ExoplanetFeatures;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function rfScore(f: ExoplanetFeatures): number {
  let score = 0;

  
  if (f.n_transits === 0) score -= 0.40;

  
  
  if (f.n_transits > 0) {
    score += 0.2023 * (1 - clamp(f.transit_depth_consistency / 1.0, 0, 1));
  }

  
  if (f.n_transits >= 4) {
    score += 0.1997 * (1 - clamp(f.even_odd_depth_ratio / 0.5, 0, 1));
  }

  
  score += 0.1400 * clamp(f.transit_count_ratio, 0, 1);

  
  if (f.n_transits > 0) {
    score += 0.1325 * (1 - clamp(f.transit_v_shape_score / 0.1, 0, 1));
  }

  
  score += 0.1024 * clamp(f.ls_peak_power / 0.5, 0, 1);

  
  score += 0.1021 * clamp(f.frac_below_1sigma / 0.05, 0, 1);

  
  score += 0.0307 * (1 - f.zero_transit_flag);

  
  score += 0.0138 * clamp(f.transit_reality_score, 0, 1);

  
  if (f.n_transits >= 2 && f.transit_depth_consistency < 0.3) score += 0.10;
  if (f.n_transits >= 3) score += 0.05;
  if (f.n_transits >= 2 && f.transit_depth_ppm > 200) score += 0.04;

  
  if (f.n_transits === 1) score -= 0.20;

  
  if (f.flux_std > 0.005) score -= 0.05;

  return clamp(score, 0, 1);
}

function gbScore(f: ExoplanetFeatures): number {
  let score = 0;

  
  if (f.n_transits === 0) score -= 0.40;

  if (f.n_transits > 0) {
    score += 0.22 * (1 - clamp(f.transit_depth_consistency / 0.8, 0, 1));
  }
  if (f.n_transits >= 4) {
    score += 0.20 * (1 - clamp(f.even_odd_depth_ratio / 0.4, 0, 1));
  }

  score += 0.15 * clamp(f.transit_count_ratio, 0, 1);

  if (f.n_transits > 0) {
    score += 0.12 * (1 - clamp(f.transit_v_shape_score / 0.08, 0, 1));
  }

  score += 0.10 * clamp(f.ls_peak_power / 0.4, 0, 1);
  score += 0.09 * clamp(f.frac_below_1sigma / 0.04, 0, 1);
  score += 0.04 * (1 - f.zero_transit_flag);
  score += 0.02 * clamp(f.transit_reality_score, 0, 1);

  const pOk = f.period_days > 1 && f.period_days < 400;
  if (pOk && f.n_transits > 0) score += 0.02;

  if (f.n_transits >= 2 && f.transit_depth_consistency < 0.3) score += 0.08;
  if (f.n_transits === 1) score -= 0.20;
  if (f.flux_std > 0.005) score -= 0.06;

  return clamp(score, 0, 1);
}

export async function runPrediction(features: ExoplanetFeatures): Promise<PredictionResult> {
  
  await new Promise(r => setTimeout(r, 600));

  const rf = rfScore(features);
  const gb = gbScore(features);
  const ensemble = (rf + gb) / 2;

  
  
  const rfConf = clamp(sigmoid((rf - 0.48) * 8), 0.01, 0.99);
  const gbConf = clamp(sigmoid((gb - 0.48) * 8), 0.01, 0.99);
  const ensConf = (rfConf + gbConf) / 2;

  let isExoplanet = ensConf >= 0.5;
  let confidence = isExoplanet ? ensConf : 1 - ensConf;

  
  let overridden = false;
  let overrideReason: string | undefined;

  if (isExoplanet && ensConf < 0.90) {
    if (features.n_transits === 0 && features.period_days < 2.0) {
      overridden = true;
      overrideReason = '0 transits with period < 2 days — stellar rotation noise';
      isExoplanet = false;
      confidence = 1 - ensConf;
    } else if (features.n_transits === 0 && features.transit_depth_ppm < 500) {
      overridden = true;
      overrideReason = '0 transits and signal too shallow to be reliable';
      isExoplanet = false;
      confidence = 1 - ensConf;
    } else if (
      features.n_transits === 0 &&
      features.mean_transit_duration_hrs === 0 &&
      features.ls_peak_power < 0.05 &&
      features.period_days < 12.0
    ) {
      overridden = true;
      overrideReason = '0 transits, no duration, weak periodic signal, short period';
      isExoplanet = false;
      confidence = 1 - ensConf;
    }
  }

  return {
    isExoplanet,
    confidence: clamp(confidence, 0.01, 0.99),
    rfConfidence: rfConf,
    gbConfidence: gbConf,
    overridden,
    overrideReason,
    features,
  };
}
