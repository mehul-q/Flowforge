import { Pool } from 'pg';
import { reaperTick } from './reaper';

const pool = new Pool({
  connectionString: 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
});

async function loop(): Promise<void> {
  while (true) {
    try {
      const count = await reaperTick(pool);
      if (count > 0) console.log(`[reaper] re-queued ${count} expired leases`);
    } catch (e) {
      console.error('[reaper] error:', (e as Error).message);
    }
    await new Promise(r => setTimeout(r, 200));
  }
}

loop().catch(e => { console.error(e); process.exit(1); });