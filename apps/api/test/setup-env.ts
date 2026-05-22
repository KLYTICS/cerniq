// Test-only env defaults. Real values come from CI / .env.test.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.PORT = process.env.PORT ?? '0';
process.env.API_KEY_BCRYPT_COST = process.env.API_KEY_BCRYPT_COST ?? '4';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://aegis:aegis@localhost:5432/aegis_test?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
// The WorkOS module factory throws at boot if WORKOS_API_KEY is missing,
// even though no test calls the WorkOS adapter. Supply a placeholder so
// the AppModule can compile; the `new WorkOS(...)` constructor itself is
// inert and makes no network calls. Real WorkOS-dependent paths would
// need to mock the client.
process.env.WORKOS_API_KEY = process.env.WORKOS_API_KEY ?? 'test_placeholder_workos_api_key';
process.env.WORKOS_COOKIE_PASSWORD =
  process.env.WORKOS_COOKIE_PASSWORD ?? 'test_placeholder_cookie_password_32_chars_min';
