-- LC6.4: versioned standard workflows, existing training facts remain authoritative.
PRAGMA foreign_keys=ON;
BEGIN;
ALTER TABLE training_program ADD COLUMN standard_kind TEXT CHECK(standard_kind IS NULL OR standard_kind IN('entry','adaptation','safety','internship','production'));
CREATE TABLE twi_preparation(
 id TEXT PRIMARY KEY, trainee_id TEXT NOT NULL REFERENCES person(id),manager_id TEXT NOT NULL REFERENCES person(id),
 category TEXT NOT NULL CHECK(category IN('new','transfer')),
 adaptation_id TEXT NOT NULL UNIQUE REFERENCES training_enrollment(id),
 safety_id TEXT NOT NULL UNIQUE REFERENCES training_enrollment(id),
 internship_id TEXT NOT NULL UNIQUE REFERENCES training_enrollment(id),
 shifts_json TEXT NOT NULL CHECK(json_valid(shifts_json)),note TEXT NOT NULL,created_at TEXT NOT NULL,rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1)
);
CREATE TABLE twi_preparation_shared(
 preparation_id TEXT NOT NULL REFERENCES twi_preparation(id),
 adaptation_task_id TEXT NOT NULL REFERENCES training_program_task(id),
 internship_task_id TEXT NOT NULL REFERENCES training_program_task(id),
 PRIMARY KEY(preparation_id,adaptation_task_id),UNIQUE(preparation_id,internship_task_id)
);
CREATE INDEX ix_twi_preparation_person ON twi_preparation(trainee_id);
CREATE TABLE twi_knowledge_bank(
 id TEXT PRIMARY KEY,profession_id TEXT REFERENCES profession(id),author_id TEXT NOT NULL REFERENCES person(id),
 reviewed_on TEXT NOT NULL,previous_id TEXT REFERENCES twi_knowledge_bank(id),
 version_no INTEGER NOT NULL CHECK(version_no>0),note TEXT NOT NULL,blocks_json TEXT NOT NULL CHECK(json_valid(blocks_json)),created_at TEXT NOT NULL,rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1)
);
CREATE UNIQUE INDEX ix_twi_bank_version ON twi_knowledge_bank(coalesce(profession_id,''),version_no);
CREATE TABLE twi_supplement(
 id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES person(id),manager_id TEXT NOT NULL REFERENCES person(id),
 role TEXT NOT NULL CHECK(role IN('instructor','internal_trainer')),month TEXT NOT NULL,
 tasks_json TEXT NOT NULL CHECK(json_valid(tasks_json)),state TEXT NOT NULL CHECK(state IN('draft','approved','declined')),
 decision_note TEXT,decided_at TEXT,created_at TEXT NOT NULL,rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),
 UNIQUE(person_id,role,month)
);
UPDATE meta SET value='16' WHERE key='schema_version';
PRAGMA user_version=16;
COMMIT;
