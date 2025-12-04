import React from 'react';
import { FitsHeaderCard } from '../types';
import { Info, Database, Calendar, Hash } from 'lucide-react';

interface MetadataViewerProps {
  primaryHeader: FitsHeaderCard[];
  extensionHeader: FitsHeaderCard[];
}

const MetadataViewer: React.FC<MetadataViewerProps> = ({ primaryHeader, extensionHeader }) => {
  // Helper to find specific keys safely
  const getValue = (header: FitsHeaderCard[], key: string) => 
    header.find(c => c.key === key)?.value || '-';

  const relevantKeys = [
    { label: 'Object', key: 'OBJECT', icon: Database },
    { label: 'Telescope', key: 'TELESCOP', icon: Info },
    { label: 'Instrument', key: 'INSTRUME', icon: Info },
    { label: 'Date Obs', key: 'DATE-OBS', icon: Calendar },
    { label: 'Exposure', key: 'EXPOSURE', icon: Hash },
    { label: 'Creator', key: 'CREATOR', icon: Info },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {/* Quick Stats Card */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 backdrop-blur-sm">
        <h3 className="text-lg font-semibold text-cyan-400 mb-4 flex items-center gap-2">
          <Info className="w-5 h-5" />
          Observation Details
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {relevantKeys.map((item) => (
            <div key={item.key} className="p-3 bg-slate-950 rounded-lg border border-slate-800/50">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider block mb-1">
                {item.label}
              </span>
              <span className="text-slate-200 font-mono text-sm truncate block">
                {String(getValue(primaryHeader, item.key) !== '-' ? getValue(primaryHeader, item.key) : getValue(extensionHeader, item.key))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Raw Header Data Scrollable Area */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl flex flex-col backdrop-blur-sm h-[320px]">
        <div className="p-4 border-b border-slate-800 bg-slate-900/80 rounded-t-xl">
          <h3 className="text-sm font-semibold text-slate-300">Raw FITS Header (Primary + Extension)</h3>
        </div>
        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-slate-400 space-y-1">
          {primaryHeader.concat(extensionHeader).map((card, idx) => (
            <div key={idx} className="flex gap-4 border-b border-slate-800/30 pb-0.5 hover:bg-slate-800/50 px-2 rounded">
              <span className="text-cyan-600 w-20 shrink-0 select-all">{card.key}</span>
              <span className="text-emerald-500 select-all">= {String(card.value)}</span>
              {card.comment && <span className="text-slate-600 truncate flex-1">// {card.comment}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MetadataViewer;