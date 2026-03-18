import { Excalidraw } from "@excalidraw/excalidraw";

export default function Whiteboard({ onApiReady, onSceneChange }) {
  return (
    <div style={{ height: "100%", width: "100%", backgroundColor: "#f5f5f5" }}>
      <Excalidraw
        excalidrawAPI={(api) => {
          onApiReady?.(api);
        }}
        onChange={(elements) => {
          onSceneChange?.(elements);
        }}
        initialData={{
          appState: {
            viewBackgroundColor: "#ffffff",
            activeTool: { type: "freedraw" },
            currentItemStrokeColor: "#000000",
          },
        }}
      />
    </div>
  );
}
