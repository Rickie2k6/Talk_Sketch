import { getApiKeyElements, getChatElements, setChatInputValue, appendChatMessage, setChatMessageText } from "./ui.js";
import { setUserApiKey, hasUserApiKey, sendMessageToOpenAIStream } from "./api.js";

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

    setChatInputValue("");
  };
}
