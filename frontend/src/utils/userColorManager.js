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

  /**
   * Assign a random color to a user
   * Ensures no collisions among active users
   * @param {string} userId - Unique user identifier
   * @returns {string} - Assigned color (hex)
   */
  assignColorToUser(userId) {
    // Check if user already has a color
    if (this.userColorMap.has(userId)) {
      return this.userColorMap.get(userId);
    }

    // Find available colors
    const availableColors = COLOR_PALETTE.filter(
      (color) => !this.usedColors.has(color)
    );

    if (availableColors.length === 0) {
      // Fallback: if all colors are used, reuse colors but log warning
      console.warn(
        'All colors in palette exhausted. Reusing colors for new user.'
      );
      // Return a color anyway (with potential visual collision)
      const randomColor =
        COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
      this.userColorMap.set(userId, randomColor);
      return randomColor;
    }

    // Randomly select from available colors
    const selectedColor =
      availableColors[Math.floor(Math.random() * availableColors.length)];

    // Map the color to user
    this.userColorMap.set(userId, selectedColor);
    this.usedColors.add(selectedColor);
    this.colorUsageMap.set(selectedColor, userId);

    return selectedColor;
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
