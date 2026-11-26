// Explicit, closed allowlist. Entries describe ONLY implemented QA coverage.
// Future actions (including director approval and password reset) are absent
// and therefore denied. No wildcard permissions or dynamic table names.
export const RESOURCE_TABLES=Object.freeze({
 'person.read_basic':'person',
 'sop.read_effective':'document_revision',
 'training.read':'training_assignment',
 'task.read':'action_item',
 "org.read":"org_unit",
 "operation.read":"operation",
 "sop.read_history":"document_revision",
 "sop.read_steps":"document_revision",
 "frv.read":"frv_study",
 "training.enrollment.read":"training_enrollment",
 "preparation.read":"twi_preparation",
 "credential.read":"mentor_credential",
 "appointment.read":"mentor_appointment",
 "development.read":"development_plan",
 "audit.read":"audit_session",
 "supplement.read":"twi_supplement",
 "roi.read":"economic_effect",
 "calendar.read":"schedule_event"
});
export const READ_ACTIONS=Object.freeze(Object.keys(RESOURCE_TABLES));
export const COMMAND_ACTIONS=Object.freeze(['task.implement_own']);
export const PERMISSIONS=Object.freeze([...READ_ACTIONS,...COMMAND_ACTIONS]);
export const REFERENCE_CREATE_TYPES=Object.freeze(['person','org_unit','business_role','role_assignment','person_assignment']);
