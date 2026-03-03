import { Excalidraw } from "@excalidraw/excalidraw";
import { useRef } from "react";

export default function Whiteboard() {
  const excalidrawRef = useRef(null);

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        backgroundColor: "#f5f5f5",
      }}
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          excalidrawRef.current = api;
        }}
        initialData={{
          appState: {
            viewBackgroundColor: "#ffffff",
            activeTool: { type: "freedraw" },
          },
        }}
      />
      <button
        onClick={() => {
          const elements = excalidrawRef.current?.getSceneElements?.() || [];
          console.log(elements);
        }}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 10,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #d0d0d0",
          background: "#ffffff",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Get Drawing Data
      </button>
    </div>
  );
}
