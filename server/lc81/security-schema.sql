
-- Private service schema; never part of the portable/client export.
CREATE TABLE lc81_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE lc81_account(
 id TEXT PRIMARY KEY,person_id TEXT UNIQUE REFERENCES person(id),
 login TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('active','blocked')),
 bootstrap INTEGER NOT NULL DEFAULT 0 CHECK(bootstrap IN(0,1)),
 credential_revision INTEGER NOT NULL DEFAULT 1 CHECK(credential_revision>0),
 created_at TEXT NOT NULL,
 CHECK(bootstrap=1 OR person_id IS NOT NULL)
);
CREATE UNIQUE INDEX lc81_one_bootstrap ON lc81_account(bootstrap) WHERE bootstrap=1;
CREATE TABLE lc81_policy(role_id TEXT PRIMARY KEY REFERENCES business_role(id),revision INTEGER NOT NULL CHECK(revision>0),permissions_json TEXT NOT NULL CHECK(json_valid(permissions_json)));
CREATE TABLE lc81_grant(
 id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES lc81_account(id),role_id TEXT NOT NULL REFERENCES business_role(id),
 assignment_id TEXT NOT NULL REFERENCES role_assignment(id),employment_id TEXT NOT NULL REFERENCES person_assignment(id),
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
 state TEXT NOT NULL CHECK(state IN('active','revoked')),valid_from TEXT NOT NULL,valid_to TEXT,revoked_at TEXT,
 issued_by TEXT NOT NULL REFERENCES lc81_account(id),issued_at TEXT NOT NULL,
 CHECK(valid_to IS NULL OR valid_to>=valid_from),CHECK((state='revoked')=(revoked_at IS NOT NULL))
);
CREATE INDEX lc81_grant_account ON lc81_grant(account_id,state);
CREATE TABLE lc81_audit(id TEXT PRIMARY KEY,actor_account_id TEXT NOT NULL REFERENCES lc81_account(id),action TEXT NOT NULL,target_id TEXT NOT NULL,occurred_at TEXT NOT NULL);
