const apiKeyInput = document.getElementById("apiKeyInput");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const sendBtn = document.getElementById("sendBtn");
const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");

export function getApiKeyElements() {
  return { apiKeyInput, saveKeyBtn };
}

export function getChatElements() {
  return { sendBtn, chatInput, chatMessages };
}

export function setChatInputValue(value) {
  if (chatInput) chatInput.value = value;
}

export function appendChatMessage(role, text) {
  if (!chatMessages) return;
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${role}`;
  const roleLabel = document.createElement("span");
  roleLabel.className = "role";
  roleLabel.textContent = role === "user" ? "You" : "AI Coach";
  const body = document.createElement("div");
  body.textContent = text;
  wrapper.append(roleLabel, body);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return wrapper;
}

export function setChatMessageText(wrapper, text) {
  if (!wrapper) return;
  const body = wrapper.querySelector("div");
  if (body) body.textContent = text;
}

export function getHistoryPanel() {
  let panel = document.getElementById("chatHistoryPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "chatHistoryPanel";
    panel.className = "chat-history-panel";
    document.body.appendChild(panel);
  }
  return panel;
}

export function displayChatHistory(history) {
  const panel = getHistoryPanel();
  panel.innerHTML = "";

  if (history.length === 0) {
    panel.innerHTML = "<p class='empty-message'>No chat history yet</p>";
    return;
  }

  const header = document.createElement("div");
  header.className = "history-header";
  header.innerHTML = `
    <h3>Chat History (${history.length} messages)</h3>
    <button id="closeHistoryBtn" class="close-btn">×</button>
  `;
  panel.appendChild(header);

  const container = document.createElement("div");
  container.className = "history-container";

  history.forEach((msg) => {
    const item = document.createElement("div");
    item.className = `history-item history-item-${msg.role}`;
    
    const dateStr = new Date(msg.timestamp).toLocaleString();
    const roleLabel = msg.role === "user" ? "You" : "AI Coach";
    
    item.innerHTML = `
      <div class="history-item-header">
        <span class="history-role">${roleLabel}</span>
        <span class="history-time">${dateStr}</span>
      </div>
      <div class="history-item-text">${escapeHtml(msg.text)}</div>
    `;
    
    container.appendChild(item);
  });

  panel.appendChild(container);

  const footer = document.createElement("div");
  footer.className = "history-footer";
  footer.innerHTML = `
    <button id="downloadHistoryBtn" class="history-btn">Download CSV</button>
    <button id="clearHistoryBtn" class="history-btn danger">Clear History</button>
  `;
  panel.appendChild(footer);

  document.getElementById("closeHistoryBtn").onclick = () => {
    panel.style.display = "none";
  };
}

export function showHistoryPanel() {
  const panel = getHistoryPanel();
  panel.style.display = "block";
}

export function hideHistoryPanel() {
  const panel = getHistoryPanel();
  panel.style.display = "none";
}

function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
