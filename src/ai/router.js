/**
 * Smart Model Router
 *
 * Routes messages to the most appropriate Claude model based on:
 * - Message complexity and emotional depth
 * - Available budget and context
 * - Whether memory/emotional depth is needed
 *
 * Haiku: Short factual questions, quick responses
 * Sonnet: Emotional depth, memory integration, nuanced conversations
 * Opus: Reserved for nightly batch processing and model updates
 */

const config = require('../config');
const { MESSAGE_ANALYSIS_PROMPTS } = require('./prompts');

class MessageRouter {
  constructor(anthropicClient) {
    this.client = anthropicClient;
    this.models = config.anthropic.models;
  }

  /**
   * Analyze a message to determine routing
   * @param {string} message - The user's message
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeMessage(message) {
    // Quick heuristic analysis before making API call
    const heuristics = this._analyzeHeuristics(message);

    // For MVP, use heuristics only (faster, cheaper)
    // In production, we could make an API call to Claude for more nuanced analysis
    return heuristics;
  }

  /**
   * Heuristic-based message analysis (fast, no API call)
   * @private
   * @param {string} message - The user's message
   * @returns {Object} Analysis results
   */
  _analyzeHeuristics(message) {
    const lowerMessage = message.toLowerCase();
    const messageLength = message.length;
    const wordCount = message.split(/\s+/).length;

    // Emotional depth indicators
    const emotionalKeywords = [
      'feel', 'feeling', 'felt', 'emotion', 'love', 'hate', 'hurt', 'angry',
      'sad', 'happy', 'scared', 'worried', 'anxious', 'lonely', 'miss',
      'care', 'trust', 'relationship', 'friend', 'family', 'heart',
    ];

    // Complex reasoning indicators
    const complexKeywords = [
      'why', 'how', 'explain', 'think', 'believe', 'understand', 'reason',
      'decision', 'choice', 'problem', 'solution', 'advice', 'help',
      'concern', 'matter', 'important', 'meaning', 'purpose',
    ];

    // Simple factual indicators
    const factualKeywords = [
      'what', 'when', 'where', 'who', 'which', 'weather', 'time',
      'definition', 'meaning', 'fact', 'information',
    ];

    // Count keyword matches
    const emotionalMatches = emotionalKeywords.filter(kw => lowerMessage.includes(kw)).length;
    const complexMatches = complexKeywords.filter(kw => lowerMessage.includes(kw)).length;
    const factualMatches = factualKeywords.filter(kw => lowerMessage.includes(kw)).length;

    // Determine emotional intensity
    let emotionalIntensity = 'low';
    if (emotionalMatches >= 3) {
      emotionalIntensity = 'high';
    } else if (emotionalMatches >= 1) {
      emotionalIntensity = 'medium';
    }

    // Determine complexity
    const isComplex = complexMatches > 0 || messageLength > 200 || wordCount > 30;
    const needsEmotionalDepth = emotionalMatches > 0 || emotionalIntensity !== 'low';
    const requiresMemory =
      needsEmotionalDepth ||
      isComplex ||
      lowerMessage.includes('remember') ||
      lowerMessage.includes('before') ||
      lowerMessage.includes('last');

    return {
      isComplex,
      needsEmotionalDepth,
      emotionalIntensity,
      requiresMemory,
      messageLength,
      wordCount,
      emotionalMatches,
      complexMatches,
      factualMatches,
    };
  }

  /**
   * Select the appropriate model based on message analysis
   * @param {Object} analysis - Message analysis results
   * @returns {string} Model name to use
   */
  selectModel(analysis) {
    // If message needs emotional depth or is complex, use Sonnet
    if (analysis.needsEmotionalDepth || analysis.isComplex) {
      return this.models.sonnet;
    }

    // Simple factual questions can use cheaper Haiku
    if (!analysis.isComplex && analysis.emotionalIntensity === 'low') {
      return this.models.haiku;
    }

    // Default to Sonnet for conversational safety
    return this.models.sonnet;
  }

  /**
   * Route a message to the appropriate model
   * @param {string} message - The user's message
   * @param {Object} context - Conversation context
   * @returns {Promise<Object>} Routing decision with model and metadata
   */
  async route(message, context = {}) {
    const analysis = await this.analyzeMessage(message);
    const selectedModel = this.selectModel(analysis);

    return {
      model: selectedModel,
      analysis,
      shouldIncludeMemory: analysis.requiresMemory,
      shouldTrackEmotionalState: analysis.needsEmotionalDepth,
      costEstimate: this._estimateCost(selectedModel, context),
    };
  }

  /**
   * Estimate API cost for a message
   * @private
   * @param {string} model - The model to use
   * @param {Object} context - Context that will be sent
   * @returns {Object} Cost estimation
   */
  _estimateCost(model, context = {}) {
    // Token estimates (rough)
    const inputTokens = (context.systemPromptLength || 1000) +
                       (context.memoryLength || 300) +
                       (context.messageLength || 100);

    const outputTokens = 300; // Average response length

    // Pricing per million tokens (as of early 2024)
    const pricing = {
      [this.models.haiku]: { input: 0.80, output: 4.00 },      // $0.80/$4 per million
      [this.models.sonnet]: { input: 3.00, output: 15.00 },    // $3/$15 per million
      [this.models.opus]: { input: 15.00, output: 75.00 },     // $15/$75 per million
    };

    const modelPricing = pricing[model] || pricing[this.models.sonnet];
    const inputCost = (inputTokens / 1000000) * modelPricing.input;
    const outputCost = (outputTokens / 1000000) * modelPricing.output;

    return {
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedInputCost: inputCost,
      estimatedOutputCost: outputCost,
      estimatedTotalCost: inputCost + outputCost,
    };
  }
}

module.exports = MessageRouter;
