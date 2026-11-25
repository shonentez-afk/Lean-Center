-- LC3.5: independent editable Stage43 checklist overlay, exact SOP source.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE sop_stage43_checklist(
 id TEXT PRIMARY KEY,
 revision_id TEXT NOT NULL REFERENCES document_revision(id),
 source_sha256 TEXT NOT NULL REFERENCES attachment(sha256),
 rows_json TEXT NOT NULL CHECK(json_valid(rows_json)),
 actor_id TEXT REFERENCES person(id),
 actor_name TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL,
 rev INTEGER NOT NULL CHECK(rev>0),
 UNIQUE(revision_id,source_sha256)
);
CREATE INDEX ix_stage43_checklist_revision ON sop_stage43_checklist(revision_id,updated_at);
UPDATE meta SET value='6' WHERE key='schema_version';
PRAGMA user_version=6;
COMMIT;
