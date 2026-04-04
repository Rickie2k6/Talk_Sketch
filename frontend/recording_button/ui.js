const recordBtn = document.getElementById("recordBtn");
const recordLabel = document.getElementById("recordLabel");

export function setRecordingUI(isActive) {
  if (!recordBtn || !recordLabel) return;
  recordBtn.classList.toggle("active", isActive);
  recordBtn.setAttribute("aria-pressed", String(isActive));
  recordLabel.textContent = isActive ? "Recording…" : "Recording";
}

export function getRecordButton() {
  return recordBtn;
}
