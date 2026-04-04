const eraseBtn = document.getElementById("eraseBtn");
const drawBtn = document.getElementById("drawBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");

function setActive(btn) {
  [drawBtn, eraseBtn, undoBtn, redoBtn, clearBtn, saveBtn].forEach((el) => {
    if (el) el.classList.remove("active");
  });
  if (btn) btn.classList.add("active");
}

if (eraseBtn) {
  eraseBtn.addEventListener("click", () => {
    setActive(eraseBtn);
    if (window.setExcalidrawTool) {
      window.setExcalidrawTool({ type: "eraser", locked: true });
    } else if (window.excalidrawAPI) {
      window.excalidrawAPI.setActiveTool({ type: "eraser", locked: true });
    }
  });
}
