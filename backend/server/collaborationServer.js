import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

const COLOR_PALETTE = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#F7DC6F",
  "#BB8FCE", "#85C1E2", "#F8B88B", "#A9D6E5", "#EAA29B", "#B4E7E7",
  "#FFB6B9", "#8FD14F", "#FF9999", "#FFEAA7",
];

class CollaborationServer {
  constructor(httpServer) {
    this.io = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] },
    });
    this.users = new Map();
    this.socketToUser = new Map();
    this.usedColors = new Set();
    this.strokes = new Map();
    this.expressions = [];
    this.setupSocketHandlers();
  }

  assignColor(userId) {
    if (this.users.has(userId)) {
      return this.users.get(userId).color;
    }

    const available = COLOR_PALETTE.filter((color) => !this.usedColors.has(color));
    const color = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];

    this.usedColors.add(color);
    return color;
  }

  getActiveUsersPayload() {
    return Array.from(this.users.entries()).map(([userId, data]) => ({
      userId,
      color: data.color,
      joinedAt: data.joinedAt,
      connectionCount: data.socketIds.size,
      socketIds: Array.from(data.socketIds),
      sessionIds: Array.from(data.sessionIds),
    }));
  }

  registerSocket(userId, socket, sessionId) {
    const existing = this.users.get(userId);
    const user = existing || {
      color: this.assignColor(userId),
      joinedAt: Date.now(),
      socketIds: new Set(),
      sessionIds: new Set(),
    };

    user.socketIds.add(socket.id);
    if (sessionId) {
      user.sessionIds.add(sessionId);
    }

    this.users.set(userId, user);
    this.socketToUser.set(socket.id, { userId, sessionId: sessionId || null });
    socket.data.userId = userId;
    socket.data.sessionId = sessionId || null;

    return user;
  }

  unregisterSocket(socket) {
    const link = this.socketToUser.get(socket.id);
    if (!link) {
      return null;
    }

    const user = this.users.get(link.userId);
    this.socketToUser.delete(socket.id);

    if (!user) {
      return { userId: link.userId, userRemoved: false, remainingConnections: 0 };
    }

    user.socketIds.delete(socket.id);
    if (link.sessionId) {
      user.sessionIds.delete(link.sessionId);
    }

    const remainingConnections = user.socketIds.size;
    if (remainingConnections === 0) {
      this.users.delete(link.userId);
      this.usedColors.delete(user.color);
      return { userId: link.userId, userRemoved: true, remainingConnections: 0 };
    }

    return { userId: link.userId, userRemoved: false, remainingConnections };
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`Connected socket ${socket.id}`);

      socket.on("user:join", (payload = {}) => {
        const incomingUserId = typeof payload.userId === "string" && payload.userId.trim()
          ? payload.userId.trim()
          : uuidv4();
        const sessionId = typeof payload.sessionId === "string" && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : socket.id;

        const user = this.registerSocket(incomingUserId, socket, sessionId);
        const activeUsers = this.getActiveUsersPayload();

        socket.emit("users:list", { users: activeUsers });
        socket.emit("strokes:sync", { strokes: Array.from(this.strokes.values()) });
        this.io.emit("user:joined", {
          userId: incomingUserId,
          color: user.color,
          socketId: socket.id,
          sessionId,
          connectionCount: user.socketIds.size,
        });

        console.log(
          `User ${incomingUserId} connected on socket ${socket.id} (${user.socketIds.size} active connection(s))`,
        );
      });

      const handleStroke = (payload = {}) => {
        const userId = socket.data.userId || payload.userId;
        const userData = userId ? this.users.get(userId) : null;
        if (!userId || !userData) {
          return;
        }

        const strokeId = typeof payload.strokeId === "string" && payload.strokeId.trim()
          ? payload.strokeId.trim()
          : uuidv4();
        const timestamp = Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now();
        const stroke = {
          ...payload,
          strokeId,
          userId,
          color: userData.color,
          timestamp,
          version: Number.isFinite(payload.version) ? payload.version : 1,
          socketId: socket.id,
          sessionId: socket.data.sessionId || null,
        };

        const existing = this.strokes.get(strokeId);
        const existingVersion = Number.isFinite(existing?.version) ? existing.version : 0;
        if (existing && stroke.version < existingVersion) {
          return;
        }

        this.strokes.set(strokeId, stroke);
        this.io.emit("stroke", stroke);
        console.log(`Broadcast stroke ${strokeId} from ${userId} on socket ${socket.id}`);
      };

      socket.on("stroke", handleStroke);
      socket.on("stroke:created", handleStroke);

      socket.on("expression:created", (payload = {}) => {
        const userId = socket.data.userId || payload.userId;
        const userData = userId ? this.users.get(userId) : null;
        if (!userId || !userData) {
          return;
        }

        const expressionId = typeof payload.expressionId === "string" && payload.expressionId.trim()
          ? payload.expressionId.trim()
          : uuidv4();

        if (this.expressions.some((expression) => expression.expressionId === expressionId)) {
          return;
        }

        const expression = {
          expressionId,
          strokes: Array.isArray(payload.strokes) ? payload.strokes : [],
          userId,
          color: userData.color,
          timestamp: Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now(),
          sessionId: socket.data.sessionId || null,
        };

        this.expressions.push(expression);
        this.io.emit("expression:created", expression);
        console.log(`Broadcast expression ${expressionId} from ${userId} (${expression.strokes.length} stroke(s))`);
      });

      socket.on("user:leave", () => {
        const result = this.unregisterSocket(socket);
        if (!result) {
          return;
        }

        if (result.userRemoved) {
          this.io.emit("user:left", { userId: result.userId });
          console.log(`User ${result.userId} left (last socket closed)`);
          return;
        }

        const user = this.users.get(result.userId);
        if (user) {
          this.io.emit("user:updated", {
            userId: result.userId,
            color: user.color,
            connectionCount: result.remainingConnections,
          });
        }

        console.log(
          `Socket ${socket.id} left user ${result.userId}; ${result.remainingConnections} connection(s) remain`,
        );
      });

      socket.on("disconnect", () => {
        const result = this.unregisterSocket(socket);
        if (!result) {
          return;
        }

        if (result.userRemoved) {
          this.io.emit("user:left", { userId: result.userId });
          console.log(`User ${result.userId} disconnected (no sockets remaining)`);
          return;
        }

        const user = this.users.get(result.userId);
        if (user) {
          this.io.emit("user:updated", {
            userId: result.userId,
            color: user.color,
            connectionCount: result.remainingConnections,
          });
        }

        console.log(
          `Socket ${socket.id} disconnected for user ${result.userId}; ${result.remainingConnections} connection(s) remain`,
        );
      });
    });
  }

  getHistory() {
    return this.expressions;
  }

  clearHistory() {
    this.expressions = [];
  }

  getActiveUsers() {
    return this.getActiveUsersPayload();
  }
}

export default CollaborationServer;
