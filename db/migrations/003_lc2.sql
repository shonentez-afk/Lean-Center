-- LC2, deterministic additive migration. Existing LC1 data and event IDs survive.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE position (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0));
CREATE TABLE work_shift (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0));
CREATE TABLE business_role (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0));
-- The v1 person_role table is reserved legacy data, never written by LC1.
-- New effective-dated roles do not grant application or file permissions.
CREATE TABLE role_assignment (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(id), role_id TEXT NOT NULL REFERENCES business_role(id), valid_from TEXT NOT NULL, valid_to TEXT, rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0), CHECK(valid_to IS NULL OR valid_to>=valid_from));
CREATE INDEX ix_role_assignment ON role_assignment(person_id,role_id,valid_from,valid_to);
ALTER TABLE person_assignment ADD COLUMN position_id TEXT REFERENCES position(id);
ALTER TABLE person_assignment ADD COLUMN shift_id TEXT REFERENCES work_shift(id);
ALTER TABLE skill_category ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1));
ALTER TABLE skill_category ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
ALTER TABLE skill ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
ALTER TABLE rating_scale ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1));
ALTER TABLE rating_scale ADD COLUMN rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0);
UPDATE meta SET value='3' WHERE key='schema_version';
PRAGMA user_version=3;
COMMIT;
