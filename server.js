import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "dist");
const DEV_FRONTEND_URL =
  process.env.DEV_FRONTEND_URL || `http://${process.env.VITE_HOST || "127.0.0.1"}:${process.env.VITE_PORT || "5174"}`;
const PYTHON_BIN = process.env.COMER_PYTHON_BIN || "python3";
const COMER_WORKER_PATH = path.join(__dirname, "scripts", "comer_worker.py");
let comerWorkerPromise = null;
let comerWorker = null;

app.use(express.json({ limit: "10mb" }));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(DIST_DIR));
} else {
  app.get("/", (_req, res) => {
    res.type("text/plain").send(
      `Talk Sketch backend is running.\nOpen the frontend at ${DEV_FRONTEND_URL} after starting \`npm run dev\`.`,
    );
  });
}

function startCoMERWorker() {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["-u", COMER_WORKER_PATH], {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const pending = new Map();
    const stderrChunks = [];
    let isReady = false;

    const settleFailure = (message) => {
      const error = new Error(message);
      comerWorkerPromise = null;
      if (!isReady) {
        reject(error);
      }

      for (const { reject: rejectRequest } of pending.values()) {
        rejectRequest(error);
      }
      pending.clear();
      comerWorker = null;
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
        comerWorker = { child, pending, readyState: payload };
        resolve(comerWorker);
        return;
      }

      if (payload.event === "fatal") {
        settleFailure(payload.error || "CoMER startup failed.");
        return;
      }

      if (!payload.id) return;

      const request = pending.get(payload.id);
      if (!request) return;
      pending.delete(payload.id);

      if (payload.ok) {
        request.resolve(payload);
      } else {
        request.reject(new Error(payload.error || "CoMER recognition failed."));
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(String(chunk));
    });

    child.once("error", (error) => {
      settleFailure(`Unable to start CoMER worker: ${error.message}`);
    });

    child.once("exit", (code, signal) => {
      const stderr = stderrChunks.join("").trim();
      const reason = stderr || `CoMER worker exited (${signal || code || "unknown"}).`;
      settleFailure(reason);
    });
  });
}

async function ensureCoMERWorker() {
  if (!comerWorkerPromise) {
    comerWorkerPromise = startCoMERWorker();
  }
  return comerWorkerPromise;
}

async function requestCoMERRecognition(imageData) {
  const worker = await ensureCoMERWorker();

  return new Promise((resolve, reject) => {
    const id = randomUUID();
    worker.pending.set(id, { resolve, reject });

    worker.child.stdin.write(`${JSON.stringify({ id, imageData })}\n`, (error) => {
      if (!error) return;
      worker.pending.delete(id);
      reject(new Error(`Unable to send request to CoMER worker: ${error.message}`));
    });
  });
}

process.on("exit", () => {
  if (comerWorker?.child) {
    comerWorker.child.kill();
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
            `Recognized math from CoMER: ${typeof recognizedMath === "string" && recognizedMath.trim() ? recognizedMath.trim() : "(none)"}`,
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
    res.json({ latex: "", normalized: "", score: null, model: "CoMER" });
    return;
  }

  try {
    const result = await requestCoMERRecognition(imageData);
    res.json({
      latex: typeof result.latex === "string" ? result.latex : "",
      normalized: typeof result.normalized === "string" ? result.normalized : "",
      score: Number.isFinite(result.score) ? result.score : null,
      imageSize: result.imageSize || null,
      model: "CoMER",
      device: typeof result.device === "string" ? result.device : null,
    });
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : "CoMER recognition failed.",
      model: "CoMER",
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
