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
