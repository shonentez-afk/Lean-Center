-- LC4.2: variable-count methods and distinct audit/self-evaluation records.
PRAGMA foreign_keys=ON;
BEGIN;
ALTER TABLE audit_session ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
ALTER TABLE audit_session ADD COLUMN assignment_id TEXT REFERENCES training_assignment(id);
ALTER TABLE audit_session ADD COLUMN summary TEXT;
ALTER TABLE audit_session ADD COLUMN recorded_at TEXT;
CREATE TABLE mentor_self_evaluation(
 id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(id),
 method_id TEXT NOT NULL REFERENCES checklist_version(id), evaluated_on TEXT NOT NULL,
 place TEXT NOT NULL, person_name TEXT NOT NULL, responses_json TEXT NOT NULL CHECK(json_valid(responses_json)),
 feedback TEXT NOT NULL, recorded_at TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1)
);
CREATE INDEX ix_lc42_self_person ON mentor_self_evaluation(person_id,evaluated_on);
CREATE INDEX ix_lc42_audit_assignment ON audit_session(assignment_id,observed_at);
UPDATE meta SET value='9' WHERE key='schema_version';
PRAGMA user_version=9;
COMMIT;
