import { exportToBlob, exportToCanvas } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import "./App.css";
import "../ai_chatbox/history.css";
import Whiteboard from "./library/Whiteboard.jsx";
import { addMessageToHistory, addExpressionToHistory, getHistory, clearHistory, downloadHistoryAsFile } from "../ai_chatbox/history.js";
import {
  buildRoomPath,
  createRoomId,
  getOrCreateGuestIdentity,
  normalizeRoomId,
} from "./utils/collaborationIdentity.js";
import { buildSceneSignature, cloneSceneElements } from "./utils/sceneAttribution.js";
import UserColorManager from "./utils/userColorManager.js";
import { sanitizeCollaborativeAppState } from "../../shared/excalidrawCollaboration.js";
import {
  debugExcalidrawFlow,
  registerExcalidrawDebugApi,
  summarizeAppState,
  summarizeElements,
  summarizeDrawingFocus,
  summarizeScenePacket,
} from "./utils/excalidrawDebug.js";

const RECOGNITION_DEBOUNCE_MS = 450;
const RECOGNITION_EXPORT_PADDING = 24;
const RECOGNITION_REQUEST_TIMEOUT_MS = 45000;
const RECOGNITION_EXPORT_MAX_DIMENSION = 1200;
const RECOGNITION_EXPORT_MAX_PIXELS = 900000;
const LOCAL_EXPRESSION_IDLE_MS = 2000;
const EXPRESSION_NOTICE_DURATION_MS = 2800;
const SCENE_SEND_DEBOUNCE_MS = 60;
const SHARED_RECOGNITION_FEED_LIMIT = 8;
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

function getCollaborationServerUrl() {
  return getBackendServerUrl();
}

function getBackendServerUrl() {
  const configuredUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_COLLAB_SERVER_URL;
  if (typeof configuredUrl === "string" && configuredUrl.trim()) {
    return configuredUrl.trim();
  }

  if (typeof window === "undefined") {
    return "http://127.0.0.1:8080";
  }

  if (import.meta.env.DEV) {
    const backendPort = String(import.meta.env.VITE_BACKEND_PORT || "8080");
    const url = new URL(window.location.origin);
    url.port = backendPort;
    return url.toString().replace(/\/$/, "");
  }

  return window.location.origin;
}

function hasOpenAiApiKey(value) {
  return typeof value === "string" && value.trim().startsWith("sk-");
}

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

function formatRoomEventLabel(event, currentUserId) {
  const actor = event?.userId === currentUserId
    ? "You"
    : event?.displayName || (typeof event?.userId === "string" ? event.userId.slice(0, 6) : "Guest");
  const strokeLabel = event?.strokeId ? ` stroke ${event.strokeId.slice(0, 6)}` : "";

  switch (event?.actionType) {
    case "create":
      return `${actor} created${strokeLabel}`;
    case "update":
      return `${actor} updated${strokeLabel}`;
    case "delete":
      return `${actor} deleted${strokeLabel}`;
    case "clear":
      return `${actor} cleared the board`;
    default:
      return `${actor} changed the board`;
  }
}

function buildRoomShareUrl(roomId) {
  if (typeof window === "undefined") {
    return buildRoomPath(roomId);
  }

  return `${window.location.origin}${buildRoomPath(roomId)}`;
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

async function renderExpressionPreview(elements, files = {}) {
  const safeElements = cloneSceneElements(elements).filter((element) => !element?.isDeleted);
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

function expressionCreatorLabel(expression, currentUserId) {
  if (expression?.userId === currentUserId) {
    return "You";
  }

  if (typeof expression?.displayName === "string" && expression.displayName.trim()) {
    return expression.displayName.trim();
  }

  const shortId = typeof expression?.userId === "string" ? expression.userId.slice(0, 4) : "user";
  return `User ${shortId}`;
}

function recognitionCreatorLabel(recognition, currentUserId) {
  if (recognition?.userId === currentUserId) {
    return "You";
  }

  if (typeof recognition?.displayName === "string" && recognition.displayName.trim()) {
    return recognition.displayName.trim();
  }

  const shortId = typeof recognition?.userId === "string" ? recognition.userId.slice(0, 4) : "user";
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

function toCollaboratorsMap(users, currentUserId) {
  const next = new Map();

  if (!Array.isArray(users)) {
    return next;
  }

  users.forEach((user) => {
    if (!user?.userId || user.userId === currentUserId) {
      return;
    }

    next.set(user.userId, {
      username: user.displayName || user.name || "Anonymous",
    });
  });

  return next;
}

function App() {
  const navigate = useNavigate();
  const { roomId: routeRoomId } = useParams();
  const roomId = useMemo(() => normalizeRoomId(routeRoomId || "lobby"), [routeRoomId]);

  // User & Collaboration
  const userIdRef = useRef(null);
  const displayNameRef = useRef("");
  const roomIdRef = useRef(roomId);
  const canonicalSceneElementsRef = useRef([]);
  const canonicalAppStateRef = useRef(null);
  const serverSceneVersionRef = useRef(0);
  const [userColor, setUserColor] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [roomInput, setRoomInput] = useState(roomId);
  const [joined, setJoined] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);
  const [isLoadingScene, setIsLoadingScene] = useState(false);
  const [activeUsers, setActiveUsers] = useState(new Map());
  const [collaborators, setCollaborators] = useState(new Map());
  const [historyItems, setHistoryItems] = useState([]);
  const [sharedRecognitions, setSharedRecognitions] = useState([]);
  const [collaborationEvents, setCollaborationEvents] = useState([]);
  const [expressionNotice, setExpressionNotice] = useState(null);
  const [highlightedExpressionId, setHighlightedExpressionId] = useState("");
  const socketRef = useRef(null);
  const sessionIdRef = useRef(null);
  const userColorRef = useRef(null);
  const colorManagerRef = useRef(new UserColorManager());
  const expressionIdleTimerRef = useRef(null);
  const sceneSendTimerRef = useRef(null);
  const expressionNoticeTimerRef = useRef(null);
  const sceneLoadingTimerRef = useRef(null);
  const pendingRemoteSceneRef = useRef(null);
  const isApplyingServerSceneRef = useRef(false);
  const isBoardReadyRef = useRef(false);
  const collaboratorsRef = useRef(new Map());
  const isPointerDownRef = useRef(false);
  const pendingPointerSceneRef = useRef(null);
  const lastSharedExpressionSignatureRef = useRef("");

  // Existing states
  const excalidrawAPIRef = useRef(null);
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
  const lastBroadcastRecognitionKeyRef = useRef("");

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
    () => historyItems.filter(
      (item) => item.type === "expression" && item.content?.expression?.roomId === roomId,
    ),
    [historyItems, roomId],
  );
  const latestSharedExpression = expressionHistoryItems.at(-1)?.content?.expression || null;
  const visibleRecognitions = useMemo(
    () => [...sharedRecognitions]
      .filter((item) => item.roomId === roomId)
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, SHARED_RECOGNITION_FEED_LIMIT),
    [sharedRecognitions, roomId],
  );
  const recentCollaborationEvents = useMemo(
    () => [...collaborationEvents]
      .filter((event) => event.roomId === roomId)
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, 8),
    [collaborationEvents, roomId],
  );
  const roomShareUrl = useMemo(() => buildRoomShareUrl(roomId), [roomId]);
  const visibleHistoryItems = useMemo(
    () => historyItems.filter(
      (item) => item.type !== "expression" || item.content?.expression?.roomId === roomId,
    ),
    [historyItems, roomId],
  );
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

  const mergeCollaborationEvents = (events) => {
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    setCollaborationEvents((prev) => {
      const byId = new Map(prev.map((event) => [event.eventId, event]));
      events.forEach((event) => {
        if (!event?.eventId) {
          return;
        }
        byId.set(event.eventId, event);
      });

      return Array.from(byId.values())
        .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
        .slice(-80);
    });
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

  const mergeRecognitionItem = (item) => {
    if (!item?.recognitionId || !item?.latex) {
      return;
    }

    setSharedRecognitions((prev) => {
      const existingIndex = prev.findIndex((entry) => entry.recognitionId === item.recognitionId);
      const nextItems =
        existingIndex === -1
          ? [...prev, item]
          : prev.map((entry, index) => (index === existingIndex ? item : entry));

      return nextItems
        .sort((left, right) => {
          const leftTimestamp = new Date(left.timestamp || 0).getTime();
          const rightTimestamp = new Date(right.timestamp || 0).getTime();
          if (leftTimestamp !== rightTimestamp) {
            return leftTimestamp - rightTimestamp;
          }
          return String(left.recognitionId).localeCompare(String(right.recognitionId));
        })
        .slice(-24);
    });
  };

  const publishRecognizedMath = (latex, signature) => {
    const cleanLatex = typeof latex === "string" ? latex.trim() : "";
    if (!cleanLatex || !userIdRef.current) {
      return;
    }

    const recognitionKey = `${roomIdRef.current}:${userIdRef.current}:${signature || cleanLatex}`;
    if (recognitionKey === lastBroadcastRecognitionKeyRef.current) {
      return;
    }

    lastBroadcastRecognitionKeyRef.current = recognitionKey;

    const recognition = {
      recognitionId: recognitionKey,
      roomId: roomIdRef.current,
      userId: userIdRef.current,
      displayName: displayNameRef.current,
      color: userColorRef.current || colorManagerRef.current.getColorForUser(userIdRef.current),
      latex: cleanLatex,
      timestamp: new Date().toISOString(),
      sceneSignature: signature || "",
      sessionId: sessionIdRef.current,
    };

    mergeRecognitionItem(recognition);

    if (socketRef.current?.connected) {
      socketRef.current.emit("recognition:created", recognition);
    }
  };

  const recognizeSharedExpression = async (expression) => {
    const previewUrl = typeof expression?.previewUrl === "string" ? expression.previewUrl.trim() : "";
    if (!expression?.expressionId || !previewUrl || !hasOpenAiApiKey(apiKey)) {
      return;
    }

    try {
      const response = await fetch(`${getBackendServerUrl()}/recognize-math`, {
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
        roomId: roomIdRef.current,
        displayName: displayNameRef.current,
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

  const applyRemoteScene = (scene, { replace = false } = {}) => {
    const incomingElements = cloneSceneElements(scene?.elements);
    const nextAppState = sanitizeCollaborativeAppState(scene?.appState) || {};
    const nextFiles = scene?.files && typeof scene.files === "object" ? scene.files : {};
    const nextSceneVersion = Number.isFinite(scene?.version)
      ? scene.version
      : Number.isFinite(scene?.sceneVersion)
        ? scene.sceneVersion
        : serverSceneVersionRef.current;
    const nextAppStateSignature = JSON.stringify(nextAppState || {});
    const currentAppStateSignature = JSON.stringify(canonicalAppStateRef.current || {});

    if (nextSceneVersion < serverSceneVersionRef.current) {
      debugExcalidrawFlow("app.applyRemoteScene.skip-stale", {
        incomingVersion: nextSceneVersion,
        currentVersion: serverSceneVersionRef.current,
      });
      return;
    }

    const nextElements = incomingElements;
    const signature = buildSceneSignature(nextElements);

    if (
      nextSceneVersion === serverSceneVersionRef.current &&
      signature === lastObservedSceneSignatureRef.current &&
      nextAppStateSignature === currentAppStateSignature
    ) {
      debugExcalidrawFlow("app.applyRemoteScene.skip-identical", {
        sceneVersion: nextSceneVersion,
        signature,
      });
      return;
    }

    debugExcalidrawFlow("app.applyRemoteScene.start", {
      replace,
      sceneVersion: nextSceneVersion,
      signature,
      scene: summarizeScenePacket({
        roomId: roomIdRef.current,
        version: nextSceneVersion,
        elements: nextElements,
        appState: nextAppState,
        files: nextFiles,
      }),
    });

    canonicalSceneElementsRef.current = nextElements;
    canonicalAppStateRef.current = nextAppState || null;
    serverSceneVersionRef.current = nextSceneVersion;
    lastObservedSceneSignatureRef.current = signature;
    latestSceneSignatureRef.current = signature;
    setSceneElements(nextElements);

    const excalidrawAPI = excalidrawAPIRef.current;
    if (!excalidrawAPI) {
      pendingRemoteSceneRef.current = {
        elements: nextElements,
        appState: nextAppState,
        files: nextFiles,
        sceneVersion: nextSceneVersion,
        replace,
      };
      debugExcalidrawFlow("app.applyRemoteScene.queue-pending", {
        sceneVersion: nextSceneVersion,
        signature,
      });
      return;
    }

    pendingRemoteSceneRef.current = null;
    isApplyingServerSceneRef.current = true;
    window.clearTimeout(sceneLoadingTimerRef.current);
    setIsLoadingScene(true);
    sceneLoadingTimerRef.current = window.setTimeout(() => {
      setIsLoadingScene(false);
    }, 1500);

    try {
      debugExcalidrawFlow("app.applyRemoteScene.updateScene", {
        sceneVersion: nextSceneVersion,
        scene: summarizeScenePacket({
          roomId: roomIdRef.current,
          version: nextSceneVersion,
          elements: nextElements,
          appState: nextAppState,
          files: nextFiles,
        }),
      });
      excalidrawAPI.updateScene({
        elements: nextElements,
        appState: {
          ...nextAppState,
          collaborators: collaboratorsRef.current instanceof Map
            ? new Map(collaboratorsRef.current)
            : new Map(),
        },
        files: nextFiles,
      });
    } finally {
      window.requestAnimationFrame(() => {
        isApplyingServerSceneRef.current = false;
        window.clearTimeout(sceneLoadingTimerRef.current);
        sceneLoadingTimerRef.current = null;
        setIsLoadingScene(false);
      });
    }
  };

  const flushPendingExpression = async () => {
    const excalidrawAPI = excalidrawAPIRef.current;
    if (!socketRef.current?.connected || !excalidrawAPI) {
      return;
    }

    const elements = cloneSceneElements(excalidrawAPI.getSceneElements());
    const sceneSignature = buildSceneSignature(elements);
    if (!sceneSignature || sceneSignature === lastSharedExpressionSignatureRef.current) {
      return;
    }

    const previewUrl = await renderExpressionPreview(elements, excalidrawAPI.getFiles?.() || {});
    const expression = {
      expressionId: uuidv4(),
      roomId: roomIdRef.current,
      strokes: [],
      elements,
      previewUrl,
      userId: userIdRef.current,
      displayName: displayNameRef.current,
      color: userColorRef.current || colorManagerRef.current.getColorForUser(userIdRef.current),
      timestamp: new Date().toISOString(),
      sessionId: sessionIdRef.current,
      recognizedText: "",
    };

    lastSharedExpressionSignatureRef.current = sceneSignature;
    socketRef.current.emit("expression:created", expression);
    appendSharedExpression(expression);
    void recognizeSharedExpression(expression);
  };

  const queueExpressionCapture = () => {
    window.clearTimeout(expressionIdleTimerRef.current);
    expressionIdleTimerRef.current = window.setTimeout(() => {
      void flushPendingExpression();
    }, LOCAL_EXPRESSION_IDLE_MS);
  };

  const emitSceneUpdate = useCallback((scene) => {
    if (!socketRef.current?.connected || !userIdRef.current || !joined || !scene) {
      return;
    }

    debugExcalidrawFlow("app.emitSceneUpdate", {
      scene: summarizeScenePacket({
        roomId: roomIdRef.current,
        version: serverSceneVersionRef.current,
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
      }),
    });

    socketRef.current.emit("scene:update", {
      roomId: roomIdRef.current,
      scene: {
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
        version: serverSceneVersionRef.current,
      },
    });
  }, [joined]);

  const flushPendingPointerScene = useCallback(() => {
    if (!pendingPointerSceneRef.current) {
      return;
    }

    const scene = pendingPointerSceneRef.current;
    pendingPointerSceneRef.current = null;
    emitSceneUpdate(scene);
  }, [emitSceneUpdate]);

  const handleBoardPointerDown = useCallback(() => {
    isPointerDownRef.current = true;
    debugExcalidrawFlow("app.board.pointer-down", {});
  }, []);

  const handleBoardPointerUp = useCallback(() => {
    const wasPointerDown = isPointerDownRef.current;
    isPointerDownRef.current = false;
    debugExcalidrawFlow("app.board.pointer-up", {
      hadPendingScene: Boolean(pendingPointerSceneRef.current),
      wasPointerDown,
    });
    flushPendingPointerScene();
  }, [flushPendingPointerScene]);

  const handleSceneChange = (elements, appState, files) => {
    if (isApplyingServerSceneRef.current) {
      debugExcalidrawFlow("app.handleSceneChange.skip-applying-remote", {});
      return;
    }

    const currentElements = cloneSceneElements(
      excalidrawAPIRef.current?.getSceneElementsIncludingDeleted?.() || elements,
    );
    const liveAppState = excalidrawAPIRef.current?.getAppState?.() || appState || {};
    const isEditingLinearElement = Boolean(liveAppState?.editingLinearElement);
    const isCreatingMultiElement = Boolean(liveAppState?.multiElement);
    const activeToolType = liveAppState?.activeTool?.type || null;
    const shouldSkipExpressionCapture =
      isPointerDownRef.current ||
      isEditingLinearElement ||
      isCreatingMultiElement ||
      activeToolType === "line" ||
      activeToolType === "arrow";
    const signature = buildSceneSignature(currentElements);
    latestSceneSignatureRef.current = signature;
    setSceneElements(currentElements);
    debugExcalidrawFlow("app.handleSceneChange.received", {
      signature,
      elements: summarizeElements(currentElements),
      drawFocus: summarizeDrawingFocus(currentElements),
      appState: summarizeAppState(liveAppState),
      fileCount: files && typeof files === "object" ? Object.keys(files).length : 0,
    });

    if (!socketRef.current?.connected || !userIdRef.current || !joined) {
      debugExcalidrawFlow("app.handleSceneChange.skip-not-connected", {
        joined,
        connected: Boolean(socketRef.current?.connected),
      });
      return;
    }

    if (isEditingLinearElement || isCreatingMultiElement) {
      debugExcalidrawFlow("app.handleSceneChange.skip-linear-in-progress", {
        isEditingLinearElement,
        isCreatingMultiElement,
        activeToolType,
        elements: summarizeElements(currentElements),
        drawFocus: summarizeDrawingFocus(currentElements),
        appState: summarizeAppState(liveAppState),
      });
      return;
    }

    window.clearTimeout(sceneSendTimerRef.current);
    sceneSendTimerRef.current = window.setTimeout(() => {
      if (!socketRef.current?.connected || !joined) {
        return;
      }

      const liveElements = cloneSceneElements(
        excalidrawAPIRef.current?.getSceneElementsIncludingDeleted?.() || currentElements,
      );
      const syncedAppState = sanitizeCollaborativeAppState(
        excalidrawAPIRef.current?.getAppState?.() || appState,
      ) || {};
      const liveFiles = excalidrawAPIRef.current?.getFiles?.() || files || {};
      const scene = {
        elements: liveElements,
        appState: syncedAppState,
        files: liveFiles,
      };

      if (isPointerDownRef.current) {
        pendingPointerSceneRef.current = scene;
        debugExcalidrawFlow("app.handleSceneChange.defer-while-pointer-down", {
          scene: summarizeScenePacket({
            roomId: roomIdRef.current,
            version: serverSceneVersionRef.current,
            elements: liveElements,
            appState: syncedAppState,
            files: liveFiles,
          }),
        });
        return;
      }

      emitSceneUpdate(scene);
    }, SCENE_SEND_DEBOUNCE_MS);

    if (shouldSkipExpressionCapture) {
      window.clearTimeout(expressionIdleTimerRef.current);
      debugExcalidrawFlow("app.handleSceneChange.skip-expression-capture", {
        activeToolType,
        isPointerDown: isPointerDownRef.current,
        isEditingLinearElement,
        isCreatingMultiElement,
      });
    } else if (currentElements.some((element) => !element?.isDeleted)) {
      queueExpressionCapture();
    } else {
      window.clearTimeout(expressionIdleTimerRef.current);
    }
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
      if (sceneSendTimerRef.current) {
        window.clearTimeout(sceneSendTimerRef.current);
      }
      if (expressionNoticeTimerRef.current) {
        window.clearTimeout(expressionNoticeTimerRef.current);
      }
      if (sceneLoadingTimerRef.current) {
        window.clearTimeout(sceneLoadingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const identity = getOrCreateGuestIdentity();
    let sessionId = sessionStorage.getItem("talkSketchSessionId");
    if (!sessionId) {
      sessionId = uuidv4();
      sessionStorage.setItem("talkSketchSessionId", sessionId);
    }

    userIdRef.current = identity.userId;
    displayNameRef.current = identity.displayName;
    roomIdRef.current = roomId;
    sessionIdRef.current = sessionId;
    setDisplayName(identity.displayName);

    const storedColorKey = `talkSketchUserColor:${identity.userId}`;
    const storedColor = localStorage.getItem(storedColorKey);
    const color = storedColor
      ? colorManagerRef.current.setColorForUser(identity.userId, storedColor)
      : colorManagerRef.current.assignColorToUser(identity.userId);

    if (!storedColor) {
      localStorage.setItem(storedColorKey, color);
    }

    setUserColor(color);
    userColorRef.current = color;
    setIdentityReady(true);
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
    setRoomInput(roomId);
  }, [roomId]);

  useEffect(() => {
    registerExcalidrawDebugApi(() => ({
      roomId: roomIdRef.current,
      joined,
      socketConnected: Boolean(socketRef.current?.connected),
      serverSceneVersion: serverSceneVersionRef.current,
      sceneElements: summarizeElements(sceneElements),
      canonicalElements: summarizeElements(canonicalSceneElementsRef.current),
      collaborators: collaboratorsRef.current instanceof Map
        ? Array.from(collaboratorsRef.current.entries())
        : [],
      appState: summarizeAppState(excalidrawAPIRef.current?.getAppState?.() || {}),
    }));
  }, [joined, sceneElements]);

  useEffect(() => {
    if (!identityReady) {
      return;
    }

    setJoined(false);
    setActiveUsers(new Map());
    setCollaborators(new Map());
    collaboratorsRef.current = new Map();
    setSharedRecognitions([]);
    setCollaborationEvents([]);
    setExpressionNotice(null);
    setHighlightedExpressionId("");
    canonicalSceneElementsRef.current = [];
    canonicalAppStateRef.current = null;
    serverSceneVersionRef.current = 0;
    pendingRemoteSceneRef.current = null;
    lastObservedSceneSignatureRef.current = "";
    latestSceneSignatureRef.current = "";
    lastSharedExpressionSignatureRef.current = "";
    lastBroadcastRecognitionKeyRef.current = "";
    isBoardReadyRef.current = false;
    setSceneElements([]);
    setIsLoadingScene(false);

    const userId = userIdRef.current;
    const currentDisplayName = displayNameRef.current;
    const sessionId = sessionIdRef.current;
    const color = userColorRef.current || colorManagerRef.current.getColorForUser(userId);
    const socket = io(getCollaborationServerUrl(), {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    socket.on("connect", () => {
      debugExcalidrawFlow("socket.connect", {
        socketId: socket.id,
        roomId,
      });
      socket.emit("join-room", {
        roomId,
        user: {
          id: userId,
          name: currentDisplayName,
          sessionId,
          color,
        },
      });
      setJoined(true);
    });

    socket.on("users:list", (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }

      const { users } = payload;
      const userMap = new Map();
      users.forEach(({ userId: uId, displayName: name, color: c, connectionCount }) => {
        if (c) {
          colorManagerRef.current.setColorForUser(uId, c);
        }
        userMap.set(uId, {
          displayName: name || (uId === userIdRef.current ? displayNameRef.current : "Guest"),
          color: c || colorManagerRef.current.getColorForUser(uId),
          connectionCount,
        });
      });
      setActiveUsers(userMap);
      const nextCollaborators = toCollaboratorsMap(users, userIdRef.current);
      collaboratorsRef.current = nextCollaborators;
      setCollaborators(nextCollaborators);
      debugExcalidrawFlow("socket.users:list", {
        roomId: payload.roomId,
        users,
        collaborators: Array.from(nextCollaborators.entries()),
      });
    });

    socket.on("presence-update", (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }

      setCollaborators((prev) => {
        const next = prev instanceof Map ? new Map(prev) : new Map();
        const collaboratorId = payload.user?.id || payload.socketId;

        if (payload.type === "join" && collaboratorId && collaboratorId !== userIdRef.current) {
          next.set(collaboratorId, {
            username: payload.user?.name || "Anonymous",
          });
        }

        if (payload.type === "leave" && collaboratorId) {
          next.delete(collaboratorId);
        }

        collaboratorsRef.current = next;
        return next;
      });
      debugExcalidrawFlow("socket.presence-update", payload);
    });

    socket.on("scene-init", (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }
      debugExcalidrawFlow("socket.scene-init", {
        scene: summarizeScenePacket({
          roomId: payload.roomId,
          version: payload?.scene?.version,
          elements: payload?.scene?.elements,
          appState: payload?.scene?.appState,
          files: payload?.scene?.files,
        }),
      });
      applyRemoteScene(payload?.scene || {}, { replace: true });
    });

    const handleRemoteScene = (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }
      debugExcalidrawFlow("socket.scene-update", {
        scene: summarizeScenePacket({
          roomId: payload.roomId,
          senderId: payload.senderId,
          version: payload?.scene?.version,
          elements: payload?.scene?.elements,
          appState: payload?.scene?.appState,
          files: payload?.scene?.files,
        }),
      });
      applyRemoteScene(payload?.scene || {}, { replace: true });
    };

    socket.on("scene-update", handleRemoteScene);
    socket.on("scene:update", handleRemoteScene);

    socket.on("recognition:list", (payload) => {
      if (payload?.roomId !== roomIdRef.current || !Array.isArray(payload?.recognitions)) {
        return;
      }
      payload.recognitions.forEach((recognition) => {
        mergeRecognitionItem(recognition);
      });
    });

    socket.on("recognition:created", (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }
      mergeRecognitionItem(payload);
    });

    socket.on("expression:created", (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }
      appendSharedExpression(payload, { notify: payload.sessionId !== sessionIdRef.current });
    });

    socket.on("expression:updated", (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }
      appendSharedExpression(payload);
    });

    socket.on("events:list", (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }

      mergeCollaborationEvents(payload.events);
    });

    socket.on("events:created", (payload) => {
      if (payload?.roomId !== roomIdRef.current) {
        return;
      }

      mergeCollaborationEvents(payload.events);
    });

    socket.on("connect_error", (error) => {
      debugExcalidrawFlow("socket.connect-error", {
        message: error?.message || String(error),
      });
      console.error("Collaboration connect error:", error);
    });

    socket.on("disconnect", (reason) => {
      debugExcalidrawFlow("socket.disconnect", {
        reason,
      });
      console.log(`Disconnected from collaboration server: ${reason}`);
      setJoined(false);
    });

    socketRef.current = socket;

    fetch(`${getBackendServerUrl()}/history?roomId=${encodeURIComponent(roomId)}`)
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
      if (sceneSendTimerRef.current) {
        window.clearTimeout(sceneSendTimerRef.current);
        sceneSendTimerRef.current = null;
      }
      socket.removeAllListeners();
      if (socket.active || socket.connected) {
        socket.disconnect();
      }
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [identityReady, roomId]);

  const handleExcalidrawApiReady = useCallback((api) => {
    if (!api || excalidrawAPIRef.current === api) {
      return;
    }

    excalidrawAPIRef.current = api;
    isBoardReadyRef.current = true;
    debugExcalidrawFlow("app.excalidraw-api-ready", {
      hasPendingScene: Boolean(pendingRemoteSceneRef.current),
    });

    if (!pendingRemoteSceneRef.current) {
      return;
    }

    const pendingScene = pendingRemoteSceneRef.current;
    pendingRemoteSceneRef.current = null;
    window.requestAnimationFrame(() => {
      debugExcalidrawFlow("app.excalidraw-api-ready.replay-pending", {
        sceneVersion: pendingScene.sceneVersion,
        elements: summarizeElements(pendingScene.elements),
      });
      applyRemoteScene(pendingScene, { replace: pendingScene.replace === true });
    });
  }, []);

  const recognizeScene = async ({ preserveExistingMath = false, signature = "" } = {}) => {
    const excalidrawAPI = excalidrawAPIRef.current;
    if (!excalidrawAPI) return "";

    if (!hasOpenAiApiKey(apiKey)) {
      if (!preserveExistingMath) {
        setRecognizedMath("");
      }
      setRecognitionError("");
      return "";
    }

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
      const response = await fetch(`${getBackendServerUrl()}/recognize-math`, {
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
        if (latex) {
          publishRecognizedMath(latex, cacheKey);
        }
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
    if (!isBoardReadyRef.current || !excalidrawAPIRef.current || activeElements.length === 0) {
      setRecognizedMath("");
      setRecognitionError("");
      lastSceneSignatureRef.current = "";
      lastAttemptedSceneSignatureRef.current = "";
      pendingRecognitionSignatureRef.current = "";
      return;
    }

    if (!hasOpenAiApiKey(apiKey)) {
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
  }, [apiKey, isRecognizingMath, sceneElements]);

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
    if (!hasOpenAiApiKey(key)) {
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
    if (wantsExpressionOnly && !hasOpenAiApiKey(apiKey)) {
      appendMessage("assistant", "Connect your OpenAI API key first to use math recognition.");
      return;
    }

    const elements = excalidrawAPIRef.current?.getSceneElements?.() || [];
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
      const response = await fetch(`${getBackendServerUrl()}/analyze-sketch`, {
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

  const joinRoom = (nextRoomId) => {
    const normalizedRoomId = normalizeRoomId(nextRoomId);
    navigate(buildRoomPath(normalizedRoomId));
  };

  const handleJoinRoom = () => {
    if (!roomInput.trim()) {
      return;
    }

    joinRoom(roomInput);
  };

  const handleCreateRoom = () => {
    joinRoom(createRoomId());
  };

  const handleCopyRoomLink = async () => {
    try {
      await navigator.clipboard.writeText(roomShareUrl);
      alert(`Room link copied:\n${roomShareUrl}`);
    } catch (error) {
      console.error("Unable to copy room link:", error);
      alert(roomShareUrl);
    }
  };

  const handleExportRoomLog = () => {
    window.open(`${getBackendServerUrl()}/events/export?roomId=${encodeURIComponent(roomId)}&format=csv`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="app-shell">
      <div className="board-area">
        <Whiteboard
          onApiReady={handleExcalidrawApiReady}
          onSceneChange={handleSceneChange}
          onBoardPointerDown={handleBoardPointerDown}
          onBoardPointerUp={handleBoardPointerUp}
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
          <div style={{ display: "grid", gap: "8px", marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "#666" }}>Nickname: <strong style={{ color: "#1f2a44" }}>{displayName || "Guest"}</strong></div>
            <div style={{ fontSize: "11px", color: "#666" }}>Room: <strong style={{ color: "#1f2a44" }}>{roomId}</strong></div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: "6px" }}>
              <input
                id="room-id-input"
                name="roomId"
                className="chat-input"
                type="text"
                value={roomInput}
                onChange={(event) => setRoomInput(event.target.value)}
                placeholder="Enter room id"
              />
              <button className="history-btn" type="button" onClick={handleJoinRoom}>
                {joined && roomInput === roomId ? "Joined" : "Join Room"}
              </button>
              <button className="history-btn" type="button" onClick={handleCreateRoom}>New</button>
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button className="history-btn" type="button" onClick={handleCopyRoomLink}>Copy Link</button>
              <button className="history-btn" type="button" onClick={handleExportRoomLog}>Export Room Log</button>
            </div>
            <div style={{ fontSize: "10px", color: "#7b8297", wordBreak: "break-all" }}>{roomShareUrl}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <div style={{ fontSize: "11px", color: "#666" }}>Your Color:</div>
            <div style={{
              width: "20px", height: "20px", borderRadius: "3px",
              backgroundColor: userColor || "#ccc",
              border: "1px solid #999"
            }} />
          </div>
          {isLoadingScene ? (
            <div style={{ fontSize: "11px", color: "#6f7b99", marginBottom: "8px" }}>
              Syncing scene...
            </div>
          ) : null}
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
                      {userId === userIdRef.current ? `You (${user.displayName || displayName})` : user.displayName || "Guest"} x{user.connectionCount || 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
            <div style={{ fontSize: "11px", fontWeight: "bold", color: "#666" }}>Recent Room Activity</div>
            {recentCollaborationEvents.length === 0 ? (
              <div style={{ fontSize: "11px", color: "#8a93aa" }}>No room activity yet.</div>
            ) : (
              recentCollaborationEvents.map((event) => (
                <div
                  key={event.eventId}
                  style={{
                    display: "grid",
                    gap: "3px",
                    padding: "8px",
                    borderRadius: "8px",
                    backgroundColor: "#fff",
                    border: "1px solid #e2e7f5",
                  }}
                  title={`${event.displayName || event.userId} • ${new Date(event.timestamp).toLocaleString()}`}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "999px",
                        backgroundColor: event.metadata?.color || "#c7d2ec",
                      }}
                    />
                    <span style={{ fontSize: "11px", color: "#1f2a44", fontWeight: 600 }}>
                      {formatRoomEventLabel(event, userIdRef.current)}
                    </span>
                  </div>
                  <div style={{ fontSize: "10px", color: "#7b8297" }}>
                    {new Date(event.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
              ))
            )}
          </div>
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
            {visibleRecognitions.length > 0 ? (
              <div className="recognition-feed">
                <div className="recognition-feed-title">Shared Live Recognitions</div>
                <div className="recognition-feed-list">
                  {visibleRecognitions.map((recognition) => (
                    <div className="recognition-feed-item" key={recognition.recognitionId}>
                      <div className="recognition-feed-meta">
                        <span
                          className="shared-expression-badge"
                          style={{ backgroundColor: recognition.color || "#d8deeb" }}
                        />
                        <span>{recognitionCreatorLabel(recognition, userIdRef.current)}</span>
                        <span>
                          {new Date(recognition.timestamp || Date.now()).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="recognition-feed-latex">
                        {formatRecognizedMathPreview(recognition.latex) || recognition.latex}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
            id="chat-message-input"
            name="chatMessage"
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
              name="apiKey"
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
              <h3>History ({visibleHistoryItems.length} items)</h3>
              <button className="close-btn" onClick={() => setShowHistory(false)}>
                ×
              </button>
            </div>
            <div className="history-container">
              {visibleHistoryItems.length === 0 ? (
                <p className="empty-message">No history yet</p>
              ) : (
                visibleHistoryItems.map((item) => (
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
