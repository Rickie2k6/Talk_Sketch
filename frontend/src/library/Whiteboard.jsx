import { useCallback, useEffect, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  debugExcalidrawFlow,
  summarizeAppState,
  summarizeElements,
} from "../utils/excalidrawDebug.js";

export default function Whiteboard({
  onApiReady,
  onSceneChange,
  onBoardPointerDown,
  onBoardPointerUp,
}) {
  const containerRef = useRef(null);
  const lastApiRef = useRef(null);
  const apiReadyRef = useRef(onApiReady);
  const sceneChangeRef = useRef(onSceneChange);
  const pointerDownRef = useRef(onBoardPointerDown);
  const pointerUpRef = useRef(onBoardPointerUp);
  const trackingPointerRef = useRef(false);

  useEffect(() => {
    apiReadyRef.current = onApiReady;
  }, [onApiReady]);

  useEffect(() => {
    sceneChangeRef.current = onSceneChange;
  }, [onSceneChange]);

  useEffect(() => {
    pointerDownRef.current = onBoardPointerDown;
  }, [onBoardPointerDown]);

  useEffect(() => {
    pointerUpRef.current = onBoardPointerUp;
  }, [onBoardPointerUp]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const container = containerRef.current;
      if (!container || !container.contains(event.target)) {
        return;
      }

      trackingPointerRef.current = true;
      debugExcalidrawFlow("whiteboard.pointer-down", {});
      pointerDownRef.current?.();
    };

    const handlePointerUp = () => {
      if (!trackingPointerRef.current) {
        return;
      }

      trackingPointerRef.current = false;
      debugExcalidrawFlow("whiteboard.pointer-up", {});
      pointerUpRef.current?.();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerUp, true);
    window.addEventListener("blur", handlePointerUp);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerUp, true);
      window.removeEventListener("blur", handlePointerUp);
    };
  }, []);

  const handleApiReady = useCallback((api) => {
    if (!api || lastApiRef.current === api) {
      return;
    }

    lastApiRef.current = api;
    debugExcalidrawFlow("whiteboard.api-ready", {
      hasApi: Boolean(api),
    });
    apiReadyRef.current?.(api);
  }, []);

  const handleSceneChange = useCallback((elements, appState, files) => {
    debugExcalidrawFlow("whiteboard.onChange", {
      elements: summarizeElements(elements),
      appState: summarizeAppState(appState),
      fileCount: files && typeof files === "object" ? Object.keys(files).length : 0,
    });
    sceneChangeRef.current?.(elements, appState, files);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", width: "100%", backgroundColor: "#f5f5f5" }}
    >
      <Excalidraw
        excalidrawAPI={handleApiReady}
        onChange={handleSceneChange}
      />
    </div>
  );
}
