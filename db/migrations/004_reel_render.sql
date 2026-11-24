ALTER TABLE scheduled_jobs DROP CONSTRAINT scheduled_jobs_kind_check;
ALTER TABLE scheduled_jobs ADD CHECK(kind IN ('source_scan','generate_content','publish','collect_metrics','backup','decision','render_reel'));
CREATE TABLE reel_render_inputs (
  job_id uuid PRIMARY KEY REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  picture uuid NOT NULL REFERENCES media_assets(id),
  music uuid NOT NULL REFERENCES media_assets(id),
  captions uuid REFERENCES media_assets(id),
  seconds integer NOT NULL CHECK(seconds BETWEEN 1 AND 180)
);
