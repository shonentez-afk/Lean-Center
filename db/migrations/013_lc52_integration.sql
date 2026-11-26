-- LC5.2: explicit planned assessments and immutable links to evidence.
PRAGMA foreign_keys=ON;
BEGIN;
ALTER TABLE schedule_event ADD COLUMN completed_assessment_id TEXT REFERENCES assessment_session(id);
ALTER TABLE schedule_event ADD COLUMN completed_self_id TEXT REFERENCES mentor_self_evaluation(id);
CREATE UNIQUE INDEX ux_lc52_schedule_assessment ON schedule_event(completed_assessment_id) WHERE completed_assessment_id IS NOT NULL;
CREATE UNIQUE INDEX ux_lc52_schedule_self ON schedule_event(completed_self_id) WHERE completed_self_id IS NOT NULL;
ALTER TABLE action_item ADD COLUMN comparison_self_id TEXT REFERENCES mentor_self_evaluation(id);
ALTER TABLE action_item ADD COLUMN source_weighted_event_id TEXT REFERENCES change_event(id);
ALTER TABLE action_item ADD COLUMN source_weighted_position INTEGER CHECK(source_weighted_position BETWEEN 1 AND 13);
ALTER TABLE action_verification ADD COLUMN sop_evaluation_id TEXT REFERENCES sop_evaluation(id);
ALTER TABLE action_verification ADD COLUMN weighted_event_id TEXT REFERENCES change_event(id);
CREATE INDEX ix_lc52_action_comparison ON action_item(comparison_self_id);
CREATE INDEX ix_lc52_action_weighted ON action_item(source_weighted_event_id,source_weighted_position);
UPDATE meta SET value='13' WHERE key='schema_version';
PRAGMA user_version=13;
COMMIT;
