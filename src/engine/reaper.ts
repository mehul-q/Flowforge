import { Pool } from 'pg';

export async function reaperTick(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Try to acquire the tick lock. If another reaper holds it, return 0.
    const lock = await client.query(
      `SELECT pg_try_advisory_xact_lock(42) AS locked`);
    if (!lock.rows[0].locked) {
      await client.query('ROLLBACK');
      return 0;
    }

    const { rowCount } = await client.query(`
      UPDATE steps SET
        status = 'QUEUED',
        locked_by = NULL,
        locked_until = NULL,
        updated_at = now()
      WHERE status = 'RUNNING' AND locked_until < now()`);

    await client.query('COMMIT');
    return rowCount ?? 0;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}