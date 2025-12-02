import React from 'react';
import { AnalysisResult as AnalysisResultType } from '../types';

interface Props {
  result: AnalysisResultType | null;
  loading: boolean;
}

export const AnalysisResult: React.FC<Props> = ({ result, loading }) => {
  if (loading) {
    return (
      <div className="w-full h-full min-h-[200px] flex flex-col items-center justify-center bg-slate-800 rounded-xl border border-slate-700 animate-pulse">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-cyan-400 font-mono text-sm">Analyzing Light Curve...</p>
        <p className="text-slate-500 text-xs mt-2">Checking against TCE patterns</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="w-full h-full min-h-[200px] flex flex-col items-center justify-center bg-slate-800/50 rounded-xl border border-slate-700 border-dashed">
        <p className="text-slate-500 text-sm">Select a dataset and run analysis</p>
      </div>
    );
  }

  const isPositive = result.classification === "PLANET_CANDIDATE";
  const confidenceColor = result.confidence > 80 ? 'text-green-400' : result.confidence > 50 ? 'text-yellow-400' : 'text-red-400';
  
  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 h-full flex flex-col">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-sm text-slate-400 uppercase tracking-wider font-bold">Detection Result</h2>
          <div className={`text-3xl font-bold mt-1 ${isPositive ? 'text-cyan-400' : 'text-slate-300'}`}>
            {result.classification.replace('_', ' ')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-400 uppercase tracking-wider font-bold">Confidence</div>
          <div className={`text-3xl font-bold mt-1 ${confidenceColor}`}>
            {result.confidence}%
          </div>
        </div>
      </div>

      <div className="bg-slate-900/50 rounded-lg p-4 mb-4 border border-slate-700 flex-grow">
        <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Analysis Report</h3>
        <p className="text-slate-300 text-sm leading-relaxed">
          {result.explanation}
        </p>
      </div>

      <div>
        <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Detected Features</h3>
        <div className="flex flex-wrap gap-2">
          {result.featuresDetected.map((feature, idx) => (
            <span key={idx} className="px-2 py-1 rounded bg-slate-700 text-slate-200 text-xs border border-slate-600">
              {feature}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};