const HISTORY_KEY = "talk-sketch-history";
const MAX_HISTORY_ITEMS = 200;

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

function toTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeHistoryItem(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  if (entry.type === "chat" || entry.type === "expression") {
    return {
      id: entry.id || `${Date.now()}-${Math.random()}`,
      type: entry.type,
      content: entry.content ?? null,
      userId: entry.userId || null,
      color: entry.color || null,
      timestamp: toTimestamp(entry.timestamp),
    };
  }

  const role = entry.role || "assistant";
  return {
    id: entry.id || `${Date.now()}-${Math.random()}`,
    type: role === "expression" ? "expression" : "chat",
    content:
      role === "expression"
        ? {
            text: entry.text || "",
            expressionId: entry.metadata?.expressionId || entry.id || null,
            strokeCount: entry.metadata?.strokeCount || 0,
            elementCount: entry.metadata?.elementCount || 0,
            previewUrl: entry.metadata?.previewUrl || null,
            recognizedText: entry.metadata?.recognizedText || "",
            usersInvolved: entry.metadata?.usersInvolved || [],
            expression: entry.metadata?.expression || null,
          }
        : {
            role,
            text: entry.text || "",
          },
    userId: entry.metadata?.userId || null,
    color: entry.metadata?.color || null,
    timestamp: toTimestamp(entry.timestamp),
  };
}

function sortHistory(history) {
  return history.slice().sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    return String(left.id).localeCompare(String(right.id));
  });
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sortHistory(history).slice(-MAX_HISTORY_ITEMS)));
  } catch (err) {
    console.error("Failed to save history:", err);
  }
}

export function getHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return sortHistory(parsed.map(normalizeHistoryItem).filter(Boolean));
  } catch (err) {
    console.error("Failed to load history:", err);
    return [];
  }
}

export function addHistoryEntry(entry) {
  const history = getHistory();
  const normalized = normalizeHistoryItem(entry);
  if (!normalized) {
    return null;
  }

  const existingIndex = history.findIndex((item) => item.id === normalized.id);
  const nextHistory =
    existingIndex === -1
      ? [...history, normalized]
      : history.map((item, index) => (index === existingIndex ? normalized : item));
  saveHistory(nextHistory);
  return normalized;
}

export function addMessageToHistory(role, text, options = {}) {
  return addHistoryEntry({
    id: options.id,
    type: "chat",
    content: {
      role,
      text,
    },
    userId: options.userId || null,
    color: options.color || null,
    timestamp: options.timestamp || Date.now(),
  });
}

export function addExpressionToHistory(expression) {
  if (!expression?.expressionId) {
    return null;
  }

  return addHistoryEntry({
    id: expression.expressionId,
    type: "expression",
    content: {
      expressionId: expression.expressionId,
      expression,
      strokeCount: Array.isArray(expression.strokes) ? expression.strokes.length : 0,
      elementCount: Array.isArray(expression.elements) ? expression.elements.length : 0,
      previewUrl: expression.previewUrl || null,
      recognizedText: typeof expression.recognizedText === "string" ? expression.recognizedText : "",
      usersInvolved: getExpressionUserIds(expression),
      text:
        typeof expression.recognizedText === "string" && expression.recognizedText.trim()
          ? expression.recognizedText.trim()
          : `${expression.userId || "A user"} shared an expression.`,
    },
    userId: expression.userId || null,
    color: expression.color || null,
    timestamp: expression.timestamp || Date.now(),
  });
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (err) {
    console.error("Failed to clear history:", err);
  }
}

export function exportHistory() {
  const history = getHistory();
  const csv = history
    .map((item) => {
      const text =
        item.type === "chat"
          ? String(item.content?.text || "")
          : String(item.content?.text || "Shared expression");
      return `"${new Date(item.timestamp).toISOString()}","${item.type}","${text.replace(/"/g, '""')}"`;
    })
    .join("\n");

  return '"Timestamp","Type","Content"\n' + csv;
}

export function downloadHistoryAsFile() {
  const csv = exportHistory();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `history-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function getHistoryStats() {
  const history = getHistory();
  return {
    total: history.length,
    chats: history.filter((item) => item.type === "chat").length,
    expressions: history.filter((item) => item.type === "expression").length,
  };
}
