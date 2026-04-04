/**
 * Collaboration Manager
 * Handles real-time multi-user coordination via WebSockets
 */

class CollaborationManager {
  constructor(userId) {
    this.userId = userId;
    this.ws = null;
    this.isConnected = false;
    this.activeUsers = new Map(); // userId -> { name, color, lastUpdate }
    this.messageHandlers = new Map(); // eventType -> callbacks
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
  }

  /**
   * Connect to collaboration server
   * @param {string} serverUrl - WebSocket server URL
   * @returns {Promise<void>}
   */
  connect(serverUrl) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log('Connected to collaboration server');
          this.isConnected = true;
          this.reconnectAttempts = 0;

          // Send join message
          this.send('user:join', {
            userId: this.userId,
            joinedAt: Date.now(),
          });

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('Disconnected from collaboration server');
          this.isConnected = false;
          this.attemptReconnect(serverUrl);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming messages
   * @param {string} data - JSON message
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      const { type, payload } = message;

      // Handle user join/leave
      if (type === 'user:joined') {
        this.activeUsers.set(payload.userId, {
          name: payload.name,
          color: payload.color,
          lastUpdate: Date.now(),
        });
        this.emit('userJoined', payload);
        return;
      }

      if (type === 'user:left') {
        this.activeUsers.delete(payload.userId);
        this.emit('userLeft', payload);
        return;
      }

      // Route to handlers
      const handlers = this.messageHandlers.get(type) || [];
      handlers.forEach((handler) => handler(payload));

      this.emit(`message:${type}`, payload);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  /**
   * Send message to server
   * @param {string} type - Message type
   * @param {object} payload - Message data
   */
  send(type, payload) {
    if (!this.isConnected || !this.ws) {
      console.warn('Not connected to collaboration server');
      return;
    }

    try {
      this.ws.send(
        JSON.stringify({
          type,
          payload,
          timestamp: Date.now(),
          userId: this.userId,
        })
      );
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  /**
   * Broadcast stroke creation
   * @param {object} stroke - Stroke metadata
   */
  broadcastStrokeCreated(stroke) {
    this.send('stroke:created', stroke);
  }

  /**
   * Broadcast stroke modification
   * @param {object} stroke - Updated stroke metadata
   */
  broadcastStrokeModified(stroke) {
    this.send('stroke:modified', stroke);
  }

  /**
   * Broadcast stroke deletion
   * @param {string} elementId - Deleted element ID
   */
  broadcastStrokeDeleted(elementId) {
    this.send('stroke:deleted', { elementId });
  }

  /**
   * Broadcast cursor position for live collaboration
   * @param {object} position - { x, y }
   */
  broadcastCursorPosition(position) {
    this.send('cursor:move', position);
  }

  /**
   * Broadcast remote pointer/presence
   * @param {object} presence - User presence data
   */
  broadcastPresence(presence) {
    this.send('presence:update', presence);
  }

  /**
   * Register message handler
   * @param {string} type - Message type
   * @param {function} callback
   */
  onMessage(type, callback) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type).push(callback);
  }

  /**
   * Remove message handler
   * @param {string} type
   * @param {function} callback
   */
  offMessage(type, callback) {
    if (this.messageHandlers.has(type)) {
      const handlers = this.messageHandlers.get(type);
      const index = handlers.indexOf(callback);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit local event
   * @param {string} eventName
   * @param {object} data
   */
  emit(eventName, data) {
    // Can be integrated with event emitter library
    const event = new CustomEvent(eventName, { detail: data });
    window.dispatchEvent(event);
  }

  /**
   * Get active users
   * @returns {Map}
   */
  getActiveUsers() {
    return new Map(this.activeUsers);
  }

  /**
   * Get user count
   * @returns {number}
   */
  getActiveUserCount() {
    return this.activeUsers.size;
  }

  /**
   * Attempt to reconnect
   * @param {string} serverUrl
   */
  attemptReconnect(serverUrl) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('connectionFailed', {
        reason: 'max_reconnect_attempts',
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect(serverUrl).catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.ws) {
      this.send('user:leave', { userId: this.userId });
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.activeUsers.clear();
  }

  /**
   * Request full state from server
   */
  requestFullState() {
    this.send('request:fullState', {});
  }

  /**
   * Update session metadata
   * @param {object} metadata
   */
  updateSessionMetadata(metadata) {
    this.send('session:metadata', metadata);
  }
}

export default CollaborationManager;
