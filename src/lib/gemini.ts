import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
if (!apiKey) {
  throw new Error("Missing GEMINI_API_KEY");
}

export const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-2.5-flash";

export const ai = new GoogleGenAI({ apiKey });
