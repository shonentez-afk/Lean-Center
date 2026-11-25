-- Saved matrix layout, pinned baseline, explicit scope. Actual assessments and
-- personal development goals remain in their existing authoritative tables.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE competency_matrix(
 id TEXT PRIMARY KEY, code TEXT NOT NULL, version_no INTEGER NOT NULL CHECK(version_no>0),
 title TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES person(id), unit_id TEXT REFERENCES org_unit(id),
 shift_id TEXT REFERENCES work_shift(id), scale_id TEXT NOT NULL REFERENCES rating_scale(id),
 base_on TEXT NOT NULL, target_on TEXT NOT NULL CHECK(target_on>=base_on),
 roster_json TEXT NOT NULL CHECK(json_valid(roster_json)),
 columns_json TEXT NOT NULL CHECK(json_valid(columns_json)),
 baseline_json TEXT NOT NULL CHECK(json_valid(baseline_json)),
 created_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('active','retired')),
 rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0), UNIQUE(code,version_no)
);
CREATE UNIQUE INDEX uq_matrix_active ON competency_matrix(code) WHERE state='active';
UPDATE meta SET value='10' WHERE key='schema_version';
PRAGMA user_version=10;
COMMIT;
