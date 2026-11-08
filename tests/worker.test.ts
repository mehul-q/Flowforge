import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runWorkerOnce } from '../src/engine/worker';

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
      output JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT valid_status CHECK (status IN
        ('PENDING','QUEUED','RUNNING','SUCCEEDED','FAILED','DLQ'))
    )`);
});

afterAll(async () => { await pool.end(); });
beforeEach(async () => { await pool.query('DELETE FROM steps'); });

describe('runWorkerOnce', () => {
  it('claims a step, runs handler, marks SUCCEEDED with output', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222', 'charge', 'QUEUED')`);

    const ran = await runWorkerOnce(pool, {
      workerId: 'worker-A',
      stepHandlers: {
        charge: async (step) => ({ charged: true, stepId: step.id }),
      },
    });

    expect(ran).toBe(true);
    const { rows } = await pool.query('SELECT status, output FROM steps');
    expect(rows[0].status).toBe('SUCCEEDED');
    expect(rows[0].output).toEqual({ charged: true, stepId: '11111111-1111-1111-1111-111111111111' });
  });

  it('returns false when queue is empty', async () => {
    const ran = await runWorkerOnce(pool, {
      workerId: 'worker-A',
      stepHandlers: {},
    });
    expect(ran).toBe(false);
  });

  it('marks FAILED when handler throws', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222', 'charge', 'QUEUED')`);

    await runWorkerOnce(pool, {
      workerId: 'worker-A',
      stepHandlers: {
        charge: async () => { throw new Error('provider timeout'); },
      },
    });

    const { rows } = await pool.query('SELECT status FROM steps');
    expect(rows[0].status).toBe('FAILED');
  });

  it('marks FAILED when no handler is registered for step name', async () => {
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status)
      VALUES ('11111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222', 'charge', 'QUEUED')`);

    await runWorkerOnce(pool, {
      workerId: 'worker-A',
      stepHandlers: {},
    });

    const { rows } = await pool.query('SELECT status FROM steps');
    expect(rows[0].status).toBe('FAILED');
  });
});