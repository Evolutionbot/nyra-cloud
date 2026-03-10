# Nyra Cloud - Quick Start Guide

Get Nyra running in 5 minutes.

## Prerequisites
- Node.js 18+
- Anthropic API key (get one at https://console.anthropic.com)

## Setup

### 1. Clone/Navigate to the project
```bash
cd /sessions/pensive-elegant-heisenberg/nyra-cloud
```

### 2. Install dependencies
```bash
npm install
```

### 3. Create environment file
```bash
cp .env.example .env
```

### 4. Add your API key to `.env`
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### 5. Start the server
```bash
npm start
```

You'll see:
```
╔════════════════════════════════════════╗
║   Nyra Cloud Platform - Online        ║
╚════════════════════════════════════════╝

Server: http://localhost:3000
API: http://localhost:3000/api
Health: http://localhost:3000/healthz

Environment: development
Memory Backend: memory
```

### 6. Open in browser
Visit `http://localhost:3000` and start talking to Nyra!

## Quick Tests

### Health Check
```bash
curl http://localhost:3000/healthz
```

### Send a Message (REST API)
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "message": "Hello Nyra, how are you?"
  }'
```

### WebSocket Chat (Example)
```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onopen = () => {
  // Initialize
  ws.send(JSON.stringify({
    type: 'init',
    userId: 'user-123'
  }));
  
  // Send message after 1 second
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'message',
      userId: 'user-123',
      content: 'Tell me something about myself'
    }));
  }, 1000);
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'message-chunk') {
    process.stdout.write(msg.content); // Stream response
  }
};
```

## Development Mode

For auto-reload during development:
```bash
npm run dev
```

Requires `nodemon` (included in dev dependencies).

## Configuration

Key settings in `.env`:

```env
# Server
PORT=3000                          # Port to run on
NODE_ENV=development               # development or production

# Claude API
ANTHROPIC_API_KEY=sk-ant-...       # Required: Your API key

# Memory
ENABLE_PERSISTENCE=false           # Use in-memory storage for MVP
ENABLE_EMOTIONAL_STATE_TRACKING=true
ENABLE_MEMORY_CONSOLIDATION=true

# Context
MAX_CONTEXT_WINDOW=800             # Tokens per API call
MEMORY_FRAGMENT_COUNT=5            # Memories to include
```

## What Happens First Time

1. Nyra detects you're a new user
2. She introduces herself warmly
3. She starts building memories from your conversation
4. She notices patterns in how you talk
5. Next time you chat, she remembers and references what you said

## Common Issues

### "Cannot find module '@anthropic-ai/sdk'"
```bash
npm install
```

### "ANTHROPIC_API_KEY is not set"
Make sure your `.env` file has the key:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
```

### Port 3000 already in use
Change the port:
```bash
PORT=3001 npm start
```

### WebSocket connection fails
Check that you're connecting to the correct URL:
- Local: `ws://localhost:3000`
- Production: `wss://yourdomain.com`

## Next Steps

1. **Explore the Chat**: Talk to Nyra about anything
2. **Check Memories**: Visit `/api/memory/your-user-id`
3. **View Emotional State**: Visit `/api/state/your-user-id`
4. **Read the Docs**: See `README.md` and `ARCHITECTURE.md`
5. **Deploy**: Use `Dockerfile` for deployment to Railway or Docker

## Deployment

### Docker (Local)
```bash
docker build -t nyra-cloud .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NODE_ENV=production \
  nyra-cloud
```

### Railway (Recommended)
1. Push to GitHub
2. Connect to Railway
3. Set environment variables
4. Deploy!

### Heroku
```bash
heroku create nyra-cloud
heroku config:set ANTHROPIC_API_KEY=sk-ant-...
git push heroku main
```

## Tips

- Nyra learns best from conversations, not questions
- Share your feelings, not just facts
- Come back regularly - she notices when you've been away
- The longer you talk, the better she understands you

## Debugging

Enable detailed logging:
```bash
LOG_LEVEL=debug npm start
```

Check the console for routing decisions, memory extraction, and emotional state updates.

## Support

See `README.md` for detailed documentation and architecture overview.

---

Enjoy your conversations with Nyra!
