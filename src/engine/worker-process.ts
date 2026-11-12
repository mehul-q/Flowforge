import { Pool } from 'pg';
import { claimStep } from './claim';
import { heartbeat } from './heartbeat';
import { runIdempotentEffect } from './effects';
import { failpoint } from './failpoint';

const workerId = process.argv[2] || 'worker-unknown';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
    ?? 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
  max: 5,
});

async function loop(): Promise<void> {
  while (true) {
    let step;
    try {
      step = await claimStep(pool, workerId);
    } catch (e: any) {
      console.error(`[${workerId}] claim error:`, JSON.stringify(e, null, 2));
      await new Promise(r => setTimeout(r, 200));
      continue;
    }

    if (!step) {
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
            // Check if the entire run is finished
      const { rows: runCheck } = await pool.query(`
        SELECT COUNT(*) AS total, 
               COUNT(*) FILTER (WHERE status = 'SUCCEEDED') AS succeeded,
               COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
        FROM steps WHERE run_id = $1`, 
        [step.run_id]
      );
      
      const { total, succeeded, failed } = runCheck[0];
      if (Number(total) === Number(succeeded)) {
        await pool.query(`UPDATE runs SET status='SUCCEEDED', updated_at=now() WHERE id=$1`, [step.run_id]);
      } else if (Number(failed) > 0) {
        await pool.query(`UPDATE runs SET status='FAILED', updated_at=now() WHERE id=$1`, [step.run_id]);
      }
    } catch (e: any) {
      console.error(`[${workerId}] step error:`, JSON.stringify(e, null, 2));
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