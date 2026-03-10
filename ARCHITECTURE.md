# Nyra Cloud Platform - Architecture Overview

## System Design

Nyra is a voice-first AI companion with three core pillars:

### 1. Emotional Intelligence
- Tracks user mood patterns over time
- Detects behavioral changes and absence
- Maintains Nyra's own internal emotional state
- Surfaces insights naturally in conversation

### 2. Persistent Memory
- Semantic memory fragments (3-5 per conversation)
- Emotional state snapshots
- Session history and metadata
- User profile and preferences

### 3. Cost-Optimized AI
- **Haiku** ($0.80/$4 per million): Factual queries
- **Sonnet** ($3/$15 per million): Emotional depth
- **Opus**: Nightly batch consolidation
- Context compression keeps calls under 800 tokens

## Data Flow

```
User Message
    ↓
Message Router (analyze complexity)
    ↓
Context Builder (select relevant memories)
    ↓
Claude API (with smart model selection)
    ↓
Memory Extractor (extract key insights)
    ↓
Emotional State Tracker (update mood analysis)
    ↓
Storage (persist memories and state)
    ↓
Response to User
```

## Key Components

### src/ai/
- **claude.js**: Claude API wrapper with streaming, memory extraction, emotional analysis
- **router.js**: Smart model selection (Haiku vs Sonnet) based on message complexity
- **prompts.js**: Nyra's system prompt with personality definition and memory formatting

### src/memory/
- **store.js**: In-memory storage abstraction (PostgreSQL-ready)
  - Stores: memories, emotional states, user profiles, sessions
  - Provides: retrieval, search, time-since-last-session calculations

- **emotional-state.js**: Emotional tracking and analysis
  - Analyzes conversation tone and patterns
  - Detects mood trajectories
  - Triggers "missed you" context when appropriate
  - Builds emotional awareness for system prompt

- **context-builder.js**: Context compression engine
  - Selects 3-5 most relevant memory fragments
  - Compresses emotional state to ~100 tokens
  - Validates total context stays under 800 tokens
  - Handles absence context formatting

### src/api/
- **routes.js**: REST endpoints for chat, memory, profile
  - POST /api/chat - Send message (non-streaming)
  - GET /api/memory/:userId - Retrieve memories
  - GET /api/state/:userId - Get emotional state
  - GET /api/profile/:userId - User profile
  - Health checks: /healthz, /readyz

- **websocket.js**: Real-time WebSocket chat
  - Streaming response chunks
  - Session management
  - Memory extraction on close
  - Emotional state tracking per session

### src/
- **index.js**: Express server with HTTP + WebSocket
- **config.js**: Environment-based configuration

## Memory System Deep Dive

### How Memories Are Stored
1. **Extraction**: Claude analyzes each user message + Nyra response
2. **Scoring**: Each memory gets importance and connection rating
3. **Storage**: Persisted with timestamp, content, context

### How Memories Are Retrieved
1. **Scoring**: Sort by recency, importance, and relevance to current conversation
2. **Selection**: Take top 3-5 fragments
3. **Formatting**: Include in system prompt with connection context
4. **Cost Control**: Trim if context exceeds 800 tokens

### Example Memory Fragment
```javascript
{
  content: "You're dealing with anxiety about work presentations",
  connection: "relates to your recent promotion",
  importance: "high",
  timestamp: "2024-03-09T10:30:00Z"
}
```

## Emotional State Tracking

### What's Tracked
- **Current Mood**: One-word summary (neutral, anxious, excited, etc.)
- **Patterns**: Behavioral trends noticed ("withdrawn this week", "more excited lately")
- **Concerns**: Areas of worry identified by Claude
- **Growth Areas**: Positive developments noted

### Absence Detection
- Triggers after 2+ hours without talking
- Surfaces context like "It's been 4 days since we talked"
- Influences Nyra's opening tone (caring, checking in)

### Trajectory Analysis
- Analyzes last 5 emotional snapshots
- Determines if mood is improving/worsening/stable
- Used to guide conversation focus

## API Cost Model

### Typical Conversation
```
User: "What should I do about my career?" (complexity analysis: 50ms)
  → Routes to Sonnet (complex + emotional)
  → Input: ~800 tokens (system + memory + message)
  → Output: ~300 tokens
  → Cost: ~$0.0031

User: "What time is it?" (complexity analysis: 30ms)
  → Routes to Haiku (simple factual)
  → Input: ~200 tokens
  → Output: ~20 tokens
  → Cost: ~$0.0001
```

### Daily Batch Processing
- Nightly consolidation with Opus (batch discount)
- Memory consolidation and deduplication
- Emotional pattern updates
- Model fine-tuning preparation

## Scalability Considerations

### MVP (Current)
- In-memory storage (single process only)
- No database
- Suitable for prototyping and single-user testing

### Production (PostgreSQL)
- Persistent user data
- Session recovery
- Multiple server instances possible

### Future (Vector DB)
- Weaviate integration for semantic search
- Better memory relevance ranking
- More sophisticated context selection

## Security Considerations

### Data Privacy
- Users own their conversation history
- Nyra never trains on user data (by design)
- Local storage of user IDs and memories

### API Keys
- Claude API key in environment variables only
- No logging of sensitive data
- CORS configuration for web deployment

## Performance Optimizations

### Context Compression
- Semantic fragments instead of full history: ~50% token savings
- Emotional state summary instead of conversation replay: ~60% tokens
- Last 2 turns only for context: removes unnecessary history

### Smart Routing
- Haiku 4x cheaper than Sonnet for appropriate messages
- Heuristic analysis in <50ms (no API call)
- Average 40-60% cost savings vs. using Sonnet for everything

### Caching
- System prompt cached on app open
- Memory relevance scores cached per session
- Context reusable across messages in session

## Deployment

### Local Development
```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

### Docker
```bash
docker build -t nyra .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... nyra
```

### Railway
- Auto-detected Dockerfile
- Environment variables in dashboard
- Health checks configured
- Auto-restart on failure

## Future Roadmap

### Near Term
- PostgreSQL persistence
- Weaviate vector DB integration
- User-facing memory management UI
- Advanced emotional state ML

### Medium Term
- Voice input/output (Eleven Labs)
- Multi-modal understanding
- Privacy-preserving federated learning
- Cross-device conversation sync

### Long Term
- Decentralized identity
- Marketplace for specialized Nyras
- Personalized model fine-tuning
- Open-source Samantha replacement
