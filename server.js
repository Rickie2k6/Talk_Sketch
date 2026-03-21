import express from "express";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { spawn } from "child_process";
import { createHash, randomUUID } from "crypto";

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "dist");
const DEV_FRONTEND_URL =
  process.env.DEV_FRONTEND_URL || `http://${process.env.VITE_HOST || "127.0.0.1"}:${process.env.VITE_PORT || "5174"}`;
const PYTHON_BIN = process.env.PIX2TEXT_PYTHON_BIN || process.env.MATH_OCR_PYTHON_BIN || "python3";
const OCR_WORKER_PATH = path.join(__dirname, "scripts", "pix2text_worker.py");
const OCR_WARMUP_SAMPLE_PATH = path.join(__dirname, "example", "UN19_1041_em_595.bmp");
const RECOGNITION_CACHE_LIMIT = 64;
let ocrWorkerPromise = null;
let ocrWorker = null;
const recognitionCache = new Map();

app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https:",
      "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https:",
      "script-src-attr 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' http: https: ws: wss:",
      "worker-src 'self' blob:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  next();
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(DIST_DIR));
} else {
  app.get("/", (_req, res) => {
    res.type("text/plain").send(
      `Talk Sketch backend is running.\nOpen the frontend at ${DEV_FRONTEND_URL} after starting \`npm run dev\`.`,
    );
  });
}

function startRecognitionWorker() {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["-u", OCR_WORKER_PATH], {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const pending = new Map();
    const stderrChunks = [];
    let isReady = false;

    const settleFailure = (message) => {
      const error = new Error(message);
      ocrWorkerPromise = null;
      if (!isReady) {
        reject(error);
      }

      for (const { reject: rejectRequest } of pending.values()) {
        rejectRequest(error);
      }
      pending.clear();
      ocrWorker = null;
    };

    const stdout = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdout.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        return;
      }

      if (payload.event === "ready") {
        isReady = true;
        ocrWorker = { child, pending, readyState: payload };
        resolve(ocrWorker);
        return;
      }

      if (payload.event === "fatal") {
        settleFailure(payload.error || "Pix2Text startup failed.");
        return;
      }

      if (!payload.id) return;

      const request = pending.get(payload.id);
      if (!request) return;
      pending.delete(payload.id);

      if (payload.ok) {
        request.resolve(payload);
      } else {
        request.reject(new Error(payload.error || "Pix2Text recognition failed."));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(String(chunk));
    });

    child.once("error", (error) => {
      settleFailure(`Unable to start Pix2Text worker: ${error.message}`);
    });

    child.once("exit", (code, signal) => {
      const stderr = stderrChunks.join("").trim();
      const reason = stderr || `Pix2Text worker exited (${signal || code || "unknown"}).`;
      settleFailure(reason);
    });
  });
}

async function ensureRecognitionWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = startRecognitionWorker();
  }
  return ocrWorkerPromise;
}

function getRecognitionCacheKey(imageData) {
  return createHash("sha1").update(imageData).digest("hex");
}

function getCachedRecognition(cacheKey) {
  if (!recognitionCache.has(cacheKey)) return null;

  const cached = recognitionCache.get(cacheKey);
  recognitionCache.delete(cacheKey);
  recognitionCache.set(cacheKey, cached);
  return cached;
}

function setCachedRecognition(cacheKey, result) {
  if (!cacheKey || !result) return;

  if (recognitionCache.has(cacheKey)) {
    recognitionCache.delete(cacheKey);
  }
  recognitionCache.set(cacheKey, result);

  if (recognitionCache.size > RECOGNITION_CACHE_LIMIT) {
    const oldestKey = recognitionCache.keys().next().value;
    if (oldestKey) {
      recognitionCache.delete(oldestKey);
    }
  }
}

ensureRecognitionWorker()
  .then((worker) => {
    const model = worker?.readyState?.model || "unknown model";
    const device = worker?.readyState?.device || "unknown device";
    console.log(`Pix2Text worker ready on ${device} using ${model}`);

    if (fs.existsSync(OCR_WARMUP_SAMPLE_PATH)) {
      const warmupImageData = `data:image/bmp;base64,${fs.readFileSync(OCR_WARMUP_SAMPLE_PATH).toString("base64")}`;
      requestRecognition(warmupImageData)
        .then(() => {
          console.log("Pix2Text worker warmup complete.");
        })
        .catch((error) => {
          console.error(`Pix2Text warmup failed: ${error instanceof Error ? error.message : "unknown error"}`);
        });
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Pix2Text worker failed to start.");
  });

async function requestRecognition(imageData) {
  const worker = await ensureRecognitionWorker();

  return new Promise((resolve, reject) => {
    const id = randomUUID();
    worker.pending.set(id, { resolve, reject });

    worker.child.stdin.write(`${JSON.stringify({ id, imageData })}\n`, (error) => {
      if (!error) return;
      worker.pending.delete(id);
      reject(new Error(`Unable to send request to Pix2Text worker: ${error.message}`));
    });
  });
}

process.on("exit", () => {
  if (ocrWorker?.child) {
    ocrWorker.child.kill();
  }
});

app.post("/analyze-sketch", async (req, res) => {
  const { apiKey, elements, message, recognizedMath } = req.body || {};
  const prompt = typeof message === "string" ? message.trim() : "";
  const recognized = typeof recognizedMath === "string" ? recognizedMath.trim() : "";
  const wantsExpressionOnly =
    /math expression|equation|what is on the (white)?board|what's on the (white)?board|read the (white)?board/i.test(
      prompt,
    );

  if (recognized && wantsExpressionOnly) {
    res.json({ result: recognized });
    return;
  }

  if (typeof apiKey !== "string" || !apiKey.startsWith("sk-")) {
    res.status(400).json({ error: "Invalid API key." });
    return;
  }

  const safeElements = Array.isArray(elements) ? elements : [];

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
            `Recognized math from Pix2Text: ${typeof recognizedMath === "string" && recognizedMath.trim() ? recognizedMath.trim() : "(none)"}`,
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
  const { imageData } = req.body || {};

  if (typeof imageData !== "string" || !imageData.trim()) {
    res.json({ latex: "", normalized: "", score: null, model: "Pix2Text", isReliable: false, issues: ["no_image"] });
    return;
  }

  try {
    const cacheKey = getRecognitionCacheKey(imageData);
    const cachedResult = getCachedRecognition(cacheKey);
    if (cachedResult) {
      res.json({
        ...cachedResult,
        cached: true,
      });
      return;
    }

    const result = await requestRecognition(imageData);
    const payload = {
      latex: typeof result.latex === "string" ? result.latex : "",
      normalized: typeof result.normalized === "string" ? result.normalized : "",
      score: Number.isFinite(result.score) ? result.score : null,
      imageSize: result.imageSize || null,
      model: "Pix2Text",
      device: typeof result.device === "string" ? result.device : null,
      isReliable: result.isReliable === true,
      issues: Array.isArray(result.issues) ? result.issues : [],
      cached: false,
    };
    setCachedRecognition(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : "Pix2Text recognition failed.",
      model: "Pix2Text",
    });
  }
});

if (process.env.NODE_ENV === "production") {
  app.get("*", (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Talk Sketch backend listening on http://${HOST}:${PORT}`);
});
