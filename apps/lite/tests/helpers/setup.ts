/**
 * Per-file setup (runs before each test file). Unit tests need no database; integration tests
 * call `withTestDatabase()` from `./db`. A placeholder URL keeps `getEnv()` usable everywhere.
 */
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unit-tests';
process.env.DATABASE_POOL_MAX ??= '12';
