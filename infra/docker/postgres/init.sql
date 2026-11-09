-- BI-Rem local Postgres bootstrap. Runs once, when the data volume is first created
-- (docker-entrypoint-initdb.d). The initial Prisma migration also issues
-- CREATE EXTENSION IF NOT EXISTS, so this file only makes the local database look like a
-- freshly provisioned Neon project, where both extensions are pre-installed.

\connect birem

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Secondary databases used by the test suites and by `prisma migrate diff` drift checks.
-- They are created here because Prisma's shadow database must exist when a URL is passed
-- explicitly, and the e2e suite defaults to the *_test database.
SELECT 'CREATE DATABASE birem_test OWNER birem'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'birem_test')\gexec

SELECT 'CREATE DATABASE birem_shadow OWNER birem'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'birem_shadow')\gexec

\connect birem_test
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect birem_shadow
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
