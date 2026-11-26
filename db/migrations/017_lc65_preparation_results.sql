-- LC6.5: keep JI-1 facts; add versioned configurations and preparation facts.
PRAGMA foreign_keys=ON;
BEGIN;
ALTER TABLE training_assignment ADD COLUMN method_config_json TEXT CHECK(method_config_json IS NULL OR json_valid(method_config_json));
CREATE TABLE twi_preparation_fact(
 id TEXT PRIMARY KEY,preparation_id TEXT NOT NULL REFERENCES twi_preparation(id),
 kind TEXT NOT NULL CHECK(kind IN('shift','safety','internship','questions','commission')),
 actor_id TEXT NOT NULL REFERENCES person(id),fact_on TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),recorded_at TEXT NOT NULL,
 rev INTEGER NOT NULL DEFAULT 1 CHECK(rev=1)
);
CREATE INDEX ix_twi_preparation_fact ON twi_preparation_fact(preparation_id,kind,fact_on,recorded_at,id);
CREATE TRIGGER twi_preparation_fact_immutable BEFORE UPDATE ON twi_preparation_fact BEGIN SELECT RAISE(ABORT,'immutable preparation fact'); END;
CREATE TRIGGER twi_preparation_fact_no_delete BEFORE DELETE ON twi_preparation_fact BEGIN SELECT RAISE(ABORT,'immutable preparation fact'); END;
UPDATE meta SET value='17' WHERE key='schema_version';
PRAGMA user_version=17;
COMMIT;
