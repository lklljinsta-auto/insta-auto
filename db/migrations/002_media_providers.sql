CREATE TABLE IF NOT EXISTS provider_settings (
  stage text PRIMARY KEY CHECK (stage IN ('source_analysis','caption','image','video','audio','storage')),
  provider text NOT NULL,
  model text,
  secret_ref text,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_media_folders (
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('feed','reels')),
  provider text NOT NULL,
  remote_folder_id text NOT NULL,
  folder_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,kind,provider),
  UNIQUE(provider,remote_folder_id)
);
CREATE TABLE IF NOT EXISTS storage_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('feed','reels')),
  content_sha256 text NOT NULL,
  filename text NOT NULL,
  provider text NOT NULL,
  remote_file_id text,
  state text NOT NULL CHECK(state IN ('pending','uploaded','verified','retryable_error','unknown_result')),
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_uploads_account_idx ON storage_uploads(account_id,created_at DESC);
