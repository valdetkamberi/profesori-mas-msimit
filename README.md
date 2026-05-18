# Profesori mas msimit

Profesori mas msimit is a React and Express math calculator. The main solver runs locally with Python and SymPy, so normal math tasks do not need Gemini, Wolfram, or another solving API.

## Features

- Solve arithmetic expressions and simplify formulas.
- Solve equations and basic systems of equations.
- Solve indefinite and definite integrals.
- Calculate derivatives and limits.
- Work with simple matrix operations such as determinant and inverse.
- Calculate basic statistics such as mean, median, mode, and standard deviation.
- Ask follow-up questions for a solution step, optionally with Gemini.
- Upload a compressed image and extract the math expression, optionally with Gemini.

## Example Inputs

```text
2+3*4
x^2+2x+1
2x+5=13
x+y=5; x-y=1
\int x^2 \, dx
\int_{0}^{2} x^2 \, dx
\frac{d}{dx}x^3
\lim_{x\to0}\frac{\sin{x}}{x}
det([1,2;3,4])
inverse([1,2;3,4])
mean(2,4,6,8)
median(1,7,3)
std(2,4,6)
```

## Requirements

- Node.js 20 or newer
- Python 3
- SymPy for the local solver
- Optional Wolfram|Alpha App ID for fallback solving
- Optional Gemini API key for explanations and image extraction only

## Setup

1. Install Node dependencies:

   ```bash
   npm install
   ```

2. Create a Python virtual environment for the local SymPy solver:

   ```bash
   python -m venv .venv
   .venv/Scripts/python.exe -m pip install sympy
   ```

3. Optional: create an environment file for explanations or image extraction:

   ```bash
   cp .env.example .env.local
   ```

   ```env
   GEMINI_API_KEY="your_gemini_api_key_here"
   GEMINI_API_KEY_FALLBACK="your_fallback_gemini_api_key_here"
   GEMINI_API_KEY_FALLBACK_2="your_second_fallback_gemini_api_key_here"
   WOLFRAM_APP_ID="your_wolfram_app_id_here"
   PYTHON_BIN=".venv/Scripts/python.exe"
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

## Scripts

- `npm run dev` starts the Express and Vite development server.
- `npm run build` builds the frontend and server.
- `npm run start` runs the production build.
- `npm run lint` checks TypeScript.

## Notes

Do not commit `.env`, `.env.local`, or any real API key. The `.gitignore` already excludes environment files and keeps only `.env.example`.
