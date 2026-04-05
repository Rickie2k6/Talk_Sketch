import { getRecordButton, setRecordingUI } from "./ui.js";
import { appendChatMessage, setChatInputValue, setChatMessageText } from "../ai_chatbox/ui.js";
import { hasUserApiKey, sendMessageToOpenAIStream } from "../ai_chatbox/api.js";

let mediaRecorder = null;
let audioStream = null;
let recognition = null;
let isRecording = false;
let finalTranscript = "";
let interimTranscript = "";
let liveMessageEl = null;
let liveAssistantEl = null;
let liveAssistantText = "";
let autoSendTimer = null;
let autoSendAbort = null;
let lastSentText = "";

const supportsSpeechRecognition =
  "SpeechRecognition" in window || "webkitSpeechRecognition" in window;

function createRecognition() {
  if (!supportsSpeechRecognition) return null;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = true;

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) {
        const finalChunk = result[0].transcript.trim();
        finalTranscript += `${finalChunk} `;
      } else {
        interim += result[0].transcript;
      }
    }
    interimTranscript = interim;
    const liveText = `${finalTranscript}${interim}`.trim();
    setChatInputValue(liveText);

    if (autoSendTimer) clearTimeout(autoSendTimer);
    autoSendTimer = setTimeout(() => {
      autoSendTimer = null;
      startAutoSend(liveText);
    }, 3000);
  };

  rec.onerror = () => {
    stopRecording();
  };

  return rec;
}

async function startRecording() {
  if (isRecording) return;
  isRecording = true;
  setRecordingUI(true);
  finalTranscript = "";

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream);
    mediaRecorder.start();

    recognition = createRecognition();
    if (recognition) {
      recognition.start();
    } else {
      setChatInputValue("Speech recognition not supported in this browser.");
    }
  } catch (err) {
    stopRecording();
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  setRecordingUI(false);

  if (recognition) {
    recognition.stop();
    recognition = null;
  }

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder = null;
  }

  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = null;
  }

  const finalText = `${finalTranscript}${interimTranscript}`.trim();
  if (finalText && liveMessageEl) {
    setChatMessageText(liveMessageEl, finalText);
  }

  finalTranscript = "";
  interimTranscript = "";
  liveMessageEl = null;
  liveAssistantEl = null;
  liveAssistantText = "";
  if (autoSendTimer) clearTimeout(autoSendTimer);
  autoSendTimer = null;
  if (autoSendAbort) autoSendAbort.abort();
  autoSendAbort = null;
  lastSentText = "";
  setChatInputValue("");
}

function startAutoSend(text) {
  if (!text) return;
  if (!hasUserApiKey()) return;
  if (text === lastSentText) return;
  lastSentText = text;

  if (autoSendAbort) autoSendAbort.abort();
  autoSendAbort = new AbortController();

  liveMessageEl = appendChatMessage("user", text);
  liveAssistantEl = appendChatMessage("assistant", "");
  liveAssistantText = "";

  sendMessageToOpenAIStream(text, {
    signal: autoSendAbort.signal,
    onDelta: (chunk) => {
      liveAssistantText += chunk;
      setChatMessageText(liveAssistantEl, liveAssistantText);
    },
    onError: () => {
      // Ignore abort errors during live speaking.
    },
  });
}

const recordBtn = getRecordButton();
if (recordBtn) {
  recordBtn.addEventListener("click", () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
}
