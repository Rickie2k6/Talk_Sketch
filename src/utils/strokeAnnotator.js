/**
 * Stroke Tracker & Annotator
 * Tracks all strokes with user identity, color, and provenance information
 */

class StrokeAnnotator {
  constructor() {
    this.strokes = new Map(); // elementId -> stroke metadata
    this.elementIdToUserId = new Map(); // elementId -> userId
    this.userStrokes = new Map(); // userId -> Set of elementIds
    this.strokeHistory = []; // Complete history of all strokes
  }

  /**
   * Create stroke annotation
   * @param {string} elementId - Excalidraw element ID
   * @param {string} userId - User creating the stroke
   * @param {string} color - User's assigned color
   * @param {number} timestamp - When stroke was created
   * @returns {object} - Stroke metadata
   */
  annotateStroke(elementId, userId, color, timestamp = Date.now()) {
    const strokeMetadata = {
      elementId,
      userId,
      color,
      timestamp,
      created: new Date(timestamp).toISOString(),
    };

    this.strokes.set(elementId, strokeMetadata);
    this.elementIdToUserId.set(elementId, userId);

    // Track strokes by user
    if (!this.userStrokes.has(userId)) {
      this.userStrokes.set(userId, new Set());
    }
    this.userStrokes.get(userId).add(elementId);

    // Add to history
    this.strokeHistory.push({ ...strokeMetadata, action: 'created' });

    return strokeMetadata;
  }

  /**
   * Get stroke metadata
   * @param {string} elementId
   * @returns {object|null}
   */
  getStrokeMetadata(elementId) {
    return this.strokes.get(elementId) || null;
  }

  /**
   * Get user who created a stroke
   * @param {string} elementId
   * @returns {string|null}
   */
  getStrokeCreator(elementId) {
    return this.elementIdToUserId.get(elementId) || null;
  }

  /**
   * Get all strokes by a user
   * @param {string} userId
   * @returns {string[]} - Array of element IDs
   */
  getStrokesByUser(userId) {
    const strokes = this.userStrokes.get(userId);
    return strokes ? Array.from(strokes) : [];
  }

  /**
   * Mark stroke as modified/updated
   * @param {string} elementId
   * @param {string} userId - User who modified
   * @param {number} timestamp
   */
  markStrokeModified(elementId, userId, timestamp = Date.now()) {
    const metadata = this.strokes.get(elementId);
    if (metadata) {
      metadata.lastModified = timestamp;
      metadata.lastModifiedBy = userId;
      metadata.lastModifiedAt = new Date(timestamp).toISOString();

      this.strokeHistory.push({
        ...metadata,
        action: 'modified',
        modifiedBy: userId,
      });
    }
  }

  /**
   * Mark stroke as deleted
   * @param {string} elementId
   * @param {string} userId - User who deleted
   * @param {number} timestamp
   */
  markStrokeDeleted(elementId, userId, timestamp = Date.now()) {
    const metadata = this.strokes.get(elementId);
    if (metadata) {
      metadata.deletedAt = timestamp;
      metadata.deletedBy = userId;
      metadata.deleted = true;

      this.strokeHistory.push({
        ...metadata,
        action: 'deleted',
        deletedBy: userId,
      });

      // Remove from active tracking
      if (this.userStrokes.has(metadata.userId)) {
        this.userStrokes.get(metadata.userId).delete(elementId);
      }
    }
  }

  /**
   * Get complete stroke history
   * @returns {array}
   */
  getHistory() {
    return [...this.strokeHistory];
  }

  /**
   * Get history filtered by user
   * @param {string} userId
   * @returns {array}
   */
  getHistoryForUser(userId) {
    return this.strokeHistory.filter((entry) => entry.userId === userId);
  }

  /**
   * Get statistics
   * @returns {object}
   */
  getStatistics() {
    const stats = {
      totalStrokes: this.strokes.size,
      totalHistoryEvents: this.strokeHistory.length,
      strokesByUser: {},
    };

    for (const [userId, strokes] of this.userStrokes.entries()) {
      stats.strokesByUser[userId] = strokes.size;
    }

    return stats;
  }

  /**
   * Export stroke data for persistence
   * @returns {object}
   */
  exportData() {
    return {
      strokes: Array.from(this.strokes.entries()),
      elementIdToUserId: Array.from(this.elementIdToUserId.entries()),
      history: this.strokeHistory,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Import stroke data for restoration
   * @param {object} data
   */
  importData(data) {
    if (data.strokes) {
      this.strokes = new Map(data.strokes);
    }
    if (data.elementIdToUserId) {
      this.elementIdToUserId = new Map(data.elementIdToUserId);
    }
    if (data.history) {
      this.strokeHistory = [...data.history];
    }
  }

  /**
   * Clear all data
   */
  reset() {
    this.strokes.clear();
    this.elementIdToUserId.clear();
    this.userStrokes.clear();
    this.strokeHistory = [];
  }

  /**
   * Get all active element IDs (not deleted)
   * @returns {string[]}
   */
  getActiveElements() {
    return Array.from(this.strokes.entries())
      .filter(([_, metadata]) => !metadata.deleted)
      .map(([elementId, _]) => elementId);
  }
}

export default StrokeAnnotator;
