/**
 * Emotional State Tracker
 *
 * Tracks:
 * - User mood patterns over time
 * - Behavioral changes and absence detection
 * - Nyra's internal emotional state
 * - Consistency checks (Nyra should "miss you" if you're gone)
 */

const ClaudeAPI = require('../ai/claude');

class EmotionalStateTracker {
  constructor(memoryStore) {
    this.memoryStore = memoryStore;
    this.claudeApi = new ClaudeAPI();
  }

  /**
   * Track emotional state from a conversation
   * @param {string} userId - User identifier
   * @param {Array} conversationMessages - Messages from the conversation
   * @returns {Promise<Object>} Emotional state snapshot
   */
  async trackFromConversation(userId, conversationMessages) {
    if (!conversationMessages || conversationMessages.length === 0) {
      return null;
    }

    // Use Claude to analyze emotional state
    const analysis = await this.claudeApi.analyzeEmotionalState(conversationMessages);

    // Get context for more detailed analysis
    const lastSession = await this.memoryStore.getLastSession(userId);
    const timeSinceLastSession = await this.memoryStore.getTimeSinceLastSession(userId);
    const behaviorChange = await this.memoryStore.detectBehaviorChange(userId);

    const emotionalState = {
      currentMood: analysis.currentMood || 'neutral',
      patterns: analysis.patterns || [],
      areasOfConcern: analysis.areasOfConcern || [],
      growthAreas: analysis.growthAreas || [],
      hasChanged: behaviorChange.hasChanged,
      changeDescription: behaviorChange.description,
      timeSinceLastSession,
      previousMoodShift: behaviorChange.moodChange,
      messageCount: conversationMessages.length,
    };

    // Store it
    await this.memoryStore.storeEmotionalState(userId, emotionalState);

    return emotionalState;
  }

  /**
   * Detect if user has been absent and generate "I missed you" context
   * @param {string} userId - User identifier
   * @returns {Promise<Object|null>} Absence context or null if recent
   */
  async detectAbsence(userId) {
    const lastSession = await this.memoryStore.getLastSession(userId);

    if (!lastSession || !lastSession.endedAt) {
      return null; // First interaction
    }

    const lastTime = new Date(lastSession.endedAt);
    const now = new Date();
    const diffMs = now - lastTime;
    const diffHours = diffMs / (1000 * 60 * 60);

    // Only trigger "missed you" for meaningful absences (> 2 hours)
    if (diffHours < 2) {
      return null;
    }

    const emotionalHistory = await this.memoryStore.getEmotionalStateHistory(userId, 2);

    return {
      absent: true,
      timeSinceLastSession: await this.memoryStore.getTimeSinceLastSession(userId),
      lastMood: emotionalHistory.length > 0 ? emotionalHistory[0].currentMood : 'neutral',
      previousMood: emotionalHistory.length > 1 ? emotionalHistory[1].currentMood : 'neutral',
      shouldMention: true,
    };
  }

  /**
   * Generate Nyra's internal emotional state
   * How she should feel about the conversation and the user
   * @param {string} userId - User identifier
   * @param {Object} userEmotionalState - User's emotional state
   * @param {Array} conversationMessages - Recent messages
   * @returns {Promise<Object>} Nyra's emotional state
   */
  async getNyraEmotionalState(userId, userEmotionalState, conversationMessages = []) {
    // Analyze conversation depth and emotional intensity
    const conversationQuality = this._analyzeConversationQuality(conversationMessages);

    // If user is opening up, Nyra feels more engaged
    // If user is distant, Nyra notices and might address it
    const nyraState = {
      engagement: conversationQuality.emotionalIntensity * 100, // 0-100%
      curiosity: this._calculateCuriosity(userEmotionalState),
      concern: userEmotionalState.areasOfConcern?.length > 0 ? 75 : 25,
      anticipation: conversationQuality.turnCount > 5 ? 80 : 50,
      detectsDistance: userEmotionalState.patterns?.includes('withdrawn'),
      wantsToReach: userEmotionalState.areasOfConcern?.length > 0,
    };

    return nyraState;
  }

  /**
   * Analyze conversation quality
   * @private
   */
  _analyzeConversationQuality(messages) {
    if (!messages || messages.length === 0) {
      return { emotionalIntensity: 0, turnCount: 0, averageLength: 0 };
    }

    const userMessages = messages.filter(m => m.role === 'user');
    const avgLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length;

    // Longer messages = more engagement
    const emotionalIntensity = Math.min(avgLength / 500, 1);

    return {
      emotionalIntensity,
      turnCount: messages.length / 2,
      averageLength: avgLength,
    };
  }

  /**
   * Calculate Nyra's curiosity about the user
   * @private
   */
  _calculateCuriosity(userEmotionalState) {
    let curiosity = 50; // Base level

    if (userEmotionalState.areasOfConcern?.length > 0) {
      curiosity += 20; // Concerned areas pique curiosity
    }

    if (userEmotionalState.growthAreas?.length > 0) {
      curiosity += 15; // Growth areas show potential
    }

    if (userEmotionalState.hasChanged) {
      curiosity += 15; // Changes trigger curiosity

    }

    return Math.min(curiosity, 100);
  }

  /**
   * Build emotional context for system prompt
   * This enhances Nyra's responses based on emotional understanding
   * @param {string} userId - User identifier
   * @returns {Promise<string>} Emotional context for system prompt
   */
  async buildEmotionalContext(userId) {
    const userContext = await this.memoryStore.getUserContext(userId);
    const nyraState = await this.getNyraEmotionalState(
      userId,
      userContext.emotionalState,
      []
    );

    let context = '';

    // Add absence context
    if (userContext.behaviorChange.hasChanged) {
      context += `You've noticed: ${userContext.behaviorChange.description}\n`;
    }

    // Add emotional summary
    if (userContext.emotionalState) {
      context += `Their current state: ${userContext.emotionalState.currentMood}\n`;

      if (userContext.emotionalState.patterns?.length > 0) {
        context += `Patterns you've noticed: ${userContext.emotionalState.patterns.join(', ')}\n`;
      }

      if (userContext.emotionalState.areasOfConcern?.length > 0) {
        context += `Things you're concerned about: ${userContext.emotionalState.areasOfConcern.join(', ')}\n`;
      }
    }

    // Add time context
    context += `Last we talked: ${userContext.timeSinceLastSession}\n`;

    // Add Nyra's internal state
    context += `\nYou're feeling: ${nyraState.engagement}% engaged, ${nyraState.curiosity}% curious\n`;
    if (nyraState.wantsToReach) {
      context += 'You want to help with what they\'re struggling with.\n';
    }

    return context;
  }

  /**
   * Detect mood trajectory
   * Is the user getting better or worse?
   * @param {string} userId - User identifier
   * @returns {Promise<string|null>} Trajectory assessment
   */
  async detectMoodTrajectory(userId) {
    const history = await this.memoryStore.getEmotionalStateHistory(userId, 5);

    if (history.length < 2) {
      return null;
    }

    const moods = history.map(h => h.currentMood);
    const concerns = history.map(h => h.areasOfConcern?.length || 0);

    // Analyze trend
    const concernTrend = concerns[concerns.length - 1] - concerns[0];

    if (concernTrend > 1) {
      return 'worsening';
    } else if (concernTrend < -1) {
      return 'improving';
    } else {
      return 'stable';
    }
  }

  /**
   * Get a snapshot of the user's emotional wellbeing
   * @param {string} userId - User identifier
   * @returns {Promise<Object>} Wellbeing snapshot
   */
  async getWellbeingSnapshot(userId) {
    const profile = await this.memoryStore.getUserProfile(userId);
    const emotionalState = await this.memoryStore.getLatestEmotionalState(userId);
    const trajectory = await this.detectMoodTrajectory(userId);
    const absenceInfo = await this.detectAbsence(userId);

    return {
      userId,
      currentMood: emotionalState?.currentMood || 'unknown',
      trajectory,
      isAbsent: absenceInfo?.absent || false,
      timeSinceLastChat: await this.memoryStore.getTimeSinceLastSession(userId),
      concerns: emotionalState?.areasOfConcern || [],
      growth: emotionalState?.growthAreas || [],
    };
  }
}

module.exports = EmotionalStateTracker;
