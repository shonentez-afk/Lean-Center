// Explicit, closed allowlist. Entries describe ONLY implemented QA coverage.
// Future work actions (including director approval) are absent and denied.
// Account password / identity / lifecycle commands are separate, never role permissions. No wildcard permissions or dynamic table names.
export const RESOURCE_TABLES=Object.freeze({
 'person.read_basic':'person',
 'person.read_directory':'person',
 'equipment.read':'equipment',
 'workplace.read':'workplace',
 'sop.read_effective':'document_revision',
 'training.read':'training_assignment',
 'matrix.read':'competency_matrix',
 'task.read':'action_item',
 "org.read":"org_unit",
 "operation.read":"operation",
 "sop.read_history":"document_revision",
 "sop.read_steps":"document_revision",
 "frv.read":"frv_study",
 "program.read":"training_program",
 "training.enrollment.read":"training_enrollment",
 "preparation.read":"twi_preparation",
 "credential.read":"mentor_credential",
 "appointment.read":"mentor_appointment",
 "order.read":"mentor_order",
 "authorization.read":"mentor_authorization",
 "development.read":"development_plan",
 "audit.read":"audit_session",
 "self.read":"mentor_self_evaluation",
 "bank.read":"twi_knowledge_bank",
 "skill.read":"skill",
 "requirement.read":"role_requirement",
 "coverage.read":"coverage_requirement",
 "assessment.read":"assessment_session",
 "supplement.read":"twi_supplement",
 "roi.read":"economic_effect",
 "calendar.read":"schedule_event",
 "profession.read":"profession",
 "position.read":"position",
 "shift.read":"work_shift",
 "category.read":"skill_category",
 "scale.read":"rating_scale",
 "role.read":"business_role",
 "employment.read":"person_assignment",
 "role_assignment.read":"role_assignment"
});
export const READ_ACTIONS=Object.freeze(Object.keys(RESOURCE_TABLES));
export const SITE_REFERENCE_TYPES=Object.freeze(['profession','position','work_shift','rating_scale','skill_category','business_role']);
export const DIRECTORIES=Object.freeze({
 profession:{read:'profession.read',create:'profession.create',update:'profession.update',archive:null},
 position:{read:'position.read',create:'position.create',update:'position.update',archive:null},
 work_shift:{read:'shift.read',create:'shift.create',update:'shift.update',archive:null},
 rating_scale:{read:'scale.read',create:'scale.create',update:null,archive:null},
 skill_category:{read:'category.read',create:null,update:null,archive:null},
 business_role:{read:'role.read',create:null,update:null,archive:null},
 person:{read:'person.read_directory',create:'person.create',update:'person.update',archive:null},
 org_unit:{read:'org.read',create:'org.create',update:'org.update',archive:null},
 equipment:{read:'equipment.read',create:'equipment.create',update:'equipment.update',archive:'equipment.archive'},
 workplace:{read:'workplace.read',create:'workplace.create',update:'workplace.update',archive:'workplace.archive'},
 operation:{read:'operation.read',create:'operation.create',update:'operation.update',archive:'operation.archive'}
});
export const DIRECTORY_COMMANDS=Object.freeze(Object.values(DIRECTORIES).flatMap(d=>[d.create,d.update,d.archive].filter(Boolean)));
export const LIBRARY_COMMANDS=Object.freeze(['sop.create','sop.edit_draft','sop.revise','sop.passport','sop.from_frv','frv.create','frv.edit_draft','frv.finalize']);
export const TRAINING_COMMANDS=Object.freeze(['training.create','training.approve_responsible','training.approve_head','training.reschedule','training.cancel','training.stage','training.verify','training.practical','training.qualify','training.admit','matrix.create','matrix.retire','credential.register','credential.revoke','appointment.register','appointment.revoke','authorization.register','authorization.revoke','program.create','program.retire','training.enrollment.create','training.enrollment.result','training.enrollment.finish','training.enrollment.cancel','preparation.create','preparation.shift','preparation.safety','preparation.internship','preparation.questions','preparation.commission','order.register','supplement.create','supplement.revise','supplement.decide','development.create','development.goal.create','development.goal.close','development.close','development.from_matrix','audit.create','audit.void','self.create','task.create','task.start','task.link','task.cancel','task.verify','bank.save','mentor.method.install','skill.category.create','skill.create','skill.from_sop','requirement.create','requirement.close','coverage.save','assessment.general','calendar.plan','calendar.cancel','calendar.complete','calendar.replan','roi.create','roi.plan','roi.reschedule','roi.cancel','roi.measure','roi.fact.create','roi.fact.save','roi.fact.confirm','roi.fact.void','roi.target','roi.target.cancel','roi.target.review','roi.twi_basis','employment.transfer','sop.evaluation.create','sop.method.install','audit.mobile.export','audit.mobile.import']);
export const COMMAND_ACTIONS=Object.freeze(['task.implement_own',...DIRECTORY_COMMANDS,...LIBRARY_COMMANDS,...TRAINING_COMMANDS]);
export const DETAIL_ACTIONS=Object.freeze(['sop.read_photo','sop.read_twi','sop.read_linked_frv','frv.read_summary','training.detail','training.read_sop','matrix.detail','person.read_card','program.detail','training.enrollment.detail','preparation.detail','order.detail','supplement.detail','development.detail','audit.detail','self.detail','task.detail','bank.detail','assessment.detail','calendar.detail','plan.read','center.read','analytics.read','metrics.read','roi.detail','employment.detail','forms.read','forms.export','sop.evaluation.read','assistant.read','assistant.cloud']);
export const PERMISSIONS=Object.freeze([...READ_ACTIONS,...COMMAND_ACTIONS,...DETAIL_ACTIONS]);
export const REFERENCE_CREATE_TYPES=Object.freeze(['person','org_unit','business_role','role_assignment','person_assignment']);
