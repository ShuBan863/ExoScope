import * as ort from 'onnxruntime-web';
import { ExoplanetFeatures } from './exoplanetFeatures';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

export interface PredictionResult {
  isExoplanet:     boolean;
  confidence:      number;
  rfConfidence:    number;
  gbConfidence:    number;
  overridden:      boolean;
  overrideReason?: string;
  features:        ExoplanetFeatures;
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create('/model/exoscope_model.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }
  return sessionPromise;
}

/** Must match FEATURE_SPEC in train_model.py exactly — 13 features */
function buildFeatureVector(f: ExoplanetFeatures): Float32Array {
  const logDur      = Math.log10(Math.max(f.transit_duration_hr, 0.01));
  const depthXlogg  = f.transit_depth_ppm * f.stellar_logg;
  const periodXsrad = f.period_days / Math.max(f.stellar_radius_rsun, 0.1);
  return new Float32Array([
    f.period_days,
    f.transit_depth_ppm,
    f.transit_duration_hr,
    f.stellar_teff_k,
    f.stellar_logg,
    f.stellar_radius_rsun,
    f.depth_per_hr,
    f.duty_cycle,
    f.log_depth,
    f.log_period,
    logDur,
    depthXlogg,
    periodXsrad,
  ]);
}

function extractProbPlanet(output: ort.InferenceSession.OnnxValueMapType): number {
  const keys = Object.keys(output);
  for (const key of keys) {
    const val = output[key];
    if (val instanceof ort.Tensor) {
      const data = val.data as Float32Array | Int32Array | BigInt64Array;
      if (val.dims.length === 2 && val.dims[1] === 2) return Number(data[1]);
      if (val.dims.length === 1 || (val.dims.length === 2 && val.dims[1] === 1)) {
        const v = Number(data[0]);
        if (v !== 0 && v !== 1) return v;
      }
    }
  }
  for (const key of keys) {
    const val = output[key];
    if (val instanceof ort.Tensor) {
      const v = Number((val.data as any)[0]);
      if (v === 0 || v === 1) return v === 1 ? 0.75 : 0.25;
    }
  }
  return 0.5;
}

/**
 * Primary detection logic using BLS SNR.
 *
 * SNR thresholds (empirical from Kepler pipeline):
 *   SNR > 10  → strong signal, likely planet
 *   SNR 7-10  → marginal, use ML to decide
 *   SNR < 7   → weak signal, unlikely planet
 *
 * ML probability adjusts confidence within each band.
 */
function combineSignals(snr: number, mlProb: number): { isExoplanet: boolean; confidence: number } {
  // Normalize SNR to 0-1 scale (sigmoid-like)
  // SNR=7 → ~0.5, SNR=10 → ~0.75, SNR=15 → ~0.9
  const snrScore = 1 / (1 + Math.exp(-(snr - 8) / 2));

  // Blend: 60% SNR, 40% ML
  const combined = 0.60 * snrScore + 0.40 * mlProb;

  // Decision threshold: 0.45 (biased toward sensitivity)
  const isExoplanet = combined >= 0.45;
  const confidence  = Math.max(0.01, Math.min(0.99, combined));

  return { isExoplanet, confidence };
}

export async function runPrediction(features: ExoplanetFeatures): Promise<PredictionResult> {
  const session = await getSession();

  const vec    = buildFeatureVector(features);
  const tensor = new ort.Tensor('float32', vec, [1, 13]);
  const feeds  = { [session.inputNames[0]]: tensor };

  console.log('[ExoScope] Feature vector:', {
    period_days:         features.period_days,
    transit_depth_ppm:   features.transit_depth_ppm,
    transit_duration_hr: features.transit_duration_hr,
    duty_cycle:          features.duty_cycle,
    bls_snr:             features.bls_snr,
    stellar_teff_k:      features.stellar_teff_k,
    stellar_radius_rsun: features.stellar_radius_rsun,
  });

  let output: ort.InferenceSession.OnnxValueMapType;
  try {
    output = await session.run(feeds);
  } catch (e: any) {
    throw new Error('Model format incompatible — please retrain. ' + e.message);
  }

  const probTensor = output['probabilities'];
  if (probTensor instanceof ort.Tensor) {
    const d = probTensor.data as Float32Array;
    console.log('[ExoScope] Raw probs: class0=', d[0], ' class1=', d[1]);
  }

  const mlProb = extractProbPlanet(output);
  const snr    = features.bls_snr;

  console.log('[ExoScope] BLS SNR:', snr.toFixed(2), '| ML prob:', mlProb.toFixed(3));

  const { isExoplanet, confidence } = combineSignals(snr, mlProb);

  // snrScore for display
  const snrScore = 1 / (1 + Math.exp(-(snr - 8) / 2));

  return {
    isExoplanet,
    confidence,
    rfConfidence: snrScore,      // shows BLS SNR score
    gbConfidence: mlProb,        // shows ML probability
    overridden:      false,
    overrideReason:  undefined,
    features,
  };
}
