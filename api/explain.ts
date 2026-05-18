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

    const { problem, stepEquation, question, chatHistory } = req.body || {};
    if (!problem || !stepEquation) {
      res.status(400).json({ error: "Mungon problemi ose hapi per shpjegim." });
      return;
    }

    const historyText = Array.isArray(chatHistory)
      ? chatHistory.map((m: any) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`).join("\n")
      : "";

    const prompt = `
You are a mathematical tutor built into a premium calculator app. Your goal is to explain ONE specific mathematical step to a student.

Original Problem: ${problem}
Current Step in focus: ${stepEquation}
Student's History:
${historyText}

Student's New Question/Prompt: ${question || "Shpjego kete hap"}

Rules:
1. Explain the step COMPLETELY AND EXCLUSIVELY IN ALBANIAN. Do not use a single word of English. If mathematical terms are used, translate them to Albanian.
2. Keep the explanation strictly focused on this exact mathematical transition. Do not solve the whole problem.
3. Use Markdown and LaTeX ($ for inline, $$ for block).
4. Do NOT use conversational filler. Be direct and premium.
5. GUARDRAIL: If the student asks something COMPLETELY unrelated to mathematics, reply STRICTLY with: "Une mund te te ndihmoj vetem me paqartesite rreth ketij hapi matematikash."
`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      contents: prompt,
    });

    const explanation = response.text || "";
    if (!explanation.trim()) {
      res.status(422).json({ error: "Gemini nuk ktheu shpjegim per kete hap. Provo perseri." });
      return;
    }

    res.status(200).json({ explanation });
  } catch (error: any) {
    console.error("explain failed:", error);
    res.status(error?.status === 429 ? 429 : 500).json({
      error: getGeminiErrorMessage(error) || String(error?.message || "Nuk mund te shpjegohej hapi. Provo perseri."),
    });
  }
}
