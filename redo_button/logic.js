const redoBtn = document.getElementById("redoBtn");
const drawBtn = document.getElementById("drawBtn");
const eraseBtn = document.getElementById("eraseBtn");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");

function setActive(btn) {
  [drawBtn, eraseBtn, undoBtn, redoBtn, clearBtn, saveBtn].forEach((el) => {
    if (el) el.classList.remove("active");
  });
  if (btn) btn.classList.add("active");
}

if (redoBtn) {
  redoBtn.addEventListener("click", () => {
    setActive(redoBtn);
    if (window.excalidrawAPI) {
      window.excalidrawAPI.redo();
    }
  });
}
