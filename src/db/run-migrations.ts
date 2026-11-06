import { pool } from './pool';
import { migrate } from './migrate';

migrate(pool)
  .then(() => { console.log('migrations done'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });