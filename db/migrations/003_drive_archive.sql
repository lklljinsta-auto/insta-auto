-- Folder and upload IDs are committed before making any Drive create request.
ALTER TABLE account_media_folders DROP CONSTRAINT account_media_folders_kind_check;
ALTER TABLE account_media_folders ADD CHECK (kind IN ('account','feed','reels'));
ALTER TABLE storage_uploads ADD COLUMN asset_id uuid UNIQUE REFERENCES media_assets(id) ON DELETE CASCADE;
ALTER TABLE storage_uploads ADD COLUMN retry_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX archive_filename_per_folder ON storage_uploads(account_id,kind,provider,filename) WHERE asset_id IS NOT NULL;
ALTER TABLE content_versions ADD COLUMN title text NOT NULL DEFAULT '';
CREATE TABLE drive_destination (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  root_id text NOT NULL
);
CREATE TABLE drive_folder_work (
  account_id uuid PRIMARY KEY REFERENCES ig_accounts(id) ON DELETE CASCADE,
  ready boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  retry_at timestamptz NOT NULL DEFAULT now(),
  error_code text
);
CREATE FUNCTION mark_drive_folders_needed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO drive_folder_work(account_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER prepare_drive_folders AFTER INSERT ON ig_accounts FOR EACH ROW EXECUTE FUNCTION mark_drive_folders_needed();
INSERT INTO drive_folder_work(account_id) SELECT id FROM ig_accounts ON CONFLICT DO NOTHING;
CREATE INDEX drive_folders_due ON drive_folder_work(retry_at) WHERE NOT ready;
CREATE INDEX drive_files_due ON storage_uploads(retry_at) WHERE asset_id IS NOT NULL AND state <> 'verified';
ALTER TABLE drive_destination ADD COLUMN root_mode text NOT NULL DEFAULT 'existing';
ALTER TABLE drive_destination ADD COLUMN root_ready boolean NOT NULL DEFAULT false;
CREATE TABLE drive_authorizations (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  refresh_encrypted text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE drive_consent_states (
  state_hash text PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
