import { Pool } from 'pg';
import { claimStep } from './claim';
import { heartbeat } from './heartbeat';
import { runIdempotentEffect } from './effects';
import { failpoint } from './failpoint';

const workerId = process.argv[2] || 'worker-unknown';

const pool = new Pool({
  connectionString: 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
  max: 5,
});

async function loop(): Promise<void> {
  while (true) {
    let step;
    try {
      step = await claimStep(pool, workerId);
    } catch (e) {
      console.error(`[${workerId}] claim error:`, (e as Error).message);
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    if (!step) {
      // No work available; wait and try again
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    failpoint('after_claim');

    try {
      await runIdempotentEffect(pool, step.idempotency_key ?? step.id, async () => {
        return { charged: true, stepId: step!.id, workerId };
      });

      failpoint('after_effect_before_ack');

      const { rowCount } = await pool.query(`
        UPDATE steps SET
          status='SUCCEEDED', locked_by=NULL, locked_until=NULL, updated_at=now()
        WHERE id=$1 AND locked_by=$2 AND status='RUNNING'`,
        [step.id, workerId]);

      if (rowCount === 0) {
        console.log(`[${workerId}] lease lost for ${step.id} (effect safe, result discarded)`);
      }
    } catch (e) {
      console.error(`[${workerId}] step error:`, (e as Error).message);
      await pool.query(`
        UPDATE steps SET
          status='FAILED', locked_by=NULL, locked_until=NULL, updated_at=now()
        WHERE id=$1 AND locked_by=$2 AND status='RUNNING'`,
        [step.id, workerId]);
    }
  }
}

loop().catch(e => {
  console.error(`[${workerId}] fatal:`, e);
  process.exit(1);
});