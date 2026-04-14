import { v4 as uuidv4 } from "uuid";

const USER_ID_KEY = "talkSketchUserId";
const DISPLAY_NAME_KEY = "talkSketchDisplayName";
const DEFAULT_ROOM_ID = "lobby";

function sanitizeRoomId(rawRoomId) {
  const candidate = typeof rawRoomId === "string" ? rawRoomId.trim().toLowerCase() : "";
  if (!candidate) {
    return DEFAULT_ROOM_ID;
  }

  return candidate
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    || DEFAULT_ROOM_ID;
}

function createGuestDisplayName() {
  return `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
}

export function getOrCreateGuestIdentity() {
  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = `guest_${uuidv4()}`;
    localStorage.setItem(USER_ID_KEY, userId);
  }

  let displayName = localStorage.getItem(DISPLAY_NAME_KEY);
  if (!displayName) {
    const promptedValue = window.prompt("Choose a nickname for collaboration (optional).", "");
    displayName = promptedValue?.trim() || createGuestDisplayName();
    localStorage.setItem(DISPLAY_NAME_KEY, displayName);
  }

  return { userId, displayName };
}

export function persistDisplayName(displayName) {
  const nextDisplayName = typeof displayName === "string" && displayName.trim()
    ? displayName.trim()
    : createGuestDisplayName();
  localStorage.setItem(DISPLAY_NAME_KEY, nextDisplayName);
  return nextDisplayName;
}

export function getRoomIdFromLocation(pathname = window.location.pathname) {
  const match = pathname.match(/^\/room\/([^/]+)/i);
  return sanitizeRoomId(match?.[1] || DEFAULT_ROOM_ID);
}

export function createRoomId() {
  return `room-${uuidv4().slice(0, 8)}`;
}

export function buildRoomPath(roomId) {
  return `/room/${sanitizeRoomId(roomId)}`;
}

export function updateBrowserRoom(roomId, { replace = false } = {}) {
  const path = buildRoomPath(roomId);
  const method = replace ? "replaceState" : "pushState";
  window.history[method](null, "", path);
  return sanitizeRoomId(roomId);
}

export function normalizeRoomId(roomId) {
  return sanitizeRoomId(roomId);
}
