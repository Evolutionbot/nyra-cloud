/**
 * WebSocket Handler
 *
 * Handles real-time conversation over WebSocket:
 * - Message streaming for real-time responses
 * - Connection lifecycle management
 * - Session tracking
 * - Event handling (typing indicators, etc.)
 *
 * Message Format:
 * { type: 'message', userId: string, content: string }
 * { type: 'typing', userId: string }
 * { type: 'end-session', userId: string }
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class WebSocketHandler {
  constructor(claudeApi, memoryStore, contextBuilder, emotionalStateTracker) {
    this.claudeApi = claudeApi;
    this.memoryStore = memoryStore;
    this.contextBuilder = contextBuilder;
    this.emotionalStateTracker = emotionalStateTracker;

    // Track active sessions
    this.sessions = new Map(); // userId -> { ws, sessionId, messages }
  }

  /**
   * Attach WebSocket handler to server
   * @param {http.Server} server - Express server instance
   */
  attachToServer(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
      console.log('[WebSocket] New connection');

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('[WebSocket] Message handling error:', error);
          ws.send(
            JSON.stringify({
              type: 'error',
              error: error.message,
            })
          );
        }
      });

      ws.on('close', async () => {
        console.log('[WebSocket] Connection closed');
        // Clean up session
        for (const [userId, session] of this.sessions.entries()) {
          if (session.ws === ws) {
            await this.closeSession(userId, session);
            this.sessions.delete(userId);
          }
        }
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error.message);
      });
    });

    return wss;
  }

  /**
   * Handle incoming WebSocket message
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   */
  async handleMessage(ws, message) {
    const { type, userId, content } = message;

    switch (type) {
      case 'message':
        await this.handleChatMessage(ws, userId, content);
        break;

      case 'typing':
        await this.handleTypingIndicator(ws, userId);
        break;

      case 'end-session':
        await this.handleEndSession(ws, userId);
        break;

      case 'init':
        await this.handleInit(ws, userId);
        break;

      default:
        ws.send(
          JSON.stringify({
            type: 'error',
            error: `Unknown message type: ${type}`,
          })
        );
    }
  }

  /**
   * Handle initialization
   * Starts a new session for the user
   */
  async handleInit(ws, userId) {
    if (!userId) {
      ws.send(
        JSON.stringify({
          type: 'error',
          error: 'userId is required',
        })
      );
      return;
    }

    // Initialize user in memory
    await this.memoryStore.initializeUser(userId);

    // Start session
    const session = await this.memoryStore.startSession(userId);

    // Store session
    this.sessions.set(userId, {
      ws,
      sessionId: session.id,
      messages: [],
      startedAt: new Date(),
    });

    // Detect absence and send initial context
    const absenceInfo = await this.emotionalStateTracker.detectAbsence(userId);

    ws.send(
      JSON.stringify({
        type: 'init',
        sessionId: session.id,
        userId,
        absenceDetected: !!absenceInfo,
        absenceContext: absenceInfo?.context || null,
      })
    );

    console.log(`[Session] Started for user ${userId}: ${session.id}`);
  }

  /**
   * Handle chat message
   * Send to Claude and stream response
   */
  async handleChatMessage(ws, userId, content) {
    if (!userId || !content) {
      ws.send(
        JSON.stringify({
          type: 'error',
          error: 'userId and content are required',
        })
      );
      return;
    }

    const session = this.sessions.get(userId);
    if (!session) {
      ws.send(
        JSON.stringify({
          type: 'error',
          error: 'No active session. Call init first.',
        })
      );
      return;
    }

    // Add user message to session
    session.messages.push({
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    });

    // Send typing indicator that Nyra is responding
    ws.send(
      JSON.stringify({
        type: 'typing',
        from: 'nyra',
      })
    );

    try {
      // Build context
      const context = await this.contextBuilder.buildContext(
        userId,
        session.messages
      );

      context = this.contextBuilder.validateContextSize(context);

      // Get user profile
      const userProfile = await this.memoryStore.getUserProfile(userId);

      // Stream response from Claude
      let fullResponse = '';
      let messageId = uuidv4();

      // Create a streaming response
      const response = await this._streamChatResponse(
        content,
        context,
        userProfile,
        (chunk) => {
          fullResponse += chunk;

          // Send streaming chunks to client
          ws.send(
            JSON.stringify({
              type: 'message-chunk',
              messageId,
              content: chunk,
              from: 'nyra',
            })
          );
        }
      );

      // Send completion signal
      ws.send(
        JSON.stringify({
          type: 'message-complete',
          messageId,
          model: response.model,
        })
      );

      // Add response to session
      session.messages.push({
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date().toISOString(),
        model: response.model,
      });

      // Extract and store memories
      const memories = await this.claudeApi.extractMemories(content, fullResponse);
      for (const memory of memories) {
        await this.memoryStore.storeMemory(userId, memory);
      }

      // Track emotional state
      await this.emotionalStateTracker.trackFromConversation(userId, session.messages);
    } catch (error) {
      console.error('[Chat Error]', error);

      ws.send(
        JSON.stringify({
          type: 'error',
          error: `Failed to get response: ${error.message}`,
        })
      );
    }
  }

  /**
   * Stream chat response in chunks
   * @private
   */
  async _streamChatResponse(message, context, userProfile, onChunk) {
    return new Promise((resolve, reject) => {
      const routingDecision = this.claudeApi.router.selectModel(
        await this.claudeApi.router.analyzeMessage(message)
      );

      const systemPrompt = require('../ai/prompts').generateSystemPrompt(
        context.memoryFragments,
        context.emotionalState,
        userProfile
      );

      let fullResponse = '';

      this.claudeApi.client.messages.stream({
        model: routingDecision,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
      })
        .on('text', (text) => {
          fullResponse += text;
          onChunk(text);
        })
        .on('end', () => {
          resolve({
            message: fullResponse,
            model: routingDecision,
          });
        })
        .on('error', reject);
    });
  }

  /**
   * Handle typing indicator
   */
  async handleTypingIndicator(ws, userId) {
    const session = this.sessions.get(userId);
    if (session) {
      // Broadcast typing to other connections for this user (if applicable)
      ws.send(
        JSON.stringify({
          type: 'typing-ack',
          userId,
        })
      );
    }
  }

  /**
   * Handle end session
   */
  async handleEndSession(ws, userId) {
    const session = this.sessions.get(userId);

    if (!session) {
      ws.send(
        JSON.stringify({
          type: 'error',
          error: 'No active session',
        })
      );
      return;
    }

    await this.closeSession(userId, session);

    ws.send(
      JSON.stringify({
        type: 'session-ended',
        userId,
        sessionId: session.sessionId,
      })
    );

    this.sessions.delete(userId);
  }

  /**
   * Close a session properly
   * @private
   */
  async closeSession(userId, session) {
    await this.memoryStore.endSession(userId, session.sessionId, session.messages);

    console.log(
      `[Session] Closed for user ${userId}: ${session.messages.length} messages`
    );
  }
}

module.exports = WebSocketHandler;
