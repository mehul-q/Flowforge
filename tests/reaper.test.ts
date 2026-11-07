import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { reaperTick } from '../src/engine/reaper';

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

describe('reaperTick', () => {
  it('re-queues RUNNING steps whose lease expired', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status, locked_by, locked_until)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222', 'charge', 'RUNNING',
              'worker-A', now() - interval '1 minute')`);
    const count = await reaperTick(pool);
    expect(count).toBe(1);
    const { rows } = await pool.query('SELECT status, locked_by, locked_until FROM steps');
    expect(rows[0].status).toBe('QUEUED');
    expect(rows[0].locked_by).toBeNull();
    expect(rows[0].locked_until).toBeNull();
  });

  it('does not touch RUNNING steps with valid lease', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status, locked_by, locked_until)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222', 'charge', 'RUNNING',
              'worker-A', now() + interval '10 seconds')`);
    const count = await reaperTick(pool);
    expect(count).toBe(0);
    const { rows } = await pool.query('SELECT status FROM steps');
    expect(rows[0].status).toBe('RUNNING');
  });

  it('two concurrent reapers: only one does work, but all steps re-queued', async () => {
    for (let i = 0; i < 10; i++) {
      await pool.query(`
        INSERT INTO steps (id, run_id, name, status, locked_by, locked_until)
        VALUES ($1, '22222222-2222-2222-2222-222222222222', 'charge',
                'RUNNING', 'worker-A', now() - interval '1 minute')`,
        [`${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`]);
    }
    const [a, b] = await Promise.all([reaperTick(pool), reaperTick(pool)]);
    expect(a + b).toBe(10);
    const { rows } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='QUEUED') AS queued FROM steps`);
    expect(Number(rows[0].queued)).toBe(10);
  });
});