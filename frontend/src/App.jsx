import { exportToBlob, exportToCanvas } from "@excalidraw/excalidraw";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import "./App.css";
import "../ai_chatbox/history.css";
import Whiteboard from "./library/Whiteboard.jsx";
import { addMessageToHistory, addExpressionToHistory, getHistory, clearHistory, downloadHistoryAsFile } from "../ai_chatbox/history.js";
import UserColorManager from "./utils/userColorManager.js";
import StrokeTracker from "./utils/strokeTracker.js";

const RECOGNITION_DEBOUNCE_MS = 450;
const RECOGNITION_EXPORT_PADDING = 24;
const RECOGNITION_REQUEST_TIMEOUT_MS = 45000;
const RECOGNITION_EXPORT_MAX_DIMENSION = 1200;
const RECOGNITION_EXPORT_MAX_PIXELS = 900000;
const LOCAL_EXPRESSION_IDLE_MS = 2000;
const EXPRESSION_NOTICE_DURATION_MS = 2800;
const SHARED_STROKE_RENDER_COLOR = "#000000";
const EXPRESSION_PREVIEW_BACKGROUND = "#ffffff";
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
    return "GPT-5.4 produced a repetitive or broken equation for this drawing. Try redrawing the expression with more spacing.";
  }

  if (issues.includes("too_many_multiplication_dots")) {
    return "GPT-5.4 over-read repeated multiplication symbols. Remove stray marks and try again.";
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

function getSerializableExpressionElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .filter((element) => element && !element.isDeleted)
    .map((element) => JSON.parse(JSON.stringify(element)));
}

async function renderExpressionPreview(elements, files = {}) {
  const safeElements = getSerializableExpressionElements(elements);
  if (safeElements.length === 0) {
    return "";
  }

  const canvas = await exportToCanvas({
    elements: safeElements,
    appState: {
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: EXPRESSION_PREVIEW_BACKGROUND,
    },
    files,
    maxWidthOrHeight: 640,
  });

  return canvas.toDataURL("image/png");
}

function isStrokeElement(element) {
  return Boolean(element) && !element.isDeleted && Array.isArray(element.points) && element.points.length > 1;
}

function createStrokePayload(element, userId, color, timestamp = Date.now()) {
  return {
    strokeId: typeof element.id === "string" ? element.id : uuidv4(),
    userId,
    color,
    timestamp,
    version: Number.isFinite(element.version) ? element.version : 1,
    type: element.type,
    x: Number.isFinite(element.x) ? element.x : 0,
    y: Number.isFinite(element.y) ? element.y : 0,
    width: Number.isFinite(element.width) ? element.width : 0,
    height: Number.isFinite(element.height) ? element.height : 0,
    points: Array.isArray(element.points)
      ? element.points.map((point) => ({
        x: Number.isFinite(point?.[0]) ? point[0] : 0,
        y: Number.isFinite(point?.[1]) ? point[1] : 0,
      }))
      : [],
    element: JSON.parse(JSON.stringify(element)),
  };
}

function createStrokeElementFromPayload(stroke) {
  if (stroke?.element && typeof stroke.element === "object") {
    const element = JSON.parse(JSON.stringify(stroke.element));
    element.id = stroke.strokeId || element.id;
    if (Array.isArray(stroke.points)) {
      element.points = stroke.points.map((point) => [
        Number.isFinite(point?.x) ? point.x : 0,
        Number.isFinite(point?.y) ? point.y : 0,
      ]);
    }
    element.strokeColor = SHARED_STROKE_RENDER_COLOR;
    element.roughness = 0;
    element.strokeStyle = "solid";
    element.opacity = 100;
    if (Number.isFinite(stroke.version)) {
      element.version = stroke.version;
    }
    return element;
  }

  return null;
}

function getStrokeBounds(stroke) {
  const absolutePoints = Array.isArray(stroke?.points)
    ? stroke.points.map((point) => [
      (Number.isFinite(stroke?.x) ? stroke.x : 0) + (Number.isFinite(point?.x) ? point.x : 0),
      (Number.isFinite(stroke?.y) ? stroke.y : 0) + (Number.isFinite(point?.y) ? point.y : 0),
    ])
    : [];

  if (absolutePoints.length > 0) {
    const xs = absolutePoints.map(([x]) => x);
    const ys = absolutePoints.map(([, y]) => y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }

  const x = Number.isFinite(stroke?.x) ? stroke.x : 0;
  const y = Number.isFinite(stroke?.y) ? stroke.y : 0;
  const width = Number.isFinite(stroke?.width) ? stroke.width : 1;
  const height = Number.isFinite(stroke?.height) ? stroke.height : 1;
  return {
    minX: x,
    maxX: x + Math.max(width, 1),
    minY: y,
    maxY: y + Math.max(height, 1),
  };
}

function getExpressionBounds(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0) {
    return { minX: 0, minY: 0, width: 100, height: 60 };
  }

  const bounds = strokes.map(getStrokeBounds);
  const minX = Math.min(...bounds.map((bound) => bound.minX));
  const maxX = Math.max(...bounds.map((bound) => bound.maxX));
  const minY = Math.min(...bounds.map((bound) => bound.minY));
  const maxY = Math.max(...bounds.map((bound) => bound.maxY));

  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 40),
    height: Math.max(maxY - minY, 24),
  };
}

function expressionCreatorLabel(expression, currentUserId) {
  if (expression?.userId === currentUserId) {
    return "You";
  }

  const shortId = typeof expression?.userId === "string" ? expression.userId.slice(0, 4) : "user";
  return `User ${shortId}`;
}

function getExpressionUserIds(expression) {
  const userIds = new Set();

  if (typeof expression?.userId === "string" && expression.userId.trim()) {
    userIds.add(expression.userId.trim());
  }

  if (Array.isArray(expression?.strokes)) {
    expression.strokes.forEach((stroke) => {
      if (typeof stroke?.userId === "string" && stroke.userId.trim()) {
        userIds.add(stroke.userId.trim());
      }
    });
  }

  return Array.from(userIds);
}

function SharedExpressionPreview({ expression, currentUserId, highlighted = false }) {
  const creatorLabel = expressionCreatorLabel(expression, currentUserId);
  const [previewUrl, setPreviewUrl] = useState(expression?.previewUrl || "");

  useEffect(() => {
    let isCancelled = false;
    const nextPreviewUrl = typeof expression?.previewUrl === "string" ? expression.previewUrl : "";

    if (nextPreviewUrl) {
      setPreviewUrl(nextPreviewUrl);
      return () => {
        isCancelled = true;
      };
    }

    if (!Array.isArray(expression?.elements) || expression.elements.length === 0) {
      setPreviewUrl("");
      return () => {
        isCancelled = true;
      };
    }

    renderExpressionPreview(expression.elements)
      .then((dataUrl) => {
        if (!isCancelled) {
          setPreviewUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setPreviewUrl("");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [expression]);

  return (
    <div className={`shared-expression-card ${highlighted ? "highlighted" : ""}`}>
      <div className="shared-expression-meta">
        <span className="shared-expression-badge" style={{ backgroundColor: expression?.color || "#d8deeb" }} />
        <span>{creatorLabel}</span>
        <span>{new Date(expression?.timestamp || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
      </div>
      {previewUrl ? (
        <img className="shared-expression-preview" src={previewUrl} alt="Shared handwritten math sketch preview" />
      ) : (
        <div className="shared-expression-preview" />
      )}
      <div className="shared-expression-footer">
        {Array.isArray(expression?.elements) ? expression.elements.length : 0} element(s)
      </div>
    </div>
  );
}

function App() {
  // User & Collaboration
  const userIdRef = useRef(null);
  const [userColor, setUserColor] = useState(null);
  const [activeUsers, setActiveUsers] = useState(new Map());
  const [historyItems, setHistoryItems] = useState([]);
  const [sharedStrokes, setSharedStrokes] = useState([]);
  const [expressionNotice, setExpressionNotice] = useState(null);
  const [highlightedExpressionId, setHighlightedExpressionId] = useState("");
  const socketRef = useRef(null);
  const strokeTrackerRef = useRef(null);
  const sessionIdRef = useRef(null);
  const userColorRef = useRef(null);
  const colorManagerRef = useRef(new UserColorManager());
  const activeStrokeElementIdsRef = useRef(new Set());
  const sentStrokeVersionsRef = useRef(new Map());
  const pendingExpressionStrokesRef = useRef([]);
  const expressionIdleTimerRef = useRef(null);
  const expressionNoticeTimerRef = useRef(null);

  // Existing states
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
  const [showHistory, setShowHistory] = useState(false);
  const recognitionRef = useRef(null);
  const recognizeAbortRef = useRef(null);
  const recognitionCacheRef = useRef(new Map());
  const lastSceneSignatureRef = useRef("");
  const lastAttemptedSceneSignatureRef = useRef("");
  const lastObservedSceneSignatureRef = useRef("");
  const latestSceneSignatureRef = useRef("");
  const recognitionRequestSerialRef = useRef(0);
  const pendingRecognitionSignatureRef = useRef("");

  const canSend = useMemo(() => Boolean(chatInput.trim()) && !isSending, [chatInput, isSending]);
  const recognizedMathPreview = useMemo(
    () => formatRecognizedMathPreview(recognizedMath),
    [recognizedMath],
  );
  const activeConnectionCount = useMemo(
    () => Array.from(activeUsers.values()).reduce((total, user) => total + (user.connectionCount || 0), 0),
    [activeUsers],
  );
  const expressionHistoryItems = useMemo(
    () => historyItems.filter((item) => item.type === "expression"),
    [historyItems],
  );
  const latestSharedExpression = expressionHistoryItems.at(-1)?.content?.expression || null;

  const mergeHistoryItem = (item) => {
    if (!item?.id) {
      return;
    }

    setHistoryItems((prev) => {
      const existingIndex = prev.findIndex((entry) => entry.id === item.id);
      const nextItems =
        existingIndex === -1
          ? [...prev, item]
          : prev.map((entry, index) => (index === existingIndex ? item : entry));

      return nextItems.sort((left, right) => {
        if (left.timestamp !== right.timestamp) {
          return left.timestamp - right.timestamp;
        }
        return String(left.id).localeCompare(String(right.id));
      });
    });
  };

  const upsertSharedStroke = (stroke) => {
    if (!stroke?.strokeId) {
      return;
    }

    setSharedStrokes((prev) => {
      const index = prev.findIndex((entry) => entry.strokeId === stroke.strokeId);
      if (index === -1) {
        return [...prev, stroke];
      }

      const current = prev[index];
      const currentVersion = Number.isFinite(current?.version) ? current.version : 0;
      const nextVersion = Number.isFinite(stroke?.version) ? stroke.version : 0;
      if (nextVersion < currentVersion) {
        return prev;
      }

      const next = [...prev];
      next[index] = { ...current, ...stroke };
      return next;
    });
  };

  const removeSharedStrokesByIds = (strokeIds) => {
    if (!Array.isArray(strokeIds) || strokeIds.length === 0) {
      return;
    }

    const idsToRemove = new Set(strokeIds.filter(Boolean));
    if (idsToRemove.size === 0) {
      return;
    }

    setSharedStrokes((prev) => prev.filter((stroke) => !idsToRemove.has(stroke.strokeId)));
  };

  const appendSharedExpression = (expression, { notify = false } = {}) => {
    if (!expression?.expressionId) {
      return;
    }

    const historyItem = addExpressionToHistory(expression);
    if (historyItem) {
      mergeHistoryItem(historyItem);
    }

    setHighlightedExpressionId(expression.expressionId);
    window.clearTimeout(expressionNoticeTimerRef.current);
    expressionNoticeTimerRef.current = window.setTimeout(() => {
      setHighlightedExpressionId((current) => (current === expression.expressionId ? "" : current));
      setExpressionNotice((current) => (current?.expressionId === expression.expressionId ? null : current));
    }, EXPRESSION_NOTICE_DURATION_MS);

    if (notify) {
      setExpressionNotice({
        expressionId: expression.expressionId,
        message: `${expressionCreatorLabel(expression, userIdRef.current)} added a new expression`,
      });
    }
  };

  const recognizeSharedExpression = async (expression) => {
    const previewUrl = typeof expression?.previewUrl === "string" ? expression.previewUrl.trim() : "";
    if (!expression?.expressionId || !previewUrl) {
      return;
    }

    try {
      const response = await fetch("/recognize-math", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: previewUrl,
          apiKey,
          mode: "openai",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Math recognition failed");
      }

      const payload = await response.json();
      const recognizedText = typeof payload?.latex === "string" ? payload.latex.trim() : "";
      if (!recognizedText) {
        return;
      }

      const updatedExpression = {
        ...expression,
        recognizedText,
      };

      appendSharedExpression(updatedExpression);
      if (socketRef.current?.connected) {
        socketRef.current.emit("expression:updated", updatedExpression);
      }
    } catch (error) {
      console.error("Failed to recognize shared expression:", error);
    }
  };

  const flushPendingExpression = async () => {
    const pendingStrokes = pendingExpressionStrokesRef.current;
    if (!pendingStrokes.length || !socketRef.current?.connected || !excalidrawAPI) {
      pendingExpressionStrokesRef.current = [];
      return;
    }

    const elements = getSerializableExpressionElements(excalidrawAPI.getSceneElements());
    const previewUrl = await renderExpressionPreview(elements, excalidrawAPI.getFiles?.() || {});
    const expression = {
      expressionId: uuidv4(),
      strokes: pendingStrokes,
      elements,
      previewUrl,
      userId: userIdRef.current,
      color: userColorRef.current || colorManagerRef.current.getColorForUser(userIdRef.current),
      timestamp: Date.now(),
      sessionId: sessionIdRef.current,
      recognizedText: "",
    };

    pendingExpressionStrokesRef.current = [];
    socketRef.current.emit("expression:created", expression);
    appendSharedExpression(expression);
    void recognizeSharedExpression(expression);
  };

  const queueExpressionStroke = (stroke) => {
    pendingExpressionStrokesRef.current = [
      ...pendingExpressionStrokesRef.current.filter((entry) => entry.strokeId !== stroke.strokeId),
      stroke,
    ];

    window.clearTimeout(expressionIdleTimerRef.current);
    expressionIdleTimerRef.current = window.setTimeout(flushPendingExpression, LOCAL_EXPRESSION_IDLE_MS);
  };

  const handleSceneChange = (elements) => {
    const nextElements = Array.isArray(elements) ? elements : [];
    const nextActiveStrokeIds = new Set();
    const previousActiveStrokeIds = activeStrokeElementIdsRef.current;

    nextElements.forEach((element) => {
      if (!isStrokeElement(element)) {
        return;
      }

      nextActiveStrokeIds.add(element.id);
      const previousVersion = sentStrokeVersionsRef.current.get(element.id);
      const nextVersion = Number.isFinite(element.version) ? element.version : 0;
      if (previousVersion === nextVersion) {
        return;
      }

      sentStrokeVersionsRef.current.set(element.id, nextVersion);
      activeStrokeElementIdsRef.current.add(element.id);

      if (!socketRef.current?.connected || !userIdRef.current) {
        return;
      }

      const stroke = createStrokePayload(
        element,
        userIdRef.current,
        userColor || colorManagerRef.current.getColorForUser(userIdRef.current),
      );
      socketRef.current.emit("stroke", stroke);
      queueExpressionStroke(stroke);
    });

    const removedStrokeIds = Array.from(previousActiveStrokeIds).filter((strokeId) => !nextActiveStrokeIds.has(strokeId));
    if (removedStrokeIds.length > 0) {
      removeSharedStrokesByIds(removedStrokeIds);
      removedStrokeIds.forEach((strokeId) => {
        sentStrokeVersionsRef.current.delete(strokeId);
      });
    }

    activeStrokeElementIdsRef.current = nextActiveStrokeIds;
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
    setHistoryItems(getHistory());

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (recognizeAbortRef.current) {
        recognizeAbortRef.current.abort();
      }
      if (expressionIdleTimerRef.current) {
        window.clearTimeout(expressionIdleTimerRef.current);
      }
      if (expressionNoticeTimerRef.current) {
        window.clearTimeout(expressionNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    const currentElements = excalidrawAPI.getSceneElements();
    const canonicalStrokeMap = new Map();
    sharedStrokes.forEach((stroke) => {
      const element = createStrokeElementFromPayload(stroke);
      if (element?.id) {
        canonicalStrokeMap.set(element.id, element);
      }
    });

    if (canonicalStrokeMap.size === 0) {
      return;
    }

    const nextElements = [];
    const seenStrokeIds = new Set();
    let didChange = false;

    currentElements.forEach((currentElement) => {
      const canonicalElement = canonicalStrokeMap.get(currentElement.id);
      if (!canonicalElement) {
        nextElements.push(currentElement);
        return;
      }

      seenStrokeIds.add(currentElement.id);
      activeStrokeElementIdsRef.current.add(currentElement.id);
      sentStrokeVersionsRef.current.set(
        currentElement.id,
        Number.isFinite(canonicalElement.version) ? canonicalElement.version : 0,
      );

      const existingVersion = Number.isFinite(currentElement?.version) ? currentElement.version : 0;
      const incomingVersion = Number.isFinite(canonicalElement?.version) ? canonicalElement.version : 0;
      const shouldReplace =
        incomingVersion > existingVersion ||
        currentElement.strokeColor !== canonicalElement.strokeColor ||
        (currentElement.roughness ?? 1) !== (canonicalElement.roughness ?? 0) ||
        (currentElement.strokeStyle ?? "solid") !== (canonicalElement.strokeStyle ?? "solid") ||
        (currentElement.opacity ?? 100) !== (canonicalElement.opacity ?? 100);

      if (shouldReplace) {
        nextElements.push(canonicalElement);
        didChange = true;
        return;
      }

      nextElements.push(currentElement);
    });

    canonicalStrokeMap.forEach((canonicalElement, strokeId) => {
      if (seenStrokeIds.has(strokeId)) {
        return;
      }

      activeStrokeElementIdsRef.current.add(strokeId);
      sentStrokeVersionsRef.current.set(
        strokeId,
        Number.isFinite(canonicalElement.version) ? canonicalElement.version : 0,
      );
      nextElements.push(canonicalElement);
      didChange = true;
    });

    if (didChange) {
      excalidrawAPI.updateScene({
        elements: nextElements,
      });
    }
  }, [excalidrawAPI, sharedStrokes]);

  // Initialize user and collaboration
  useEffect(() => {
    let userId = localStorage.getItem("talkSketchUserId");
    if (!userId) {
      userId = uuidv4();
      localStorage.setItem("talkSketchUserId", userId);
    }

    let sessionId = sessionStorage.getItem("talkSketchSessionId");
    if (!sessionId) {
      sessionId = uuidv4();
      sessionStorage.setItem("talkSketchSessionId", sessionId);
    }

    userIdRef.current = userId;
    sessionIdRef.current = sessionId;

    const storedColorKey = `talkSketchUserColor:${userId}`;
    const storedColor = localStorage.getItem(storedColorKey);
    const color = storedColor
      ? colorManagerRef.current.setColorForUser(userId, storedColor)
      : colorManagerRef.current.assignColorToUser(userId);

    if (!storedColor) {
      localStorage.setItem(storedColorKey, color);
    }

    setUserColor(color);
    userColorRef.current = color;

    strokeTrackerRef.current = new StrokeTracker(userId, color, null);

    const socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    socket.on("connect", () => {
      console.log(`Connected to collaboration server as socket ${socket.id}`);
      socket.emit("user:join", { userId, sessionId, color });
    });

    socket.on("user:joined", (payload) => {
      const { userId: newUserId, color: newColor, connectionCount } = payload;
      if (newColor) {
        colorManagerRef.current.setColorForUser(newUserId, newColor);
      }
      setActiveUsers((prev) => {
        const next = new Map(prev);
        next.set(newUserId, {
          color: newColor || colorManagerRef.current.getColorForUser(newUserId),
          connectionCount,
        });
        return next;
      });
      console.log(`User ${newUserId} joined with color ${newColor} (${connectionCount} connection(s))`);
    });

    socket.on("user:updated", (payload) => {
      const { userId: updatedUserId, color: updatedColor, connectionCount } = payload;
      if (updatedColor) {
        colorManagerRef.current.setColorForUser(updatedUserId, updatedColor);
      }
      setActiveUsers((prev) => {
        const next = new Map(prev);
        if (connectionCount > 0) {
          next.set(updatedUserId, {
            color: updatedColor || colorManagerRef.current.getColorForUser(updatedUserId),
            connectionCount,
          });
        } else {
          next.delete(updatedUserId);
        }
        return next;
      });
    });

    socket.on("user:left", (payload) => {
      const { userId: leftUserId } = payload;
      setActiveUsers((prev) => {
        const next = new Map(prev);
        next.delete(leftUserId);
        return next;
      });
      console.log(`User ${leftUserId} left`);
    });

    socket.on("users:list", (payload) => {
      const { users } = payload;
      const userMap = new Map();
      users.forEach(({ userId: uId, color: c, connectionCount }) => {
        if (c) {
          colorManagerRef.current.setColorForUser(uId, c);
        }
        userMap.set(uId, {
          color: c || colorManagerRef.current.getColorForUser(uId),
          connectionCount,
        });
      });
      setActiveUsers(userMap);
    });

    socket.on("stroke", (payload) => {
      if (payload.sessionId !== sessionIdRef.current) {
        upsertSharedStroke(payload);
        strokeTrackerRef.current?.addRemoteStroke(payload);
      }
    });

    socket.on("strokes:sync", (payload) => {
      if (!Array.isArray(payload?.strokes)) {
        return;
      }

      payload.strokes.forEach((stroke) => {
        upsertSharedStroke(stroke);
      });
    });

    socket.on("expression:created", (payload) => {
      appendSharedExpression(payload, { notify: payload.sessionId !== sessionIdRef.current });
    });

    socket.on("expression:updated", (payload) => {
      appendSharedExpression(payload);
    });

    socket.on("connect_error", (error) => {
      console.error("Collaboration connect error:", error);
    });

    socket.on("disconnect", (reason) => {
      console.log(`Disconnected from collaboration server: ${reason}`);
    });

    socketRef.current = socket;

    fetch("/history")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to load shared expressions");
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload?.expressions)) {
          return;
        }
        payload.expressions.forEach((expression) => {
          const historyItem = addExpressionToHistory(expression);
          if (historyItem) {
            mergeHistoryItem(historyItem);
          }
        });
      })
      .catch((error) => {
        console.error("Failed to load shared expressions:", error);
      });

    return () => {
      flushPendingExpression();
      socket.emit("user:leave", { userId, sessionId });
      socket.disconnect();
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
        body: JSON.stringify({
          image: imageData,
          apiKey,
          mode: "openai",
        }),
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
      lastAttemptedSceneSignatureRef.current = "";
      pendingRecognitionSignatureRef.current = "";
      return;
    }

    const signature = activeElements.map((el) => `${el.id}:${el.version}`).join("|");
    if (signature === lastSceneSignatureRef.current || signature === lastAttemptedSceneSignatureRef.current) return;

    if (recognitionCacheRef.current.has(signature)) {
      const cachedLatex = recognitionCacheRef.current.get(signature);
      setRecognizedMath(cachedLatex);
      setRecognitionError("");
      lastSceneSignatureRef.current = signature;
      lastAttemptedSceneSignatureRef.current = signature;
      return;
    }

    if (isRecognizingMath) {
      pendingRecognitionSignatureRef.current = signature;
      return;
    }

    const recognitionTimer = setTimeout(async () => {
      lastAttemptedSceneSignatureRef.current = signature;
      await recognizeScene({ preserveExistingMath: false, signature });
      if (recognitionCacheRef.current.has(signature)) {
        lastSceneSignatureRef.current = signature;
      }

      if (pendingRecognitionSignatureRef.current === signature) {
        pendingRecognitionSignatureRef.current = "";
      }
    }, RECOGNITION_DEBOUNCE_MS);

    return () => clearTimeout(recognitionTimer);
  }, [excalidrawAPI, isRecognizingMath, sceneElements]);

  const appendMessage = (role, text) => {
    const message = { id: `${Date.now()}-${Math.random()}`, role, text };
    setMessages((prev) => [...prev, message]);
    const historyItem = addMessageToHistory(role, text, {
      id: message.id,
      userId: role === "user" ? userIdRef.current : "assistant",
      color: role === "user" ? userColorRef.current : null,
      timestamp: Date.now(),
    });
    if (historyItem) {
      mergeHistoryItem(historyItem);
    }
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
          "GPT-5.4 could not confidently read the handwritten math yet. Try waiting a moment or redrawing the symbols a bit more clearly.",
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

  const handleViewHistory = () => {
    setHistoryItems(getHistory());
    setShowHistory(true);
  };

  const handleDownloadHistory = () => {
    downloadHistoryAsFile();
  };

  const handleClearHistory = () => {
    if (confirm("Are you sure you want to clear all history? This action cannot be undone.")) {
      clearHistory();
      setHistoryItems([]);
      setShowHistory(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="board-area">
        <Whiteboard
          strokeColor={SHARED_STROKE_RENDER_COLOR}
          onApiReady={setExcalidrawAPI}
          onSceneChange={handleSceneChange}
        />
        {expressionNotice && latestSharedExpression ? (
          <div className="expression-notice">
            <div className="expression-notice-title">{expressionNotice.message}</div>
            <SharedExpressionPreview
              expression={latestSharedExpression}
              currentUserId={userIdRef.current}
              highlighted={highlightedExpressionId === latestSharedExpression.expressionId}
            />
          </div>
        ) : null}
      </div>

      <aside className="side-panel">
        <div className="panel-header">
          <h2 className="panel-title">TalkSketch Assistant</h2>
          <span className={`key-status ${apiKey ? "connected" : ""}`}>
            {apiKey ? "Chat API Connected" : "Chat API Not Connected"}
          </span>
        </div>

        {/* Collaboration Panel */}
        <div className="collaboration-panel" style={{ marginBottom: "15px", padding: "10px", backgroundColor: "#f9f9f9", borderRadius: "5px" }}>
          <div style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "8px", color: "#666" }}>Collaboration</div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <div style={{ fontSize: "11px", color: "#666" }}>Your Color:</div>
            <div style={{
              width: "20px", height: "20px", borderRadius: "3px",
              backgroundColor: userColor || "#ccc",
              border: "1px solid #999"
            }} />
          </div>
          {activeUsers.size > 0 && (
            <div style={{ fontSize: "11px" }}>
              <div style={{ marginBottom: "4px", color: "#666" }}>
                Active Users ({activeConnectionCount}):
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {Array.from(activeUsers.entries()).map(([userId, user]) => (
                  <div key={userId} style={{
                    display: "inline-flex", alignItems: "center", gap: "4px",
                    padding: "2px 6px", backgroundColor: "#fff", borderRadius: "3px", border: "1px solid #ddd"
                  }}>
                    <div style={{
                      width: "12px", height: "12px", borderRadius: "2px",
                      backgroundColor: user.color
                    }} />
                    <span style={{ fontSize: "10px", color: "#666" }}>
                      {userId === userIdRef.current ? "You" : "User"} x{user.connectionCount || 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="recognition-card">
          <div className="recognition-title">Live Math Recognition</div>
          <div className="recognition-body">
            {isRecognizingMath ? "Recognizing current handwriting with GPT-5.4..." : null}
            {!isRecognizingMath && recognitionError ? (
              <p className="recognition-error">{recognitionError}</p>
            ) : null}
            {!isRecognizingMath && !recognitionError && recognizedMath ? (
              <div className="recognition-result">
                <div className="recognition-preview">{recognizedMathPreview || recognizedMath}</div>
                <div className="recognition-raw-label">Raw LaTeX Output</div>
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
              Chat will include recognized math context: <code>{recognizedMath}</code>
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
          <button className="history-btn" type="button" onClick={handleViewHistory}>
            📋 History
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

        {showHistory && (
          <div className="chat-history-panel">
            <div className="history-header">
              <h3>History ({historyItems.length} items)</h3>
              <button className="close-btn" onClick={() => setShowHistory(false)}>
                ×
              </button>
            </div>
            <div className="history-container">
              {historyItems.length === 0 ? (
                <p className="empty-message">No history yet</p>
              ) : (
                historyItems.map((item) => (
                  <div
                    key={item.id}
                    className={`history-item history-item-${item.type === "chat" ? item.content?.role || "assistant" : "expression"}`}
                  >
                    <div className="history-item-header">
                      <span className="history-role">
                        {item.type === "expression"
                          ? "Shared Expression"
                          : item.content?.role === "user"
                            ? "You"
                            : "AI Coach"}
                      </span>
                      <span className="history-time">
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {item.type === "expression" ? (
                      <>
                        <div className="history-item-text">
                          {expressionCreatorLabel(item.content?.expression, userIdRef.current)} shared an expression.
                        </div>
                        <div className="history-item-meta">
                          {item.content?.elementCount || item.content?.strokeCount || 0} element(s)
                          {(Array.isArray(item.content?.usersInvolved)
                            ? item.content.usersInvolved
                            : getExpressionUserIds(item.content?.expression)).length > 0
                            ? ` • Users: ${(Array.isArray(item.content?.usersInvolved)
                              ? item.content.usersInvolved
                              : getExpressionUserIds(item.content?.expression)).join(", ")}`
                            : ""}
                        </div>
                        {item.content?.expression ? (
                          <SharedExpressionPreview
                            expression={item.content.expression}
                            currentUserId={userIdRef.current}
                            highlighted={highlightedExpressionId === item.content.expression.expressionId}
                          />
                        ) : null}
                        {item.content?.recognizedText ? (
                          <div className="history-item-text">
                            Recognized math: <code>{item.content.recognizedText}</code>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="history-item-text">{item.content?.text || ""}</div>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="history-footer">
              <button className="history-btn" onClick={handleDownloadHistory}>
                Download CSV
              </button>
              <button className="history-btn danger" onClick={handleClearHistory}>
                Clear History
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default App;
