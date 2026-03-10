/**
 * Nyra Cloud Platform - Express Server
 *
 * Main entry point for the Nyra AI companion platform.
 * Sets up:
 * - Express server with CORS
 * - WebSocket support for real-time chat
 * - REST API endpoints
 * - Claude API integration
 * - Memory and emotional state management
 * - Graceful shutdown
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const ClaudeAPI = require('./ai/claude');
const MemoryStore = require('./memory/store');
const EmotionalStateTracker = require('./memory/emotional-state');
const ContextBuilder = require('./memory/context-builder');
const initializeRoutes = require('./api/routes');
const WebSocketHandler = require('./api/websocket');

// Initialize application
const app = express();
const port = config.port;

// Middleware
app.use(cors({ origin: config.api.corsOrigin }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Initialize components
let claudeApi;
let memoryStore;
let emotionalStateTracker;
let contextBuilder;
let wsHandler;

try {
  claudeApi = new ClaudeAPI();
  memoryStore = new MemoryStore();
  emotionalStateTracker = new EmotionalStateTracker(memoryStore);
  contextBuilder = new ContextBuilder(memoryStore, emotionalStateTracker);
  wsHandler = new WebSocketHandler(
    claudeApi,
    memoryStore,
    contextBuilder,
    emotionalStateTracker
  );

  console.log('[Init] All components initialized successfully');
} catch (error) {
  console.error('[Init] Failed to initialize components:', error.message);
  process.exit(1);
}

// Initialize API routes
const apiRouter = initializeRoutes(
  claudeApi,
  memoryStore,
  contextBuilder,
  emotionalStateTracker
);

app.use(apiRouter);

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.isDevelopment ? err.message : undefined,
  });
});

// Create HTTP server
const http = require('http');
const server = http.createServer(app);

// Attach WebSocket
wsHandler.attachToServer(server);

// Start server
server.listen(port, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Nyra Cloud Platform - Online        ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log(`Server: http://localhost:${port}`);
  console.log(`API: http://localhost:${port}/api`);
  console.log(`Health: http://localhost:${port}/healthz`);
  console.log('');
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Memory Backend: ${config.memory.backend}`);
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM received, closing gracefully...');

  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  console.log('[Shutdown] SIGINT received, closing gracefully...');

  server.close(() => {
    console.log('[Shutdown] Server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10000);
});

// Unhandled rejection
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

// Uncaught exception
process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error);
  process.exit(1);
});

module.exports = { app, server };
