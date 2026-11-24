CREATE TABLE account_insight_settings (
  account_id uuid PRIMARY KEY REFERENCES ig_accounts ON DELETE CASCADE,
  delay_minutes integer NOT NULL CHECK (delay_minutes > 0),
  metrics text[] NOT NULL CHECK (cardinality(metrics)>0)
);
CREATE TABLE post_insight_jobs (
  job_id uuid PRIMARY KEY REFERENCES scheduled_jobs ON DELETE CASCADE,
  publish_attempt_id uuid NOT NULL UNIQUE REFERENCES publish_attempts ON DELETE CASCADE,
  metrics text[] NOT NULL
);
