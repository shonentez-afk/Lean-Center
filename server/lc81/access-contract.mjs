// Explicit, closed allowlist. Entries describe ONLY implemented QA coverage.
// Future actions (including director approval and password reset) are absent
// and therefore denied. No wildcard permissions or dynamic table names.
export const RESOURCE_TABLES=Object.freeze({
 'person.read_basic':'person',
 'sop.read_effective':'document_revision',
 'training.read':'training_assignment',
 'task.read':'action_item'
});
export const READ_ACTIONS=Object.freeze(Object.keys(RESOURCE_TABLES));
export const REFERENCE_CREATE_TYPES=Object.freeze(['person','org_unit','business_role','role_assignment','person_assignment']);
