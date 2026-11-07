import { Pool } from 'pg';

export async function heartbeat(
  pool: Pool,
  stepId: string,
  workerId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(`
    UPDATE steps SET locked_until = now() + interval '30 seconds'
    WHERE id = $1 AND locked_by = $2 AND status = 'RUNNING'`,
    [stepId, workerId]);
  return rowCount === 1;
}