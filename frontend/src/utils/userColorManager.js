/**
 * User Color Manager
 * Manages unique color assignments for users with collision avoidance
 */

// Constrained color palette for user attribution
// Colors are chosen for visual differentiation and accessibility
const COLOR_PALETTE = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#FFA07A', // Light Salmon
  '#98D8C8', // Mint
  '#F7DC6F', // Yellow
  '#BB8FCE', // Purple
  '#85C1E2', // Light Blue
  '#F8B88B', // Peach
  '#A9D6E5', // Powder Blue
  '#EAA29B', // Dusty Rose
  '#B4E7E7', // Aquamarine
  '#FFB6B9', // Light Red
  '#8FD14F', // Green
  '#FF9999', // Salmon
  '#FFEAA7', // Light Yellow
];

class UserColorManager {
  constructor() {
    this.userColorMap = new Map(); // userId -> color
    this.colorUsageMap = new Map(); // color -> userId
    this.usedColors = new Set();
  }

  getDeterministicColor(userId) {
    const input = String(userId || "");
    let hash = 0;

    for (let index = 0; index < input.length; index += 1) {
      hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
    }

    return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
  }

  assignColorToUser(userId) {
    if (this.userColorMap.has(userId)) {
      return this.userColorMap.get(userId);
    }

    const selectedColor = this.getDeterministicColor(userId);
    this.userColorMap.set(userId, selectedColor);
    this.usedColors.add(selectedColor);
    this.colorUsageMap.set(selectedColor, userId);

    return selectedColor;
  }

  setColorForUser(userId, color) {
    if (!userId || !color) {
      return null;
    }

    const previousColor = this.userColorMap.get(userId);
    if (previousColor && previousColor !== color) {
      this.usedColors.delete(previousColor);
      this.colorUsageMap.delete(previousColor);
    }

    this.userColorMap.set(userId, color);
    this.usedColors.add(color);
    this.colorUsageMap.set(color, userId);
    return color;
  }

  /**
   * Get color for a user
   * @param {string} userId - User identifier
   * @returns {string|null} - User's assigned color or null if not assigned
   */
  getColorForUser(userId) {
    return this.userColorMap.get(userId) || null;
  }

  /**
   * Get user ID for a given color
   * @param {string} color - Hex color
   * @returns {string|null} - User ID or null
   */
  getUserForColor(color) {
    return this.colorUsageMap.get(color) || null;
  }

  /**
   * Remove user and free up their color
   * @param {string} userId - User to remove
   */
  removeUser(userId) {
    const color = this.userColorMap.get(userId);
    if (color) {
      this.userColorMap.delete(userId);
      this.usedColors.delete(color);
      this.colorUsageMap.delete(color);
    }
  }

  /**
   * Get all active users and their colors
   * @returns {Map} - Map of userId -> color
   */
  getAllUserColors() {
    return new Map(this.userColorMap);
  }

  /**
   * Get list of active users
   * @returns {string[]} - Array of user IDs
   */
  getActiveUsers() {
    return Array.from(this.userColorMap.keys());
  }

  /**
   * Get available colors count
   * @returns {number}
   */
  getAvailableColorsCount() {
    return COLOR_PALETTE.length - this.usedColors.size;
  }

  /**
   * Reset all user-color mappings
   */
  reset() {
    this.userColorMap.clear();
    this.colorUsageMap.clear();
    this.usedColors.clear();
  }

  /**
   * Get the color palette
   * @returns {string[]}
   */
  getPalette() {
    return [...COLOR_PALETTE];
  }
}

export default UserColorManager;
