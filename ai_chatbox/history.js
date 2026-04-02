// Chat History Management
const HISTORY_KEY = "talk-sketch-chat-history";
const MAX_HISTORY_ITEMS = 100;

export function addMessageToHistory(role, text) {
  const history = getHistory();
  const timestamp = new Date().toISOString();
  
  history.push({
    id: Date.now(),
    role,
    text,
    timestamp,
  });

  // Keep only the last MAX_HISTORY_ITEMS messages
  if (history.length > MAX_HISTORY_ITEMS) {
    history.splice(0, history.length - MAX_HISTORY_ITEMS);
  }

  saveHistory(history);
  return history[history.length - 1];
}

export function getHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.error("Failed to load history:", err);
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    console.error("Failed to save history:", err);
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    console.log("Chat history cleared");
  } catch (err) {
    console.error("Failed to clear history:", err);
  }
}

export function exportHistory() {
  const history = getHistory();
  const csv = history
    .map((msg) => `"${msg.timestamp}","${msg.role}","${msg.text.replace(/"/g, '""')}"`)
    .join("\n");
  const header = '"Timestamp","Role","Message"\n';
  return header + csv;
}

export function downloadHistoryAsFile() {
  const csv = exportHistory();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `chat-history-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function getHistoryStats() {
  const history = getHistory();
  const userMessages = history.filter((m) => m.role === "user").length;
  const assistantMessages = history.filter((m) => m.role === "assistant").length;
  return {
    total: history.length,
    userMessages,
    assistantMessages,
  };
}
