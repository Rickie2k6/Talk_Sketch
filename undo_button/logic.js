const undoBtn = document.getElementById("undoBtn");
const drawBtn = document.getElementById("drawBtn");
const eraseBtn = document.getElementById("eraseBtn");
const redoBtn = document.getElementById("redoBtn");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");

function setActive(btn) {
  [drawBtn, eraseBtn, undoBtn, redoBtn, clearBtn, saveBtn].forEach((el) => {
    if (el) el.classList.remove("active");
  });
  if (btn) btn.classList.add("active");
}

if (undoBtn) {
  undoBtn.addEventListener("click", () => {
    setActive(undoBtn);
    if (window.excalidrawAPI) {
      window.excalidrawAPI.undo();
    }
  });
}
