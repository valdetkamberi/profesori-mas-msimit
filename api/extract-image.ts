import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

export const config = {
  maxDuration: 60,
};

function getGeminiErrorMessage(error: any) {
  const message = String(error?.message || "");

  if (error?.status === 429 || message.includes("RESOURCE_EXHAUSTED")) {
    return "Kuota e Gemini API eshte harxhuar per momentin. Provo perseri pas pak ose perdor nje API key tjeter.";
  }

  if (message.includes("free tier is not available in your country") || message.includes("FAILED_PRECONDITION")) {
    return "Gemini API falas nuk eshte i disponueshem per kete projekt/vend. Aktivizo billing ne Google AI Studio ose perdor nje API key tjeter me billing aktiv.";
  }

  if (error?.status === 400 || message.includes("API key not valid") || message.includes("INVALID_ARGUMENT")) {
    return "Gemini API key nuk u pranua ose kerkesa nuk eshte valide. Kontrollo API key dhe provo perseri.";
  }

  if (message.includes("PERMISSION_DENIED")) {
    return "Gemini API nuk ka leje per kete key. Kontrollo qe key te jete aktiv ne Google AI Studio.";
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({ error: "Mungon GEMINI_API_KEY ne Vercel Environment Variables." });
      return;
    }

    const imageBase64 = req.body?.imageBase64;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: "No image provided" });
      return;
    }

    const [meta, base64Data] = imageBase64.split(',');
    const mimeType = meta?.split(';')[0]?.split(':')[1] || 'image/jpeg';
    if (!base64Data) {
      res.status(400).json({ error: "Imazhi nuk u dergua ne format te vlefshem." });
      return;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      contents: [
        { text: "Extract the mathematical equation from this image. Output ONLY the raw LaTeX string representing the formula. Do not include markdown formatting or backticks, just the math." },
        { inlineData: { mimeType, data: base64Data } },
      ],
    });

    const equation = (response.text || '').replace(/```latex/gi, '').replace(/```/g, '').trim();
    if (!equation) {
      res.status(422).json({ error: "Gemini nuk lexoi dot formulen nga kjo foto. Provo nje foto me te qarte." });
      return;
    }

    res.status(200).json({ equation });
  } catch (error: any) {
    console.error("extract-image failed:", error);
    res.status(error?.status === 429 ? 429 : 500).json({
      error: getGeminiErrorMessage(error) || String(error?.message || "Nuk mund te lexohej imazhi. Provo perseri."),
    });
  }
}
