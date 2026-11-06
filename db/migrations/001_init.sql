CREATE TABLE steps (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count INT NOT NULL DEFAULT 0,
  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN
    ('PENDING','QUEUED','RUNNING','SUCCEEDED','FAILED','DLQ'))
);

CREATE INDEX idx_steps_ready ON steps (status, updated_at)
  WHERE status = 'QUEUED';