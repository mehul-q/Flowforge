import express from 'express';
import { Pool } from 'pg';
import { requireAuth, requireAdmin, signToken } from './auth';
import { createRun } from './workflow-runner';
import cors from 'cors';
import Groq from 'groq-sdk';
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
// The AI Copilot Endpoint
app.post('/api/copilot', requireAuth, async (req, res) => {
  const { question } = req.body;
  if (!question) {
    res.status(400).json({ error: 'question required' });
    return;
  }

  try {
    // 1. Fetch the recent context from the DB so the AI knows what's happening
    const { rows: runs } = await pool.query(
      `SELECT id, workflow_name, status FROM runs ORDER BY created_at DESC LIMIT 5`
    );
    const { rows: steps } = await pool.query(
      `SELECT name, status, attempt_count FROM steps ORDER BY updated_at DESC LIMIT 20`
    );

    // 2. Build the prompt (this is the "grounding" the critic demanded)
    const systemPrompt = `You are the FlowForge Copilot. You help users understand their workflow runs.
Here is the current state of the database:
Recent Runs: ${JSON.stringify(runs)}
Recent Steps: ${JSON.stringify(steps)}

Answer the user's question accurately based ONLY on this data. Be concise, professional, and helpful.`;

    // 3. Ask the LLM
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ],
      model: 'openai/gpt-oss-120b',
    });

    const answer = chatCompletion.choices[0]?.message?.content || "I couldn't generate an answer.";
    
    // We also return the evidence we sent to the AI (so the user can verify it)
    res.json({ answer, evidence: { runs, steps } });

  } catch (e) {
    console.error('Copilot error:', e);
    res.status(500).json({ error: 'Failed to contact AI' });
  }
});
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});