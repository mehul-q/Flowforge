import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runIdempotentEffect } from '../src/engine/effects';

const pool = new Pool({
  connectionString: 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
});

beforeAll(async () => {
  await pool.query('DROP TABLE IF EXISTS provider_effects CASCADE');
  await pool.query(`
    CREATE TABLE provider_effects (
      idempotency_key TEXT PRIMARY KEY,
      calls INT NOT NULL DEFAULT 0,
      effects INT NOT NULL DEFAULT 0,
      result JSONB
    )`);
});

afterAll(async () => { await pool.end(); });
beforeEach(async () => { await pool.query('DELETE FROM provider_effects'); });

describe('runIdempotentEffect', () => {
  it('runs the effect once when called once', async () => {
    let effectCount = 0;
    const result = await runIdempotentEffect(pool, 'key-1', async () => {
      effectCount++;
      return { id: 'charge-123' };
    });
    expect(result).toEqual({ id: 'charge-123' });
    expect(effectCount).toBe(1);
    const { rows } = await pool.query('SELECT * FROM provider_effects');
    expect(rows[0].calls).toBe(1);
    expect(rows[0].effects).toBe(1);
  });

  it('does NOT run effect twice for same key (cached result)', async () => {
    let effectCount = 0;
    const effect = async () => { effectCount++; return { id: 'charge-123' }; };
    await runIdempotentEffect(pool, 'key-1', effect);
    const result = await runIdempotentEffect(pool, 'key-1', effect);
    expect(effectCount).toBe(1);
    expect(result).toEqual({ id: 'charge-123' });
    const { rows } = await pool.query('SELECT * FROM provider_effects');
    expect(rows[0].calls).toBe(2);
    expect(rows[0].effects).toBe(1);
  });

  it('different keys run independently', async () => {
    let effectCount = 0;
    const effect = async () => { effectCount++; return { id: 'x' }; };
    await runIdempotentEffect(pool, 'key-1', effect);
    await runIdempotentEffect(pool, 'key-2', effect);
    expect(effectCount).toBe(2);
  });
});