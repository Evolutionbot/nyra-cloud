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
      let context = await this.contextBuilder.buildContext(
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

      // Analyze emotion from the response for avatar
      const emotionData = this._extractEmotion(fullResponse, content);

      // Send completion signal with emotion data
      ws.send(
        JSON.stringify({
          type: 'message-complete',
          messageId,
          model: response.model,
          emotion: emotionData.emotion,
          intensity: emotionData.intensity,
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
    return new Promise(async (resolve, reject) => {
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
   * Extract emotion from response text and user message
   * Maps to the 9 avatar emotion states: neutral, joy, curiosity, empathy, concern, excitement, calm, playful, focused
   * @private
   */
  _extractEmotion(responseText, userMessage) {
    const text = (responseText + ' ' + userMessage).toLowerCase();

    // Keyword-based emotion detection with intensity scoring
    const emotionScores = {
      joy: 0,
      curiosity: 0,
      empathy: 0,
      concern: 0,
      excitement: 0,
      calm: 0,
      playful: 0,
      focused: 0,
    };

    // Joy indicators
    if (/\b(happy|glad|wonderful|great|amazing|love|beautiful|proud|congratulat|celebrate|fantastic)\b/.test(text)) emotionScores.joy += 3;
    if (/\b(good|nice|pleased|smile|enjoy|fun)\b/.test(text)) emotionScores.joy += 1;
    if (/[!]{1,}/.test(responseText) && /\b(great|awesome|wonderful)\b/.test(text)) emotionScores.joy += 2;

    // Curiosity indicators
    if (/\b(interesting|curious|wonder|fascinating|tell me more|explore|discover|intriguing)\b/.test(text)) emotionScores.curiosity += 3;
    if (/\b(what if|how does|why do|could you explain|I'd love to know)\b/.test(text)) emotionScores.curiosity += 2;

    // Empathy indicators
    if (/\b(sorry|understand|feel|hear you|that must|difficult|tough|hard time|loss|lost|grief|pain|hurt)\b/.test(text)) emotionScores.empathy += 3;
    if (/\b(I'm here|with you|support|care about|matters to me)\b/.test(text)) emotionScores.empathy += 2;

    // Concern indicators
    if (/\b(worried|concern|careful|warning|danger|risk|problem|trouble|struggle|stress|anxious|overwhelm)\b/.test(text)) emotionScores.concern += 3;
    if (/\b(are you okay|how are you feeling|take care|be careful)\b/.test(text)) emotionScores.concern += 2;

    // Excitement indicators
    if (/\b(excited|thrilled|can't wait|incredible|breakthrough|huge|epic|mind-blowing|phenomenal)\b/.test(text)) emotionScores.excitement += 3;
    if (/[!]{2,}/.test(responseText)) emotionScores.excitement += 1;

    // Calm indicators
    if (/\b(peace|calm|relax|breathe|mindful|serene|gentle|quiet|meditation|tranquil|still|slow)\b/.test(text)) emotionScores.calm += 3;
    if (/\b(take your time|no rush|it's okay|easy)\b/.test(text)) emotionScores.calm += 1;

    // Playful indicators
    if (/\b(haha|lol|funny|joke|silly|laugh|playful|tease|grin|wink|kidding)\b/.test(text)) emotionScores.playful += 3;
    if (/[😄😂🤣😊😏😜]/.test(text)) emotionScores.playful += 2;

    // Focused indicators
    if (/\b(analyze|implement|code|build|technical|specific|detail|step by step|algorithm|architecture|debug|optimize)\b/.test(text)) emotionScores.focused += 3;
    if (/\b(let's|here's how|first|second|third|the approach)\b/.test(text)) emotionScores.focused += 1;

    // Find the dominant emotion
    let maxScore = 0;
    let dominantEmotion = 'neutral';
    for (const [emotion, score] of Object.entries(emotionScores)) {
      if (score > maxScore) {
        maxScore = score;
        dominantEmotion = emotion;
      }
    }

    // Calculate intensity (0.0 - 1.0)
    const intensity = Math.min(maxScore / 6, 1.0);

    // If no strong emotion detected, stay neutral
    if (maxScore < 2) {
      return { emotion: 'neutral', intensity: 0.3 };
    }

    return { emotion: dominantEmotion, intensity: Math.max(intensity, 0.3) };
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
