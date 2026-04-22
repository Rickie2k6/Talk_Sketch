import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { sanitizeCollaborativeAppState } from "../../shared/excalidrawCollaboration.js";

const DEFAULT_ROOM_ID = "lobby";
const EVENT_LOG_LIMIT = 500;
const RECOGNITION_LIMIT = 24;
const DEBUG_COLLAB_FLOW = process.env.COLLAB_DEBUG_FLOW === "1";

function summarizeElements(elements) {
  return (Array.isArray(elements) ? elements : []).map((element) => ({
    id: element?.id || null,
    type: element?.type || null,
    version: Number.isFinite(element?.version) ? element.version : null,
    isDeleted: Boolean(element?.isDeleted),
    width: Number.isFinite(element?.width) ? element.width : null,
    height: Number.isFinite(element?.height) ? element.height : null,
    points: Array.isArray(element?.points) ? element.points.length : null,
    lastPoint: Array.isArray(element?.points) && element.points.length > 0
      ? element.points[element.points.length - 1]
      : null,
  }));
}

function summarizeDrawingFocus(elements) {
  const linearElements = (Array.isArray(elements) ? elements : []).filter((element) => (
    element?.type === "line" ||
    element?.type === "arrow" ||
    element?.type === "freedraw" ||
    element?.type === "draw"
  ));
  const latestLinearElement = linearElements[linearElements.length - 1] || null;

  return {
    totalElements: Array.isArray(elements) ? elements.length : 0,
    linearElementCount: linearElements.length,
    latestLinearElement: latestLinearElement
      ? {
        id: latestLinearElement?.id || null,
        type: latestLinearElement?.type || null,
        version: Number.isFinite(latestLinearElement?.version) ? latestLinearElement.version : null,
        width: Number.isFinite(latestLinearElement?.width) ? latestLinearElement.width : null,
        height: Number.isFinite(latestLinearElement?.height) ? latestLinearElement.height : null,
        points: Array.isArray(latestLinearElement?.points) ? latestLinearElement.points.length : null,
        firstPoint: Array.isArray(latestLinearElement?.points) && latestLinearElement.points.length > 0
          ? latestLinearElement.points[0]
          : null,
        lastPoint: Array.isArray(latestLinearElement?.points) && latestLinearElement.points.length > 0
          ? latestLinearElement.points[latestLinearElement.points.length - 1]
          : null,
      }
      : null,
  };
}

function summarizeScenePacket(scene = {}, extras = {}) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const files = scene?.files && typeof scene.files === "object" ? scene.files : {};

  return {
    roomId: extras.roomId || scene?.roomId || null,
    senderId: extras.senderId || scene?.senderId || null,
    version: Number.isFinite(extras.version) ? extras.version : (
      Number.isFinite(scene?.version) ? scene.version : null
    ),
    fileCount: Object.keys(files).length,
    drawFocus: summarizeDrawingFocus(elements),
    elements: summarizeElements(elements),
    appState: sanitizeCollaborativeAppState(scene?.appState) || {},
  };
}

function debugCollabFlow(event, payload) {
  if (!DEBUG_COLLAB_FLOW) {
    return;
  }

  console.log(`[collab-debug] ${new Date().toISOString()} ${event}`, payload);
}

class CollaborationServer {
  constructor(httpServer) {
    this.io = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] },
    });
    this.rooms = new Map();
    this.socketLinks = new Map();
    this.setupSocketHandlers();
  }

  normalizeRoomId(roomId) {
    const candidate = typeof roomId === "string" ? roomId.trim() : "";
    if (!candidate) {
      return DEFAULT_ROOM_ID;
    }

    return candidate
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "") || DEFAULT_ROOM_ID;
  }

  normalizeTimestamp(value) {
    const date = typeof value === "string" || typeof value === "number" ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      return new Date().toISOString();
    }
    return date.toISOString();
  }

  cloneSerializable(value, fallback) {
    if (value == null) {
      return fallback;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  sanitizeScene(scene = {}) {
    return {
      elements: Array.isArray(scene?.elements) ? this.cloneSerializable(scene.elements, []) : [],
      appState: sanitizeCollaborativeAppState(scene?.appState) || {},
      files: scene?.files && typeof scene.files === "object"
        ? this.cloneSerializable(scene.files, {})
        : {},
    };
  }

  getRoomState(roomId) {
    const normalizedRoomId = this.normalizeRoomId(roomId);
    if (!this.rooms.has(normalizedRoomId)) {
      this.rooms.set(normalizedRoomId, {
        roomId: normalizedRoomId,
        elements: [],
        appState: {},
        files: {},
        version: 0,
        expressions: [],
        recognitions: [],
        activeUsers: new Map(),
        eventLog: [],
      });
    }

    return this.rooms.get(normalizedRoomId);
  }

  buildScenePayload(room) {
    return {
      elements: this.cloneSerializable(room.elements, []),
      appState: this.cloneSerializable(room.appState, {}),
      files: this.cloneSerializable(room.files, {}),
      version: room.version,
    };
  }

  getRoomUsersPayload(roomId) {
    const room = this.getRoomState(roomId);
    return Array.from(room.activeUsers.entries()).map(([userId, user]) => ({
      roomId: room.roomId,
      userId,
      displayName: user.displayName,
      color: user.color,
      joinedAt: user.joinedAt,
      connectionCount: user.socketIds.size,
      socketIds: Array.from(user.socketIds),
      sessionIds: Array.from(user.sessionIds),
    }));
  }

  emitUsersList(roomId) {
    this.io.to(roomId).emit("users:list", {
      roomId,
      users: this.getRoomUsersPayload(roomId),
    });
  }

  appendEvent(room, actionType, socket, metadata = {}) {
    const record = {
      eventId: uuidv4(),
      roomId: room.roomId,
      userId: socket?.data?.userId || null,
      displayName: socket?.data?.displayName || "Guest",
      actionType,
      strokeId: null,
      timestamp: new Date().toISOString(),
      metadata: this.cloneSerializable(metadata, {}),
    };

    room.eventLog = [...room.eventLog, record].slice(-EVENT_LOG_LIMIT);
    this.io.to(room.roomId).emit("events:created", {
      roomId: room.roomId,
      events: [record],
    });
  }

  registerSocket(socket, payload = {}) {
    const roomId = this.normalizeRoomId(payload.roomId);
    const room = this.getRoomState(roomId);
    const userId = typeof payload.userId === "string" && payload.userId.trim()
      ? payload.userId.trim()
      : `guest_${uuidv4()}`;
    const displayName = typeof payload.displayName === "string" && payload.displayName.trim()
      ? payload.displayName.trim()
      : "Guest";
    const color = typeof payload.color === "string" && payload.color.trim()
      ? payload.color.trim()
      : null;
    const sessionId = typeof payload.sessionId === "string" && payload.sessionId.trim()
      ? payload.sessionId.trim()
      : socket.id;

    const existing = room.activeUsers.get(userId) || {
      displayName,
      color,
      joinedAt: Date.now(),
      socketIds: new Set(),
      sessionIds: new Set(),
    };

    existing.displayName = displayName;
    existing.color = color;
    existing.socketIds.add(socket.id);
    existing.sessionIds.add(sessionId);
    room.activeUsers.set(userId, existing);

    this.socketLinks.set(socket.id, {
      roomId: room.roomId,
      userId,
      sessionId,
    });

    socket.join(room.roomId);
    socket.data.roomId = room.roomId;
    socket.data.userId = userId;
    socket.data.sessionId = sessionId;
    socket.data.displayName = displayName;
    socket.data.color = color;

    return { room, userId, user: existing };
  }

  unregisterSocket(socket) {
    const link = this.socketLinks.get(socket.id);
    if (!link) {
      return null;
    }

    this.socketLinks.delete(socket.id);
    const room = this.rooms.get(link.roomId);
    if (!room) {
      return null;
    }

    const user = room.activeUsers.get(link.userId);
    if (!user) {
      return {
        roomId: room.roomId,
        userId: link.userId,
        displayName: socket.data.displayName || "Guest",
      };
    }

    user.socketIds.delete(socket.id);
    user.sessionIds.delete(link.sessionId);

    if (user.socketIds.size === 0) {
      room.activeUsers.delete(link.userId);
    }

    return {
      roomId: room.roomId,
      userId: link.userId,
      displayName: user.displayName,
      color: user.color,
    };
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`Connected socket ${socket.id}`);

      socket.on("join-room", (payload = {}) => {
        const nextPayload = typeof payload === "string"
          ? { roomId: payload }
          : payload;
        const user = nextPayload?.user && typeof nextPayload.user === "object"
          ? nextPayload.user
          : nextPayload;
        const existing = this.socketLinks.get(socket.id);

        if (existing?.roomId) {
          socket.leave(existing.roomId);
          this.unregisterSocket(socket);
        }

        const { room, userId, user: userEntry } = this.registerSocket(socket, {
          roomId: nextPayload.roomId,
          userId: user?.id || user?.userId,
          displayName: user?.name || user?.displayName,
          color: user?.color,
          sessionId: user?.sessionId,
        });

        socket.emit("scene-init", {
          roomId: room.roomId,
          scene: this.buildScenePayload(room),
        });
        socket.emit("recognition:list", {
          roomId: room.roomId,
          recognitions: room.recognitions,
        });
        socket.emit("events:list", {
          roomId: room.roomId,
          events: room.eventLog,
        });
        this.emitUsersList(room.roomId);
        socket.to(room.roomId).emit("presence-update", {
          type: "join",
          roomId: room.roomId,
          socketId: socket.id,
          user: {
            id: userId,
            name: userEntry.displayName,
            color: userEntry.color,
          },
        });
        this.appendEvent(room, "join", socket, {
          socketId: socket.id,
        });
        debugCollabFlow("socket.join-room", {
          socketId: socket.id,
          roomId: room.roomId,
          userId,
          version: room.version,
          scene: summarizeScenePacket(this.buildScenePayload(room), {
            roomId: room.roomId,
            version: room.version,
          }),
        });

        console.log(`User ${userId} joined room ${room.roomId} on socket ${socket.id}`);
      });

      const handleSceneUpdate = (payload = {}) => {
        const link = this.socketLinks.get(socket.id);
        if (!link) {
          return;
        }

        const room = this.getRoomState(link.roomId);
        const incomingScene = this.sanitizeScene(payload?.scene || payload);
        const clientVersion = Number.isFinite(payload?.scene?.version)
          ? payload.scene.version
          : Number.isFinite(payload?.version)
            ? payload.version
            : null;

        if (clientVersion != null && clientVersion < room.version) {
          debugCollabFlow("socket.scene-update.skip-stale", {
            socketId: socket.id,
            roomId: room.roomId,
            clientVersion,
            roomVersion: room.version,
            incomingScene: summarizeScenePacket(incomingScene, {
              roomId: room.roomId,
              senderId: socket.id,
              version: clientVersion,
            }),
            canonicalScene: summarizeScenePacket(this.buildScenePayload(room), {
              roomId: room.roomId,
              version: room.version,
            }),
          });
          socket.emit("scene-init", {
            roomId: room.roomId,
            scene: this.buildScenePayload(room),
          });
          return;
        }

        room.elements = incomingScene.elements;
        room.appState = incomingScene.appState;
        room.files = incomingScene.files;
        room.version += 1;

        const scene = this.buildScenePayload(room);
        debugCollabFlow("socket.scene-update.accepted", {
          socketId: socket.id,
          roomId: room.roomId,
          nextVersion: room.version,
          incomingScene: summarizeScenePacket(incomingScene, {
            roomId: room.roomId,
            senderId: socket.id,
            version: clientVersion,
          }),
          canonicalScene: summarizeScenePacket(scene, {
            roomId: room.roomId,
            senderId: socket.id,
            version: room.version,
          }),
        });
        this.appendEvent(room, "scene-update", socket, {
          version: room.version,
          elementCount: room.elements.length,
        });

        this.io.to(room.roomId).emit("scene-update", {
          roomId: room.roomId,
          scene,
          senderId: socket.id,
        });
      };

      socket.on("scene-update", handleSceneUpdate);
      socket.on("scene:update", handleSceneUpdate);

      socket.on("recognition:created", (payload = {}) => {
        const roomId = this.normalizeRoomId(socket.data.roomId || payload.roomId);
        const room = this.getRoomState(roomId);
        const latex = typeof payload.latex === "string" ? payload.latex.trim() : "";

        if (!latex) {
          return;
        }

        const recognitionId = typeof payload.recognitionId === "string" && payload.recognitionId.trim()
          ? payload.recognitionId.trim()
          : `${roomId}:${socket.data.userId || socket.id}:${Date.now()}`;

        const recognition = {
          recognitionId,
          roomId,
          userId: socket.data.userId || payload.userId || socket.id,
          displayName: socket.data.displayName || payload.displayName || "Guest",
          color: socket.data.color || payload.color || null,
          latex,
          timestamp: this.normalizeTimestamp(payload.timestamp),
          sceneSignature: typeof payload.sceneSignature === "string" ? payload.sceneSignature : "",
          sessionId: socket.data.sessionId || null,
        };

        const existingIndex = room.recognitions.findIndex((entry) => entry.recognitionId === recognitionId);
        if (existingIndex === -1) {
          room.recognitions.push(recognition);
        } else {
          room.recognitions[existingIndex] = recognition;
        }

        room.recognitions = room.recognitions
          .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
          .slice(-RECOGNITION_LIMIT);

        this.io.to(roomId).emit("recognition:created", recognition);
      });

      socket.on("expression:created", (payload = {}) => {
        const roomId = this.normalizeRoomId(socket.data.roomId || payload.roomId);
        const room = this.getRoomState(roomId);
        const expressionId = typeof payload.expressionId === "string" && payload.expressionId.trim()
          ? payload.expressionId.trim()
          : uuidv4();

        if (room.expressions.some((expression) => expression.expressionId === expressionId)) {
          return;
        }

        const expression = {
          expressionId,
          roomId,
          strokes: Array.isArray(payload.strokes) ? this.cloneSerializable(payload.strokes, []) : [],
          elements: Array.isArray(payload.elements) ? this.cloneSerializable(payload.elements, []) : [],
          previewUrl: typeof payload.previewUrl === "string" ? payload.previewUrl : "",
          userId: socket.data.userId || payload.userId || socket.id,
          displayName: socket.data.displayName || payload.displayName || "Guest",
          color: socket.data.color || payload.color || null,
          timestamp: this.normalizeTimestamp(payload.timestamp),
          sessionId: socket.data.sessionId || null,
          recognizedText: typeof payload.recognizedText === "string" ? payload.recognizedText : "",
        };

        room.expressions.push(expression);
        this.io.to(roomId).emit("expression:created", expression);
      });

      socket.on("expression:updated", (payload = {}) => {
        const roomId = this.normalizeRoomId(socket.data.roomId || payload.roomId);
        const room = this.getRoomState(roomId);
        const expressionId = typeof payload.expressionId === "string" && payload.expressionId.trim()
          ? payload.expressionId.trim()
          : null;

        if (!expressionId) {
          return;
        }

        const index = room.expressions.findIndex((expression) => expression.expressionId === expressionId);
        if (index === -1) {
          return;
        }

        const current = room.expressions[index];
        room.expressions[index] = {
          ...current,
          elements: Array.isArray(payload.elements) ? this.cloneSerializable(payload.elements, current.elements) : current.elements,
          previewUrl: typeof payload.previewUrl === "string" ? payload.previewUrl : current.previewUrl,
          recognizedText: typeof payload.recognizedText === "string" ? payload.recognizedText : current.recognizedText,
          strokes: Array.isArray(payload.strokes) ? this.cloneSerializable(payload.strokes, current.strokes) : current.strokes,
        };

        this.io.to(roomId).emit("expression:updated", room.expressions[index]);
      });

      const handleDisconnect = () => {
        const result = this.unregisterSocket(socket);
        if (!result) {
          return;
        }

        const room = this.getRoomState(result.roomId);
        this.emitUsersList(result.roomId);
        socket.to(result.roomId).emit("presence-update", {
          type: "leave",
          roomId: result.roomId,
          socketId: socket.id,
          user: {
            id: result.userId,
            name: result.displayName,
            color: result.color,
          },
        });
        this.appendEvent(room, "leave", socket, {
          socketId: socket.id,
        });
      };

      socket.on("leave-room", handleDisconnect);
      socket.on("disconnect", handleDisconnect);
    });
  }

  getHistory(roomId = DEFAULT_ROOM_ID) {
    return this.getRoomState(roomId).expressions;
  }

  clearHistory(roomId = DEFAULT_ROOM_ID) {
    const room = this.getRoomState(roomId);
    room.expressions = [];
    room.recognitions = [];
    room.eventLog = [];
    room.elements = [];
    room.appState = {};
    room.files = {};
    room.version = 0;
  }

  getActiveUsers(roomId = DEFAULT_ROOM_ID) {
    return this.getRoomUsersPayload(roomId);
  }

  getEventLog(roomId = DEFAULT_ROOM_ID) {
    return this.getRoomState(roomId).eventLog;
  }
}

export default CollaborationServer;
