/** Deterministic environment for the e2e suite; no database or Redis is required. */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL ??= 'postgresql://birem:birem@127.0.0.1:5432/birem_test';
delete process.env.DATABASE_POOL_URL;
delete process.env.REDIS_URL;
process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-e2e-access-secret-0123456789';
process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-e2e-refresh-secret-0123456789';
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
process.env.API_PORT = '4999';
