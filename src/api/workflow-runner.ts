import { Pool } from 'pg';

export interface WorkflowDefinition {
  name: string;
  steps: Array<{ name: string; depends_on?: string[] }>;
}

export interface RunInput {
  workflowName: string;
  input?: any;
}

/**
 * Creates a run and its steps. Steps start as PENDING and are
 * promoted to QUEUED only when their dependencies are SUCCEEDED.
 * For the MVP, we promote steps with no dependencies immediately.
 */
export async function createRun(
  pool: Pool,
  input: RunInput,
  workflow: WorkflowDefinition,
): Promise<{ runId: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: runRows } = await client.query(
      `INSERT INTO runs (workflow_name, status, input)
       VALUES ($1, 'PENDING', $2) RETURNING id`,
      [workflow.name, input.input ?? null],
    );
    const runId = runRows[0].id;

    for (const stepDef of workflow.steps) {
      const id = crypto.randomUUID();
      const idempotencyKey = `${runId}:${stepDef.name}`;
      const ready = !stepDef.depends_on || stepDef.depends_on.length === 0;
      await client.query(
        `INSERT INTO steps
           (id, run_id, name, depends_on, status, idempotency_key, input)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id, runId, stepDef.name,
          stepDef.depends_on ?? [],
          ready ? 'QUEUED' : 'PENDING',
          idempotencyKey,
          input.input ?? null,
        ],
      );
    }

    await client.query('COMMIT');
    return { runId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}