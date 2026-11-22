-- Runs once, when the Postgres volume is first created.
-- pgcrypto: gen_random_uuid() and hashing helpers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pg_trgm: fast fuzzy search for question/book titles (future).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
