const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      ebay_user_id TEXT UNIQUE NOT NULL,
      ebay_username TEXT,
      refresh_token_encrypted TEXT NOT NULL,
      item_limit INTEGER NOT NULL DEFAULT 10,
      keywords JSONB NOT NULL DEFAULT '[]',
      max_views INTEGER NOT NULL DEFAULT 0,
      days_left_threshold INTEGER NOT NULL DEFAULT 15,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE clients ADD COLUMN IF NOT EXISTS max_views INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS days_left_threshold INTEGER NOT NULL DEFAULT 15;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS schedule_hours INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS max_sold_count INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS runs (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      status TEXT NOT NULL DEFAULT 'running',
      log TEXT NOT NULL DEFAULT '',
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{"ended":[],"resold":[]}';
  `);
}

module.exports = { pool, migrate };
