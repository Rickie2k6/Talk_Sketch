let userApiKey = "";

export function setUserApiKey(key) {
  userApiKey = key;
}

export function hasUserApiKey() {
  return Boolean(userApiKey);
}

function getCurrentSketchElements() {
  if (!window.excalidrawAPI || typeof window.excalidrawAPI.getSceneElements !== "function") {
    return [];
  }
  return window.excalidrawAPI.getSceneElements();
}

export async function sendMessageToOpenAIStream(message, { onDelta, onDone, onError, signal } = {}) {
  if (!userApiKey) {
    onError?.(new Error("missing_api_key"));
    return;
  }

  try {
    const response = await fetch("/analyze-sketch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: userApiKey,
        message,
        elements: getCurrentSketchElements(),
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      onError?.(new Error(errText || "request_failed"));
      return;
    }

    const payload = await response.json();
    const output = typeof payload?.result === "string" ? payload.result : "";
    if (output) onDelta?.(output);
    onDone?.();
  } catch (err) {
    onError?.(err);
  }
}
