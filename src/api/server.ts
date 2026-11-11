import express from 'express';
import { Pool } from 'pg';
import { requireAuth, requireAdmin, signToken } from './auth';
import { createRun } from './workflow-runner';
import cors from 'cors';

const app = express();
app.use(cors()); // Allow all origins (for local dev)
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
    ?? 'postgresql://flowforge:flowforge@localhost:5432/flowforge',
  max: 10,
});

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Dev-only: issue a token. Remove before production.
app.post('/auth/dev-token', (req, res) => {
  const { role } = req.body;
  if (role !== 'admin' && role !== 'viewer') {
    res.status(400).json({ error: 'role must be admin or viewer' });
    return;
  }
  const token = signToken({ sub: `user-${role}`, role });
  res.json({ token });
});

// Create a workflow run
app.post('/api/runs', requireAuth, requireAdmin, async (req, res) => {
  const { workflowName, steps, input } = req.body;
  if (!workflowName || !Array.isArray(steps)) {
    res.status(400).json({ error: 'workflowName and steps required' });
    return;
  }
  try {
    const { runId } = await createRun(
      pool,
      { workflowName, input },
      { name: workflowName, steps },
    );
    res.status(201).json({ runId });
  } catch (e) {
    console.error('createRun error:', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Get run status
app.get('/api/runs/:id', requireAuth, async (req, res) => {
  try {
    const { rows: runRows } = await pool.query(
      'SELECT * FROM runs WHERE id=$1', [req.params.id]);
    if (runRows.length === 0) {
      res.status(404).json({ error: 'run not found' });
      return;
    }
    const { rows: stepRows } = await pool.query(
      'SELECT id, name, status, attempt_count, updated_at FROM steps WHERE run_id=$1 ORDER BY updated_at',
      [req.params.id]);
    res.json({ run: runRows[0], steps: stepRows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});