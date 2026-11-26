-- LC6.3 version boundary; historical facts unchanged.
PRAGMA foreign_keys=ON;
BEGIN;
UPDATE meta SET value='15' WHERE key='schema_version';
PRAGMA user_version=15;
COMMIT;
