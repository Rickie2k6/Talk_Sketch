import { getApiKeyElements, getChatElements, setChatInputValue, appendChatMessage, setChatMessageText, displayChatHistory, showHistoryPanel } from "./ui.js";
import { setUserApiKey, hasUserApiKey, sendMessageToOpenAIStream } from "./api.js";
import { addMessageToHistory, getHistory, clearHistory, downloadHistoryAsFile } from "./history.js";

const { apiKeyInput, saveKeyBtn } = getApiKeyElements();
const { sendBtn, chatInput } = getChatElements();

if (saveKeyBtn) {
  saveKeyBtn.onclick = () => {
    const key = apiKeyInput ? apiKeyInput.value.trim() : "";

    if (!key.startsWith("sk-")) {
      alert("Invalid API key format.");
      return;
    }

    setUserApiKey(key);
    if (apiKeyInput) apiKeyInput.value = "";
    alert("API key saved for this session.");
  };
}

if (sendBtn) {
  sendBtn.onclick = async () => {
    if (!chatInput) return;
    const message = chatInput.value.trim();

    if (!message) return;

    if (!hasUserApiKey()) {
      alert("Please enter your API key first.");
      return;
    }

    appendChatMessage("user", message);
    addMessageToHistory("user", message);
    setChatInputValue("Thinking...");

    const assistantEl = appendChatMessage("assistant", "");
    let assistantText = "";

    await sendMessageToOpenAIStream(message, {
      onDelta: (chunk) => {
        assistantText += chunk;
        setChatMessageText(assistantEl, assistantText);
      },
      onError: (err) => {
        setChatMessageText(assistantEl, "Error: " + (err?.message || "Request failed."));
      },
    });

    addMessageToHistory("assistant", assistantText);
    setChatInputValue("");
  };
}

// History management
document.addEventListener("DOMContentLoaded", () => {
  // Add history button if it doesn't exist
  let historyBtn = document.getElementById("viewHistoryBtn");
  if (!historyBtn && chatInput && sendBtn) {
    historyBtn = document.createElement("button");
    historyBtn.id = "viewHistoryBtn";
    historyBtn.textContent = "📋 History";
    historyBtn.className = "history-btn";
    sendBtn.parentNode.insertBefore(historyBtn, sendBtn.nextSibling);
  }

  if (historyBtn) {
    historyBtn.onclick = () => {
      const history = getHistory();
      displayChatHistory(history);
      showHistoryPanel();
    };
  }
});

// Handle history management buttons when they appear
document.addEventListener("click", (e) => {
  if (e.target.id === "downloadHistoryBtn") {
    downloadHistoryAsFile();
  } else if (e.target.id === "clearHistoryBtn") {
    if (
      confirm(
        "Are you sure you want to clear all chat history? This action cannot be undone."
      )
    ) {
      clearHistory();
      const history = getHistory();
      displayChatHistory(history);
    }
  }
});
