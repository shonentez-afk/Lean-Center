-- LC5.1: links to the original self-assessment and exact assessment criterion.
PRAGMA foreign_keys=ON;
BEGIN;
ALTER TABLE action_item ADD COLUMN source_self_id TEXT REFERENCES mentor_self_evaluation(id);
ALTER TABLE action_item ADD COLUMN source_criterion_id TEXT REFERENCES checklist_criterion(id);
CREATE INDEX ix_lc51_action_self ON action_item(source_self_id,source_criterion_id);
CREATE INDEX ix_lc51_action_assessment ON action_item(source_assessment_id,source_criterion_id);
UPDATE meta SET value='12' WHERE key='schema_version';
PRAGMA user_version=12;
COMMIT;
