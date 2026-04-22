function canUseBrowserApis() {
  return typeof window !== "undefined";
}

export function isExcalidrawDebugEnabled() {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_TALK_SKETCH_DEBUG === "1") {
    return true;
  }

  if (!canUseBrowserApis()) {
    return false;
  }

  try {
    if (window.localStorage.getItem("talkSketchDebug") === "1") {
      return true;
    }
  } catch {
    // ignore storage failures
  }

  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("tsdebug") === "1";
  } catch {
    return false;
  }
}

function cleanNumber(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function getLinearElements(elements) {
  return (Array.isArray(elements) ? elements : []).filter((element) => (
    element?.type === "line" ||
    element?.type === "arrow" ||
    element?.type === "freedraw" ||
    element?.type === "draw"
  ));
}

export function summarizeElements(elements) {
  const safeElements = Array.isArray(elements) ? elements : [];

  return safeElements.map((element) => ({
    id: element?.id || null,
    type: element?.type || null,
    version: cleanNumber(element?.version),
    isDeleted: Boolean(element?.isDeleted),
    x: cleanNumber(element?.x),
    y: cleanNumber(element?.y),
    width: cleanNumber(element?.width),
    height: cleanNumber(element?.height),
    points: Array.isArray(element?.points) ? element.points.length : null,
    lastPoint: Array.isArray(element?.points) && element.points.length > 0
      ? element.points[element.points.length - 1]
      : null,
  }));
}

export function summarizeDrawingFocus(elements) {
  const linearElements = getLinearElements(elements);
  const latestLinearElement = linearElements[linearElements.length - 1] || null;

  return {
    totalElements: Array.isArray(elements) ? elements.length : 0,
    linearElementCount: linearElements.length,
    latestLinearElement: latestLinearElement
      ? {
        id: latestLinearElement.id || null,
        type: latestLinearElement.type || null,
        version: cleanNumber(latestLinearElement.version),
        versionNonce: cleanNumber(latestLinearElement.versionNonce),
        isDeleted: Boolean(latestLinearElement.isDeleted),
        x: cleanNumber(latestLinearElement.x),
        y: cleanNumber(latestLinearElement.y),
        width: cleanNumber(latestLinearElement.width),
        height: cleanNumber(latestLinearElement.height),
        points: Array.isArray(latestLinearElement.points) ? latestLinearElement.points.length : null,
        firstPoint: Array.isArray(latestLinearElement.points) && latestLinearElement.points.length > 0
          ? latestLinearElement.points[0]
          : null,
        lastPoint: Array.isArray(latestLinearElement.points) && latestLinearElement.points.length > 0
          ? latestLinearElement.points[latestLinearElement.points.length - 1]
          : null,
      }
      : null,
    allLinearElements: summarizeElements(linearElements),
  };
}

export function summarizeAppState(appState) {
  if (!appState || typeof appState !== "object") {
    return {};
  }

  return {
    activeTool: appState.activeTool?.type || null,
    editingLinearElementId: appState.editingLinearElement?.elementId || null,
    multiElementId: appState.multiElement?.id || null,
    selectedElementCount: appState.selectedElementIds
      ? Object.keys(appState.selectedElementIds).length
      : 0,
    viewModeEnabled: Boolean(appState.viewModeEnabled),
    zenModeEnabled: Boolean(appState.zenModeEnabled),
    gridSize: cleanNumber(appState.gridSize),
    viewBackgroundColor: appState.viewBackgroundColor || null,
  };
}

export function summarizeScenePacket(scene = {}) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const files = scene?.files && typeof scene.files === "object" ? scene.files : {};

  return {
    roomId: scene?.roomId || null,
    version: cleanNumber(scene?.version),
    senderId: scene?.senderId || null,
    fileCount: Object.keys(files).length,
    elements: summarizeElements(elements),
    drawFocus: summarizeDrawingFocus(elements),
    appState: summarizeAppState(scene?.appState),
  };
}

function getDebugStore() {
  if (!canUseBrowserApis()) {
    return null;
  }

  if (!window.__talkSketchDebugStore) {
    window.__talkSketchDebugStore = [];
  }

  return window.__talkSketchDebugStore;
}

export function debugExcalidrawFlow(event, payload = {}) {
  if (!isExcalidrawDebugEnabled()) {
    return;
  }

  const timestamp = new Date().toISOString();
  const store = getDebugStore();
  if (store) {
    store.push({ timestamp, event, payload });
    if (store.length > 500) {
      store.splice(0, store.length - 500);
    }
  }
  console.log(`[talk-sketch-debug] ${timestamp} ${event}`, payload);
}

export function registerExcalidrawDebugApi(apiFactory) {
  if (!canUseBrowserApis() || typeof apiFactory !== "function") {
    return;
  }

  window.__talkSketchDebug = {
    enable() {
      window.localStorage.setItem("talkSketchDebug", "1");
    },
    disable() {
      window.localStorage.removeItem("talkSketchDebug");
    },
    clear() {
      const store = getDebugStore();
      if (store) {
        store.length = 0;
      }
    },
    events() {
      return [...(getDebugStore() || [])];
    },
    last(count = 25) {
      return (getDebugStore() || []).slice(-Math.max(1, Number(count) || 25));
    },
    snapshot() {
      return apiFactory();
    },
  };
}
