// Test-only env defaults. Real values come from CI / .env.test.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.PORT = process.env.PORT ?? '0';
process.env.API_KEY_BCRYPT_COST = process.env.API_KEY_BCRYPT_COST ?? '4';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://okoro:okoro@localhost:5432/okoro_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
