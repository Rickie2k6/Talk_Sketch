const drawBtn = document.getElementById("drawBtn");
const eraseBtn = document.getElementById("eraseBtn");
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

if (drawBtn) {
  drawBtn.addEventListener("click", () => {
    setActive(drawBtn);
    if (window.setExcalidrawTool) {
      window.setExcalidrawTool({ type: "freedraw", locked: true });
    } else if (window.excalidrawAPI) {
      window.excalidrawAPI.setActiveTool({ type: "freedraw", locked: true });
    }
    if (window.excalidrawAPI) {
      window.excalidrawAPI.updateScene({
        appState: {
          ...window.excalidrawAPI.getAppState(),
          currentItemStrokeColor: "#000000",
        },
      });
    }
  });
}
