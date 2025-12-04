import React, { useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush
} from 'recharts';
import { ParsedFitsData, DataPoint } from '../types';
import { TrendingUp, Activity, AlertTriangle } from 'lucide-react';

interface LightCurveChartProps {
  data: ParsedFitsData;
}

const LightCurveChart: React.FC<LightCurveChartProps> = ({ data }) => {
  const [useRawFlux, setUseRawFlux] = useState(false);

  // Memoize data processing to avoid blocking UI
  const chartData = useMemo(() => {
    // Identify columns
    const timeCol = data.columns.find(c => c.includes('TIME'));
    // Prefer PDCSAP_FLUX (processed) over SAP_FLUX (simple aperture), or fallback
    const fluxCol = useRawFlux 
        ? data.columns.find(c => c === 'SAP_FLUX')
        : (data.columns.find(c => c === 'PDCSAP_FLUX') || data.columns.find(c => c === 'SAP_FLUX'));
    
    // Fallback for generic files
    const finalTimeCol = timeCol || data.columns[0];
    const finalFluxCol = fluxCol || data.columns[1];

    if (!finalTimeCol || !finalFluxCol) return [];

    const times = data.data[finalTimeCol];
    const fluxes = data.data[finalFluxCol];
    const points: DataPoint[] = [];

    // Filter nulls and normalize roughly for display
    let sumFlux = 0;
    let count = 0;

    for (let i = 0; i < data.rowCount; i++) {
        const t = times[i];
        const f = fluxes[i];
        if (t !== null && f !== null && !isNaN(f)) {
            sumFlux += f;
            count++;
            points.push({ time: t, flux: f });
        }
    }

    // Normalize around 1.0 if fluxes are huge (Kepler fluxes are in e-/s, usually ~10^5)
    // Actually, astronomers prefer to see the relative change, often ppm or normalized flux.
    // Let's just display raw values but format the axis nicely.
    
    // Sort by time just in case
    return points.sort((a, b) => a.time - b.time);
  }, [data, useRawFlux]);

  if (chartData.length === 0) {
    return (
      <div className="p-12 text-center border border-slate-800 rounded-xl bg-slate-900/30">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h3 className="text-xl text-slate-300">No Valid Light Curve Data Found</h3>
        <p className="text-slate-500 mt-2">Could not identify TIME and FLUX columns in the FITS table.</p>
        <div className="mt-4 text-xs text-left max-h-32 overflow-auto bg-slate-950 p-2 rounded border border-slate-800">
          Available columns: {data.columns.join(', ')}
        </div>
      </div>
    );
  }

  const fluxLabel = useRawFlux ? "Raw Flux (SAP)" : "Processed Flux (PDCSAP)";

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 backdrop-blur-sm">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-6 h-6 text-cyan-400" />
            Light Curve Visualization
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Displaying {chartData.length.toLocaleString()} data points. 
            Time is in Barycentric Julian Date (BJD) offset.
          </p>
        </div>
        
        <div className="flex items-center bg-slate-950 rounded-lg p-1 border border-slate-800">
          <button
            onClick={() => setUseRawFlux(false)}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${!useRawFlux ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/50' : 'text-slate-400 hover:text-white'}`}
          >
            Clean (PDCSAP)
          </button>
          <button
            onClick={() => setUseRawFlux(true)}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${useRawFlux ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/50' : 'text-slate-400 hover:text-white'}`}
          >
            Raw (SAP)
          </button>
        </div>
      </div>

      <div className="h-[500px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis 
              dataKey="time" 
              type="number" 
              domain={['auto', 'auto']}
              tickFormatter={(val) => val.toFixed(2)}
              stroke="#64748b"
              label={{ value: 'Time (BJD - 2454833)', position: 'insideBottom', offset: -20, fill: '#64748b' }}
            />
            <YAxis 
              domain={['auto', 'auto']} 
              stroke="#64748b"
              tickFormatter={(val) => val.toExponential(2)}
              width={80}
              label={{ value: 'Flux (e-/s)', angle: -90, position: 'insideLeft', fill: '#64748b' }}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
              itemStyle={{ color: '#22d3ee' }}
              formatter={(value: number) => [value.toFixed(4), fluxLabel]}
              labelFormatter={(label) => `Time: ${label}`}
            />
            <Line 
              type="monotone" 
              dataKey="flux" 
              stroke="#22d3ee" 
              strokeWidth={1.5} 
              dot={false} 
              activeDot={{ r: 4, fill: '#fff' }}
              animationDuration={1500}
            />
            <Brush 
              dataKey="time" 
              height={30} 
              stroke="#22d3ee" 
              fill="#0f172a" 
              tickFormatter={() => ''}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default LightCurveChart;