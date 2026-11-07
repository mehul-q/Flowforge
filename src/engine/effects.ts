import { Pool } from 'pg';

export async function runIdempotentEffect<T>(
  pool: Pool,
  key: string,
  effect: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      INSERT INTO provider_effects (idempotency_key, calls, effects, result)
      VALUES ($1, 1, 0, NULL)
      ON CONFLICT (idempotency_key) DO UPDATE
        SET calls = provider_effects.calls + 1
      RETURNING calls, effects, result`, [key]);

    const row = rows[0];

    if (row.effects === 1) {
      // Effect already ran; return cached result
      await client.query('COMMIT');
      return row.result as T;
    }

    // First time (or crash before effect): run it
    const result = await effect();

    await client.query(`
      UPDATE provider_effects
      SET effects = 1, result = $2
      WHERE idempotency_key = $1`, [key, result]);

    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}