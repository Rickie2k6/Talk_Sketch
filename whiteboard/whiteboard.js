import React from "https://esm.sh/react@18";
import ReactDOM from "https://esm.sh/react-dom@18/client";
import { Excalidraw } from "https://esm.sh/@excalidraw/excalidraw@0.18.0";

const rootEl = document.getElementById("whiteboard");

window.setExcalidrawTool = (tool) => {
  if (window.excalidrawAPI) {
    window.excalidrawAPI.setActiveTool(tool);
  } else {
    window._pendingExcalidrawTool = tool;
  }
};

if (rootEl) {
  window.EXCALIDRAW_ASSET_PATH = "https://unpkg.com/@excalidraw/excalidraw@0.18.0/dist/prod/";

  const App = () => {
    return React.createElement(Excalidraw, {
      theme: "light",
      initialData: {
        appState: {
          activeTool: { type: "freedraw", locked: true },
        },
      },
      UIOptions: {
        canvasActions: {
          export: false,
          saveToActiveFile: false,
          saveAsImage: false,
          loadScene: false,
          toggleTheme: false,
        },
      },
      excalidrawAPI: (api) => {
        window.excalidrawAPI = api;
        if (window._pendingExcalidrawTool) {
          api.setActiveTool(window._pendingExcalidrawTool);
          window._pendingExcalidrawTool = null;
        }
      },
    });
  };

  const root = ReactDOM.createRoot(rootEl);
  root.render(React.createElement(App));
}
