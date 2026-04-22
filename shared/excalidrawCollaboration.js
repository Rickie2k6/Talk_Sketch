export const COLLABORATIVE_APP_STATE_KEYS = [
  "viewBackgroundColor",
  "gridSize",
];

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

export function cloneSceneElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .filter((element) => element && typeof element === "object" && typeof element.id === "string")
    .map((element) => cloneSerializable(element));
}

export function sanitizeCollaborativeAppState(appState) {
  if (!appState || typeof appState !== "object") {
    return undefined;
  }

  const nextAppState = {};
  COLLABORATIVE_APP_STATE_KEYS.forEach((key) => {
    if (appState[key] !== undefined) {
      nextAppState[key] = cloneSerializable(appState[key]);
    }
  });

  return Object.keys(nextAppState).length > 0 ? nextAppState : undefined;
}

export function areElementsEqualForSync(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    toFiniteNumber(left.version) === toFiniteNumber(right.version) &&
    toFiniteNumber(left.versionNonce) === toFiniteNumber(right.versionNonce) &&
    toFiniteNumber(left.updated) === toFiniteNumber(right.updated) &&
    Boolean(left.isDeleted) === Boolean(right.isDeleted)
  );
}

export function isIncomingElementNewer(incomingElement, existingElement) {
  if (!existingElement) {
    return true;
  }

  const incomingVersion = toFiniteNumber(incomingElement?.version);
  const existingVersion = toFiniteNumber(existingElement?.version);
  if (incomingVersion !== existingVersion) {
    return incomingVersion > existingVersion;
  }

  const incomingUpdated = toFiniteNumber(incomingElement?.updated);
  const existingUpdated = toFiniteNumber(existingElement?.updated);
  if (incomingUpdated !== existingUpdated) {
    return incomingUpdated > existingUpdated;
  }

  const incomingNonce = toFiniteNumber(incomingElement?.versionNonce);
  const existingNonce = toFiniteNumber(existingElement?.versionNonce);
  if (incomingNonce !== existingNonce) {
    return incomingNonce > existingNonce;
  }

  return !areElementsEqualForSync(incomingElement, existingElement);
}

export function reconcileElements(baseElements, incomingElements) {
  const nextElements = cloneSceneElements(baseElements);
  const indexesById = new Map(nextElements.map((element, index) => [element.id, index]));
  const acceptedElements = [];
  const previousElementsById = new Map(nextElements.map((element) => [element.id, element]));

  cloneSceneElements(incomingElements).forEach((incomingElement) => {
    const nextIndex = indexesById.get(incomingElement.id);
    const existingElement = nextIndex === undefined ? null : nextElements[nextIndex];
    if (!isIncomingElementNewer(incomingElement, existingElement)) {
      return;
    }

    if (nextIndex === undefined) {
      indexesById.set(incomingElement.id, nextElements.length);
      nextElements.push(incomingElement);
    } else {
      nextElements[nextIndex] = incomingElement;
    }

    acceptedElements.push(incomingElement);
  });

  return {
    elements: nextElements,
    acceptedElements,
    previousElementsById,
  };
}

export function getChangedSceneElements(baseElements, nextElements) {
  const next = cloneSceneElements(nextElements);
  const baseById = new Map(cloneSceneElements(baseElements).map((element) => [element.id, element]));

  return next.filter((element) => {
    const previousElement = baseById.get(element.id);
    return !areElementsEqualForSync(previousElement, element);
  });
}
