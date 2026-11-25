-- LC3 detached source library, schema v4.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE UNIQUE INDEX uq_lc3_effective_document ON document_revision(document_id) WHERE state='effective';
CREATE UNIQUE INDEX uq_lc3_open_document ON document_revision(document_id) WHERE state IN ('draft','review','approved');
CREATE INDEX ix_lc3_document_operation ON document(operation_id,archived);
CREATE INDEX ix_lc3_frv_operation ON frv_study(operation_id,state);
UPDATE meta SET value='4' WHERE key='schema_version';
PRAGMA user_version=4;
COMMIT;
