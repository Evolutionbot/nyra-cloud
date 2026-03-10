require('dotenv').config();

module.exports = {
  // Server Configuration
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
  isProduction: (process.env.NODE_ENV || 'development') === 'production',

  // Claude API Configuration
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    endpoint: process.env.ANTHROPIC_API_ENDPOINT || 'https://api.anthropic.com',
    models: {
      haiku: 'claude-3-5-haiku-20241022',
      sonnet: 'claude-3-5-sonnet-20241022',
      opus: 'claude-3-opus-20250219',
    },
  },

  // Database Configuration
  database: {
    enabled: process.env.DATABASE_URL !== undefined,
    url: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    name: process.env.DATABASE_NAME || 'nyra',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
  },

  // Memory Configuration
  memory: {
    backend: process.env.MEMORY_BACKEND || 'memory',
    fragmentCount: parseInt(process.env.MEMORY_FRAGMENT_COUNT || '5'),
    maxContextWindow: parseInt(process.env.MAX_CONTEXT_WINDOW || '800'),
  },

  // Vector Database Configuration
  vectorDb: {
    enabled: process.env.VECTOR_DB_ENABLED === 'true',
    url: process.env.VECTOR_DB_URL || 'http://localhost:8080',
  },

  // Feature Flags
  features: {
    persistence: process.env.ENABLE_PERSISTENCE === 'true',
    emotionalStateTracking: process.env.ENABLE_EMOTIONAL_STATE_TRACKING !== 'false',
    memoryConsolidation: process.env.ENABLE_MEMORY_CONSOLIDATION !== 'false',
  },

  // API Configuration
  api: {
    corsOrigin: process.env.CORS_ORIGIN || '*',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
