-- Record the final media selected at approval, independently of later uploads.
ALTER TABLE content_versions ADD COLUMN publish_asset_id uuid REFERENCES media_assets(id);
