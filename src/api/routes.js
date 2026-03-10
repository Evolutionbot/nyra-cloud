/**
 * REST API Routes
 *
 * Endpoints:
 * - GET /healthz - Health check
 * - GET /readyz - Readiness check
 * - POST /api/chat - Send message and get response
 * - GET /api/memory/:userId - Get user's memories
 * - GET /api/state/:userId - Get emotional state
 * - GET /api/profile/:userId - Get user profile
 * - PUT /api/profile/:userId - Update user profile
 */

const express = require('express');
const router = express.Router();

/**
 * Initialize routes with dependencies
 * @param {ClaudeAPI} claudeApi - Claude API instance
 * @param {MemoryStore} memoryStore - Memory store instance
 * @param {ContextBuilder} contextBuilder - Context builder instance
 * @param {EmotionalStateTracker} emotionalStateTracker - Emotional state tracker
 */
function initializeRoutes(claudeApi, memoryStore, contextBuilder, emotionalStateTracker) {
  /**
   * Health check endpoint
   * Used by load balancers and monitoring
   */
  router.get('/healthz', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  /**
   * Readiness check endpoint
   * Verifies dependencies are ready
   */
  router.get('/readyz', (req, res) => {
    // Check if Claude API is accessible
    if (!claudeApi) {
      return res.status(503).json({
        status: 'not_ready',
        reason: 'Claude API not initialized',
      });
    }

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      memoryStats: memoryStore.getStats(),
    });
  });

  /**
   * POST /api/chat - Send a message to Nyra
   * Body: { userId: string, message: string, stream?: boolean }
   */
  router.post('/api/chat', async (req, res) => {
    try {
      const { userId, message } = req.body;

      if (!userId || !message) {
        return res.status(400).json({
          error: 'Missing userId or message',
        });
      }

      // Initialize user in memory store
      await memoryStore.initializeUser(userId);

      // Build context for the conversation
      const context = await contextBuilder.buildContext(
        userId,
        claudeApi.getHistory()
      );

      context = contextBuilder.validateContextSize(context);

      // Get user profile for context
      const userProfile = await memoryStore.getUserProfile(userId);

      // Send message to Claude
      const response = await claudeApi.chat(message, {
        memoryFragments: context.memoryFragments,
        emotionalState: context.emotionalState,
        userProfile,
        stream: false,
      });

      // Extract and store memories from this exchange
      const memories = await claudeApi.extractMemories(message, response.message);
      for (const memory of memories) {
        await memoryStore.storeMemory(userId, memory);
      }

      // Track emotional state from this conversation
      const conversationMessages = [...claudeApi.getHistory()];
      await emotionalStateTracker.trackFromConversation(userId, conversationMessages);

      res.status(200).json({
        message: response.message,
        model: response.model,
        routing: response.routing,
      });
    } catch (error) {
      console.error('[API Error]', error);
      res.status(500).json({
        error: 'Failed to process message',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/memory/:userId - Get user's stored memories
   * Query: ?limit=5
   */
  router.get('/api/memory/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit) || 5;

      const memories = await memoryStore.retrieveMemories(userId, limit);

      res.status(200).json({
        userId,
        memories,
        count: memories.length,
      });
    } catch (error) {
      console.error('[Memory API Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/state/:userId - Get user's emotional state
   */
  router.get('/api/state/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      const wellbeing = await emotionalStateTracker.getWellbeingSnapshot(userId);
      const emotionalState = await memoryStore.getLatestEmotionalState(userId);

      res.status(200).json({
        userId,
        wellbeing,
        emotionalState,
      });
    } catch (error) {
      console.error('[State API Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/profile/:userId - Get user profile
   */
  router.get('/api/profile/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      const profile = await memoryStore.getUserProfile(userId);

      res.status(200).json({
        userId,
        profile,
      });
    } catch (error) {
      console.error('[Profile API Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/profile/:userId - Update user profile
   * Body: { name?: string, interests?: string[], ... }
   */
  router.put('/api/profile/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const updates = req.body;

      const updatedProfile = await memoryStore.updateUserProfile(userId, updates);

      res.status(200).json({
        userId,
        profile: updatedProfile,
      });
    } catch (error) {
      console.error('[Profile Update Error]', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/stats - Get system statistics
   */
  router.get('/api/stats', (req, res) => {
    const stats = memoryStore.getStats();

    res.status(200).json({
      stats,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/test - Test endpoint for debugging
   * Echoes back the request body
   */
  router.post('/api/test', (req, res) => {
    res.status(200).json({
      test: true,
      received: req.body,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = initializeRoutes;
