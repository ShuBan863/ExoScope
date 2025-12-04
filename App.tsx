import React, { useState } from 'react';
import { Telescope, Github, Rocket, FileQuestion, Activity } from 'lucide-react';
import FileUpload from './components/FileUpload';
import MetadataViewer from './components/MetadataViewer';
import LightCurveChart from './components/LightCurveChart';
import { ParsedFitsData } from './types';

function App() {
  const [fitsData, setFitsData] = useState<ParsedFitsData | null>(null);
  const [fileName, setFileName] = useState<string>('');

  const handleDataLoaded = (data: ParsedFitsData, name: string) => {
    setFitsData(data);
    setFileName(name);
  };

  const handleReset = () => {
    setFitsData(null);
    setFileName('');
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]">
      {/* Navigation Bar */}
      <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-2 rounded-lg">
                <Telescope className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-400">
                ExoScope
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-500 text-sm hidden sm:block">Senior Frontend Analysis Tool</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Intro / Header */}
        {!fitsData && (
          <div className="text-center py-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight mb-6">
              Explore the <span className="text-cyan-400">Universe</span> in Binary.
            </h1>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-12">
              A purely client-side FITS parser for NASA Kepler & TESS data. 
              Upload a standard <code className="text-cyan-300">.fits</code> light curve file to instantly extract metadata 
              and visualize photometric flux without sending data to a server.
            </p>
          </div>
        )}

        {/* Upload Area */}
        {!fitsData ? (
          <FileUpload onDataLoaded={handleDataLoaded} />
        ) : (
          <div className="animate-in fade-in zoom-in-95 duration-500">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <FileQuestion className="text-cyan-400" />
                <h2 className="text-xl font-semibold text-white">{fileName}</h2>
              </div>
              <button 
                onClick={handleReset}
                className="text-slate-400 hover:text-white hover:bg-slate-800 px-4 py-2 rounded-lg transition-colors text-sm"
              >
                Analyze Another File
              </button>
            </div>

            {/* Analysis Grid */}
            <div className="space-y-6">
              <MetadataViewer 
                primaryHeader={fitsData.primaryHeader} 
                extensionHeader={fitsData.extensionHeader} 
              />
              <LightCurveChart data={fitsData} />
            </div>
          </div>
        )}

        {/* Empty State / Demo Hints */}
        {!fitsData && (
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
                <div className="p-6 bg-slate-900/50 rounded-xl border border-slate-800 hover:border-cyan-500/30 transition-colors">
                    <Rocket className="w-8 h-8 text-cyan-400 mb-4" />
                    <h3 className="text-lg font-semibold text-white mb-2">Zero Latency</h3>
                    <p className="text-slate-400 text-sm">Parsing binary FITS tables directly in the browser using JavaScript typed arrays.</p>
                </div>
                <div className="p-6 bg-slate-900/50 rounded-xl border border-slate-800 hover:border-cyan-500/30 transition-colors">
                    <Github className="w-8 h-8 text-cyan-400 mb-4" />
                    <h3 className="text-lg font-semibold text-white mb-2">Standard Compliant</h3>
                    <p className="text-slate-400 text-sm">Reads standard Header Data Units (HDU) and Binary Table extensions used by MAST archive.</p>
                </div>
                <div className="p-6 bg-slate-900/50 rounded-xl border border-slate-800 hover:border-cyan-500/30 transition-colors">
                    <Activity className="w-8 h-8 text-cyan-400 mb-4" />
                    <h3 className="text-lg font-semibold text-white mb-2">Interactive Viz</h3>
                    <p className="text-slate-400 text-sm">Zoomable, responsive charts powered by Recharts for detailed transit inspection.</p>
                </div>
            </div>
        )}

      </main>
      
      <footer className="border-t border-slate-900 mt-20 py-8 text-center text-slate-600 text-sm">
        <p>ExoScope © {new Date().getFullYear()} • Built for Astrophysics</p>
      </footer>
    </div>
  );
}

export default App;