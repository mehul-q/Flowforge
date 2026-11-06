import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL
    ?? 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
  max: 10,
});