import { Pool } from 'pg';

export interface Step {
  id: string;
  run_id: string;
  name: string;
  status: string;
  attempt_count: number;
  locked_by: string | null;
  locked_until: Date | null;
  updated_at: Date;
}

export async function claimStep(
  pool: Pool,
  workerId: string,
): Promise<Step | null> {
  const { rows } = await pool.query<Step>(`
    UPDATE steps SET
      status = 'RUNNING',
      locked_by = $1,
      locked_until = now() + interval '30 seconds',
      attempt_count = attempt_count + 1,
      updated_at = now()
    WHERE id = (
      SELECT id FROM steps
      WHERE status = 'QUEUED'
      ORDER BY updated_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *`, [workerId]);
  return rows[0] ?? null;
}