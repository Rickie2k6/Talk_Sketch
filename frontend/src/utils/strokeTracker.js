import { v4 as uuidv4 } from "uuid";

/**
 * Stroke Tracker
 * Tracks strokes drawn by users and integrates with collaboration
 */
class StrokeTracker {
  constructor(userId, color, collaborationManager) {
    this.userId = userId;
    this.color = color;
    this.collaborationManager = collaborationManager;
    this.strokes = new Map();
    this.remoteStrokes = new Map();
  }

  /**
   * Track a newly created stroke
   */
  createStroke(points, timestamp = Date.now()) {
    const strokeId = uuidv4();
    const stroke = {
      strokeId,
      userId: this.userId,
      color: this.color,
      points,
      timestamp,
      status: "local", // local | synced | remote
    };

    this.strokes.set(strokeId, stroke);

    // Broadcast to other users via collaboration manager
    if (this.collaborationManager) {
      this.collaborationManager.send("stroke:created", {
        strokeId,
        userId: this.userId,
        points,
        timestamp,
      });
    }

    return stroke;
  }

  /**
   * Receive a remote stroke from another user
   */
  addRemoteStroke(stroke) {
    this.remoteStrokes.set(stroke.strokeId, stroke);
    return stroke;
  }

  /**
   * Get all strokes (local + remote)
   */
  getAllStrokes() {
    return [
      ...Array.from(this.strokes.values()),
      ...Array.from(this.remoteStrokes.values()),
    ];
  }

  /**
   * Get strokes by user
   */
  getStrokesByUser(userId) {
    const all = [
      ...Array.from(this.strokes.values()),
      ...Array.from(this.remoteStrokes.values()),
    ];
    return all.filter((s) => s.userId === userId);
  }

  /**
   * Mark stroke as synced
   */
  markAsSynced(strokeId) {
    if (this.strokes.has(strokeId)) {
      const stroke = this.strokes.get(strokeId);
      stroke.status = "synced";
    }
  }

  /**
   * Clear all strokes
   */
  clear() {
    this.strokes.clear();
    this.remoteStrokes.clear();
  }

  /**
   * Export strokes for history
   */
  export() {
    return {
      userId: this.userId,
      color: this.color,
      strokes: Array.from(this.strokes.values()),
      timestamp: Date.now(),
    };
  }
}

export default StrokeTracker;
