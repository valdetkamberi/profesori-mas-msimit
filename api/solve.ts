import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  maxDuration: 60,
};

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

function solveArithmetic(problemText: string): SolveResult | null {
  const expression = problemText
    .replace(/\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\^/g, "**")
    .replace(/\s+/g, "");

  if (!/^[0-9+\-*/().*]+$/.test(expression) || !/[+\-*/]/.test(expression)) return null;

  const result = Function(`"use strict"; return (${expression});`)();
  if (typeof result !== "number" || !Number.isFinite(result)) return null;

  const finalAnswer = Number.isInteger(result) ? String(result) : String(Number(result.toFixed(10)));
  return {
    steps: [
      { id: "step-1", equation: problemText },
      { id: "step-2", equation: finalAnswer },
    ],
    finalAnswer,
  };
}

function solveSimpleLinearEquation(problemText: string): SolveResult | null {
  const normalized = problemText.replace(/\s+/g, "").replace(/\\times/g, "*");
  const match = normalized.match(/^([+-]?\d*)x([+-]\d+)?=(-?\d+)$/);
  if (!match) return null;

  const coefficient = match[1] === "" || match[1] === "+" ? 1 : match[1] === "-" ? -1 : Number(match[1]);
  const constant = match[2] ? Number(match[2]) : 0;
  const right = Number(match[3]);
  if (!Number.isFinite(coefficient) || coefficient === 0 || !Number.isFinite(constant) || !Number.isFinite(right)) return null;

  const result = (right - constant) / coefficient;
  const finalAnswer = `x=${Number.isInteger(result) ? result : Number(result.toFixed(10))}`;
  return {
    steps: [
      { id: "step-1", equation: problemText },
      { id: "step-2", equation: `${coefficient}x=${right - constant}` },
      { id: "step-3", equation: finalAnswer },
    ],
    finalAnswer,
  };
}

function solveLocally(problemText: string): SolveResult | null {
  return solvePowerIntegral(problemText) || solveSimpleLinearEquation(problemText) || solveArithmetic(problemText);
}

function wolframPlaintextToResult(problemText: string, plaintext: string): SolveResult {
  const lines = plaintext
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const finalAnswer = normalizeWolframMathText(lines[lines.length - 1] || plaintext.trim());

  return {
    steps: [
      { id: "step-1", equation: problemText },
      { id: "step-2", equation: finalAnswer },
    ],
    finalAnswer,
  };
}

function normalizeWolframMathText(value: string) {
  return value
    .replace(/\bintegral\b\s*/gi, "\\int ")
    .replace(/\bconstant\b/gi, "C")
    .replace(/\bcsc\b/gi, "\\csc")
    .replace(/\bsec\b/gi, "\\sec")
    .replace(/\bcos\b/gi, "\\cos")
    .replace(/\bsin\b/gi, "\\sin")
    .replace(/\btan\b/gi, "\\tan")
    .replace(/\^(\d+)/g, "^{$1}")
    .replace(/\*/g, "")
    .replace(/_/g, "\\_");
}

async function solveWithWolfram(problemText: string): Promise<SolveResult | null> {
  const appId = process.env.WOLFRAM_APP_ID;
  if (!appId) return null;

  const url = new URL("https://api.wolframalpha.com/v2/query");
  url.searchParams.set("appid", appId);
  url.searchParams.set("input", getWolframInput(problemText));
  url.searchParams.set("output", "json");
  url.searchParams.set("format", "plaintext");

  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  const pods = data?.queryresult?.pods || [];
  const usefulPod = pods.find((pod: any) => /result|solution|integral|derivative|limit|exact result|decimal approximation/i.test(String(pod.title)))
    || pods.find((pod: any) => pod?.subpods?.[0]?.plaintext);
  const plaintext = usefulPod?.subpods?.[0]?.plaintext;
  return plaintext ? wolframPlaintextToResult(problemText, plaintext) : null;
}

function getWolframInput(problemText: string) {
  const normalized = problemText.trim();
  if (/^\\int|^∫|integral/i.test(normalized)) {
    return `integrate ${normalized}`;
  }

  if (/^\\frac\{d\}\{d|derivative|derivati|diff/i.test(normalized)) {
    return `differentiate ${normalized}`;
  }

  if (/^\\lim|limit|limiti/i.test(normalized)) {
    return `limit ${normalized}`;
  }

  return normalized;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const problem = req.body?.problem;
    if (!problem || typeof problem !== 'string') {
      res.status(400).json({ error: "No problem provided" });
      return;
    }

    const localResult = solveLocally(problem);
    if (localResult) {
      res.status(200).json(localResult);
      return;
    }

    const wolframResult = await solveWithWolfram(problem);
    if (wolframResult) {
      res.status(200).json(wolframResult);
      return;
    }

    res.status(422).json({
      error: process.env.WOLFRAM_APP_ID
        ? "Ky problem nuk u zgjidh nga solver-i lokal ose Wolfram. Kontrollo sintaksen dhe provo perseri."
        : "Ky problem kerkon fallback. Shto WOLFRAM_APP_ID ne Vercel Environment Variables dhe bej redeploy.",
    });
  } catch (error: any) {
    console.error("solve failed:", error);
    res.status(500).json({
      error: String(error?.message || "Nuk mund te zgjidhej problemi. Provo perseri."),
    });
  }
}
