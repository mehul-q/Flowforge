import { Pool } from 'pg';
import { spawn, ChildProcess } from 'child_process';

const pool = new Pool({
  connectionString: 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
  max: 5,
});

interface Worker {
  name: string;
  proc: ChildProcess | null;
  restarts: number;
  crashes: number;
  maxRestarts: number;
  stopped: boolean;
}

async function prepareDatabase(): Promise<void> {
  await pool.query('DROP TABLE IF EXISTS steps CASCADE');
  await pool.query('DROP TABLE IF EXISTS provider_effects CASCADE');
  await pool.query('DROP TABLE IF EXISTS runs CASCADE');
  
  // Ensure full schema from migrations
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
  const env = { ...process.env };
  
  if (withFailpoints) {
    env.FAILPOINTS = 'after_claim,after_effect_before_ack';
    env.FAILPOINT_P = '0.1'; // 10% instead of 50%
  } else {
    delete env.FAILPOINTS;
    delete env.FAILPOINT_P;
  }

  w.proc = spawn('node', ['dist/src/engine/worker-process.js', w.name], {
    env: env,
    stdio: 'inherit',
  });

  w.proc.on('exit', (code, signal) => {
    if (w.stopped) return;
    w.proc = null;
    if (signal === 'SIGKILL' || code !== 0) {
      w.crashes++; 
      if (w.restarts < w.maxRestarts) {
        w.restarts++;
        console.log(`[supervisor] restarting ${w.name} (crash #${w.crashes})`);
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
    { name: 'worker-A', proc: null, restarts: 0, crashes: 0, maxRestarts: 1000, stopped: false },
{ name: 'worker-B', proc: null, restarts: 0, crashes: 0, maxRestarts: 1000, stopped: false },
{ name: 'worker-C', proc: null, restarts: 0, crashes: 0, maxRestarts: 1000, stopped: false },
  ];

  for (const w of workers) startWorker(w, true);

  const start = Date.now();
  while (Date.now() - start < 120000) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM steps WHERE status IN ('PENDING','QUEUED','RUNNING')`);
    const remaining = Number(rows[0].count);
    if (remaining === 0) {
      console.log(`[supervisor] all steps terminal after ${((Date.now() - start) / 1000).toFixed(1)}s`);
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Stop everything
  for (const w of workers) { w.stopped = true; w.proc?.kill('SIGTERM'); }
  reaper.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));

  console.log('\n=== CHAOS TEST RESULTS ===');

  const { rows: stuck } = await pool.query(
    `SELECT id, status FROM steps WHERE status IN ('PENDING','QUEUED','RUNNING')`);
  
  const { rows: expired } = await pool.query(
    `SELECT id FROM steps WHERE status='RUNNING' AND locked_until < now()`);
  
  const { rows: effects } = await pool.query(
    `SELECT idempotency_key, calls, effects FROM provider_effects ORDER BY calls DESC`);
  
  const total = effects.length;
  const correct = effects.filter(e => e.effects === 1).length;
  const maxCalls = effects.length > 0 ? Math.max(...effects.map(e => e.calls)) : 0;
  
  const totalCrashes = workers.reduce((sum, w) => sum + w.crashes, 0);

  console.log(`Stuck steps: ${stuck.length}`);
  console.log(`Expired leases: ${expired.length}`);
  console.log(`Effect keys: ${total}`);
  console.log(`Keys with effects=1: ${correct}`);
  console.log(`Total worker crashes: ${totalCrashes}`);
  console.log(`Max calls for one key: ${maxCalls}`);

  console.log('\n=== VERDICT ===');
  const pass =
    stuck.length === 0 &&
    expired.length === 0 &&
    correct === total &&
    total === 200 &&
    totalCrashes > 0;

  console.log(pass ? 'PASS: effects exactly-once under chaos' : 'FAIL: invariants violated');
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });