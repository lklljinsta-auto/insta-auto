ALTER TABLE content_versions ADD COLUMN editorial_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
