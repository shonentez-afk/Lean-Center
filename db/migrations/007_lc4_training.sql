-- LC4: extend the reserved LC1 training/assessment tables, not a second database.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE mentor_credential(
 id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(id),
 kind TEXT NOT NULL CHECK(kind IN('certificate','attendance')),
 role TEXT NOT NULL CHECK(role IN('instructor','mentor','internal_trainer')),
 number TEXT NOT NULL, issuer TEXT NOT NULL, issued_on TEXT NOT NULL, valid_until TEXT,
 evidence TEXT NOT NULL, registered_by TEXT NOT NULL REFERENCES person(id),
 revoked_at TEXT, rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),
 UNIQUE(person_id,kind,number,issuer), CHECK(valid_until IS NULL OR valid_until>=issued_on)
);
CREATE TABLE mentor_appointment(
 id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(id),
 credential_id TEXT NOT NULL REFERENCES mentor_credential(id),
 role TEXT NOT NULL CHECK(role IN('instructor','mentor','internal_trainer')),
 order_number TEXT NOT NULL, order_on TEXT NOT NULL, approved_by TEXT NOT NULL REFERENCES person(id),
 valid_from TEXT NOT NULL, valid_to TEXT, acknowledged_on TEXT NOT NULL,
 evidence TEXT NOT NULL, revoked_at TEXT, rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),
 UNIQUE(person_id,order_number,role),CHECK(valid_to IS NULL OR valid_to>=valid_from)
);
ALTER TABLE mentor_authorization ADD COLUMN credential_id TEXT REFERENCES mentor_credential(id);
ALTER TABLE mentor_authorization ADD COLUMN appointment_id TEXT REFERENCES mentor_appointment(id);
ALTER TABLE mentor_authorization ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
CREATE INDEX ix_lc4_authorization ON mentor_authorization(person_id,operation_id,valid_from,valid_to);
CREATE TABLE training_program(
 id TEXT PRIMARY KEY, code TEXT NOT NULL, version_no INTEGER NOT NULL CHECK(version_no>0),
 kind TEXT NOT NULL CHECK(kind IN('entry','internship','production')),
 title TEXT NOT NULL, profession_id TEXT REFERENCES profession(id), position_id TEXT REFERENCES position(id),
 created_by TEXT NOT NULL REFERENCES person(id), created_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('active','retired')), rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),
 UNIQUE(code,version_no)
);
CREATE TABLE training_program_task(
 id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES training_program(id),
 position INTEGER NOT NULL CHECK(position>0),
 part TEXT NOT NULL CHECK(part IN('general','individual','practice','knowledge')),
 title TEXT NOT NULL, hours REAL NOT NULL CHECK(hours>=0),
 day_offset INTEGER NOT NULL CHECK(day_offset>=0), sop_revision_id TEXT REFERENCES document_revision(id),
 skill_id TEXT REFERENCES skill(id), scale_id TEXT REFERENCES rating_scale(id),
 target_level INTEGER, UNIQUE(program_id,position),
 FOREIGN KEY(scale_id,target_level) REFERENCES rating_level(scale_id,value)
);
CREATE TABLE training_enrollment(
 id TEXT PRIMARY KEY, program_id TEXT NOT NULL REFERENCES training_program(id),
 trainee_id TEXT NOT NULL REFERENCES person(id), mentor_id TEXT NOT NULL REFERENCES person(id),
 manager_id TEXT NOT NULL REFERENCES person(id), start_on TEXT NOT NULL, due_on TEXT NOT NULL,
 reason TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('active','completed','cancelled')),
 conclusion TEXT, feedback TEXT, finished_by TEXT REFERENCES person(id), finished_at TEXT,
 rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),
 CHECK(trainee_id<>mentor_id),CHECK(due_on>=start_on)
);
CREATE TABLE training_task_result(
 id TEXT PRIMARY KEY, enrollment_id TEXT NOT NULL REFERENCES training_enrollment(id),
 task_id TEXT NOT NULL REFERENCES training_program_task(id), actor_id TEXT NOT NULL REFERENCES person(id),
 held_on TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN('completed','incomplete')),
 minutes INTEGER NOT NULL CHECK(minutes>=0), evidence TEXT NOT NULL, recorded_at TEXT NOT NULL,
 rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1)
);
ALTER TABLE training_assignment ADD COLUMN source_sha256 TEXT REFERENCES attachment(sha256);
ALTER TABLE training_assignment ADD COLUMN skill_id TEXT REFERENCES skill(id);
ALTER TABLE training_assignment ADD COLUMN scale_id TEXT REFERENCES rating_scale(id);
ALTER TABLE training_assignment ADD COLUMN target_level INTEGER;
ALTER TABLE training_assignment ADD COLUMN assigned_by TEXT REFERENCES person(id);
ALTER TABLE training_assignment ADD COLUMN assigned_on TEXT;
ALTER TABLE training_assignment ADD COLUMN reason TEXT;
ALTER TABLE training_assignment ADD COLUMN method_variant TEXT;
ALTER TABLE training_assignment ADD COLUMN method_version TEXT;
ALTER TABLE training_assignment ADD COLUMN authorization_id TEXT REFERENCES mentor_authorization(id);
ALTER TABLE training_assignment ADD COLUMN supervisor_id TEXT REFERENCES person(id);
ALTER TABLE training_assignment ADD COLUMN shift_id TEXT REFERENCES work_shift(id);
ALTER TABLE training_assignment ADD COLUMN enrollment_id TEXT REFERENCES training_enrollment(id);
ALTER TABLE training_assignment ADD COLUMN program_task_id TEXT REFERENCES training_program_task(id);
ALTER TABLE training_assignment ADD COLUMN approval_json TEXT CHECK(approval_json IS NULL OR json_valid(approval_json));
ALTER TABLE training_assignment ADD COLUMN recorded_names_json TEXT CHECK(recorded_names_json IS NULL OR json_valid(recorded_names_json));
ALTER TABLE training_assignment ADD COLUMN change_reason TEXT;
ALTER TABLE training_session ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1);
ALTER TABLE training_session ADD COLUMN stage_code TEXT;
ALTER TABLE training_session ADD COLUMN duration_minutes INTEGER;
ALTER TABLE training_session ADD COLUMN witness_id TEXT REFERENCES person(id);
ALTER TABLE training_session ADD COLUMN witness_name TEXT;
ALTER TABLE training_session ADD COLUMN mentor_ack INTEGER CHECK(mentor_ack IN(0,1));
ALTER TABLE training_session ADD COLUMN trainee_ack INTEGER CHECK(trainee_ack IN(0,1));
ALTER TABLE training_session ADD COLUMN recorded_at TEXT;
CREATE INDEX ix_lc4_training_person ON training_assignment(trainee_id,operation_id,state);
CREATE INDEX ix_lc4_session_stage ON training_session(assignment_id,stage_code,held_at);
CREATE TABLE training_verification(
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES training_assignment(id),
 kind TEXT NOT NULL CHECK(kind IN('safety','theory')), evaluator_id TEXT NOT NULL REFERENCES person(id),
 evaluated_on TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN('pass','fail')),
 evidence TEXT NOT NULL, feedback TEXT NOT NULL, recorded_at TEXT NOT NULL,
 rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1)
);
ALTER TABLE assessment_session ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
ALTER TABLE assessment_session ADD COLUMN assignment_id TEXT REFERENCES training_assignment(id);
ALTER TABLE assessment_session ADD COLUMN assessment_kind TEXT;
ALTER TABLE assessment_session ADD COLUMN method_id TEXT REFERENCES checklist_version(id);
ALTER TABLE assessment_session ADD COLUMN practical_id TEXT REFERENCES assessment_session(id);
ALTER TABLE assessment_session ADD COLUMN responses_json TEXT CHECK(responses_json IS NULL OR json_valid(responses_json));
ALTER TABLE assessment_session ADD COLUMN conclusion TEXT;
ALTER TABLE assessment_session ADD COLUMN feedback TEXT;
ALTER TABLE assessment_session ADD COLUMN recorded_at TEXT;
ALTER TABLE assessment_session ADD COLUMN recorded_names_json TEXT CHECK(recorded_names_json IS NULL OR json_valid(recorded_names_json));
CREATE INDEX ix_lc4_assessment_assignment ON assessment_session(assignment_id,assessment_kind,assessed_at);
CREATE TABLE admission_decision(
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES training_assignment(id),
 person_id TEXT NOT NULL REFERENCES person(id), operation_id TEXT NOT NULL REFERENCES operation(id),
 revision_id TEXT NOT NULL REFERENCES document_revision(id),
 qualification_id TEXT REFERENCES assessment_session(id), practical_id TEXT REFERENCES assessment_session(id),
 safety_id TEXT REFERENCES training_verification(id), theory_id TEXT REFERENCES training_verification(id),
 actor_id TEXT NOT NULL REFERENCES person(id), decided_on TEXT NOT NULL, valid_until TEXT,
 decision TEXT NOT NULL CHECK(decision IN('granted','denied')),
 evidence TEXT NOT NULL, feedback TEXT NOT NULL, recorded_at TEXT NOT NULL,
 revoked_at TEXT, revoke_reason TEXT, rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),
 CHECK(valid_until IS NULL OR valid_until>=decided_on)
);
CREATE INDEX ix_lc4_admission ON admission_decision(person_id,operation_id,decided_on);
ALTER TABLE role_requirement ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
ALTER TABLE coverage_requirement ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
ALTER TABLE development_goal ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
CREATE TRIGGER lc4_session_immutable BEFORE UPDATE ON training_session WHEN OLD.stage_code IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable training fact'); END;
CREATE TRIGGER lc4_session_no_delete BEFORE DELETE ON training_session WHEN OLD.stage_code IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable training fact'); END;
UPDATE meta SET value='7' WHERE key='schema_version';
PRAGMA user_version=7;
COMMIT;
