CREATE TABLE IF NOT EXISTS operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS operating_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  target_size integer CHECK (target_size IS NULL OR target_size >= 0),
  template jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meta_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  login_mode text NOT NULL DEFAULT 'unified_login' CHECK (login_mode IN ('unified_login','instagram_login','facebook_login')),
  oauth_config_id text,
  redirect_uri text NOT NULL,
  media_delivery_origin text,
  secret_ref text,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'not_checked' CHECK (review_status IN ('not_checked','development','standard','advanced','rejected','unknown')),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (redirect_uri ~ '^https://')
);
CREATE TABLE IF NOT EXISTS group_meta_app_defaults (
  group_id uuid PRIMARY KEY REFERENCES operating_groups(id) ON DELETE CASCADE,
  meta_app_id uuid NOT NULL REFERENCES meta_apps(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_app_id uuid NOT NULL REFERENCES meta_apps(id),
  provider text NOT NULL DEFAULT 'meta',
  token_type text NOT NULL,
  encrypted_token text NOT NULL,
  token_key_version text NOT NULL,
  business_id text,
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  refresh_policy text NOT NULL DEFAULT 'provider_managed',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expiring','expired','revoked','refresh_failed','reauthorization_required')),
  last_success_at timestamptz,
  last_refresh_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS oauth_grants_status_expiry_idx ON oauth_grants(status, expires_at);
CREATE TABLE IF NOT EXISTS ig_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES operating_groups(id) ON DELETE SET NULL,
  profile_handle text,
  display_name text,
  meta_account_id text UNIQUE,
  account_type text,
  login_management_ip_note text,
  automation_mode text NOT NULL DEFAULT 'review' CHECK (automation_mode IN ('auto','review','paused')),
  publishing_enabled boolean NOT NULL DEFAULT false,
  connection_status text NOT NULL DEFAULT 'not_connected' CHECK (connection_status IN ('not_connected','connected','expiring','revoked','error','permission_missing')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (profile_handle IS NULL OR length(profile_handle) <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS ig_accounts_profile_handle_unique ON ig_accounts(lower(profile_handle)) WHERE profile_handle IS NOT NULL;
CREATE TABLE IF NOT EXISTS grant_accounts (
  grant_id uuid NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  meta_account_id text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (grant_id, account_id),
  UNIQUE (grant_id, meta_account_id)
);
CREATE TABLE IF NOT EXISTS account_oauth_connections (
  account_id uuid PRIMARY KEY REFERENCES ig_accounts(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL REFERENCES oauth_grants(id),
  meta_app_id uuid NOT NULL REFERENCES meta_apps(id),
  selected_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (grant_id, account_id) REFERENCES grant_accounts(grant_id, account_id)
);

CREATE TABLE IF NOT EXISTS account_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  version integer NOT NULL,
  policy jsonb NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, version)
);
CREATE TABLE IF NOT EXISTS source_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('news','rss','manual','instagram_reference')),
  source_url text NOT NULL,
  label text,
  enabled boolean NOT NULL DEFAULT true,
  poll_interval_minutes integer NOT NULL DEFAULT 1440 CHECK (poll_interval_minutes > 0),
  last_checked_at timestamptz,
  last_status text NOT NULL DEFAULT 'never_checked',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, source_type, source_url)
);
CREATE TABLE IF NOT EXISTS source_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES source_subscriptions(id) ON DELETE SET NULL,
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  canonical_url text NOT NULL,
  external_key text NOT NULL,
  title text,
  published_at timestamptz,
  collected_at timestamptz NOT NULL DEFAULT now(),
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  factual_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  rights_status text NOT NULL DEFAULT 'unverified' CHECK (rights_status IN ('unverified','allowed','restricted','rejected')),
  hold_reason text,
  UNIQUE (account_id, external_key)
);
CREATE INDEX IF NOT EXISTS source_items_collected_idx ON source_items(account_id, collected_at DESC);

CREATE TABLE IF NOT EXISTS content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  source_item_id uuid REFERENCES source_items(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_approval','approved','scheduled','publishing','published','failed','held','cancelled','manual')),
  final_format text NOT NULL CHECK (final_format IN ('feed_image','carousel','reel_mp4')),
  active_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  version integer NOT NULL,
  caption text NOT NULL DEFAULT '',
  generation_provider text,
  generation_model text,
  source_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  rights_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz,
  generated_cost_estimate numeric(14,6),
  generation_cost_actual numeric(14,6),
  approved_at timestamptz,
  approved_by uuid REFERENCES operators(id),
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, version)
);
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_active_version_fk;
ALTER TABLE content_items ADD CONSTRAINT content_items_active_version_fk FOREIGN KEY (id, active_version) REFERENCES content_versions(content_id, version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_version_id uuid NOT NULL REFERENCES content_versions(id) ON DELETE CASCADE,
  object_store text NOT NULL DEFAULT 'r2_s3',
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  is_unique_copy boolean NOT NULL DEFAULT true,
  state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged','ready','meta_fetchable','published','backup_verified','pending','failed','unknown')),
  drive_file_id text,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  content_version_id uuid REFERENCES content_versions(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('source_scan','generate_content','publish','collect_metrics','backup','decision')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','held','succeeded','failed','cancelled','unknown_result')),
  scheduled_at timestamptz NOT NULL,
  account_timezone text NOT NULL DEFAULT 'Asia/Seoul',
  idempotency_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_at timestamptz,
  last_error_code text,
  hold_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx ON scheduled_jobs(status, available_at, scheduled_at) WHERE status IN ('queued','held');
CREATE TABLE IF NOT EXISTS publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  meta_container_id text,
  container_status text,
  publish_request_sent_at timestamptz,
  response_state text NOT NULL DEFAULT 'not_sent' CHECK (response_state IN ('not_sent','response_received','response_lost','reconciling','confirmed_published','confirmed_not_published')),
  actual_post_id text,
  confirmed_post_url text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, attempt_no)
);
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  metric_key text NOT NULL,
  metric_value numeric,
  data_status text NOT NULL CHECK (data_status IN ('actual_value','api_unconnected','not_collected','unavailable','collection_error','insufficient_sample')),
  source text,
  collected_at timestamptz NOT NULL DEFAULT now(),
  period_start timestamptz,
  period_end timestamptz,
  sample_count integer NOT NULL DEFAULT 0,
  raw_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (account_id, content_id, metric_key, collected_at)
);
CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  content_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  policy_version integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  action text NOT NULL CHECK (action IN ('additional_post','reevaluate','stop_today','blocked')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS monthly_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_start date NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  limit_amount numeric(14,4) NOT NULL CHECK (limit_amount >= 0),
  reserved_amount numeric(14,4) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
  actual_amount numeric(14,4) NOT NULL DEFAULT 0 CHECK (actual_amount >= 0),
  UNIQUE (month_start, provider, model)
);
CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_key text NOT NULL UNIQUE,
  account_id uuid REFERENCES ig_accounts(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model text NOT NULL,
  reserved_amount numeric(14,6) NOT NULL,
  actual_amount numeric(14,6),
  status text NOT NULL CHECK (status IN ('reserved','settled','released','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE TABLE IF NOT EXISTS backup_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  account_id uuid NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  drive_file_id text,
  status text NOT NULL CHECK (status IN ('queued','uploaded','verified','failed','delete_eligible')),
  verified_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS external_analysis_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input_value text NOT NULL,
  normalized_url text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('profile','media','username')),
  target_username text,
  state text NOT NULL DEFAULT 'registered' CHECK (state IN ('registered','resolvable','unavailable','collecting','error')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_url)
);
CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_sha256 text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('preview','applied')),
  row_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE TABLE IF NOT EXISTS system_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  emergency_paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  paused_at timestamptz,
  updated_by uuid REFERENCES operators(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_controls(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL,
  state text NOT NULL,
  queue_waiting integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid REFERENCES operators(id) ON DELETE SET NULL,
  account_id uuid REFERENCES ig_accounts(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash text PRIMARY KEY,
  meta_app_id uuid NOT NULL REFERENCES meta_apps(id),
  operator_id uuid NOT NULL REFERENCES operators(id),
  nonce_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
