import React, { useState, useCallback } from 'react';
import { SAMPLE_DATASETS } from './constants';
import { Dataset, ProcessingMode, AnalysisResult as AnalysisResultType, DataPoint } from './types';
import { LightCurveChart } from './components/LightCurveChart';
import { AnalysisResult } from './components/AnalysisResult';
import { InfoPanel } from './components/InfoPanel';
import { analyzeLightCurve } from './services/geminiService';

const App: React.FC = () => {
  const [selectedDataset, setSelectedDataset] = useState<Dataset>(SAMPLE_DATASETS[0]);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>(ProcessingMode.RAW);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResultType | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simple Phase Folding Logic
  const getProcessedData = useCallback((): DataPoint[] => {
    if (processingMode === ProcessingMode.FOLDED && selectedDataset.period) {
      const period = selectedDataset.period;
      const t0 = selectedDataset.t0 || 0;
      return selectedDataset.data.map(d => ({
        ...d,
        time: ((d.time - t0) % period + period) % period // Fold time into phase [0, period]
      })).sort((a, b) => a.time - b.time);
    }
    
    // Simple Detrending (simulated by just centering around mean for this demo)
    if (processingMode === ProcessingMode.DETRENDED) {
      const mean = selectedDataset.data.reduce((sum, d) => sum + d.flux, 0) / selectedDataset.data.length;
      return selectedDataset.data.map(d => ({
        ...d,
        flux: d.flux / mean // Normalize to 1
      }));
    }

    return selectedDataset.data;
  }, [selectedDataset, processingMode]);

  const handleAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setError(null);
    
    try {
      const result = await analyzeLightCurve(selectedDataset.data, selectedDataset.name);
      setAnalysisResult(result);
    } catch (e) {
      setError("Analysis failed. Ensure you have a valid API Key set up.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDatasetChange = (dataset: Dataset) => {
    setSelectedDataset(dataset);
    setAnalysisResult(null);
    setProcessingMode(ProcessingMode.RAW);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 shadow-[0_0_15px_rgba(6,182,212,0.5)]"></div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              ExoDetect <span className="text-cyan-400">AI</span>
            </h1>
          </div>
          <nav className="hidden md:flex gap-6 text-sm font-medium text-slate-400">
            <a href="#" className="hover:text-cyan-400 transition-colors">Dashboard</a>
            <a href="#" className="hover:text-cyan-400 transition-colors">Archive</a>
            <a href="#" className="hover:text-cyan-400 transition-colors">Documentation</a>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 lg:p-8 space-y-6">
        {/* Intro */}
        <div className="mb-8">
          <h2 className="text-3xl font-light text-white mb-2">Stellar Light Curve Analysis</h2>
          <p className="text-slate-400 max-w-2xl">
            Upload or select TESS/Kepler light curve data to detect exoplanet transits using Gemini 2.5 Flash machine learning models. 
            Currently analyzing target <span className="text-cyan-400 font-mono">{selectedDataset.name}</span>.
          </p>
        </div>

        {/* API Key Warning (Simulated for Demo) */}
        {!process.env.API_KEY && (
             <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 p-3 rounded-lg text-sm mb-4">
               <strong>Note:</strong> To run live analysis, ensure <code>REACT_APP_GEMINI_API_KEY</code> or <code>API_KEY</code> is set in your environment variables. 
               Without it, the analysis button will fail.
             </div>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Controls & Chart */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Controls Toolbar */}
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex flex-wrap gap-4 items-center justify-between shadow-lg">
              <div className="flex gap-2 items-center">
                <span className="text-xs font-bold text-slate-500 uppercase mr-2">Dataset:</span>
                <select 
                  className="bg-slate-900 border border-slate-600 text-slate-200 text-sm rounded-lg focus:ring-cyan-500 focus:border-cyan-500 block p-2 min-w-[200px]"
                  value={selectedDataset.id}
                  onChange={(e) => handleDatasetChange(SAMPLE_DATASETS.find(d => d.id === e.target.value)!)}
                >
                  {SAMPLE_DATASETS.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={() => setProcessingMode(ProcessingMode.RAW)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${processingMode === ProcessingMode.RAW ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                >
                  Raw
                </button>
                <button 
                  onClick={() => setProcessingMode(ProcessingMode.DETRENDED)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${processingMode === ProcessingMode.DETRENDED ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                >
                  Detrend
                </button>
                <button 
                  onClick={() => setProcessingMode(ProcessingMode.FOLDED)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${processingMode === ProcessingMode.FOLDED ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                >
                  Fold Phase
                </button>
              </div>
            </div>

            {/* Chart Area */}
            <LightCurveChart 
              data={getProcessedData()} 
              mode={processingMode} 
              color={processingMode === ProcessingMode.FOLDED ? '#22d3ee' : '#818cf8'} 
            />

            {/* Description of current dataset */}
            <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800">
              <h4 className="text-sm font-semibold text-slate-300 mb-1">Target Description</h4>
              <p className="text-sm text-slate-400">{selectedDataset.description}</p>
            </div>

          </div>

          {/* Right Column: Analysis & Info */}
          <div className="space-y-6">
            
            {/* Analysis Action Card */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-1 border border-slate-700 shadow-lg">
              <div className="p-5 h-full flex flex-col gap-4">
                 <button
                    onClick={handleAnalysis}
                    disabled={isAnalyzing}
                    className="w-full py-3 px-4 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded-lg shadow-lg shadow-cyan-900/50 transition-all transform active:scale-95 flex items-center justify-center gap-2"
                  >
                    {isAnalyzing ? (
                      <>Processing...</>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                        Run AI Analysis
                      </>
                    )}
                  </button>
                  
                  {error && (
                    <div className="text-red-400 text-xs text-center">{error}</div>
                  )}

                  <AnalysisResult result={analysisResult} loading={isAnalyzing} />
              </div>
            </div>

            {/* Educational Panel */}
            <InfoPanel />

          </div>
        </div>
      </main>
    </div>
  );
};

export default App;