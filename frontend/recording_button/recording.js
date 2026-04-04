const recordBtn = document.getElementById("recordBtn");
const recordLabel = document.getElementById("recordLabel");
const chatInput = document.getElementById("chatInput");

let mediaRecorder = null;
let audioStream = null;
let recognition = null;
let isRecording = false;
let finalTranscript = "";

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
        finalTranscript += `${result[0].transcript} `;
      } else {
        interim += result[0].transcript;
      }
    }
    if (chatInput) {
      chatInput.value = `${finalTranscript}${interim}`.trim();
    }
  };

  rec.onerror = () => {
    stopRecording();
  };

  return rec;
}

async function startRecording() {
  if (isRecording) return;
  isRecording = true;
  recordBtn.classList.add("active");
  recordBtn.setAttribute("aria-pressed", "true");
  recordLabel.textContent = "Recording…";
  finalTranscript = "";

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream);
    mediaRecorder.start();

    recognition = createRecognition();
    if (recognition) {
      recognition.start();
    } else if (chatInput) {
      chatInput.value = "Speech recognition not supported in this browser.";
    }
  } catch (err) {
    stopRecording();
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  recordBtn.classList.remove("active");
  recordBtn.setAttribute("aria-pressed", "false");
  recordLabel.textContent = "Recording";

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
}

if (recordBtn) {
  recordBtn.addEventListener("click", () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });
}
