import { GoogleGenAI, Type } from "@google/genai";
import { DataPoint, AnalysisResult } from "../types";

// We downsample for the prompt to save tokens while preserving shape
const formatDataForPrompt = (data: DataPoint[]): string => {
  // Take every nth point to keep it around 200 points for the LLM context
  const step = Math.ceil(data.length / 200);
  const subset = data.filter((_, i) => i % step === 0);
  
  return JSON.stringify(subset.map(d => ({ t: d.time, f: d.flux })));
};

export const analyzeLightCurve = async (data: DataPoint[], datasetName: string): Promise<AnalysisResult> => {
  try {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("API Key not found");
    }

    const ai = new GoogleGenAI({ apiKey });
    const formattedData = formatDataForPrompt(data);

    const prompt = `
      You are an expert astronomer specializing in exoplanet detection using the Transit Method.
      Analyze the following time-series data (Time 't' vs Flux 'f').
      This is a normalized light curve from ${datasetName}.
      
      Look for:
      1. Periodic dips in flux (indicating a transit).
      2. U-shaped or V-shaped signals.
      3. Consistency in dip depth.

      Data (subset):
      ${formattedData}

      Return a JSON response strictly adhering to this schema.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            classification: {
              type: Type.STRING,
              enum: ["PLANET_CANDIDATE", "FALSE_POSITIVE", "UNKNOWN"],
              description: "The verdict on whether this light curve contains a planet."
            },
            confidence: {
              type: Type.NUMBER,
              description: "Confidence score between 0 and 100."
            },
            explanation: {
              type: Type.STRING,
              description: "A brief scientific explanation of the findings."
            },
            featuresDetected: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of visual features (e.g., 'Periodic Dips', 'Stellar Noise', 'V-shape')."
            }
          },
          required: ["classification", "confidence", "explanation", "featuresDetected"]
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as AnalysisResult;
    } else {
      throw new Error("No response text from Gemini");
    }

  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    // Fallback if API fails or quota exceeded
    return {
      classification: "UNKNOWN",
      confidence: 0,
      explanation: "Analysis failed due to API error. Please ensure your API Key is valid.",
      featuresDetected: []
    };
  }
};