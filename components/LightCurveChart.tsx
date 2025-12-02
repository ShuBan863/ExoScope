import React from 'react';
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { DataPoint, ProcessingMode } from '../types';

interface LightCurveChartProps {
  data: DataPoint[];
  mode: ProcessingMode;
  color: string;
}

export const LightCurveChart: React.FC<LightCurveChartProps> = ({ data, mode, color }) => {
  // Calculate domain for better visualization
  const minFlux = Math.min(...data.map(d => d.flux));
  const maxFlux = Math.max(...data.map(d => d.flux));
  const padding = (maxFlux - minFlux) * 0.2;

  const yDomain = [minFlux - padding, maxFlux + padding];

  return (
    <div className="w-full h-96 bg-slate-900 rounded-lg border border-slate-700 p-4 shadow-inner">
      <div className="flex justify-between items-center mb-2 px-2">
        <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wider">
          {mode === ProcessingMode.FOLDED ? 'Phase Folded Flux' : 'Normalized Flux vs Time'}
        </h3>
        <span className="text-xs text-slate-500">{data.length} points</span>
      </div>
      
      <ResponsiveContainer width="100%" height="90%">
        <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis 
            type="number" 
            dataKey="time" 
            name="Time" 
            unit={mode === ProcessingMode.FOLDED ? ' phase' : ' days'} 
            stroke="#94a3b8"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#475569' }}
          />
          <YAxis 
            type="number" 
            dataKey="flux" 
            name="Flux" 
            domain={yDomain}
            stroke="#94a3b8"
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => value.toFixed(3)}
            tickLine={false}
            axisLine={{ stroke: '#475569' }}
            width={40}
          />
          <Tooltip 
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }}
            itemStyle={{ color: '#f8fafc' }}
            formatter={(value: number) => [value.toFixed(5), 'Flux']}
            labelFormatter={(label: number) => `Time: ${label.toFixed(2)}`}
          />
          <ReferenceLine y={1.0} stroke="#ef4444" strokeDasharray="3 3" opacity={0.5} />
          <Scatter 
            name="Light Curve" 
            data={data} 
            fill={color} 
            line={mode === ProcessingMode.FOLDED ? false : { stroke: color, strokeWidth: 1 }} 
            shape="circle" 
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};