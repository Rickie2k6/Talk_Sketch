import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import readline from "readline";
import { spawn } from "child_process";

const app = express();
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_ARCHIVE = process.env.MATH_DATASET_ARCHIVE || path.join(__dirname, "mathwriting-2024.tgz");
let symbolLabelsPromise = null;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

function compactElementsForRecognition(elements) {
  return elements
    .filter((el) => el && !el.isDeleted)
    .slice(0, 300)
    .map((el) => ({
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      text: el.text || "",
      points: Array.isArray(el.points) ? el.points : [],
    }));
}

function sanitizeModelJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null;
  try {
    return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function readSymbolsFromArchive() {
  return new Promise((resolve, reject) => {
    const labelSet = new Set();
    const tar = spawn("tar", ["-xOf", DATASET_ARCHIVE, "mathwriting-2024/symbols.jsonl"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    tar.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const rl = readline.createInterface({ input: tar.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const value = line.trim();
      if (!value) return;
      try {
        const row = JSON.parse(value);
        if (typeof row.label === "string" && row.label.trim()) {
          labelSet.add(row.label.trim());
        }
      } catch {
        // Skip malformed lines.
      }
    });

    rl.on("close", () => {
      // Wait for process exit event.
    });

    tar.on("error", reject);
    tar.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "Unable to read dataset archive"));
        return;
      }
      resolve(Array.from(labelSet).sort());
    });
  });
}

async function loadSymbolLabels() {
  if (symbolLabelsPromise) return symbolLabelsPromise;
  symbolLabelsPromise = (async () => {
    if (!fs.existsSync(DATASET_ARCHIVE)) return [];
    try {
      return await readSymbolsFromArchive();
    } catch {
      return [];
    }
  })();
  return symbolLabelsPromise;
}

app.post("/analyze-sketch", async (req, res) => {
  const { apiKey, elements, message } = req.body || {};

  if (typeof apiKey !== "string" || !apiKey.startsWith("sk-")) {
    res.status(400).json({ error: "Invalid API key." });
    return;
  }

  const safeElements = Array.isArray(elements) ? elements : [];
  const prompt = typeof message === "string" ? message.trim() : "";

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are TalkSketch AI Coach helping brainstorm ideas from sketch elements and user intent.",
        },
        {
          role: "user",
          content: [
            `User message: ${prompt || "(none)"}`,
            `Sketch JSON: ${JSON.stringify(safeElements)}`,
          ].join("\n\n"),
        },
      ],
    });

    const result = completion.choices?.[0]?.message?.content || "";
    res.json({ result });
  } catch {
    res.status(400).json({ error: "Invalid API key or request failed" });
  }
});

app.post("/recognize-math", async (req, res) => {
  const { apiKey, elements } = req.body || {};

  if (typeof apiKey !== "string" || !apiKey.startsWith("sk-ant-")) {
    res.status(400).json({ error: "Invalid Claude API key. Must start with 'sk-ant-'." });
    return;
  }

  if (!Array.isArray(elements) || elements.length === 0) {
    res.json({ latex: "", normalized: "", confidence: 0 });
    return;
  }

  const compactElements = compactElementsForRecognition(elements);
  const symbols = await loadSymbolLabels();
  const symbolHint = symbols.length > 0 ? symbols.slice(0, 500).join(", ") : "";

  try {
    const client = new Anthropic({ apiKey });
    
    const systemPrompt = [
      "You are an expert handwritten math expression recognizer.",
      "You analyze Excalidraw stroke elements and convert them to mathematical notation.",
      "You must ALWAYS respond with valid JSON in this exact format:",
      '{"latex":"<LaTeX expression>", "normalized":"<plain text representation>", "confidence":<0-1>}',
      "Where:",
      "- latex: The recognized expression in LaTeX notation",
      "- normalized: A plain English description of the expression",
      "- confidence: A number between 0 and 1 indicating confidence in the recognition",
      "For invalid or unclear inputs, return empty strings with confidence 0.",
      "Be precise with LaTeX syntax. Common patterns:",
      "- Fractions: \\frac{numerator}{denominator}",
      "- Powers: x^{2} or a^{b}",
      "- Roots: \\sqrt{x} or \\sqrt[n]{x}",
      "- Greek letters: \\alpha, \\beta, \\theta, etc.",
      "- Operators: \\times, \\div, \\pm, \\approx, etc.",
    ].join("\n");

    const userPrompt = [
      "Analyze these handwritten Excalidraw stroke elements and recognize the mathematical expression.",
      symbolHint ? `\nPreferred symbols from dataset: ${symbolHint}` : "",
      `\nStroke elements (JSON):\n${JSON.stringify(compactElements, null, 2)}`,
      "\nRespond ONLY with the JSON object, no additional text.",
    ].join("\n");

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const text = response.content?.[0]?.type === "text" ? response.content[0].text : "";
    const parsed = sanitizeModelJson(text);
    
    if (!parsed) {
      res.json({
        latex: "",
        normalized: "",
        confidence: 0,
        error: "recognition_parse_failed",
      });
      return;
    }

    res.json({
      latex: typeof parsed.latex === "string" ? parsed.latex : "",
      normalized: typeof parsed.normalized === "string" ? parsed.normalized : "",
      confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      symbolCount: symbols.length,
    });
  } catch (error) {
    console.error("Math recognition error:", error);
    res.status(400).json({ error: "Math recognition failed: " + (error?.message || "Unknown error") });
  }
});

app.listen(PORT);
