import { useEffect, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";

export default function Whiteboard({ onApiReady, onSceneChange, strokeColor = "#000000" }) {
  const lastApiRef = useRef(null);

  useEffect(() => {
    if (!lastApiRef.current || !strokeColor) {
      return;
    }

    const appState = lastApiRef.current.getAppState();
    if (appState.currentItemStrokeColor === strokeColor) {
      return;
    }

    lastApiRef.current.updateScene({
      appState: {
        ...appState,
        currentItemStrokeColor: strokeColor,
      },
    });
  }, [strokeColor]);

  return (
    <div style={{ height: "100%", width: "100%", backgroundColor: "#f5f5f5" }}>
      <Excalidraw
        excalidrawAPI={(api) => {
          if (!api || lastApiRef.current === api) return;
          lastApiRef.current = api;
          onApiReady?.(api);
        }}
        onChange={(elements) => {
          onSceneChange?.(elements);
        }}
        initialData={{
          appState: {
            viewBackgroundColor: "#ffffff",
            activeTool: { type: "freedraw" },
            currentItemStrokeColor: strokeColor,
          },
        }}
      />
    </div>
  );
}
