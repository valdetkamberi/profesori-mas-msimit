import express from "express";
import path from "path";
import dotenv from "dotenv";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config({ path: ".env.local" });
dotenv.config();

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const execFileAsync = promisify(execFile);

function getGeminiErrorMessage(error: any) {
  const message = String(error?.message || "");

  if (error?.status === 429 || String(error?.message || "").includes("RESOURCE_EXHAUSTED")) {
    return "Kuota e Gemini API është harxhuar për momentin. Provo përsëri pas pak ose përdor një API key tjetër.";
  }

  if (message.includes("free tier is not available in your country") || message.includes("FAILED_PRECONDITION")) {
    return "Gemini API falas nuk është i disponueshëm për këtë projekt/vend. Aktivizo billing në Google AI Studio ose përdor një API key tjetër me billing aktiv.";
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
    const error = new Error("Mungon GEMINI_API_KEY. Shto çelësin në .env.local dhe rinis serverin.");
    (error as any).status = 503;
    throw error;
  }

  let lastError: any = null;
  for (const apiKey of apiKeys) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      return await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
      });
    } catch (error) {
      lastError = error;
      console.warn("Gemini key skipped:", getGeminiErrorMessage(error) || error);
    }
  }

  throw lastError;
}

function sendGeminiError(res: express.Response, error: any, fallbackMessage: string) {
  const message = getGeminiErrorMessage(error) || String(error?.message || fallbackMessage);
  res.status(error?.status === 429 ? 429 : error?.status === 503 ? 503 : 500).json({
    error: message || fallbackMessage,
  });
}

type SolveResult = {
  steps: Array<{ id: string; equation: string }>;
  finalAnswer: string;
};

function normalizeLatex(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\,/g, "");
}

function formatCoefficient(value: number) {
  if (value === 1) return "";
  if (value === -1) return "-";
  return String(value);
}

function solvePowerIntegral(problemText: string): SolveResult | null {
  const problem = normalizeLatex(problemText);
  const match = problem.match(/^\\int(?:_\{?([^{}]+)\}?|)(?:\^\{?([^{}]+)\}?|)([+-]?\d*)x(?:\^\{?(-?\d+)\}?|)d?x$/);
  if (!match) return null;

  const lower = match[1];
  const upper = match[2];
  const coefficientText = match[3];
  const exponentText = match[4];
  const coefficient = coefficientText === "" || coefficientText === "+" ? 1 : coefficientText === "-" ? -1 : Number(coefficientText);
  const exponent = exponentText ? Number(exponentText) : 1;
  if (!Number.isFinite(coefficient) || !Number.isFinite(exponent) || exponent === -1) return null;

  const nextExponent = exponent + 1;
  const coefficientDisplay = formatCoefficient(coefficient);
  const numerator = coefficient === 1 ? `x^{${nextExponent}}` : coefficient === -1 ? `-x^{${nextExponent}}` : `${coefficient}x^{${nextExponent}}`;
  const antiderivative = coefficient % nextExponent === 0
    ? `${coefficient / nextExponent}x^{${nextExponent}}`
    : `\\frac{${numerator}}{${nextExponent}}`;

  if (lower && upper) {
    const lowerNumber = Number(lower);
    const upperNumber = Number(upper);
    const canEvaluate = Number.isFinite(lowerNumber) && Number.isFinite(upperNumber);
    const finalAnswer = canEvaluate
      ? String((coefficient / nextExponent) * (Math.pow(upperNumber, nextExponent) - Math.pow(lowerNumber, nextExponent)))
      : `${antiderivative}\\Big|_{x=${upper}}-${antiderivative}\\Big|_{x=${lower}}`;

    return {
      steps: [
        { id: "step-1", equation: `\\int_{${lower}}^{${upper}} ${coefficientDisplay}x^{${exponent}}\\,dx` },
        { id: "step-2", equation: `\\left[${antiderivative}\\right]_{${lower}}^{${upper}}` },
        { id: "step-3", equation: finalAnswer },
      ],
      finalAnswer,
    };
  }

  return {
    steps: [
      { id: "step-1", equation: `\\int ${coefficientDisplay}x^{${exponent}}\\,dx` },
      { id: "step-2", equation: `${coefficientDisplay}\\frac{x^{${exponent}+1}}{${exponent}+1}+C` },
      { id: "step-3", equation: `${antiderivative}+C` },
    ],
    finalAnswer: `${antiderivative}+C`,
  };
}

function solveLocally(problemText: string): SolveResult | null {
  return solvePowerIntegral(problemText);
}

function getPythonBin() {
  const candidates = [
    process.env.PYTHON_BIN,
    path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
    "python",
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => candidate === "python" || existsSync(candidate));
}

async function solveWithSympy(problemText: string): Promise<SolveResult | null> {
  const pythonBin = getPythonBin();
  if (!pythonBin) return null;

  try {
    const encodedProblem = Buffer.from(problemText, "utf8").toString("base64");
    const scriptPath = path.join(process.cwd(), "scripts", "solve_sympy.py");
    const { stdout } = await execFileAsync(pythonBin, [scriptPath, encodedProblem], {
      timeout: 15000,
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout.trim());
    if (parsed?.error || !parsed?.finalAnswer) return null;
    return { steps: parsed.steps, finalAnswer: parsed.finalAnswer };
  } catch (error) {
    console.warn("SymPy solver skipped:", error);
    return null;
  }
}

function wolframPlaintextToResult(problemText: string, plaintext: string): SolveResult {
  const lines = plaintext
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const finalAnswer = lines[lines.length - 1] || plaintext.trim();

  return {
    steps: [
      { id: "step-1", equation: problemText },
      { id: "step-2", equation: `\\text{WolframAlpha: } ${finalAnswer.replace(/_/g, "\\_")}` },
    ],
    finalAnswer: finalAnswer.replace(/_/g, "\\_"),
  };
}

async function solveWithWolfram(problemText: string): Promise<SolveResult | null> {
  const appId = process.env.WOLFRAM_APP_ID;
  if (!appId) return null;

  try {
    const url = new URL("https://api.wolframalpha.com/v2/query");
    url.searchParams.set("appid", appId);
    url.searchParams.set("input", `integrate ${problemText}`);
    url.searchParams.set("output", "json");
    url.searchParams.set("format", "plaintext");

    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const pods = data?.queryresult?.pods || [];
    const usefulPod = pods.find((pod: any) =>
      /result|integral|definite integral|indefinite integral/i.test(String(pod.title))
    );
    const plaintext = usefulPod?.subpods?.[0]?.plaintext;
    if (!plaintext) return null;

    return wolframPlaintextToResult(problemText, plaintext);
  } catch (error) {
    console.warn("Wolfram solver skipped:", error);
    return null;
  }
}

export async function createApp(options: { serveFrontend?: boolean; useVite?: boolean } = {}) {
  const app = express();

  app.use(express.json({ limit: "4mb" }));

  // API: Solve Problem
  app.post("/api/solve", async (req, res) => {
    try {
      const { problem } = req.body;
      if (!problem) return res.status(400).json({ error: "No problem provided" });

      const localResult = solveLocally(problem);
      if (localResult) {
        return res.json(localResult);
      }

      const sympyResult = await solveWithSympy(problem);
      if (sympyResult) {
        return res.json(sympyResult);
      }

      const wolframResult = await solveWithWolfram(problem);
      if (wolframResult) {
        return res.json(wolframResult);
      }

      if (!process.env.WOLFRAM_APP_ID) {
        return res.status(422).json({
          error:
            "Ky problem nuk u zgjidh nga Python/SymPy. Shto WOLFRAM_APP_ID ne .env.local qe Wolfram te perdoret si fallback.",
        });
      }

      return res.status(422).json({
        error:
          "Ky problem nuk u zgjidh nga motorri lokal. Kontrollo sintaksen ose krijo .venv me SymPy: python -m venv .venv dhe .venv/Scripts/python.exe -m pip install sympy.",
      });

      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ error: "Mungon GEMINI_API_KEY. Shto çelësin në .env.local dhe rinis serverin." });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const prompt = `
You are an advanced mathematical engine that outputs strict JSON. You receive a math problem and output ONLY the sequence of mathematical equations step-by-step to arrive at the solution. DO NOT output any conversational text, greetings, or explanations outside the JSON.

CRITICAL INSTRUCTION: Any textual annotations, descriptive steps, or justifications placed inside the \`equation\` strings MUST BE WRITTEN STRICTLY IN ALBANIAN.
For example, do NOT write "\\text{Factor the expression}". Instead, write "\\text{Faktorizojmë shprehjen}".
Absolutely NO ENGLISH WORDS should appear in your output. Even mathematical terms must be translated to Albanian (e.g., Derivative = Derivati, Integral = Integrali, Limit = Limiti).

The problem is: ${problem}

Return a JSON object STRICTLY matching this schema:
{
  "steps": [
    { "id": "step-1", "equation": "First equation or step description in Albanian here" },
    { "id": "step-2", "equation": "Second equation here" }
  ],
  "finalAnswer": "The final result equation"
}
`;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
      });

      let jsonStr = response.text || '';
      jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();

      const result = JSON.parse(jsonStr);
      res.json(result);
    } catch (error: any) {
      console.error("Error solving:", error);
      res.status(error?.status === 429 ? 429 : 500).json({
        error: getGeminiErrorMessage(error) || "Nuk mund të zgjidhej problemi. Provo përsëri.",
      });
    }
  });

  // API: Explain Specific Step
  app.post("/api/explain", async (req, res) => {
    try {
      const { problem, stepEquation, question, chatHistory } = req.body;
      let historyText = "";
      if (chatHistory && chatHistory.length > 0) {
        historyText = chatHistory.map((m: any) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`).join("\n");
      }

      const prompt = `
You are a mathematical tutor built into a premium calculator app. Your goal is to explain ONE specific mathematical step to a student.

Original Problem: ${problem}
Current Step in focus: ${stepEquation}
Student's History:
${historyText}

Student's New Question/Prompt: ${question || "Shpjego këtë hap (Explain this step)"}

Rules:
1. Explain the step COMPLETELY AND EXCLUSIVELY IN ALBANIAN. Do not use a single word of English. If mathematical terms are used, translate them to Albanian.
2. Keep the explanation strictly focused on this exact mathematical transition. Do not solve the whole problem.
3. Use Markdown and LaTeX ($ for inline, $$ for block).
4. Do NOT use conversational filler. Be direct and premium.
5. GUARDRAIL: If the student asks something COMPLETELY unrelated to mathematics (e.g. "how are you", "tell me a joke", "who are you"), you MUST reply STRICTLY with: "Unë mund të të ndihmoj vetëm me paqartësitë rreth këtij hapi matematikash." Do not say anything else.
`;

      const response = await generateGeminiContent(prompt);

      res.json({ explanation: response.text });
    } catch (error: any) {
      console.error("Error explaining:", error);
      res.status(error?.status === 429 ? 429 : 500).json({
        error: getGeminiErrorMessage(error) || "Nuk mund të shpjegohej hapi. Provo përsëri.",
      });
    }
  });

  // API: Extract Math from Image
  app.post("/api/extract-image", async (req, res) => {
    try {
      const { imageBase64 } = req.body; // e.g. "data:image/jpeg;base64,/9j/4AAQSk..."
      if (!imageBase64) return res.status(400).json({ error: "No image provided" });
      const mimeType = imageBase64.split(';')[0].split(':')[1];
      const base64Data = imageBase64.split(',')[1];

      const response = await generateGeminiContent([
          { text: "Extract the mathematical equation from this image. Output ONLY the raw LaTeX string representing the formula. Do not include markdown formatting or backticks, just the math." },
          { inlineData: { mimeType, data: base64Data } }
        ]);

      let extracted = response.text || '';
      extracted = extracted.replace(/```latex/gi, '').replace(/```/g, '').trim();

      res.json({ equation: extracted });
    } catch (error: any) {
      console.error("Error extracting image:", error);
      res.status(error?.status === 429 ? 429 : 500).json({
        error: getGeminiErrorMessage(error) || "Nuk mund të lexohej imazhi. Provo një foto më të qartë ose shkruaje manualisht.",
      });
    }
  });

  app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!error) {
      next();
      return;
    }

    if (error.type === "entity.too.large") {
      res.status(413).json({
        error: "Fotoja eshte shume e madhe per serverin. Provo ta presesh ose te ngarkosh nje foto me te vogel.",
      });
      return;
    }

    console.error("Unhandled API error:", error);
    res.status(500).json({
      error: getGeminiErrorMessage(error) || "Serveri pati nje gabim te papritur. Kontrollo Vercel Runtime Logs per detaje.",
    });
  });

  // Vite middleware for development
  if (options.useVite) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (options.serveFrontend) {
    // Production static files
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

async function startServer() {
  const PORT = 3000;
  const app = await createApp({
    useVite: process.env.NODE_ENV !== "production",
    serveFrontend: process.env.NODE_ENV === "production",
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== "1") {
  startServer();
}
