import { Pool } from 'pg';
import { claimStep, Step } from './claim';
import { heartbeat } from './heartbeat';
import { failpoint } from './failpoint';

export type StepHandler = (step: Step) => Promise<any>;

export interface WorkerOptions {
  workerId: string;
  stepHandlers: Record<string, StepHandler>;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
}

export async function runWorkerOnce(
  pool: Pool,
  opts: WorkerOptions,
): Promise<boolean> {
  const {
    workerId,
    stepHandlers,
    heartbeatMs = 10000,
  } = opts;

  const step = await claimStep(pool, workerId);
  if (!step) return false;

  failpoint('after_claim');

  const handler = stepHandlers[step.name];
  if (!handler) {
    await markFailure(pool, step.id, workerId,
      `no handler registered for step name: ${step.name}`);
    return true;
  }

  let leaseLost = false;
  let hbError: Error | null = null;

  const hbTimer = setInterval(async () => {
    try {
      const ok = await heartbeat(pool, step.id, workerId);
      if (!ok) leaseLost = true;
    } catch (e) {
      hbError = e as Error;
    }
  }, heartbeatMs);

  try {
    const result = await handler(step);

    failpoint('after_effect_before_ack');

    if (leaseLost) {
      console.log(`worker ${workerId}: lease lost, discarding result for ${step.id}`);
      return true;
    }

    const { rowCount } = await pool.query(`
      UPDATE steps SET
        status = 'SUCCEEDED',
        output = $3,
        locked_by = NULL,
        locked_until = NULL,
        updated_at = now()
      WHERE id = $1 AND locked_by = $2 AND status = 'RUNNING'`,
      [step.id, workerId, result === undefined ? null : result]);

    if (rowCount === 0) {
      console.log(`worker ${workerId}: markSuccess affected 0 rows (lease lost) for ${step.id}`);
    }
  } catch (e) {
    if (!leaseLost) {
      await markFailure(pool, step.id, workerId, (e as Error).message);
    }
  } finally {
    clearInterval(hbTimer);
  }

  if (hbError) throw hbError;
  return true;
}

async function markFailure(
  pool: Pool,
  stepId: string,
  workerId: string,
  message: string,
): Promise<void> {
  await pool.query(`
    UPDATE steps SET
      status = 'FAILED',
      locked_by = NULL,
      locked_until = NULL,
      updated_at = now()
    WHERE id = $1 AND locked_by = $2 AND status = 'RUNNING'`,
    [stepId, workerId]);
}