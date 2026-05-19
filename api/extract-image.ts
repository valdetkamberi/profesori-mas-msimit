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

function getGeminiApiKeys() {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_FALLBACK,
    process.env.GEMINI_API_KEY_FALLBACK_2,
  ].filter(Boolean) as string[];
}

async function generateGeminiContent(contents: any) {
  const apiKeys = getGeminiApiKeys();
  if (apiKeys.length === 0) {
    const error = new Error("Mungon GEMINI_API_KEY ne Vercel Environment Variables.");
    (error as any).status = 503;
    throw error;
  }

  let lastError: any = null;
  for (const apiKey of apiKeys) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      return await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
        contents,
      });
    } catch (error) {
      lastError = error;
      console.warn("Gemini fallback key skipped:", getGeminiErrorMessage(error) || error);
    }
  }

  throw lastError;
}

function normalizeMathInput(value: string) {
  let normalized = value
    .replace(/```(?:latex)?/gi, '')
    .replace(/```/g, '')
    .replace(/\r?\n/g, ' ')
    .trim();

  const replacements: Array<[RegExp, string]> = [
    [/∫/g, '\\int '],
    [/√/g, '\\sqrt'],
    [/π/g, '\\pi'],
    [/×/g, '\\times'],
    [/÷/g, '\\div'],
    [/≤/g, '\\le'],
    [/≥/g, '\\ge'],
    [/≠/g, '\\ne'],
    [/∫/g, '\\int '],
    [/√/g, '\\sqrt'],
    [/π/g, '\\pi'],
    [/×/g, '\\times'],
    [/÷/g, '\\div'],
    [/≤/g, '\\le'],
    [/≥/g, '\\ge'],
    [/≠/g, '\\ne'],
    [/\bintegral\b/gi, '\\int'],
    [/\bpi\b/gi, '\\pi'],
    [/\btimes\b|\bmultiplied by\b/gi, '\\times'],
    [/\bdivided by\b|\bdivide\b/gi, '\\div'],
    [/\btheta\b/gi, '\\theta'],
    [/\balpha\b/gi, '\\alpha'],
    [/\bbeta\b/gi, '\\beta'],
    [/\bgamma\b/gi, '\\gamma'],
    [/\bdelta\b/gi, '\\delta'],
    [/\bsin\b/gi, '\\sin'],
    [/\bcos\b/gi, '\\cos'],
    [/\btan\b/gi, '\\tan'],
    [/\bln\b/gi, '\\ln'],
    [/\blog\b/gi, '\\log'],
  ];

  replacements.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalized
    .replace(/\b(?:sqroot|sqrt|square root)\s*\(([^()]+)\)/gi, '\\sqrt{$1}')
    .replace(/\b(?:sqroot|sqrt)\s*\{([^{}]+)\}/gi, '\\sqrt{$1}')
    .replace(/\b(?:sqroot|sqrt|square root)\s+([a-zA-Z0-9]+(?:\^\{?[-+]?\d+\}?)?)/gi, '\\sqrt{$1}')
    .replace(/\b(?:sqroot|sqrt)([a-zA-Z0-9]+(?:\^\{?[-+]?\d+\}?)?)/gi, '\\sqrt{$1}')
    .replace(/\b(?:sqroot|sqrt|square root)\b/gi, '\\sqrt')
    .replace(/\\\\(int|sqrt|pi|times|div|le|ge|ne|theta|alpha|beta|gamma|delta|sin|cos|tan|ln|log)\b/g, '\\$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
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

    const response = await generateGeminiContent([
        { text: "Extract the mathematical equation from this image. Output ONLY the raw standard LaTeX string representing the formula. Use LaTeX commands for symbols, for example \\sqrt{...}, \\int, \\frac{...}{...}, \\pi, \\sin, \\cos. Do not use words such as sqroot, sqrt, integral, pi, times, or divide. Do not include markdown formatting or backticks, just the math." },
        { inlineData: { mimeType, data: base64Data } },
      ]);

    const equation = normalizeMathInput(response.text || '');
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
