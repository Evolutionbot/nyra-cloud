/**
 * Memory Store
 *
 * Abstraction layer for memory storage:
 * - In-memory for MVP
 * - PostgreSQL-ready for production
 * - Weaviate vector DB integration ready
 *
 * Stores:
 * - Conversation memories (facts, insights about the user)
 * - Emotional state history
 * - User profile information
 * - Session metadata
 */

const { v4: uuidv4 } = require('uuid');

class MemoryStore {
  constructor() {
    // In-memory storage for MVP
    this.memories = {}; // userId -> array of memories
    this.emotionalHistory = {}; // userId -> array of emotional states
    this.userProfiles = {}; // userId -> profile
    this.sessions = {}; // userId -> array of sessions
  }

  /**
   * Initialize or get user's memory space
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} User's memory space
   */
  async initializeUser(userId) {
    if (!this.memories[userId]) {
      this.memories[userId] = [];
      this.emotionalHistory[userId] = [];
      this.sessions[userId] = [];
      this.userProfiles[userId] = {
        userId,
        createdAt: new Date().toISOString(),
        name: null,
        interests: [],
        keyPatterns: [],
      };
    }

    return {
      userId,
      memoryCount: this.memories[userId].length,
      lastSession: this.sessions[userId][this.sessions[userId].length - 1] || null,
    };
  }

  /**
   * Store a memory
   * @param {string} userId - User identifier
   * @param {Object} memory - Memory object {content, importance, connection, timestamp}
   * @returns {Promise<Object>} Stored memory with ID
   */
  async storeMemory(userId, memory) {
    await this.initializeUser(userId);

    const storedMemory = {
      id: uuidv4(),
      ...memory,
      timestamp: memory.timestamp || new Date().toISOString(),
      vector: null, // Placeholder for vector DB integration
    };

    this.memories[userId].push(storedMemory);

    console.log(`[Memory] Stored for user ${userId}: "${memory.content.substring(0, 50)}..."`);

    return storedMemory;
  }

  /**
   * Retrieve relevant memories for a user
   * @param {string} userId - User identifier
   * @param {number} limit - Maximum memories to return
   * @returns {Promise<Array>} Array of memories
   */
  async retrieveMemories(userId, limit = 5) {
    await this.initializeUser(userId);

    // Return most recent memories (in MVP, no semantic search)
    return this.memories[userId]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Search memories by content
   * @param {string} userId - User identifier
   * @param {string} query - Search query
   * @returns {Promise<Array>} Matching memories
   */
  async searchMemories(userId, query) {
    await this.initializeUser(userId);

    const lowerQuery = query.toLowerCase();
    return this.memories[userId].filter(
      m => m.content.toLowerCase().includes(lowerQuery) ||
           m.connection?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Store emotional state snapshot
   * @param {string} userId - User identifier
   * @param {Object} state - Emotional state {currentMood, patterns, concerns, etc}
   * @returns {Promise<Object>} Stored state with ID
   */
  async storeEmotionalState(userId, state) {
    await this.initializeUser(userId);

    const storedState = {
      id: uuidv4(),
      ...state,
      timestamp: state.timestamp || new Date().toISOString(),
    };

    this.emotionalHistory[userId].push(storedState);

    console.log(`[Emotional State] Updated for user ${userId}: ${state.currentMood}`);

    return storedState;
  }

  /**
   * Get latest emotional state
   * @param {string} userId - User identifier
   * @returns {Promise<Object|null>} Latest emotional state or null
   */
  async getLatestEmotionalState(userId) {
    await this.initializeUser(userId);

    if (this.emotionalHistory[userId].length === 0) {
      return null;
    }

    return this.emotionalHistory[userId][this.emotionalHistory[userId].length - 1];
  }

  /**
   * Get emotional state history
   * @param {string} userId - User identifier
   * @param {number} limit - Number of states to retrieve
   * @returns {Promise<Array>} Emotional state history
   */
  async getEmotionalStateHistory(userId, limit = 10) {
    await this.initializeUser(userId);

    return this.emotionalHistory[userId]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Update user profile
   * @param {string} userId - User identifier
   * @param {Object} profileUpdates - Updates to apply
   * @returns {Promise<Object>} Updated profile
   */
  async updateUserProfile(userId, profileUpdates) {
    await this.initializeUser(userId);

    this.userProfiles[userId] = {
      ...this.userProfiles[userId],
      ...profileUpdates,
      updatedAt: new Date().toISOString(),
    };

    return this.userProfiles[userId];
  }

  /**
   * Get user profile
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} User profile
   */
  async getUserProfile(userId) {
    await this.initializeUser(userId);
    return this.userProfiles[userId];
  }

  /**
   * Start a new session
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Session object
   */
  async startSession(userId) {
    await this.initializeUser(userId);

    const session = {
      id: uuidv4(),
      userId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      messageCount: 0,
      messages: [],
    };

    this.sessions[userId].push(session);

    return session;
  }

  /**
   * End a session and store it
   * @param {string} userId - User identifier
   * @param {string} sessionId - Session identifier
   * @param {Array} messages - Messages from the session
   * @returns {Promise<Object>} Closed session
   */
  async endSession(userId, sessionId, messages = []) {
    await this.initializeUser(userId);

    const sessionIndex = this.sessions[userId].findIndex(s => s.id === sessionId);
    if (sessionIndex !== -1) {
      const session = this.sessions[userId][sessionIndex];
      session.endedAt = new Date().toISOString();
      session.messageCount = messages.length;
      session.messages = messages;

      console.log(`[Session] Ended for user ${userId}: ${messages.length} messages`);
    }

    return this.sessions[userId][sessionIndex] || null;
  }

  /**
   * Get user's last session
   * @param {string} userId - User identifier
   * @returns {Promise<Object|null>} Last session or null
   */
  async getLastSession(userId) {
    await this.initializeUser(userId);

    if (this.sessions[userId].length === 0) {
      return null;
    }

    return this.sessions[userId][this.sessions[userId].length - 1];
  }

  /**
   * Calculate time since last session
   * @param {string} userId - User identifier
   * @returns {Promise<string>} Human-readable time since last session
   */
  async getTimeSinceLastSession(userId) {
    const lastSession = await this.getLastSession(userId);

    if (!lastSession || !lastSession.endedAt) {
      return 'never';
    }

    const lastTime = new Date(lastSession.endedAt);
    const now = new Date();
    const diff = now - lastTime;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
      return 'just now';
    }
  }

  /**
   * Detect if user's behavior has changed
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Behavior change analysis
   */
  async detectBehaviorChange(userId) {
    const emotionalHistory = await this.getEmotionalStateHistory(userId, 5);

    if (emotionalHistory.length < 2) {
      return { hasChanged: false, description: null };
    }

    const latest = emotionalHistory[0];
    const previous = emotionalHistory[1];

    const moodChanged = latest.currentMood !== previous.currentMood;
    const patternsChanged = JSON.stringify(latest.patterns) !== JSON.stringify(previous.patterns);

    return {
      hasChanged: moodChanged || patternsChanged,
      description: moodChanged ? `You seem different than last time` : null,
      moodChange: {
        from: previous.currentMood,
        to: latest.currentMood,
        changed: moodChanged,
      },
    };
  }

  /**
   * Get comprehensive user context for a chat
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Complete user context
   */
  async getUserContext(userId) {
    const profile = await this.getUserProfile(userId);
    const memories = await this.retrieveMemories(userId, 5);
    const emotionalState = await this getLatestEmotionalState(userId);
    const timeSinceLastSession = await this.getTimeSinceLastSession(userId);
    const behaviorChange = await this.detectBehaviorChange(userId);

    return {
      userId,
      profile,
      memories,
      emotionalState,
      timeSinceLastSession,
      behaviorChange,
    };
  }

  /**
   * Clear all data for a user (use with caution)
   * @param {string} userId - User identifier
   * @returns {Promise<void>}
   */
  async clearUserData(userId) {
    delete this.memories[userId];
    delete this.emotionalHistory[userId];
    delete this.sessions[userId];
    delete this.userProfiles[userId];

    console.log(`[Memory] Cleared all data for user ${userId}`);
  }

  /**
   * Get statistics for debugging/monitoring
   * @returns {Object} Store statistics
   */
  getStats() {
    const userCount = Object.keys(this.memories).length;
    const totalMemories = Object.values(this.memories).reduce((sum, m) => sum + m.length, 0);
    const totalEmotionalSnapshots = Object.values(this.emotionalHistory).reduce((sum, h) => sum + h.length, 0);

    return {
      userCount,
      totalMemories,
      totalEmotionalSnapshots,
      backend: 'memory',
    };
  }
}

module.exports = MemoryStore;
