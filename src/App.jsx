import { useEffect, useMemo, useRef, useState } from "react";
import Whiteboard from "./library/Whiteboard.jsx";
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
  const [sceneElements, setSceneElements] = useState([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecognizingMath, setIsRecognizingMath] = useState(false);
  const [recognizedMath, setRecognizedMath] = useState("");
  const [messages, setMessages] = useState([]);
  const recognitionRef = useRef(null);
  const recognizeAbortRef = useRef(null);
  const lastSceneSignatureRef = useRef("");

  const canSend = useMemo(() => Boolean(chatInput.trim()) && !isSending, [chatInput, isSending]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (recognizeAbortRef.current) {
        recognizeAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!apiKey) {
      setRecognizedMath("");
      return;
    }

    const activeElements = sceneElements.filter((el) => !el?.isDeleted);
    if (activeElements.length === 0) {
      setRecognizedMath("");
      return;
    }

    const signature = activeElements.map((el) => `${el.id}:${el.version}`).join("|");
    if (signature === lastSceneSignatureRef.current) return;

    const timer = setTimeout(async () => {
      if (recognizeAbortRef.current) recognizeAbortRef.current.abort();
      const abortController = new AbortController();
      recognizeAbortRef.current = abortController;
      setIsRecognizingMath(true);

      try {
        const response = await fetch("/recognize-math", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, elements: activeElements }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(text || "Math recognition failed");
        }

        const data = await response.json();
        setRecognizedMath(typeof data?.latex === "string" ? data.latex : "");
        lastSceneSignatureRef.current = signature;
      } catch (error) {
        if (error?.name !== "AbortError") {
          setRecognizedMath("");
        }
      } finally {
        setIsRecognizingMath(false);
      }
    }, 900);

    return () => clearTimeout(timer);
  }, [apiKey, sceneElements]);

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
        <Whiteboard onApiReady={setExcalidrawAPI} onSceneChange={setSceneElements} />
      </div>

      <aside className="side-panel">
        <div className="panel-header">
          <h2 className="panel-title">TalkSketch Assistant</h2>
          <span className={`key-status ${apiKey ? "connected" : ""}`}>
            {apiKey ? "API Connected" : "API Not Connected"}
          </span>
        </div>

        <div className="recognition-card">
          <div className="recognition-title">Live Math Recognition</div>
          <div className="recognition-body">
            {!apiKey ? "Connect API key to enable recognition." : null}
            {apiKey && isRecognizingMath ? "Recognizing current handwriting..." : null}
            {apiKey && !isRecognizingMath && recognizedMath ? <code>{recognizedMath}</code> : null}
            {apiKey && !isRecognizingMath && !recognizedMath ? "Write math on the board to recognize." : null}
          </div>
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

        <div className="api-section">
          <label className="api-label" htmlFor="api-key-input">
            OpenAI API Key
          </label>
          <div className="api-row">
            <input
              id="api-key-input"
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
      </aside>
    </div>
  );
}

export default App;
