import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { claimStep } from '../src/engine/claim';

const pool = new Pool({
  connectionString: 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
});

beforeAll(async () => {
  await pool.query('DROP TABLE IF EXISTS steps CASCADE');
  await pool.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
  await pool.query(`
    CREATE TABLE steps (
      id UUID PRIMARY KEY,
      run_id UUID NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempt_count INT NOT NULL DEFAULT 0,
      locked_by TEXT,
      locked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT valid_status CHECK (status IN
        ('PENDING','QUEUED','RUNNING','SUCCEEDED','FAILED','DLQ'))
    )`);
});

afterAll(async () => { await pool.end(); });
beforeEach(async () => { await pool.query('DELETE FROM steps'); });

describe('claimStep', () => {
  it('claims one QUEUED step and marks it RUNNING', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              'charge', 'QUEUED')`);

    const claimed = await claimStep(pool, 'worker-A');

    expect(claimed).not.toBeNull();
    expect(claimed!.locked_by).toBe('worker-A');
    expect(claimed!.status).toBe('RUNNING');
    expect(claimed!.attempt_count).toBe(1);
    expect(claimed!.locked_until).toBeInstanceOf(Date);
  });

  it('returns null when no step is QUEUED', async () => {
    const claimed = await claimStep(pool, 'worker-A');
    expect(claimed).toBeNull();
  });

  it('two workers cannot claim the same step', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              'charge', 'QUEUED')`);

    const [a, b] = await Promise.all([
      claimStep(pool, 'worker-A'),
      claimStep(pool, 'worker-B'),
    ]);

    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });
});