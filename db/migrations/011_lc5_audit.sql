-- LC5: reuse the existing CAPA and calendar tables; no historical audit is rewritten.
PRAGMA foreign_keys=ON;
BEGIN;
ALTER TABLE action_item ADD COLUMN kind TEXT NOT NULL DEFAULT 'corrective' CHECK(kind IN('corrective','instructor_training','trainee_training','development'));
ALTER TABLE action_item ADD COLUMN subject_id TEXT REFERENCES person(id);
ALTER TABLE action_item ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN('normal','major','critical'));
ALTER TABLE action_item ADD COLUMN created_at TEXT;
ALTER TABLE action_item ADD COLUMN source_assessment_id TEXT REFERENCES assessment_session(id);
ALTER TABLE action_item ADD COLUMN source_assignment_id TEXT REFERENCES training_assignment(id);
ALTER TABLE action_item ADD COLUMN source_evaluation_id TEXT REFERENCES sop_evaluation(id);
ALTER TABLE action_item ADD COLUMN followup_assignment_id TEXT REFERENCES training_assignment(id);
ALTER TABLE action_item ADD COLUMN followup_enrollment_id TEXT REFERENCES training_enrollment(id);
ALTER TABLE action_item ADD COLUMN followup_plan_id TEXT REFERENCES development_plan(id);
ALTER TABLE schedule_event ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
ALTER TABLE schedule_event ADD COLUMN source_type TEXT;
ALTER TABLE schedule_event ADD COLUMN created_at TEXT;
ALTER TABLE schedule_event ADD COLUMN completed_audit_id TEXT REFERENCES audit_session(id);
ALTER TABLE checklist_version ADD COLUMN legacy_context_json TEXT CHECK(legacy_context_json IS NULL OR json_valid(legacy_context_json));
ALTER TABLE audit_session ADD COLUMN legacy_context_json TEXT CHECK(legacy_context_json IS NULL OR json_valid(legacy_context_json));
CREATE TABLE rc1_archive(
 id TEXT PRIMARY KEY, source_hash TEXT NOT NULL UNIQUE CHECK(length(source_hash)=64),
 records_json TEXT NOT NULL CHECK(json_valid(records_json)), recorded_at TEXT NOT NULL,
 rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1)
);
CREATE INDEX ix_lc5_audit_context ON audit_session(mentor_id,operation_id,standard_revision_id,version_id,observed_at);
CREATE INDEX ix_lc5_action_owner ON action_item(owner_id,state,due_on);
CREATE INDEX ix_lc5_finding_response ON finding(audit_response_id);
UPDATE meta SET value='11' WHERE key='schema_version';
PRAGMA user_version=11;
COMMIT;
