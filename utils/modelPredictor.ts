/**
 * modelPredictor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads the ONNX model and runs inference entirely in the browser.
 * Uses onnxruntime-web (WebAssembly backend — no GPU needed, works everywhere).
 *
 * Install:  npm install onnxruntime-web
 *
 * Usage:
 *   import { ExoScopePredictor } from './utils/modelPredictor';
 *
 *   const predictor = new ExoScopePredictor();
 *   await predictor.load();
 *   const result = await predictor.predict(featureVector, features, planetProps, blsResult);
 *   // result.isPlanet, result.confidence, result.explanation, etc.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as ort from "onnxruntime-web";

// Tell onnxruntime-web where to find the WASM files (they must be in /public/)
ort.env.wasm.wasmPaths = "/";

const MODEL_URL        = "/model/exoscope_model.onnx";
const FEATURE_CFG_URL  = "/model/feature_config.json";

// ─────────────────────────────────────────────────────────────────────────────
// ExoScopePredictor class
// ─────────────────────────────────────────────────────────────────────────────

export class ExoScopePredictor {
  constructor() {
    this.session    = null;
    this.config     = null;
    this.loaded     = false;
  }

  /** Load the ONNX model and feature config. Call once before predicting. */
  async load() {
    if (this.loaded) return;

    const [session, config] = await Promise.all([
      ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],   // WebAssembly — works on all browsers
        graphOptimizationLevel: "all",
      }),
      fetch(FEATURE_CFG_URL).then(r => r.json()),
    ]);

    this.session = session;
    this.config  = config;
    this.loaded  = true;

    console.log(
      `[ExoScope] Model loaded.\n` +
      `  Training accuracy: ${(config.training_stats.accuracy * 100).toFixed(1)}%\n` +
      `  Training ROC-AUC : ${config.training_stats.roc_auc.toFixed(4)}\n` +
      `  Trained on       : ${config.training_stats.n_total.toLocaleString()} KOIs`
    );
  }

  /**
   * Run the full prediction pipeline and return a rich result object.
   *
   * @param {Float32Array} featureVector  - 10 features in model order
   * @param {Object}       features       - Named features (for display)
   * @param {Object}       planetProps    - Derived planet properties
   * @param {Object}       blsResult      - Raw BLS output
   * @param {Object}       meta           - Light curve metadata
   */
  async predict(featureVector, features, planetProps, blsResult, meta) {
    if (!this.loaded) await this.load();

    // ── Run ONNX inference
    const inputTensor = new ort.Tensor("float32", featureVector, [1, featureVector.length]);
    const feeds = { [this.session.inputNames[0]]: inputTensor };
    const output = await this.session.run(feeds);

    // Output: label tensor + probability tensor
    const labelTensor = output[this.session.outputNames[0]];
    const probTensor  = output[this.session.outputNames[1]];

    const predictedLabel = Number(labelTensor.data[0]);
    // Probability array: [P(FP), P(planet)]
    const probData = probTensor.data;
    const probPlanet = probData.length >= 2 ? probData[1] : probData[0];
    const probFP     = probData.length >= 2 ? probData[0] : 1 - probData[0];

    const confidence = predictedLabel === 1 ? probPlanet : probFP;
    const isPlanet   = predictedLabel === 1;

    // ── Generate explanation
    const explanation = this._generateExplanation(
      isPlanet, probPlanet, features, planetProps, blsResult
    );

    // ── False positive assessment
    const fpFlags = this._checkFalsePositiveFlags(features, blsResult);

    // ── Planet type classification
    const planetType = isPlanet ? classifyPlanet(features, planetProps) : null;

    return {
      isPlanet,
      probPlanet:   Number(probPlanet),
      probFP:       Number(probFP),
      confidence:   Number(confidence),
      confidencePct: Math.round(Number(confidence) * 100),

      // Planet properties (only meaningful if isPlanet)
      planet: isPlanet ? {
        radiusEarth:     planetProps.radiusEarth,
        period:          blsResult.period,
        semiMajorAxisAU: planetProps.semiMajorAxisAU,
        teqK:            planetProps.teqK,
        inHabitableZone: planetProps.inHabitableZone,
        transitDepthPpm: blsResult.depth_ppm,
        transitSNR:      blsResult.snr,
        nTransits:       blsResult.n_transits,
        type:            planetType,
      } : null,

      // Host star info
      star: {
        teff:   features.stellar_teff_k,
        logg:   features.stellar_logg,
        radius: features.stellar_radius_rsun,
      },

      // Human-readable explanation
      explanation,
      fpFlags,
      featureImportance: this._getFeatureImportance(features),
    };
  }

  /** Generate a human-readable explanation of the prediction */
  _generateExplanation(isPlanet, probPlanet, features, planetProps, blsResult) {
    const pct   = Math.round(probPlanet * 100);
    const depth = features.transit_depth_ppm.toFixed(0);
    const period = blsResult.period.toFixed(2);
    const snr    = blsResult.snr.toFixed(1);

    if (isPlanet) {
      const lines = [
        `The model predicts a planet with ${pct}% confidence.`,
        `A periodic transit signal was detected every ${period} days, ` +
          `causing a ${depth} ppm dip in the star's brightness — ` +
          `consistent with an object blocking ~${(Math.sqrt(features.transit_depth_ppm / 1e6) * 100).toFixed(2)}% ` +
          `of the stellar disk.`,
        `The transit signal-to-noise ratio is ${snr}, ` +
          (blsResult.snr > 15 ? "which is very strong and highly reliable." :
           blsResult.snr > 7  ? "which is solid and above the detection threshold." :
                                 "which is marginal — treat with caution."),
      ];

      if (planetProps.inHabitableZone) {
        lines.push(
          `⭐ This planet falls within the star's habitable zone ` +
          `(${planetProps.hz_inner.toFixed(2)}–${planetProps.hz_outer.toFixed(2)} AU), ` +
          `with an estimated equilibrium temperature of ${Math.round(planetProps.teqK)} K.`
        );
      }

      if (features.odd_even_depth_diff < 1.5) {
        lines.push(
          `Odd and even transits have consistent depths, reducing the likelihood ` +
          `of an eclipsing binary contamination.`
        );
      }

      return lines.join(" ");

    } else {
      const lines = [
        `The model predicts this is NOT a planet (false positive) — confidence ${100 - pct}%.`,
      ];

      if (features.odd_even_depth_diff > 3) {
        lines.push(
          `The odd and even transits differ significantly (${features.odd_even_depth_diff.toFixed(1)}σ), ` +
          `which is a strong indicator of an eclipsing binary star system mimicking a planet transit.`
        );
      } else if (features.transit_depth_ppm > 50000) {
        lines.push(
          `The transit depth of ${depth} ppm is very large — ` +
          `this would correspond to a sub-stellar or stellar companion, not a planet.`
        );
      } else if (blsResult.snr < 7) {
        lines.push(
          `The transit SNR of ${snr} is too low to confidently claim a detection. ` +
          `This may be noise or a stellar variability artifact.`
        );
      } else {
        lines.push(
          `The combination of transit geometry, stellar parameters, and signal shape ` +
          `does not match the typical profile of a transiting exoplanet.`
        );
      }

      return lines.join(" ");
    }
  }

  /** Flag specific false-positive indicators */
  _checkFalsePositiveFlags(features, blsResult) {
    const flags = [];

    if (features.odd_even_depth_diff > 3.0) {
      flags.push({
        name:     "Odd/Even Depth Mismatch",
        severity: "high",
        detail:   `${features.odd_even_depth_diff.toFixed(1)}σ difference between odd and even transits. Likely an eclipsing binary.`,
      });
    }

    if (features.transit_depth_ppm > 80000) {
      flags.push({
        name:     "Very Deep Transit",
        severity: "medium",
        detail:   `Transit depth of ${features.transit_depth_ppm.toFixed(0)} ppm (${(features.transit_depth_ppm / 10000).toFixed(1)}%) is deeper than typical planets.`,
      });
    }

    if (blsResult.snr < 7.1) {
      flags.push({
        name:     "Low Signal-to-Noise",
        severity: blsResult.snr < 4 ? "high" : "low",
        detail:   `Transit SNR = ${blsResult.snr.toFixed(1)}. The Kepler pipeline requires SNR > 7.1 for a threshold crossing event.`,
      });
    }

    if (features.transit_duration_hr > 15) {
      flags.push({
        name:     "Unusually Long Transit",
        severity: "low",
        detail:   `Transit duration of ${features.transit_duration_hr.toFixed(1)} hours is longer than typical for planetary transits.`,
      });
    }

    return flags;
  }

  /** Return feature importance from config for display */
  _getFeatureImportance(features) {
    if (!this.config?.training_stats?.feature_importances) return [];

    const imps = this.config.training_stats.feature_importances;
    return Object.entries(imps)
      .sort((a, b) => b[1] - a[1])
      .map(([name, importance]) => ({
        name,
        importance,
        value: features[name],
      }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Planet type classification based on radius and temperature
// Uses the radius gap (Fulton gap) at ~1.8 R_Earth
// ─────────────────────────────────────────────────────────────────────────────

function classifyPlanet(features, planetProps) {
  const R = planetProps.radiusEarth;
  const T = planetProps.teqK;

  let type, description;

  if (R < 1.2) {
    type = "Earth-sized";
    description = "A rocky world roughly the size of Earth.";
  } else if (R < 1.8) {
    type = "Super-Earth";
    description = "Likely a rocky planet, possibly with a thin atmosphere.";
  } else if (R < 4.0) {
    type = "Sub-Neptune";
    description = "A volatile-rich planet with a thick gaseous envelope — no solid surface.";
  } else if (R < 10) {
    type = "Neptune-sized";
    description = "An ice or gas giant similar in size to Neptune or Uranus.";
  } else if (R < 20) {
    type = "Saturn-sized";
    description = "A large gas giant comparable to Saturn.";
  } else {
    type = "Jupiter-sized";
    description = "A massive gas giant in the Jupiter class or larger.";
  }

  // Temperature sub-classification
  let tempClass;
  if (T < 250)      tempClass = "Cold";
  else if (T < 400) tempClass = "Temperate";
  else if (T < 700) tempClass = "Warm";
  else if (T < 1200) tempClass = "Hot";
  else               tempClass = "Ultra-hot";

  return { type, description, tempClass };
}
