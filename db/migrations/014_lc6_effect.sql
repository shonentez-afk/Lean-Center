-- LC6: additive, event-sourced economic register.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE economic_effect (
 id TEXT PRIMARY KEY, study_id TEXT REFERENCES frv_study(id), action_id TEXT REFERENCES action_item(id),
 owner_id TEXT NOT NULL REFERENCES person(id), unit_id TEXT NOT NULL REFERENCES org_unit(id),
 currency TEXT NOT NULL CHECK(currency IN('RUB','EUR','USD','KZT','CNY','BYN','GBP')),
 method TEXT NOT NULL CHECK(method IN('time','direct')), title TEXT NOT NULL,
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json)), plan_basis TEXT NOT NULL, review_due TEXT NOT NULL,
 actual_json TEXT CHECK(actual_json IS NULL OR json_valid(actual_json)), actual_event_id TEXT REFERENCES change_event(id) DEFERRABLE INITIALLY DEFERRED,
 reviewed_at TEXT, state TEXT NOT NULL CHECK(state IN('active','cancelled')), created_at TEXT NOT NULL,
 rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),
 CHECK((study_id IS NOT NULL)+(action_id IS NOT NULL)=1), CHECK(study_id IS NULL OR method='time'),
 CHECK((actual_json IS NULL)=(actual_event_id IS NULL))
);
CREATE UNIQUE INDEX ux_lc6_effect_study ON economic_effect(study_id) WHERE study_id IS NOT NULL;
CREATE UNIQUE INDEX ux_lc6_effect_action ON economic_effect(action_id) WHERE action_id IS NOT NULL;
CREATE INDEX ix_lc6_effect_review ON economic_effect(state,review_due);
CREATE TABLE economic_fact (
 id TEXT PRIMARY KEY, effect_id TEXT NOT NULL REFERENCES economic_effect(id), actual_event_id TEXT NOT NULL REFERENCES change_event(id),
 period_from TEXT NOT NULL, period_to TEXT NOT NULL, gross_minor INTEGER NOT NULL,
 recurring_minor INTEGER NOT NULL CHECK(recurring_minor>=0), investment_minor INTEGER NOT NULL CHECK(investment_minor>=0),
 registered_by TEXT NOT NULL REFERENCES person(id), evidence TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('draft','confirmed','void')), verifier_id TEXT REFERENCES person(id),
 confirmed_at TEXT, confirmation_note TEXT, void_reason TEXT, void_at TEXT, void_by TEXT REFERENCES person(id),
 created_at TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1 CHECK(rev>0),
 CHECK(period_from<=period_to), CHECK(state<>'confirmed' OR (verifier_id IS NOT NULL AND confirmed_at IS NOT NULL AND confirmation_note IS NOT NULL))
);
CREATE INDEX ix_lc6_fact_period ON economic_fact(effect_id,period_from,period_to,state);
UPDATE meta SET value='14' WHERE key='schema_version';
PRAGMA user_version=14;
COMMIT;
