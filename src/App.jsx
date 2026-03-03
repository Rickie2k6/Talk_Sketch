import { useEffect, useMemo, useRef, useState } from "react";
import Whiteboard from "./Whiteboard";
import "./App.css";

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

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [messages, setMessages] = useState([]);
  const recognitionRef = useRef(null);

  const canSend = useMemo(() => Boolean(chatInput.trim()) && !isSending, [chatInput, isSending]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const appendMessage = (role, text) => {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, role, text }]);
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
    if (!apiKey) {
      alert("Please connect your API key first.");
      return;
    }

    const elements = excalidrawAPI?.getSceneElements?.() || [];
    appendMessage("user", message);
    setChatInput("");
    setIsSending(true);

    try {
      const response = await fetch("/analyze-sketch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          elements,
          message,
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

  return (
    <div className="app-shell">
      <div className="board-area">
        <Whiteboard onApiReady={setExcalidrawAPI} />
      </div>

      <aside className="side-panel">
        <h2 className="panel-title">TalkSketch</h2>

        <div className="api-row">
          <input
            className="api-input"
            type="password"
            placeholder="Enter OpenAI API key"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            autoComplete="off"
          />
          <button className="connect-btn" type="button" onClick={connectApiKey}>
            Connect
          </button>
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
        </div>

        <button
          className={`record-btn ${isRecording ? "active" : ""}`}
          type="button"
          onClick={toggleRecording}
        >
          {isRecording ? "Stop Recording" : "Start Recording"}
        </button>
      </aside>
    </div>
  );
}

export default App;
