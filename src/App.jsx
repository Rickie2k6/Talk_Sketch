import { exportToBlob } from "@excalidraw/excalidraw";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import Whiteboard from "./library/Whiteboard.jsx";

const RECOGNITION_DEBOUNCE_MS = 450;
const RECOGNITION_EXPORT_PADDING = 24;
const RECOGNITION_REQUEST_TIMEOUT_MS = 20000;
const RECOGNITION_EXPORT_MAX_DIMENSION = 1200;
const RECOGNITION_EXPORT_MAX_PIXELS = 900000;
const EXPRESSION_QUESTION_PATTERNS = [
  "math expression",
  "equation",
  "recognize the handwritten math expression",
  "recognize the expression",
  "what is on the whiteboard",
  "what's on the whiteboard",
  "what is on the board",
  "what's on the board",
  "read the whiteboard",
  "read the board",
];

const supportsSpeechRecognition =
  typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

function createRecognition({ onText, onStop }) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = true;

  rec.onresult = (event) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += `${result[0].transcript} `;
      } else {
        interimTranscript += result[0].transcript;
      }
    }

    onText(`${finalTranscript}${interimTranscript}`.trim());
  };

  rec.onerror = () => onStop();
  rec.onend = () => onStop();
  return rec;
}

function isExpressionQuestion(message) {
  const value = message.trim().toLowerCase();
  return EXPRESSION_QUESTION_PATTERNS.some((pattern) => value.includes(pattern));
}

function formatRecognizedMathPreview(latex) {
  if (typeof latex !== "string") return "";

  return latex
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\neq/g, "≠")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\left|\\right/g, "")
    .replace(/\\limits/g, "")
    .replace(/\\sum/g, "∑")
    .replace(/\\int/g, "∫")
    .replace(/\\sqrt/g, "√")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\theta/g, "θ")
    .replace(/\\pi/g, "π")
    .replace(/\\lambda/g, "λ")
    .replace(/\\mu/g, "μ")
    .replace(/\\sigma/g, "σ")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\infty/g, "∞")
    .replace(/\\ /g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*_\s*/g, "_")
    .replace(/\s*\^\s*/g, "^")
    .trim();
}

function getRecognitionIssueMessage(issues) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return "Math recognition looks unreliable for this drawing. Try writing a bit larger or more clearly.";
  }

  if (
    issues.includes("too_many_relations") ||
    issues.includes("high_token_repetition") ||
    issues.includes("repeated_phrase")
  ) {
    return "CoMER produced a repetitive or broken equation for this drawing. Try redrawing the expression with more spacing.";
  }

  if (issues.includes("too_many_multiplication_dots")) {
    return "CoMER over-read repeated multiplication symbols. Remove stray marks and try again.";
  }

  if (issues.includes("no_content")) {
    return "No handwritten math was detected on the board.";
  }

  return "Math recognition looks unreliable for this drawing. Try writing a bit larger or more clearly.";
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("Unable to read exported scene."));
    reader.readAsDataURL(blob);
  });
}

async function resizeBlobForRecognition(blob) {
  if (typeof window === "undefined" || typeof createImageBitmap !== "function") {
    return blob;
  }

  const imageBitmap = await createImageBitmap(blob);
  const { width, height } = imageBitmap;
  const dimensionScale = Math.min(
    1,
    RECOGNITION_EXPORT_MAX_DIMENSION / Math.max(width, height),
  );
  const pixelScale = Math.min(
    1,
    Math.sqrt(RECOGNITION_EXPORT_MAX_PIXELS / Math.max(width * height, 1)),
  );
  const scale = Math.min(dimensionScale, pixelScale);

  if (scale >= 1) {
    imageBitmap.close();
    return blob;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");

  if (!context) {
    imageBitmap.close();
    return blob;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
  imageBitmap.close();

  const resizedBlob = await new Promise((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob || blob), "image/png");
  });

  return resizedBlob;
}

async function exportSceneImage(excalidrawAPI) {
  if (!excalidrawAPI) return "";

  const elements = excalidrawAPI.getSceneElements();
  if (!elements.length) return "";

  const blob = await exportToBlob({
    elements,
    appState: {
      ...excalidrawAPI.getAppState(),
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: "#ffffff",
    },
    files: excalidrawAPI.getFiles(),
    mimeType: "image/png",
    exportPadding: RECOGNITION_EXPORT_PADDING,
  });

  const normalizedBlob = await resizeBlobForRecognition(blob);
  return blobToDataURL(normalizedBlob);
}

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [sceneElements, setSceneElements] = useState([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecognizingMath, setIsRecognizingMath] = useState(false);
  const [recognizedMath, setRecognizedMath] = useState("");
  const [recognitionError, setRecognitionError] = useState("");
  const [messages, setMessages] = useState([]);
  const recognitionRef = useRef(null);
  const recognizeAbortRef = useRef(null);
  const recognitionCacheRef = useRef(new Map());
  const lastSceneSignatureRef = useRef("");
  const lastObservedSceneSignatureRef = useRef("");
  const latestSceneSignatureRef = useRef("");
  const recognitionRequestSerialRef = useRef(0);

  const canSend = useMemo(() => Boolean(chatInput.trim()) && !isSending, [chatInput, isSending]);
  const recognizedMathPreview = useMemo(
    () => formatRecognizedMathPreview(recognizedMath),
    [recognizedMath],
  );

  const handleSceneChange = (elements) => {
    const nextElements = Array.isArray(elements) ? elements : [];
    const signature = nextElements
      .map((element) => `${element?.id || "unknown"}:${element?.version || 0}:${element?.isDeleted ? 1 : 0}`)
      .join("|");

    if (signature === lastObservedSceneSignatureRef.current) {
      return;
    }

    lastObservedSceneSignatureRef.current = signature;
    latestSceneSignatureRef.current = signature;
    setSceneElements([...nextElements]);
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (recognizeAbortRef.current) {
        recognizeAbortRef.current.abort();
      }
    };
  }, []);

  const recognizeScene = async ({ preserveExistingMath = false, signature = "" } = {}) => {
    if (!excalidrawAPI) return "";

    const cacheKey = signature || latestSceneSignatureRef.current;
    if (cacheKey && recognitionCacheRef.current.has(cacheKey)) {
      const cachedLatex = recognitionCacheRef.current.get(cacheKey);
      setRecognizedMath(cachedLatex);
      setRecognitionError("");
      return cachedLatex;
    }

    const imageData = await exportSceneImage(excalidrawAPI);
    if (!imageData) {
      if (!preserveExistingMath) {
        setRecognizedMath("");
      }
      setRecognitionError("");
      return "";
    }

    if (recognizeAbortRef.current) {
      recognizeAbortRef.current.abort();
    }

    const abortController = new AbortController();
    recognizeAbortRef.current = abortController;
    const requestSerial = recognitionRequestSerialRef.current + 1;
    recognitionRequestSerialRef.current = requestSerial;
    const timeoutId = window.setTimeout(() => abortController.abort(), RECOGNITION_REQUEST_TIMEOUT_MS);

    setIsRecognizingMath(true);

    try {
      const response = await fetch("/recognize-math", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Math recognition failed");
      }

      const data = await response.json();
      const latex = typeof data?.latex === "string" ? data.latex.trim() : "";
      const isReliable = data?.isReliable === true;
      const issueMessage = !latex ? getRecognitionIssueMessage(data?.issues) : "";
      if (cacheKey && latex) {
        recognitionCacheRef.current.set(cacheKey, latex);
      }

      if (recognitionRequestSerialRef.current === requestSerial) {
        setRecognizedMath(latex);
        setRecognitionError(!latex && !isReliable ? issueMessage : "");
      }

      return latex;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutMessage =
          "Math recognition is taking longer than expected. Please wait a moment and try again.";
        if (recognitionRequestSerialRef.current === requestSerial) {
          if (!preserveExistingMath) {
            setRecognizedMath("");
          }
          setRecognitionError(timeoutMessage);
        }
        return "";
      }

      const message = error?.message || "Math recognition failed.";
      if (recognitionRequestSerialRef.current === requestSerial) {
        if (!preserveExistingMath) {
          setRecognizedMath("");
        }
        setRecognitionError(message);
      }
      return "";
    } finally {
      window.clearTimeout(timeoutId);
      if (recognizeAbortRef.current === abortController) {
        recognizeAbortRef.current = null;
      }
      if (recognitionRequestSerialRef.current === requestSerial) {
        setIsRecognizingMath(false);
      }
    }
  };

  useEffect(() => {
    const activeElements = sceneElements.filter((el) => !el?.isDeleted);
    if (!excalidrawAPI || activeElements.length === 0) {
      setRecognizedMath("");
      setRecognitionError("");
      lastSceneSignatureRef.current = "";
      return;
    }

    const signature = activeElements.map((el) => `${el.id}:${el.version}`).join("|");
    if (signature === lastSceneSignatureRef.current) return;

    if (recognitionCacheRef.current.has(signature)) {
      const cachedLatex = recognitionCacheRef.current.get(signature);
      setRecognizedMath(cachedLatex);
      setRecognitionError("");
      lastSceneSignatureRef.current = signature;
      return;
    }

    const recognitionTimer = setTimeout(async () => {
      const latex = await recognizeScene({ preserveExistingMath: false, signature });
      if (latex) {
        lastSceneSignatureRef.current = signature;
      }
    }, RECOGNITION_DEBOUNCE_MS);

    return () => clearTimeout(recognitionTimer);
  }, [excalidrawAPI, sceneElements]);

  const appendMessage = (role, text) => {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, role, text }]);
  };

  const connectApiKey = () => {
    const key = apiKeyInput.trim();
    if (!key.startsWith("sk-")) {
      alert("Invalid API key format.");
      return;
    }
    setApiKey(key);
    setApiKeyInput("");
  };

  const sendMessage = async () => {
    const message = chatInput.trim();
    if (!message || isSending) return;
    const wantsExpressionOnly = isExpressionQuestion(message);
    if (!apiKey && !wantsExpressionOnly) {
      alert("Please connect your API key first.");
      return;
    }

    const elements = excalidrawAPI?.getSceneElements?.() || [];
    appendMessage("user", message);
    setChatInput("");

    let currentRecognizedMath = recognizedMath;
    if (wantsExpressionOnly && elements.some((element) => !element?.isDeleted)) {
      currentRecognizedMath = await recognizeScene({
        preserveExistingMath: true,
        signature: latestSceneSignatureRef.current,
      });
    }

    if (wantsExpressionOnly && currentRecognizedMath) {
      setRecognizedMath(currentRecognizedMath);
      appendMessage("assistant", currentRecognizedMath);
      return;
    }

    if (wantsExpressionOnly) {
      appendMessage(
        "assistant",
        recognitionError ||
          "CoMER could not confidently read the handwritten math yet. Try waiting a moment or redrawing the symbols a bit more clearly.",
      );
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch("/analyze-sketch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          elements,
          message,
          recognizedMath: currentRecognizedMath,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || "Request failed");
      }

      const data = await response.json();
      appendMessage("assistant", data?.result || "No response from assistant.");
    } catch (error) {
      appendMessage("assistant", `Error: ${error?.message || "Request failed."}`);
    } finally {
      setIsSending(false);
    }
  };

  const toggleRecording = () => {
    if (!supportsSpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsRecording(false);
      return;
    }

    const recognition = createRecognition({
      onText: (text) => {
        if (text) setChatInput(text);
      },
      onStop: () => {
        recognitionRef.current = null;
        setIsRecording(false);
      },
    });

    recognitionRef.current = recognition;
    setIsRecording(true);
    recognition.start();
  };

  const insertRecognizedMath = () => {
    if (!recognizedMath) return;
    setChatInput((prev) => (prev.trim() ? `${prev.trim()} ${recognizedMath}` : recognizedMath));
  };

  return (
    <div className="app-shell">
      <div className="board-area">
        <Whiteboard onApiReady={setExcalidrawAPI} onSceneChange={handleSceneChange} />
      </div>

      <aside className="side-panel">
        <div className="panel-header">
          <h2 className="panel-title">TalkSketch Assistant</h2>
          <span className={`key-status ${apiKey ? "connected" : ""}`}>
            {apiKey ? "Chat API Connected" : "Chat API Not Connected"}
          </span>
        </div>

        <div className="recognition-card">
          <div className="recognition-title">Live Math Recognition</div>
          <div className="recognition-body">
            {isRecognizingMath ? "Recognizing current handwriting with CoMER..." : null}
            {!isRecognizingMath && recognitionError ? (
              <p className="recognition-error">{recognitionError}</p>
            ) : null}
            {!isRecognizingMath && !recognitionError && recognizedMath ? (
              <div className="recognition-result">
                <div className="recognition-preview">{recognizedMathPreview || recognizedMath}</div>
                <div className="recognition-raw-label">Raw CoMER Output</div>
                <code>{recognizedMath}</code>
              </div>
            ) : null}
            {!isRecognizingMath && !recognitionError && !recognizedMath ? "Write math on the board to recognize." : null}
          </div>
          {recognizedMath ? (
            <div className="recognition-actions">
              <button className="ghost-btn" type="button" onClick={insertRecognizedMath}>
                Insert Into Chat
              </button>
            </div>
          ) : null}
        </div>

        <div className="chat-list">
          {messages.length === 0 ? <p className="hint">No messages yet.</p> : null}
          {messages.map((message) => (
            <div className="chat-message" key={message.id}>
              <div className="chat-role">{message.role === "user" ? "You" : "AI Coach"}</div>
              <p className="chat-text">{message.text}</p>
            </div>
          ))}
        </div>

        <div className="chat-form">
          {recognizedMath ? (
            <div className="chat-context">
              Chat will include CoMER math context: <code>{recognizedMath}</code>
            </div>
          ) : null}
          <input
            className="chat-input"
            type="text"
            placeholder="Ask about your sketch..."
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <button className="send-btn" type="button" onClick={sendMessage} disabled={!canSend}>
            Send
          </button>
        </div>

        <div className="api-section">
          <label className="api-label" htmlFor="api-key-input">
            OpenAI API Key
          </label>
          <div className="api-row">
            <input
              id="api-key-input"
              className="api-input"
              type="password"
              placeholder="Paste key (session only)"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              autoComplete="off"
            />
            <button className="connect-btn" type="button" onClick={connectApiKey}>
              Connect
            </button>
          </div>
        </div>

        <button
          className={`record-btn ${isRecording ? "active" : ""}`}
          type="button"
          onClick={toggleRecording}
        >
          {isRecording ? "Stop Recording" : "Start Recording"}
        </button>
      </aside>
    </div>
  );
}

export default App;
