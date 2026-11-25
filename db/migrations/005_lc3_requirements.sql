-- LC3.1: work locations, revision passport and separate SOP assessments.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE workplace(id TEXT PRIMARY KEY,unit_id TEXT NOT NULL REFERENCES org_unit(id),code TEXT NOT NULL,name TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),UNIQUE(unit_id,code));
ALTER TABLE operation ADD COLUMN workplace_id TEXT REFERENCES workplace(id);
ALTER TABLE document_revision ADD COLUMN print_format TEXT CHECK(print_format IN('portrait','landscape'));
ALTER TABLE document_revision ADD COLUMN changed_on TEXT;
ALTER TABLE document_revision ADD COLUMN workplace_id TEXT REFERENCES workplace(id);
ALTER TABLE document_revision ADD COLUMN workplace_name TEXT;
ALTER TABLE document_revision ADD COLUMN equipment_name TEXT;
ALTER TABLE checklist_version ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
CREATE TABLE sop_evaluation(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES document_revision(id),method_id TEXT NOT NULL REFERENCES checklist_version(id),actor_id TEXT NOT NULL REFERENCES person(id),evaluated_on TEXT NOT NULL,place TEXT NOT NULL,actor_name TEXT NOT NULL,source_sha256 TEXT NOT NULL REFERENCES attachment(sha256),recorded_at TEXT NOT NULL,rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1));
CREATE TABLE sop_evaluation_response(evaluation_id TEXT NOT NULL REFERENCES sop_evaluation(id),method_id TEXT NOT NULL REFERENCES checklist_version(id),criterion_id TEXT NOT NULL,value INTEGER NOT NULL CHECK(value IN(0,1)),note TEXT NOT NULL DEFAULT '',PRIMARY KEY(evaluation_id,criterion_id),FOREIGN KEY(criterion_id,method_id) REFERENCES checklist_criterion(id,version_id));
CREATE TABLE sop_frv_origin(revision_id TEXT PRIMARY KEY REFERENCES document_revision(id),study_id TEXT NOT NULL REFERENCES frv_study(id),source_sha256 TEXT NOT NULL REFERENCES attachment(sha256),created_at TEXT NOT NULL);
CREATE INDEX ix_sop_eval_revision ON sop_evaluation(revision_id,evaluated_on);
CREATE INDEX ix_revision_review_due ON document_revision(state,review_due);
UPDATE meta SET value='5' WHERE key='schema_version';
PRAGMA user_version=5;
COMMIT;
