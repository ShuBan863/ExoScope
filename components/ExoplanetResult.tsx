import React from 'react';
import { PredictionResult } from '../utils/exoplanetModel';
import { getPlanetType, getEquilibriumTemp } from '../utils/exoplanetFeatures';
import { AlertTriangle, CheckCircle, XCircle, Zap, Globe, Thermometer, Clock, Layers } from 'lucide-react';

interface ExoplanetResultProps {
  result: PredictionResult;
}

const ConfidenceArc: React.FC<{ value: number; isExoplanet: boolean }> = ({ value, isExoplanet }) => {
  const pct = Math.round(value * 100);
  const r = 54;
  const circumference = Math.PI * r; 
  const dash = (pct / 100) * circumference;
  const color = isExoplanet
    ? (pct > 80 ? '#22d3ee' : '#f59e0b')
    : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="80" viewBox="0 0 140 80">
        {}
        <path
          d="M 16 70 A 54 54 0 0 1 124 70"
          fill="none" stroke="#1e293b" strokeWidth="12" strokeLinecap="round"
        />
        {}
        <path
          d="M 16 70 A 54 54 0 0 1 124 70"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
        <text x="70" y="68" textAnchor="middle" fill={color} fontSize="22" fontWeight="bold" fontFamily="monospace">
          {pct}%
        </text>
      </svg>
      <span className="text-xs text-slate-500 -mt-1">Confidence</span>
    </div>
  );
};

const ModelBar: React.FC<{ label: string; value: number; isExoplanet: boolean }> = ({ label, value, isExoplanet }) => {
  const pct = Math.round(value * 100);
  const color = isExoplanet ? 'bg-cyan-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-slate-400 w-10 text-right">{pct}%</span>
    </div>
  );
};

const StatPill: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
    <span className="text-cyan-500">{icon}</span>
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-mono text-slate-200">{value}</div>
    </div>
  </div>
);

const ExoplanetResult: React.FC<ExoplanetResultProps> = ({ result }) => {
  const { isExoplanet, confidence, rfConfidence, gbConfidence, overridden, overrideReason, features } = result;
  const planetType = getPlanetType(features.est_planet_radius_rearth);
  const teq = getEquilibriumTemp(features.period_days);
  const habitable = teq > 200 && teq < 320;

  return (
    <div className={`
      border rounded-xl p-6 mb-6 backdrop-blur-sm transition-all
      ${isExoplanet
        ? 'bg-cyan-950/20 border-cyan-800/50'
        : 'bg-slate-900/50 border-slate-800'}
    `}>
      {}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {isExoplanet
            ? <CheckCircle className="w-7 h-7 text-cyan-400" />
            : <XCircle className="w-7 h-7 text-red-400" />
          }
          <div>
            <h2 className={`text-xl font-bold ${isExoplanet ? 'text-cyan-300' : 'text-slate-300'}`}>
              {isExoplanet ? '✅ Exoplanet Candidate Detected' : '❌ No Exoplanet Detected'}
            </h2>
            <p className="text-slate-500 text-sm mt-0.5">
              ML Ensemble Analysis · {features.total_obs_days.toFixed(0)} days observed
            </p>
          </div>
        </div>
        <ConfidenceArc value={confidence} isExoplanet={isExoplanet} />
      </div>

      {}
      {overridden && (
        <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-800/50 rounded-lg px-4 py-3 mb-5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">Physics Override Active</span>
            <p className="text-xs text-amber-300/80 mt-0.5">{overrideReason}</p>
          </div>
        </div>
      )}

      {}
      <div className="bg-slate-950/40 border border-slate-800/50 rounded-lg p-4 mb-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Model Breakdown</p>
        <div className="space-y-2.5">
          <ModelBar label="Random Forest" value={rfConfidence} isExoplanet={isExoplanet} />
          <ModelBar label="Grad. Boosting" value={gbConfidence} isExoplanet={isExoplanet} />
          <ModelBar label="Ensemble" value={confidence} isExoplanet={isExoplanet} />
        </div>
      </div>

      {}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatPill icon={<Zap className="w-4 h-4" />} label="Transit Depth" value={`${features.transit_depth_ppm.toFixed(0)} ppm`} />
        <StatPill icon={<Clock className="w-4 h-4" />} label="Orbital Period" value={`${features.period_days.toFixed(2)} days`} />
        <StatPill icon={<Globe className="w-4 h-4" />} label="Est. Radius" value={`${features.est_planet_radius_rearth.toFixed(2)} R⊕`} />
        <StatPill icon={<Layers className="w-4 h-4" />} label="Transits Found" value={`${features.n_transits}`} />
        <StatPill icon={<Thermometer className="w-4 h-4" />} label="Equil. Temp" value={`${teq.toFixed(0)} K`} />
        <StatPill
          icon={<Globe className="w-4 h-4" />}
          label={isExoplanet ? 'Planet Type' : 'Signal Type'}
          value={isExoplanet ? planetType : 'False Positive'}
        />
      </div>

      {}
      <div className="space-y-1.5">
        {features.n_transits === 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-400/80">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            No clear transit dips detected in this light curve quarter
          </div>
        )}
        {features.flux_std > 0.003 && (
          <div className="flex items-center gap-2 text-xs text-amber-400/80">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            High stellar variability — may mask or mimic transit signals
          </div>
        )}
        {habitable && isExoplanet && (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            Estimated equilibrium temperature within habitable zone range (200–320 K)
          </div>
        )}
      </div>
    </div>
  );
};

export default ExoplanetResult;
