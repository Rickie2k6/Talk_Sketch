/**
 * Collaboration Server
 * Handles WebSocket connections and multi-user coordination
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

class CollaborationServer {
  constructor(httpServer) {
    this.httpServer = httpServer;
    this.wss = new WebSocket.Server({ server: httpServer });
    this.sessions = new Map(); // sessionId -> sessionData
    this.clients = new Map(); // clientId -> clientData
    this.sessionUsers = new Map(); // sessionId -> Set of userIds
    this.userColors = new Map(); // userId -> color
    this.strokes = new Map(); // elementId -> strokeData

    this.setupWebSocketHandlers();
  }

  setupWebSocketHandlers() {
    this.wss.on('connection', (ws) => {
      const clientId = randomUUID();
      console.log(`New client connected: ${clientId}`);

      this.clients.set(clientId, {
        ws,
        userId: null,
        sessionId: null,
        connectedAt: Date.now(),
      });

      ws.on('message', (data) => {
        this.handleClientMessage(clientId, data);
      });

      ws.on('close', () => {
        this.handleClientDisconnect(clientId);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for ${clientId}:`, error);
      });
    });
  }

  handleClientMessage(clientId, data) {
    try {
      const message = JSON.parse(data.toString());
      const { type, payload, userId, sessionId } = message;

      const client = this.clients.get(clientId);
      if (!client) return;

      // Update client info
      if (userId) client.userId = userId;
      if (sessionId) client.sessionId = sessionId;

      switch (type) {
        case 'user:join':
          this.handleUserJoin(clientId, payload);
          break;
        case 'user:leave':
          this.handleUserLeave(clientId, payload);
          break;
        case 'stroke:created':
          this.handleStrokeCreated(clientId, payload);
          break;
        case 'stroke:modified':
          this.handleStrokeModified(clientId, payload);
          break;
        case 'stroke:deleted':
          this.handleStrokeDeleted(clientId, payload);
          break;
        case 'cursor:move':
          this.broadcastCursorPosition(clientId, payload);
          break;
        case 'presence:update':
          this.handlePresenceUpdate(clientId, payload);
          break;
        case 'request:fullState':
          this.sendFullState(clientId);
          break;
        case 'session:metadata':
          this.updateSessionMetadata(clientId, payload);
          break;
        default:
          console.warn(`Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error('Error handling client message:', error);
    }
  }

  handleUserJoin(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { userId, sessionId } = payload;
    const session = this.getOrCreateSession(sessionId);

    // Assign color to user if not already assigned
    if (!this.userColors.has(userId)) {
      const color = this.assignUserColor(userId);
      console.log(`Assigned color ${color} to user ${userId}`);
    }

    // Add user to session
    if (!this.sessionUsers.has(sessionId)) {
      this.sessionUsers.set(sessionId, new Set());
    }
    this.sessionUsers.get(sessionId).add(userId);

    const color = this.userColors.get(userId);

    // Notify all clients in session about new user
    this.broadcastToSession(sessionId, {
      type: 'user:joined',
      payload: {
        userId,
        color,
        joinedAt: Date.now(),
      },
    });

    console.log(`User ${userId} joined session ${sessionId}`);
  }

  handleUserLeave(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { userId, sessionId } = payload;

    // Remove user from session
    if (this.sessionUsers.has(sessionId)) {
      this.sessionUsers.get(sessionId).delete(userId);
    }

    // Notify other clients
    this.broadcastToSession(sessionId, {
      type: 'user:left',
      payload: {
        userId,
        leftAt: Date.now(),
      },
    });

    console.log(`User ${userId} left session ${sessionId}`);
  }

  handleStrokeCreated(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) return;

    const { elementId, userId, color, timestamp } = payload;

    // Store stroke metadata
    this.strokes.set(elementId, {
      elementId,
      userId,
      color,
      timestamp,
      sessionId: client.sessionId,
    });

    // Broadcast to all clients in session
    this.broadcastToSession(client.sessionId, {
      type: 'stroke:created',
      payload,
    });

    console.log(`Stroke ${elementId} created by ${userId}`);
  }

  handleStrokeModified(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) return;

    const { elementId } = payload;

    // Update stroke
    if (this.strokes.has(elementId)) {
      const stroke = this.strokes.get(elementId);
      stroke.lastModified = Date.now();
      stroke.lastModifiedBy = client.userId;
    }

    // Broadcast to all clients
    this.broadcastToSession(client.sessionId, {
      type: 'stroke:modified',
      payload,
    });

    console.log(`Stroke ${elementId} modified by ${client.userId}`);
  }

  handleStrokeDeleted(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) return;

    const { elementId } = payload;

    // Mark stroke as deleted
    if (this.strokes.has(elementId)) {
      const stroke = this.strokes.get(elementId);
      stroke.deleted = true;
      stroke.deletedAt = Date.now();
      stroke.deletedBy = client.userId;
    }

    // Broadcast to all clients
    this.broadcastToSession(client.sessionId, {
      type: 'stroke:deleted',
      payload,
    });

    console.log(`Stroke ${elementId} deleted by ${client.userId}`);
  }

  broadcastCursorPosition(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) return;

    // Broadcast cursor position to all other clients in session
    this.broadcastToSession(
      client.sessionId,
      {
        type: 'cursor:moved',
        payload: {
          userId: client.userId,
          ...payload,
        },
      },
      clientId // exclude sender
    );
  }

  handlePresenceUpdate(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) return;

    this.broadcastToSession(
      client.sessionId,
      {
        type: 'presence:updated',
        payload: {
          userId: client.userId,
          ...payload,
        },
      },
      clientId // exclude sender
    );
  }

  sendFullState(clientId) {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) return;

    const sessionId = client.sessionId;
    const sessionUsers = this.sessionUsers.get(sessionId) || new Set();
    const userColors = new Map();

    // Collect user colors
    for (const userId of sessionUsers) {
      userColors.set(userId, this.userColors.get(userId));
    }

    // Get strokes for this session
    const sessionStrokes = Array.from(this.strokes.values()).filter(
      (stroke) => stroke.sessionId === sessionId
    );

    // Send full state
    const fullState = {
      type: 'fullState',
      payload: {
        users: Array.from(sessionUsers),
        userColors: Object.fromEntries(userColors),
        strokes: sessionStrokes,
        timestamp: Date.now(),
      },
    };

    this.sendToClient(clientId, fullState);
  }

  updateSessionMetadata(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) return;

    const session = this.sessions.get(client.sessionId);
    if (session) {
      session.metadata = { ...session.metadata, ...payload };
    }
  }

  assignUserColor(userId) {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
      '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B88B', '#A9D6E5',
      '#EAA29B', '#B4E7E7', '#FFB6B9', '#8FD14F', '#FF9999',
      '#FFEAA7',
    ];

    const usedColors = new Set(this.userColors.values());
    const availableColors = colors.filter((c) => !usedColors.has(c));

    const color =
      availableColors.length > 0
        ? availableColors[Math.floor(Math.random() * availableColors.length)]
        : colors[Math.floor(Math.random() * colors.length)];

    this.userColors.set(userId, color);
    return color;
  }

  getOrCreateSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: Date.now(),
        metadata: {},
      });
    }
    return this.sessions.get(sessionId);
  }

  broadcastToSession(sessionId, message, excludeClientId = null) {
    for (const [clientId, client] of this.clients.entries()) {
      if (
        client.sessionId === sessionId &&
        client.ws.readyState === WebSocket.OPEN &&
        clientId !== excludeClientId
      ) {
        this.sendToClient(clientId, message);
      }
    }
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  handleClientDisconnect(clientId) {
    const client = this.clients.get(clientId);
    if (client && client.userId && client.sessionId) {
      this.broadcastToSession(client.sessionId, {
        type: 'user:left',
        payload: {
          userId: client.userId,
          leftAt: Date.now(),
        },
      });
      console.log(`User ${client.userId} disconnected from session ${client.sessionId}`);
    }

    this.clients.delete(clientId);
    console.log(`Client ${clientId} disconnected`);
  }

  getSessionStats(sessionId) {
    const users = this.sessionUsers.get(sessionId) || new Set();
    const sessionStrokes = Array.from(this.strokes.values()).filter(
      (stroke) => stroke.sessionId === sessionId
    );

    return {
      sessionId,
      activeUsers: users.size,
      totalStrokes: sessionStrokes.length,
      connectedAt: this.sessions.get(sessionId)?.createdAt,
    };
  }
}

export default CollaborationServer;
