import { v4 as uuidv4 } from "uuid";
export { cloneSceneElements } from "../../../shared/excalidrawCollaboration.js";
import { cloneSceneElements } from "../../../shared/excalidrawCollaboration.js";

export function buildSceneSignature(elements) {
  return cloneSceneElements(elements)
    .map((element) => `${element?.id || "unknown"}:${element?.version || 0}:${element?.isDeleted ? 1 : 0}`)
    .join("|");
}

function createActionRecord({
  roomId,
  userId,
  displayName,
  color,
  actionType,
  strokeId = null,
  element = null,
  metadata = {},
}) {
  const timestamp = new Date().toISOString();

  return {
    eventId: uuidv4(),
    roomId,
    userId,
    displayName,
    strokeId,
    timestamp,
    actionType,
    elements: element ? [JSON.parse(JSON.stringify(element))] : [],
    metadata: {
      color: color || null,
      ...(element
        ? {
          elementType: element.type || null,
          version: Number.isFinite(element.version) ? element.version : null,
        }
        : {}),
      ...metadata,
    },
  };
}

export function diffSceneActions(previousElements, nextElements, {
  roomId,
  userId,
  displayName,
  color,
}) {
  const previous = cloneSceneElements(previousElements);
  const next = cloneSceneElements(nextElements);
  const previousMap = new Map(previous.map((element) => [element.id, element]));
  const nextMap = new Map(next.map((element) => [element.id, element]));

  if (previousMap.size > 0 && nextMap.size === 0) {
    return [
      createActionRecord({
        roomId,
        userId,
        displayName,
        color,
        actionType: "clear",
        metadata: {
          clearedCount: previousMap.size,
          deletedStrokeIds: Array.from(previousMap.keys()),
        },
      }),
    ];
  }

  const actions = [];

  next.forEach((element) => {
    const previousElement = previousMap.get(element.id);
    if (!previousElement) {
      actions.push(createActionRecord({
        roomId,
        userId,
        displayName,
        color,
        actionType: "create",
        strokeId: element.id,
        element,
      }));
      return;
    }

    if ((previousElement.version || 0) !== (element.version || 0)) {
      actions.push(createActionRecord({
        roomId,
        userId,
        displayName,
        color,
        actionType: "update",
        strokeId: element.id,
        element,
      }));
    }
  });

  previous.forEach((element) => {
    if (!nextMap.has(element.id)) {
      actions.push(createActionRecord({
        roomId,
        userId,
        displayName,
        color,
        actionType: "delete",
        strokeId: element.id,
        metadata: {
          elementType: element.type || null,
          version: Number.isFinite(element.version) ? element.version : null,
        },
      }));
    }
  });

  return actions;
}
