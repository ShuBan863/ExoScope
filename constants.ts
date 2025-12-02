import { DataPoint, Dataset } from './types';

// Helper to generate noisy data with a transit
const generateTransitData = (points: number, period: number, depth: number, noiseLevel: number): DataPoint[] => {
  const data: DataPoint[] = [];
  for (let i = 0; i < points; i++) {
    const time = i * 0.02; // Time in days
    let flux = 1.0;
    
    // Simulate periodic dips
    const phase = time % period;
    const transitDuration = 0.15; // Duration of transit
    const transitCenter = period / 2;
    
    if (Math.abs(phase - transitCenter) < transitDuration / 2) {
      // Simple box-ish shape for transit with some limb darkening simulation (parabolic)
      const distFromCenter = Math.abs(phase - transitCenter) / (transitDuration / 2);
      flux -= depth * (1 - distFromCenter * 0.3);
    }

    // Add Gaussian noise
    const noise = (Math.random() - 0.5) * noiseLevel;
    
    data.push({
      time: parseFloat(time.toFixed(4)),
      flux: parseFloat((flux + noise).toFixed(6)),
    });
  }
  return data;
};

// Helper for empty data (noise only)
const generateNoiseData = (points: number, noiseLevel: number): DataPoint[] => {
  const data: DataPoint[] = [];
  for (let i = 0; i < points; i++) {
    const time = i * 0.02;
    const noise = (Math.random() - 0.5) * noiseLevel;
    data.push({
      time: parseFloat(time.toFixed(4)),
      flux: parseFloat((1.0 + noise).toFixed(6)),
    });
  }
  return data;
};

const KEPLER_186F_DATA = generateTransitData(1000, 3.5, 0.02, 0.002);
const KIC_1429092_DATA = generateNoiseData(1000, 0.005); // Noisy, no transit

export const SAMPLE_DATASETS: Dataset[] = [
  {
    id: 'sim_kepler_186f',
    name: 'Simulated Kepler-186f',
    description: 'A simulation of an Earth-sized planet in the habitable zone. Features distinct periodic dips.',
    source: 'NASA Exoplanet Archive (Simulated)',
    data: KEPLER_186F_DATA,
    period: 3.5,
    t0: 1.75
  },
  {
    id: 'kic_1429092',
    name: 'KIC 1429092',
    description: 'A known non-planet target from the Kepler Input Catalog. Contains 0 TCEs and is not a KOI.',
    source: 'MAST Archive',
    data: KIC_1429092_DATA,
    period: 10, // Arbitrary for folding demo
    t0: 0
  },
  {
    id: 'tess_toi_700',
    name: 'TESS TOI-700 d (Sim)',
    description: 'Simulated TESS light curve showing a small habitable zone planet transit.',
    source: 'TESS Data (Simulated)',
    data: generateTransitData(1000, 6.2, 0.015, 0.003),
    period: 6.2,
    t0: 3.1
  }
];

export const EDUCATIONAL_CONTENT = {
  significance: [
    "Discovering Earth 2.0: Finding habitable worlds is one of humanity's greatest scientific goals.",
    "Understanding Formation: Exoplanet statistics help us understand how solar systems form and evolve.",
    "Biosignatures: Transit spectroscopy allows us to analyze atmospheres for signs of life."
  ],
  sources: [
    "NASA Exoplanet Archive",
    "MAST (Mikulski Archive for Space Telescopes)",
    "Kepler KOI (Objects of Interest) & TCE (Threshold Crossing Events) lists"
  ]
};