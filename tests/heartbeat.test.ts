import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { claimStep } from '../src/engine/claim';
import { heartbeat } from '../src/engine/heartbeat';

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

describe('heartbeat', () => {
  it('returns true and extends lease when caller owns it', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222', 'charge', 'QUEUED')`);
    const claimed = await claimStep(pool, 'worker-A');
    const before = claimed!.locked_until!.getTime();
    await new Promise(r => setTimeout(r, 50));
    const ok = await heartbeat(pool, claimed!.id, 'worker-A');
    expect(ok).toBe(true);
    const { rows } = await pool.query(
      'SELECT locked_until FROM steps WHERE id=$1', [claimed!.id]);
    expect(rows[0].locked_until.getTime()).toBeGreaterThan(before);
  });

  it('returns false when caller lost the lease', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222', 'charge', 'QUEUED')`);
    const claimed = await claimStep(pool, 'worker-A');
    await pool.query(
      `UPDATE steps SET locked_by='worker-B' WHERE id=$1`, [claimed!.id]);
    const ok = await heartbeat(pool, claimed!.id, 'worker-A');
    expect(ok).toBe(false);
  });

  it('returns false when step is not RUNNING', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222', 'charge', 'QUEUED')`);
    const ok = await heartbeat(
      pool, '11111111-1111-1111-1111-111111111111', 'worker-A');
    expect(ok).toBe(false);
  });
});