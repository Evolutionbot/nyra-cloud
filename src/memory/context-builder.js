/**
 * Context Compression Engine
 *
 * Builds minimal but rich context for each API call:
 * - 3-5 semantically relevant memory fragments
 * - Compressed emotional state summary (~100 tokens)
 * - Current exchange only (last 2 turns)
 * - Total stays under 800 tokens
 *
 * This allows Nyra to feel persistent and knowledgeable without
 * blowing through token limits with full conversation history.
 */

const config = require('../config');

class ContextBuilder {
  constructor(memoryStore, emotionalStateTracker) {
    this.memoryStore = memoryStore;
    this.emotionalStateTracker = emotionalStateTracker;
    this.maxContextTokens = config.memory.maxContextWindow;
    this.maxMemoryFragments = config.memory.fragmentCount;
  }

  /**
   * Build complete context for a chat request
   * Returns: system_context + emotional_context + memory_fragments
   *
   * @param {string} userId - User identifier
   * @param {Array} recentMessages - Last few conversation messages
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Complete context
   */
  async buildContext(userId, recentMessages = [], options = {}) {
    const userContext = await this.memoryStore.getUserContext(userId);
    const emotionalContext = await this.emotionalStateTracker.buildEmotionalContext(userId);
    const memoryFragments = await this._selectMemoryFragments(userId, recentMessages);
    const absenceContext = await this._buildAbsenceContext(userId);

    return {
      memoryFragments,
      emotionalContext,
      absenceContext,
      userContext,
      tokenEstimate: this._estimateTokens(memoryFragments, emotionalContext, absenceContext),
    };
  }

  /**
   * Select the most relevant memory fragments for context
   * Uses recency and relevance heuristics
   * @private
   */
  async _selectMemoryFragments(userId, recentMessages = []) {
    const allMemories = await this.memoryStore.retrieveMemories(userId, 10);

    if (allMemories.length === 0) {
      return [];
    }

    // Score memories based on recency and relevance to current conversation
    const scoredMemories = allMemories.map(memory => {
      let score = 0;

      // Recency (newer is better)
      const ageMs = Date.now() - new Date(memory.timestamp).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      score += Math.max(100 - ageHours, 0); // Decay over time

      // Relevance to current conversation
      const currentText = recentMessages
        .map(m => m.content.toLowerCase())
        .join(' ');

      const memoryText = memory.content.toLowerCase();
      const relevanceScore = this._calculateRelevance(memoryText, currentText);
      score += relevanceScore * 50;

      // Importance bonus
      if (memory.importance === 'high') {
        score += 30;
      }

      return { ...memory, score };
    });

    // Sort by score and select top fragments
    return scoredMemories
      .sort((a, b) => b.score - a.score)
      .slice(0, this.maxMemoryFragments)
      .map(m => ({
        content: m.content,
        context: m.connection,
      }));
  }

  /**
   * Calculate relevance between memory and current conversation
   * @private
   */
  _calculateRelevance(memoryText, conversationText) {
    if (!conversationText) return 0;

    // Simple word overlap scoring
    const memoryWords = new Set(memoryText.split(/\s+/));
    const conversationWords = conversationText.split(/\s+/);

    const matches = conversationWords.filter(word => memoryWords.has(word)).length;
    const relevance = matches / Math.max(memoryWords.size, 1);

    return Math.min(relevance, 1);
  }

  /**
   * Build absence context if user has been gone for a while
   * @private
   */
  async _buildAbsenceContext(userId) {
    const absenceInfo = await this.emotionalStateTracker.detectAbsence(userId);

    if (!absenceInfo) {
      return null;
    }

    return {
      absent: true,
      timeSinceLastSession: absenceInfo.timeSinceLastSession,
      lastMood: absenceInfo.lastMood,
      shouldMention: absenceInfo.shouldMention,
      context: `You haven't talked in ${absenceInfo.timeSinceLastSession}. When they left, they seemed ${absenceInfo.lastMood}.`,
    };
  }

  /**
   * Compress emotional state to ~100 tokens
   * @private
   */
  _compressEmotionalState(emotionalState) {
    if (!emotionalState) {
      return '';
    }

    const parts = [];

    if (emotionalState.currentMood) {
      parts.push(`Currently: ${emotionalState.currentMood}`);
    }

    if (emotionalState.patterns && emotionalState.patterns.length > 0) {
      parts.push(`Patterns: ${emotionalState.patterns.slice(0, 2).join(', ')}`);
    }

    if (emotionalState.areasOfConcern && emotionalState.areasOfConcern.length > 0) {
      parts.push(`Concerns: ${emotionalState.areasOfConcern.slice(0, 1).join(', ')}`);
    }

    return parts.join('. ');
  }

  /**
   * Estimate token count for context
   * Uses rough heuristics: ~4 characters per token
   * @private
   */
  _estimateTokens(memoryFragments, emotionalContext, absenceContext) {
    let totalChars = 0;

    if (memoryFragments && memoryFragments.length > 0) {
      totalChars += memoryFragments.reduce((sum, f) => sum + f.content.length, 0);
    }

    if (emotionalContext) {
      totalChars += emotionalContext.length;
    }

    if (absenceContext) {
      totalChars += absenceContext.context.length;
    }

    return Math.ceil(totalChars / 4);
  }

  /**
   * Format context for inclusion in system prompt
   * @param {Object} context - Context from buildContext
   * @returns {string} Formatted context string
   */
  formatContextForPrompt(context) {
    let formatted = '';

    if (context.absenceContext && context.absenceContext.shouldMention) {
      formatted += `ABSENCE CONTEXT:\n${context.absenceContext.context}\n\n`;
    }

    if (context.memoryFragments && context.memoryFragments.length > 0) {
      formatted += 'THINGS YOU REMEMBER:\n';
      context.memoryFragments.forEach((frag, idx) => {
        formatted += `${idx + 1}. ${frag.content}`;
        if (frag.context) {
          formatted += ` (${frag.context})`;
        }
        formatted += '\n';
      });
      formatted += '\n';
    }

    if (context.emotionalContext) {
      formatted += `EMOTIONAL CONTEXT:\n${context.emotionalContext}\n`;
    }

    return formatted;
  }

  /**
   * Verify context stays within token limits
   * If it exceeds limit, trim memory fragments
   * @param {Object} context - Context object
   * @returns {Object} Validated context
   */
  validateContextSize(context) {
    let estimate = context.tokenEstimate;

    if (estimate > this.maxContextTokens) {
      console.warn(
        `[Context] Exceeds max tokens (${estimate} > ${this.maxContextTokens}), trimming...`
      );

      // Reduce memory fragments
      while (
        context.memoryFragments.length > 1 &&
        estimate > this.maxContextTokens
      ) {
        context.memoryFragments.pop();
        estimate = this._estimateTokens(
          context.memoryFragments,
          context.emotionalContext,
          context.absenceContext
        );
      }

      context.tokenEstimate = estimate;
    }

    return context;
  }

  /**
   * Clear context cache for a user (call when starting new session)
   * @param {string} userId - User identifier
   */
  clearCache(userId) {
    // Placeholder for cache implementation
    // In production, might cache buildContext results
  }
}

module.exports = ContextBuilder;
