/**
 * ExoAnalyzer.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Main analysis component for ExoScope.
 * Handles file upload → FITS parsing → feature extraction → ML prediction → display.
 *
 * Drop this into your src/components/ directory and import it in your page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef } from "react";
import { parseFITS }         from "../utils/fitsReader";
import { extractFeatures }   from "../utils/featureExtractor";
import { ExoScopePredictor } from "../utils/modelPredictor";

// Singleton predictor — loads model once, reuses across analyses
const predictor = new ExoScopePredictor();

export default function ExoAnalyzer() {
  const [stage,    setStage]    = useState("idle");       // idle | loading | done | error
  const [progress, setProgress] = useState({ pct: 0, msg: "" });
  const [result,   setResult]   = useState(null);
  const [rawLC,    setRawLC]    = useState(null);          // for plotting
  const [error,    setError]    = useState("");
  const [meta,     setMeta]     = useState(null);
  const fileRef = useRef(null);

  // ── Handle file selection
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.endsWith(".fits") && !file.name.endsWith(".fit")) {
      setError("Please upload a Kepler FITS file (.fits or .fit)");
      setStage("error");
      return;
    }

    setStage("loading");
    setError("");
    setResult(null);

    try {
      // 1. Load model (no-op if already loaded)
      setProgress({ pct: 2, msg: "Loading ML model…" });
      await predictor.load();

      // 2. Read FITS file
      setProgress({ pct: 8, msg: "Parsing FITS file…" });
      const buffer = await file.arrayBuffer();
      const parsed = parseFITS(buffer);
      setMeta(parsed.meta);
      setRawLC({ time: parsed.time, flux: parsed.flux });

      // 3. Extract features (BLS runs here — takes a few seconds)
      const { featureVector, features, blsResult, foldedLC, planetProps } =
        await extractFeatures(
          parsed.time,
          parsed.flux,
          parsed.fluxErr,
          parsed.meta,
          (pct, msg) => setProgress({ pct: 10 + Math.round(pct * 0.8), msg })
        );

      // 4. Run ONNX inference
      setProgress({ pct: 92, msg: "Running ML inference…" });
      const prediction = await predictor.predict(
        featureVector, features, planetProps, blsResult, parsed.meta
      );

      setResult({ prediction, features, blsResult, foldedLC, planetProps });
      setStage("done");

    } catch (e) {
      console.error(e);
      setError(e.message || "An unexpected error occurred.");
      setStage("error");
    }
  }, []);

  // ── Drag-and-drop handlers
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = (e) => e.preventDefault();

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      <div className="max-w-5xl mx-auto p-6 space-y-8">

        {/* ── Header */}
        <header className="text-center pt-8 space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-indigo-400">
            ✦ ExoScope
          </h1>
          <p className="text-gray-400 text-sm">
            Kepler light curve exoplanet detector · Fully client-side ML
          </p>
        </header>

        {/* ── Upload zone */}
        {stage === "idle" && (
          <UploadZone
            onDrop={onDrop}
            onDragOver={onDragOver}
            onFileSelect={handleFile}
            fileRef={fileRef}
          />
        )}

        {/* ── Loading */}
        {stage === "loading" && (
          <LoadingPanel progress={progress} />
        )}

        {/* ── Error */}
        {stage === "error" && (
          <ErrorPanel message={error} onReset={() => setStage("idle")} />
        )}

        {/* ── Results */}
        {stage === "done" && result && (
          <ResultPanel
            result={result}
            meta={meta}
            onReset={() => { setStage("idle"); setResult(null); }}
          />
        )}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function UploadZone({ onDrop, onDragOver, onFileSelect, fileRef }) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onClick={() => fileRef.current?.click()}
      className="border-2 border-dashed border-indigo-600 rounded-2xl p-16 text-center cursor-pointer
                 hover:border-indigo-400 hover:bg-indigo-950/20 transition-all duration-200"
    >
      <div className="text-5xl mb-4">🔭</div>
      <p className="text-lg text-gray-300 mb-2">Drop a Kepler FITS file here</p>
      <p className="text-sm text-gray-500">or click to browse · .fits / .fit files supported</p>
      <input
        ref={fileRef}
        type="file"
        accept=".fits,.fit"
        className="hidden"
        onChange={(e) => onFileSelect(e.target.files?.[0])}
      />
    </div>
  );
}

function LoadingPanel({ progress }) {
  return (
    <div className="rounded-2xl bg-gray-900 border border-gray-800 p-8 space-y-4">
      <p className="text-indigo-400 text-sm font-semibold">{progress.msg}</p>
      <div className="w-full bg-gray-800 rounded-full h-2">
        <div
          className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <p className="text-gray-500 text-xs text-right">{progress.pct}%</p>
      <p className="text-gray-600 text-xs text-center">
        The BLS transit search takes 5–15 seconds — hang tight.
      </p>
    </div>
  );
}

function ErrorPanel({ message, onReset }) {
  return (
    <div className="rounded-2xl bg-red-950/40 border border-red-800 p-6 space-y-3">
      <p className="text-red-400 font-semibold">⚠ Error</p>
      <p className="text-red-300 text-sm">{message}</p>
      <button
        onClick={onReset}
        className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white text-sm rounded-lg"
      >
        Try again
      </button>
    </div>
  );
}

function ResultPanel({ result, meta, onReset }) {
  const { prediction: p, features, blsResult, planetProps } = result;

  const planetBg   = p.isPlanet ? "bg-emerald-950/40 border-emerald-700" : "bg-red-950/30 border-red-800";
  const planetText = p.isPlanet ? "text-emerald-400" : "text-red-400";
  const verdict    = p.isPlanet ? "✓ PLANET DETECTED" : "✗ FALSE POSITIVE";

  return (
    <div className="space-y-6">

      {/* ── Verdict card */}
      <div className={`rounded-2xl border p-6 space-y-3 ${planetBg}`}>
        <div className="flex items-center justify-between">
          <span className={`text-xl font-bold tracking-wide ${planetText}`}>{verdict}</span>
          <span className="text-sm text-gray-400">
            {p.confidencePct}% confidence
          </span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full ${p.isPlanet ? "bg-emerald-500" : "bg-red-500"}`}
            style={{ width: `${p.confidencePct}%` }}
          />
        </div>
        <p className="text-gray-300 text-sm leading-relaxed">{p.explanation}</p>
      </div>

      {/* ── False positive flags */}
      {p.fpFlags.length > 0 && (
        <div className="rounded-xl bg-amber-950/30 border border-amber-800 p-4 space-y-2">
          <p className="text-amber-400 text-sm font-semibold">⚑ False Positive Flags</p>
          {p.fpFlags.map((flag, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className={
                flag.severity === "high"   ? "text-red-400"    :
                flag.severity === "medium" ? "text-amber-400"  : "text-yellow-600"
              }>
                {flag.severity === "high" ? "●" : flag.severity === "medium" ? "◐" : "○"}
              </span>
              <div>
                <span className="text-gray-300 font-medium">{flag.name}: </span>
                <span className="text-gray-400">{flag.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Planet properties (only if planet) */}
      {p.isPlanet && p.planet && (
        <div className="rounded-xl bg-indigo-950/30 border border-indigo-800 p-5 space-y-3">
          <p className="text-indigo-300 font-semibold">
            🪐 Planet Properties
            {p.planet.type && (
              <span className="ml-2 text-xs text-indigo-500">
                · {p.planet.type.tempClass} {p.planet.type.type}
              </span>
            )}
          </p>
          {p.planet.type && (
            <p className="text-gray-400 text-xs">{p.planet.type.description}</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatBox label="Radius" value={`${p.planet.radiusEarth.toFixed(2)} R⊕`} />
            <StatBox label="Period" value={`${p.planet.period.toFixed(3)} days`} />
            <StatBox label="Semi-major axis" value={`${p.planet.semiMajorAxisAU.toFixed(3)} AU`} />
            <StatBox label="Eq. temperature" value={`${Math.round(p.planet.teqK)} K`} />
            <StatBox label="Transit depth" value={`${p.planet.transitDepthPpm.toFixed(0)} ppm`} />
            <StatBox label="Transit SNR" value={p.planet.transitSNR.toFixed(1)} />
          </div>
          {p.planet.inHabitableZone && (
            <div className="rounded-lg bg-emerald-900/30 border border-emerald-700 px-3 py-2 text-emerald-300 text-sm">
              ⭐ This planet lies within the habitable zone ({planetProps.hz_inner.toFixed(2)}–{planetProps.hz_outer.toFixed(2)} AU)
            </div>
          )}
        </div>
      )}

      {/* ── Transit detection stats */}
      <div className="rounded-xl bg-gray-900 border border-gray-800 p-5 space-y-3">
        <p className="text-gray-300 font-semibold">📊 Transit Detection (BLS)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox label="Best period"     value={`${blsResult.period.toFixed(4)} d`} />
          <StatBox label="Transit depth"   value={`${blsResult.depth_ppm.toFixed(0)} ppm`} />
          <StatBox label="Duration"        value={`${blsResult.duration_hr.toFixed(2)} hr`} />
          <StatBox label="# of transits"   value={blsResult.n_transits} />
        </div>
      </div>

      {/* ── Stellar params */}
      {meta && (
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-5 space-y-3">
          <p className="text-gray-300 font-semibold">⭑ Host Star</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {meta.kepid    && <StatBox label="KIC ID"   value={meta.kepid} />}
            {meta.stellarTeff   && <StatBox label="Teff"    value={`${meta.stellarTeff} K`} />}
            {meta.stellarLogg   && <StatBox label="log g"   value={meta.stellarLogg.toFixed(2)} />}
            {meta.stellarRadius && <StatBox label="Radius"  value={`${meta.stellarRadius.toFixed(2)} R☉`} />}
          </div>
        </div>
      )}

      {/* ── Feature importance */}
      {p.featureImportance.length > 0 && (
        <details className="rounded-xl bg-gray-900 border border-gray-800 p-5">
          <summary className="text-gray-300 font-semibold cursor-pointer select-none">
            🔬 Feature Importance (click to expand)
          </summary>
          <div className="mt-3 space-y-2">
            {p.featureImportance.map(({ name, importance, value }) => (
              <div key={name} className="flex items-center gap-3 text-xs">
                <span className="text-gray-400 w-40 truncate">{name}</span>
                <div className="flex-1 bg-gray-800 rounded h-1.5">
                  <div
                    className="bg-indigo-500 h-1.5 rounded"
                    style={{ width: `${importance * 100}%` }}
                  />
                </div>
                <span className="text-gray-500 w-12 text-right">
                  {(importance * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Reset button */}
      <div className="text-center pb-8">
        <button
          onClick={onReset}
          className="px-6 py-2 bg-indigo-700 hover:bg-indigo-600 text-white rounded-xl text-sm"
        >
          Analyze another file
        </button>
      </div>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2">
      <p className="text-gray-500 text-xs">{label}</p>
      <p className="text-gray-200 text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}
