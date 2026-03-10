# Nyra Cloud Platform

A voice-first, emotionally intelligent AI companion inspired by Samantha from "Her". Nyra grows with each conversation, knows you better than you know yourself, and remembers everything with judgment.

## Features

- **Emotional Intelligence**: Tracks emotional patterns and detects behavioral changes
- **Persistent Memory**: Stores and recalls relevant conversation history across sessions
- **Smart Model Routing**: Uses Haiku for quick factual questions, Sonnet for emotional depth
- **Context Compression**: Maintains rich context without token bloat (under 800 tokens per call)
- **Real-time Chat**: WebSocket-based streaming for immediate responses
- **Absence Detection**: Notices when you haven't talked and misses you
- **Beautiful UI**: Dark-themed, minimal interface optimized for conversation

## Architecture

### Backend Components

- **Express Server**: HTTP/WebSocket server with REST API
- **Claude API Integration**: Smart model routing (Haiku vs Sonnet)
- **Memory Store**: In-memory storage (PostgreSQL-ready for production)
- **Emotional State Tracker**: Monitors mood patterns and behavioral changes
- **Context Builder**: Compresses conversation context to fit within token limits

### Frontend

- **Real-time Chat Interface**: WebSocket-based messaging with streaming responses
- **Typing Indicators**: Shows when Nyra is responding
- **Persistent User Sessions**: Maintains conversation history and user identity
- **Responsive Design**: Mobile-friendly dark theme

## Setup

### Prerequisites

- Node.js 18+
- Anthropic API key

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd nyra-cloud
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Set your Anthropic API key:
```bash
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Running Locally

```bash
npm start
```

The server will start on `http://localhost:3000`

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

### Health Checks
- `GET /healthz` - Health check
- `GET /readyz` - Readiness check

### Chat
- `POST /api/chat` - Send a message to Nyra
  ```json
  {
    "userId": "user-123",
    "message": "Hello Nyra"
  }
  ```

### Memory & State
- `GET /api/memory/:userId` - Get stored memories
- `GET /api/state/:userId` - Get emotional state
- `GET /api/profile/:userId` - Get user profile
- `PUT /api/profile/:userId` - Update user profile

### WebSocket
Connect to `ws://localhost:3000` for real-time chat:

```javascript
const ws = new WebSocket('ws://localhost:3000');

// Initialize session
ws.send(JSON.stringify({
  type: 'init',
  userId: 'user-123'
}));

// Send message
ws.send(JSON.stringify({
  type: 'message',
  userId: 'user-123',
  content: 'Hello Nyra'
}));

// Listen for responses
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'message-chunk') {
    console.log(message.content); // Streaming response
  }
};
```

## Configuration

Key environment variables:

```env
# Server
PORT=3000
NODE_ENV=development

# Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Memory
ENABLE_PERSISTENCE=false
ENABLE_EMOTIONAL_STATE_TRACKING=true
ENABLE_MEMORY_CONSOLIDATION=true

# Context
MAX_CONTEXT_WINDOW=800
MEMORY_FRAGMENT_COUNT=5
```

## How Nyra Works

### Smart Model Routing
- **Haiku**: Short factual questions ($0.80/$4 per million tokens)
- **Sonnet**: Emotional depth, memory integration ($3/$15 per million tokens)
- **Opus**: Nightly batch processing and model updates (reserved)

### Memory System
1. **Capture**: Extracts key facts and insights from conversations
2. **Store**: Saves memories with importance and connection ratings
3. **Retrieve**: Selects 3-5 most relevant memories for each message
4. **Compress**: Keeps context under 800 tokens for cost efficiency

### Emotional State Tracking
1. **Analysis**: Claude analyzes conversation tone and patterns
2. **History**: Stores snapshots over time to detect trends
3. **Absence Detection**: Notices when you haven't talked (> 2 hours)
4. **Context**: Includes emotional understanding in system prompt

### Context Compression
Each API call includes:
- 3-5 semantically relevant memory fragments (vector search ready)
- Compressed emotional state summary (~100 tokens)
- Current exchange only (last 2 turns)
- Total: under 800 tokens

## Deployment

### Railway
1. Connect your GitHub repository
2. Set environment variables in Railway dashboard
3. Deploy: `npm start` script will run automatically

### Docker
```bash
docker build -t nyra-cloud .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NODE_ENV=production \
  nyra-cloud
```

## Development

### Project Structure
```
nyra-cloud/
├── src/
│   ├── index.js              # Main server
│   ├── config.js             # Configuration
│   ├── ai/
│   │   ├── claude.js         # Claude API integration
│   │   ├── router.js         # Smart model routing
│   │   └── prompts.js        # Nyra's personality
│   ├── memory/
│   │   ├── store.js          # Memory storage
│   │   ├── emotional-state.js # Emotional tracking
│   │   └── context-builder.js # Context compression
│   └── api/
│       ├── routes.js         # REST endpoints
│       └── websocket.js      # Real-time chat
├── public/
│   └── index.html            # Web UI
├── package.json
└── Dockerfile
```

### Testing
```bash
# Health check
curl http://localhost:3000/healthz

# Send message
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user","message":"Hello"}'

# Get memories
curl http://localhost:3000/api/memory/test-user
```

## Technical Decisions

### Why Haiku vs Sonnet?
- Haiku is 4x cheaper but handles simple queries well
- Sonnet provides necessary depth for emotional understanding
- Router analyzes message complexity in real-time

### Why Context Compression?
- Full history would exceed token budgets quickly
- Semantic memory fragments preserve context richness
- Emotional state summary maintains personality continuity

### Why WebSocket?
- Real-time streaming for better UX
- Lower latency than polling
- Proper session management for persistence

### Why In-Memory MVP?
- Faster iteration without database setup
- PostgreSQL-ready schema for production
- Easy to add vector DB (Weaviate) later

## Future Enhancements

- PostgreSQL integration for data persistence
- Weaviate vector database for semantic memory search
- Nightly batch consolidation with Opus
- Multi-modal support (voice input/output)
- User-facing memory management interface
- Advanced emotional state ML models
- Federated learning for privacy-preserving personalization

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.

---

Built with love for meaningful AI companionship.
