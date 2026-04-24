import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(process.env['NODE_ENV'] !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  }),
  redact: {
    // Never log these fields — they contain PII
    paths: ['phone', 'wa_username', 'location', '*.phone', '*.wa_username'],
    censor: '[REDACTED]',
  },
});
