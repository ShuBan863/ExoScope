export interface DataPoint {
  time: number;
  flux: number;
  error?: number;
}

export interface AnalysisResult {
  classification: "PLANET_CANDIDATE" | "FALSE_POSITIVE" | "UNKNOWN";
  confidence: number;
  explanation: string;
  featuresDetected: string[];
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  source: string;
  data: DataPoint[];
  period?: number; // Orbital period for folding (if known/simulated)
  t0?: number;     // Transit epoch
}

export enum ProcessingMode {
  RAW = 'RAW',
  DETRENDED = 'DETRENDED',
  FOLDED = 'FOLDED'
}