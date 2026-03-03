const saveBtn = document.getElementById("saveBtn");
const drawBtn = document.getElementById("drawBtn");
const eraseBtn = document.getElementById("eraseBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const clearBtn = document.getElementById("clearBtn");

function setActive(btn) {
  [drawBtn, eraseBtn, undoBtn, redoBtn, clearBtn, saveBtn].forEach((el) => {
    if (el) el.classList.remove("active");
  });
  if (btn) btn.classList.add("active");
}

if (saveBtn) {
  saveBtn.addEventListener("click", () => {
    setActive(saveBtn);
    if (window.excalidrawAPI) {
      window.excalidrawAPI.toggleMenu("export");
    }
  });
}
