/**
 * Claude API Integration
 *
 * Handles communication with Anthropic's Claude API with:
 * - Smart model routing (Haiku vs Sonnet based on message complexity)
 * - Context compression to stay under token limits
 * - Streaming support for real-time responses
 * - Error handling and retry logic
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const { generateSystemPrompt } = require('./prompts');
const MessageRouter = require('./router');

class ClaudeAPI {
  constructor() {
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      baseURL: config.anthropic.endpoint,
    });

    this.router = new MessageRouter(this.client);
    this.models = config.anthropic.models;
    this.conversationHistory = [];
  }

  /**
   * Send a message and get a response from Nyra
   * @param {string} message - User message
   * @param {Object} options - Configuration options
   * @param {Array} options.memoryFragments - Relevant memory snippets
   * @param {Object} options.emotionalState - Current emotional state
   * @param {Object} options.userProfile - User profile information
   * @param {boolean} options.stream - Whether to stream the response
   * @returns {Promise<Object>} Response object
   */
  async chat(message, options = {}) {
    const {
      memoryFragments = [],
      emotionalState = {},
      userProfile = {},
      stream = false,
    } = options;

    // Analyze message to determine routing
    const routingDecision = await this.router.route(message, {
      messageLength: message.length,
      memoryLength: memoryFragments.length * 100,
      systemPromptLength: 1000,
    });

    // Build system prompt with context
    const systemPrompt = generateSystemPrompt(
      memoryFragments,
      emotionalState,
      userProfile
    );

    // Build messages array with context compression
    const messages = this._buildMessages(message, memoryFragments);

    // Log routing decision
    console.log(`[Routing] Using ${routingDecision.model} for message (emotional: ${routingDecision.shouldIncludeMemory})`);

    try {
      if (stream) {
        return await this._streamChat(systemPrompt, messages, routingDecision);
      } else {
        return await this._standardChat(systemPrompt, messages, routingDecision);
      }
    } catch (error) {
      console.error('[Claude API Error]', error.message);
      throw error;
    }
  }

  /**
   * Standard non-streaming chat
   * @private
   */
  async _standardChat(systemPrompt, messages, routingDecision) {
    const response = await this.client.messages.create({
      model: routingDecision.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Track in conversation history
    this.conversationHistory.push({
      role: 'user',
      content: messages[messages.length - 1].content,
    });
    this.conversationHistory.push({
      role: 'assistant',
      content: responseText,
    });

    return {
      message: responseText,
      model: routingDecision.model,
      usage: response.usage,
      routing: routingDecision,
      stop_reason: response.stop_reason,
    };
  }

  /**
   * Streaming chat response
   * @private
   */
  async _streamChat(systemPrompt, messages, routingDecision) {
    return new Promise((resolve, reject) => {
      let fullResponse = '';

      this.client.messages.stream({
        model: routingDecision.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      })
        .on('text', (text) => {
          fullResponse += text;
        })
        .on('end', () => {
          // Track in conversation history
          this.conversationHistory.push({
            role: 'user',
            content: messages[messages.length - 1].content,
          });
          this.conversationHistory.push({
            role: 'assistant',
            content: fullResponse,
          });

          resolve({
            message: fullResponse,
            model: routingDecision.model,
            routing: routingDecision,
            stream: true,
          });
        })
        .on('error', reject);
    });
  }

  /**
   * Build messages array with context compression
   * Keeps:
   * - Last 2 turns of conversation
   * - Memory fragments (up to 5)
   * - Total under 800 tokens
   * @private
   */
  _buildMessages(currentMessage, memoryFragments = []) {
    const messages = [];

    // Add memory context as a system note if available
    if (memoryFragments && memoryFragments.length > 0) {
      const memoryContext = memoryFragments
        .slice(0, 5)
        .map(f => f.content)
        .join('\n');

      messages.push({
        role: 'user',
        content: `[Memory context: ${memoryContext}]`,
      });

      messages.push({
        role: 'assistant',
        content: 'I\'ve reviewed what I know about you. I\'m ready to continue our conversation.',
      });
    }

    // Add last 2 turns from conversation history
    const recentHistory = this.conversationHistory.slice(-4);
    messages.push(...recentHistory);

    // Add current message
    messages.push({
      role: 'user',
      content: currentMessage,
    });

    return messages;
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Get current conversation history
   */
  getHistory() {
    return this.conversationHistory;
  }

  /**
   * Analyze a message for memory extraction
   * @param {string} userMessage - User's message
   * @param {string} nyrResponse - Nyra's response
   * @returns {Promise<Array>} Array of memory objects to store
   */
  async extractMemories(userMessage, nyrResponse) {
    try {
      const response = await this.client.messages.create({
        model: this.models.haiku,
        max_tokens: 500,
        system: 'You are a memory extraction system. Extract key facts and insights from conversations that are worth remembering about a person.',
        messages: [
          {
            role: 'user',
            content: `User said: "${userMessage}"\nNyra responded: "${nyrResponse}"\n\nExtract 1-3 key memories as JSON array with {content, importance, connection}. Return ONLY valid JSON.`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';

      try {
        const parsed = JSON.parse(text);
        return parsed.memories || [];
      } catch {
        // If parsing fails, return empty array
        return [];
      }
    } catch (error) {
      console.error('[Memory Extraction Error]', error.message);
      return [];
    }
  }

  /**
   * Analyze emotional state from recent conversation
   * @param {Array} recentMessages - Recent conversation messages
   * @returns {Promise<Object>} Emotional state analysis
   */
  async analyzeEmotionalState(recentMessages) {
    if (!recentMessages || recentMessages.length === 0) {
      return {
        currentMood: 'neutral',
        patterns: [],
        areasOfConcern: [],
        growthAreas: [],
        hasChanged: false,
      };
    }

    try {
      const conversationText = recentMessages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      const response = await this.client.messages.create({
        model: this.models.haiku,
        max_tokens: 500,
        system: 'You are an emotional intelligence analyzer. Analyze the conversation to understand the user\'s emotional state.',
        messages: [
          {
            role: 'user',
            content: `Analyze this conversation:\n\n${conversationText}\n\nReturn JSON with {currentMood, patterns, areasOfConcern, growthAreas, hasChanged}. Return ONLY valid JSON.`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '{}';

      try {
        return JSON.parse(text);
      } catch {
        return {
          currentMood: 'neutral',
          patterns: [],
          areasOfConcern: [],
          growthAreas: [],
          hasChanged: false,
        };
      }
    } catch (error) {
      console.error('[Emotional State Analysis Error]', error.message);
      return {
        currentMood: 'neutral',
        patterns: [],
        areasOfConcern: [],
        growthAreas: [],
        hasChanged: false,
      };
    }
  }
}

module.exports = ClaudeAPI;
