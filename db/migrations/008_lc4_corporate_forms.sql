-- LC4.1: retain LC4.0 histories; add group-order header and optional planning periods.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE mentor_order(
 id TEXT PRIMARY KEY, order_number TEXT NOT NULL, order_on TEXT NOT NULL,
 organization TEXT NOT NULL, city TEXT NOT NULL, approved_by TEXT NOT NULL REFERENCES person(id),
 approved_name TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT,
 supplement_from TEXT, instructor_amount INTEGER, trainer_amount INTEGER,
 evidence TEXT NOT NULL, recorded_at TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1),
 UNIQUE(organization,order_number,order_on),
 CHECK(valid_to IS NULL OR valid_to>=valid_from),
 CHECK(instructor_amount IS NULL OR instructor_amount>=0),
 CHECK(trainer_amount IS NULL OR trainer_amount>=0)
);
ALTER TABLE mentor_appointment ADD COLUMN order_id TEXT REFERENCES mentor_order(id);
ALTER TABLE mentor_appointment ADD COLUMN person_name TEXT;
ALTER TABLE mentor_appointment ADD COLUMN position_name TEXT;
CREATE INDEX ix_lc41_order_members ON mentor_appointment(order_id);
ALTER TABLE training_enrollment ADD COLUMN internship_start TEXT;
ALTER TABLE training_enrollment ADD COLUMN internship_end TEXT;
ALTER TABLE training_enrollment ADD COLUMN entry_start TEXT;
ALTER TABLE training_enrollment ADD COLUMN entry_end TEXT;
UPDATE meta SET value='8' WHERE key='schema_version';
PRAGMA user_version=8;
COMMIT;
