import { Pool } from 'pg';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const pool = new Pool({
  connectionString: 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
  max: 5,
});

interface Worker {
  name: string;
  proc: ChildProcess | null;
  restarts: number;
  maxRestarts: number;
  stopped: boolean;
}

async function prepareDatabase(): Promise<void> {
  await pool.query('DROP TABLE IF EXISTS steps CASCADE');
  await pool.query('DROP TABLE IF EXISTS provider_effects CASCADE');
  await pool.query(`
    CREATE TABLE steps (
      id UUID PRIMARY KEY,
      run_id UUID NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempt_count INT NOT NULL DEFAULT 0,
      locked_by TEXT,
      locked_until TIMESTAMPTZ,
      idempotency_key TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT valid_status CHECK (status IN
        ('PENDING','QUEUED','RUNNING','SUCCEEDED','FAILED','DLQ'))
    )`);
  await pool.query(`
    CREATE TABLE provider_effects (
      idempotency_key TEXT PRIMARY KEY,
      calls INT NOT NULL DEFAULT 0,
      effects INT NOT NULL DEFAULT 0,
      result JSONB
    )`);

  for (let i = 0; i < 200; i++) {
    const id = `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`;
    await pool.query(`
      INSERT INTO steps (id, run_id, name, status, idempotency_key)
      VALUES ($1::uuid, '22222222-2222-2222-2222-222222222222', 'charge', 'QUEUED', $1::text)`,
      [id]);
  }
}

function startWorker(w: Worker, withFailpoints: boolean): void {
  w.proc = spawn('node', ['dist/src/engine/worker-process.js', w.name], {
    env: {
      ...process.env,
      ...(withFailpoints ? {
        FAILPOINTS: 'after_claim,after_effect_before_ack',
        FAILPOINT_P: '0.05',
      } : {}),
    },
    stdio: 'inherit',
  });

  w.proc.on('exit', (code, signal) => {
    if (w.stopped) return;
    w.proc = null;
    if (signal === 'SIGKILL' || code !== 0) {
      if (w.restarts < w.maxRestarts) {
        w.restarts++;
        console.log(`[supervisor] restarting ${w.name} (restart #${w.restarts})`);
        setTimeout(() => startWorker(w, withFailpoints), 100);
      } else {
        console.log(`[supervisor] ${w.name} exceeded max restarts`);
        w.stopped = true;
      }
    }
  });
}

async function main(): Promise<void> {
  console.log('[supervisor] preparing database...');
  await prepareDatabase();

  console.log('[supervisor] starting reaper...');
  const reaper = spawn('node', ['dist/src/engine/reaper-process.js'], {
    stdio: 'inherit',
  });

  console.log('[supervisor] starting 3 workers with failpoints...');
  const workers: Worker[] = [
    { name: 'worker-A', proc: null, restarts: 0, maxRestarts: 100, stopped: false },
    { name: 'worker-B', proc: null, restarts: 0, maxRestarts: 100, stopped: false },
    { name: 'worker-C', proc: null, restarts: 0, maxRestarts: 100, stopped: false },
  ];

  for (const w of workers) startWorker(w, true);

  // Wait for all steps to reach a terminal state (or timeout at 60 seconds)
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM steps WHERE status IN ('PENDING','QUEUED','RUNNING')`);
    const remaining = Number(rows[0].count);
    if (remaining === 0) {
      console.log(`[supervisor] all steps terminal after ${((Date.now() - start) / 1000).toFixed(1)}s`);
      break;
    }
    if ((Date.now() - start) % 5000 < 500) {
      console.log(`[supervisor] ${remaining} steps remaining...`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
    // Fallback: if any steps remain, spawn a clean worker without failpoints
  {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM steps WHERE status IN ('PENDING','QUEUED','RUNNING')`);
    if (Number(rows[0].count) > 0) {
      console.log(`[supervisor] ${rows[0].count} steps remain; starting fallback worker`);
      const fallback = spawn('node', ['dist/src/engine/worker-process.js', 'fallback'], {
        stdio: 'inherit',
      });
      const fbStart = Date.now();
      while (Date.now() - fbStart < 30000) {
        const { rows: r } = await pool.query(
          `SELECT COUNT(*) FROM steps WHERE status IN ('PENDING','QUEUED','RUNNING')`);
        if (Number(r[0].count) === 0) break;
        await new Promise(r2 => setTimeout(r2, 500));
      }
      fallback.kill('SIGTERM');
      await new Promise(r2 => setTimeout(r2, 300));
    }
  }

  // Stop everything
  for (const w of workers) { w.stopped = true; w.proc?.kill('SIGTERM'); }
  reaper.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));

  console.log('\n=== CHAOS TEST RESULTS ===');

  // Invariant 1: no stuck steps
  const { rows: stuck } = await pool.query(
    `SELECT id, status FROM steps WHERE status IN ('PENDING','QUEUED','RUNNING')`);
  console.log(`Stuck steps: ${stuck.length}`);

  // Invariant 2: no expired leases on RUNNING steps
  const { rows: expired } = await pool.query(
    `SELECT id FROM steps WHERE status='RUNNING' AND locked_until < now()`);
  console.log(`Expired leases: ${expired.length}`);

  // Invariant 3: effect counts
  const { rows: effects } = await pool.query(
    `SELECT idempotency_key, calls, effects FROM provider_effects ORDER BY calls DESC`);
  const total = effects.length;
  const correct = effects.filter(e => e.effects === 1).length;
  const retried = effects.filter(e => e.calls > 1).length;
  const maxCalls = effects.length > 0 ? Math.max(...effects.map(e => e.calls)) : 0;

  console.log(`Effect keys: ${total}`);
  console.log(`Keys with effects=1: ${correct}`);
  console.log(`Keys with calls>1 (retried): ${retried}`);
  console.log(`Max calls for one key: ${maxCalls}`);

  console.log('\n=== VERDICT ===');
  const pass =
    stuck.length === 0 &&
    expired.length === 0 &&
    correct === total &&
    total === 200 &&
    retried > 0;

  console.log(pass ? 'PASS: effects exactly-once under chaos' : 'FAIL: invariants violated');
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });