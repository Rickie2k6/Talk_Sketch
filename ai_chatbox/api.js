let userApiKey = "";

export function setUserApiKey(key) {
  userApiKey = key;
}

export function hasUserApiKey() {
  return Boolean(userApiKey);
}

function parseSSEChunk(chunk, onDelta, onDone, onError) {
  const lines = chunk.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) continue;
    const data = trimmed.replace(/^data:\s*/, "");
    if (data === "[DONE]") {
      onDone?.();
      continue;
    }
    try {
      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) onDelta?.(delta);
    } catch (err) {
      onError?.(err);
    }
  }
}

export async function sendMessageToOpenAIStream(message, { onDelta, onDone, onError, signal } = {}) {
  if (!userApiKey) {
    onError?.(new Error("missing_api_key"));
    return;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${userApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      stream: true,
      messages: [
        { role: "system", content: "You are TalkSketch AI Coach helping brainstorm ideas." },
        { role: "user", content: message },
      ],
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    onError?.(new Error(errText || "request_failed"));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      parseSSEChunk(part, onDelta, onDone, onError);
    }
  }

  if (buffer) {
    parseSSEChunk(buffer, onDelta, onDone, onError);
  }
}
