import React from 'react';
import { EDUCATIONAL_CONTENT } from '../constants';

export const InfoPanel: React.FC = () => {
  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 space-y-6">
      <div>
        <h3 className="text-xl font-bold text-cyan-400 mb-3">Social Significance</h3>
        <ul className="space-y-2">
          {EDUCATIONAL_CONTENT.significance.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-slate-300 text-sm">
              <span className="text-cyan-500 mt-1">✦</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-xl font-bold text-cyan-400 mb-3">Data Sources</h3>
        <p className="text-sm text-slate-400 mb-2">
          This tool simulates the preprocessing pipelines used on raw FITS files from:
        </p>
        <ul className="space-y-1">
          {EDUCATIONAL_CONTENT.sources.map((source, idx) => (
            <li key={idx} className="text-xs text-slate-400 bg-slate-900/50 px-2 py-1 rounded inline-block mr-2 mb-2 border border-slate-700">
              {source}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-xl font-bold text-cyan-400 mb-3">Model Info</h3>
        <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400">
            <strong className="text-slate-200">Architecture:</strong> Gemini 2.5 Flash (Multimodal LLM)
          </p>
          <p className="text-xs text-slate-400 mt-1">
            <strong className="text-slate-200">Task:</strong> Time-series pattern recognition & reasoning
          </p>
          <p className="text-xs text-slate-400 mt-1">
            <strong className="text-slate-200">Evaluation:</strong> Validated against KOI/TCE catalog patterns.
          </p>
        </div>
      </div>
    </div>
  );
};