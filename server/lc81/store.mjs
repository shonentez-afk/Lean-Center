// Isolated QA server. One protected, atomically replaced SQLite checkpoint
// containing the accepted v17 domain schema and private service tables.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pilotSql,atomicReplace,PilotError,PILOT_DOCUMENT_LIMIT} from '../lc74-store.mjs';
import {createDb,openDb,verifyDb,applyEvent,one,rows,uuid,tx,bytesOf,meta,isId,readSnapshot} from '../../src/core/db.js';
import {hashPassword,verifyPassword,validHash,normalizeLogin,generatePassword,validPassword} from './credentials.mjs';
import {workspaceActions} from './workspace-access.mjs';
import {rolePresetStatus,installMissingRolePresets} from './role-presets.mjs';
import {sharedLibrary,SHARED_LIBRARY_READS,SHARED_LIBRARY_WORKSPACES} from './shared-library.mjs';
import {siteClock,normalizeZone,SITE_ZONE_KEY} from './site-clock.mjs';
import {changeOwnPassword,resetAccountPassword,renameAccount,grantStatus,endRole,endEmployment} from './admin-commands.mjs';
import {READ_ACTIONS,readAuthorized,readManagerProjection,canImplementOwnTask,canChangeDirectory,canReadSopPhoto,canUseLibrary,canReadLibraryAtOperation,canUseTrainingResource,bootstrapTrainingScope,canReadPersonCard,trainingAssignmentResource,matrixResource} from './read-policy.mjs';
import {REFERENCE_CREATE_TYPES,RESOURCE_TABLES,PERMISSIONS,DIRECTORIES,SITE_REFERENCE_TYPES,DIRECTORY_COMMANDS,DETAIL_ACTIONS,LIBRARY_COMMANDS,TRAINING_COMMANDS} from './access-contract.mjs';
import {trainingOptions,resolveTrainingCreate,createTraining,changeTraining,trainingDetail,trainingSop,productionPlans,createProductionPlan,approveProductionPlan,recordInstructionProtocol,recordAssessmentResult} from './training-commands.mjs';
import {matrixInfo,saveMatrix,retireMatrix,matrixDetail,suggestMatrix,matrixOverviewOptions,matrixOverview,matrixAssessmentHistory,profileOptions,professionProfile,saveProfessionProfile} from './matrix-commands.mjs';
import {personCard} from './person-card.mjs';
import {calendarWorkspace,calendarOptions,calendarDetail,createSchedule,changeSchedule,scheduleView,centerOptions,centerWorkspace,metricEvidence} from './center-commands.mjs';
import {roiOptions,roiView,roiDetail,createRoi,changeRoi,roiMeasureContext,measureRoi,roiTwiOptions,previewRoiTwi} from './roi-commands.mjs';
import {competencyOptions,competencyChange,competencyView,assessmentDetail} from './competency-commands.mjs';
import {mentorOptions,changeMentor,mentorView} from './mentor-commands.mjs';
import {mentorWorkspace} from './mentor-workspace.mjs';
import {candidateOptions,candidateEvidence,recordCandidateEvidence,voidCandidateEvidence} from './certification-evidence.mjs';
import {developmentOptions,createDevelopment,developmentDetail,changeDevelopment,developmentFromMatrix,bankOptions,bankDetail,saveBank,developmentView} from './development-commands.mjs';
import {qualityOptions,installMentorMethod,createAudit,createSelf,voidAudit,qualityDetail,taskOptions,createTask,taskDetail,changeTask,qualityView} from './quality-commands.mjs';
import {workflowView,orderOptions,registerOrder,orderDetail,supplementOptions,createSupplement,supplementDetail,changeSupplement} from './mentor-workflows.mjs';
import {programView,programOptions,saveProgram,retireProgram,programDetail,enrollmentOptions,createEnrollment,changeEnrollment,enrollmentDetail,preparationOptions,createPreparation,preparationDetail,preparationFactOptions,recordPreparationFact} from './program-commands.mjs';
import {requestDigest,getReceipt,addReceipt} from './library-receipts.mjs';
import {resolveLibraryContext,contextStamp,checkedLibrarySource,sourceForEditor,inspectLibraryText,saveLibrary,passportLibrary,finalizeLibrary,detailDescriptor,projectLibraryDetail,libraryReadAction,unboundLibraryContext} from './library-commands.mjs';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {photoDescriptor,extractPhoto} from './sop-photo.mjs';
import {applyDirectoryCommand,directorySchema} from './directory-commands.mjs';
import {personnelView,employmentDetail,transferEmployment} from './personnel-commands.mjs';
import {journalWorkspace,retrainingWorkspace,revisionReviewContext,inspectRevisionChange,publicRevisionReview,saveRevisionReview} from './training-registers.mjs';
import {canReadRollout,rolloutDetail,prepareRollout,inspectRolloutSources,saveRollout,prepareRolloutAcceptance,acceptRollout} from './operation-rollout.mjs';
import {sopEvaluationWorkspace,sopEvaluationOptions,sopEvaluationDetail,createSopEvaluation,installSopMethod,sopEvaluationsForRevision} from './sop-evaluation-commands.mjs';
import {importTypes,importAllowed,inspectDirectoryFile,parseDirectoryFile,planDirectoryImport,makeImportToken,checkImportToken} from './import-commands.mjs';
import {mobileOptions,exportMobile,previewMobile,commitMobile,receiptMobile} from './mobile-audit-commands.mjs';
import {assertImport,historyOptions,historyList,historyDetail,historyArchive,loadHistoryPlan,historyPreview,buildHistoryEvents,commitHistory} from './rc1-history.mjs';
import {subjectOptions,subjectReport,subjectWorkbook,frvReportDetail} from './subject-reports.mjs';
import {assistantOptions,assistantContext,assistantRequest,assistantRecords} from './assistant-commands.mjs';
import {formsCatalog,prepareForm,serializeForm,canExportForm} from './form-commands.mjs';
import {refsForDb,checkContent,MAX_CONTENT,verifyDomainEvents,frvOriginSnapshot,inspectSource} from '../../src/modules/library/domain.js';
export const ADMIN_ROLE='8c810000-0000-4000-8000-000000000001',MANAGER_ROLE='8c810000-0000-4000-8000-000000000002';
const SITE='8c810000-0000-4000-8000-000000000003';
const MAGIC=Buffer.from('LC81QA1\n'),MAX=24*1024*1024;
const schema=await fs.readFile(fileURLToPath(new URL('./security-schema.sql',import.meta.url)),'utf8');
const must=(ok,status,message)=>{if(!ok)throw new PilotError(status,message)};
const day=db=>siteClock(db).day;
const at=()=>new Date().toISOString();
const period=(r,d)=>!!r&&r.valid_from<=d&&(r.valid_to===null||r.valid_to>=d);
const keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const audit=(db,actor,action,target)=>db.run('INSERT INTO lc81_audit VALUES(?,?,?,?,?)',[uuid(),actor,action,target,at()]);
function domainCreate(db,type,payload,id=uuid()){
 applyEvent(db,{id:uuid(),entity_type:type,entity_id:id,operation:'create',expected_revision:0,payload,occurred_at:at()});return id;
}
const roleRow=(db,id)=>one(db,'SELECT id,code,name FROM business_role WHERE id=? AND archived=0',[id]);
const activePerson=(db,id)=>one(db,'SELECT id,display_name FROM person WHERE id=? AND archived=0',[id]);
const rootUnit=(db,id)=>{
 const seen=new Set();
 while(isId(id)&&!seen.has(id)){seen.add(id);const r=one(db,'SELECT id,parent_id FROM org_unit WHERE id=? AND archived=0',[id]);if(!r)return null;if(r.parent_id===null)return r.id;id=r.parent_id}return null;
};
// Existing QA stores retain their original IDs; migration records explicit mappings.
const config=db=>({
 site:one(db,"SELECT value FROM lc81_meta WHERE key='site_id'")?.value||SITE,
 admin:one(db,"SELECT value FROM lc81_meta WHERE key='admin_role_id'")?.value||ADMIN_ROLE,
 manager:one(db,"SELECT value FROM lc81_meta WHERE key='manager_role_id'")?.value||MANAGER_ROLE
});
const employment=(db,id,d)=>rows(db,'SELECT id,unit_id,valid_from,valid_to FROM person_assignment WHERE person_id=?',[id]).filter(r=>period(r,d)&&rootUnit(db,r.unit_id)===config(db).site);
function account(db,id){
 const a=one(db,'SELECT * FROM lc81_account WHERE id=?',[id]);
 if(!a||a.state!=='active')return null;
 if(a.bootstrap===1)return roleRow(db,config(db).admin)?a:null;
 return activePerson(db,a.person_id)&&employment(db,a.person_id,day(db)).length===1?a:null;
}
function requireAdmin(db,id,revision=undefined){const a=account(db,id);must(a?.bootstrap===1,403,'Требуются полномочия администратора');must(revision===undefined||a.credential_revision===revision,401,'Сеанс завершён');return a}
function sanitized(db,a){
 const p=a.person_id&&activePerson(db,a.person_id);
 return {id:a.id,person_id:a.person_id,login:a.login,state:a.state,display_name:p?.display_name||(a.bootstrap===1?'Администратор':'Сотрудник недоступен'),admin:a.bootstrap===1,credential_revision:a.credential_revision,permissions:a.state==='active'&&account(db,a.id)?permissionsFor(db,a):[]};
}
// A change in effective grants is significant even when their permission
// union stays the same (e.g. one of two units is revoked). The scope epoch
// includes changes to organizational/assigned resource relationships.
function sessionView(db,a,withWorkspace=true){
 const view=sanitized(db,a);
 if(!withWorkspace)return view;
 const d=day(db),sec=security(db,a.id),effective=sec.grants.filter(g=>grantStatus(db,g,d,config(db).site)==='effective').sort((x,y)=>x.id.localeCompare(y.id)).map(g=>[g.id,g.assignment_id,g.employment_id,g.policy_revision,g.scope,g.valid_from,g.valid_to]);
 const restricted=effective.some(g=>g[4].kind!=='unit_tree'||g[4].unit_id!==config(db).site);
 const assigned=effective.some(g=>g[4].kind==='assigned');
 const types=restricted?['org_unit','person_assignment','person','operation','role_assignment',...(assigned?['training_assignment','training_enrollment','action_item','schedule_event']:[])]:a.person_id?['org_unit','operation']:[];
 const epoch=types.length?one(db,'SELECT count(*) n FROM change_event WHERE entity_type IN ('+types.map(()=>'?').join(',')+')',types).n:0;
 const stamp=createHash('sha256').update(JSON.stringify([a.id,a.credential_revision,d,view.permissions,effective,epoch])).digest('hex');
 const work=workspaceActions(db,trainingAccess(db,a,d),a.bootstrap===1);
 return {...view,workspace_actions:[...new Set([...work,...(a.person_id?SHARED_LIBRARY_WORKSPACES:[])])].sort(),access_stamp:stamp};
}
function auditView(db){return rows(db,"SELECT a.id,a.actor_account_id,a.action,a.target_id,a.occurred_at,m.value reason FROM lc81_audit a LEFT JOIN lc81_meta m ON m.key='reason:'||a.target_id ORDER BY a.occurred_at DESC,a.id LIMIT 100")}
function security(db,accountId){
 const a=account(db,accountId);if(!a||a.bootstrap===1)return {accounts:[],policies:[],grants:[]};
 const emp=employment(db,a.person_id,day(db))[0];
 const policies=rows(db,'SELECT * FROM lc81_policy').map(({role_id,revision,permissions_json})=>({role_id,revision,permissions:JSON.parse(permissions_json)}));
 const grants=rows(db,"SELECT * FROM lc81_grant WHERE account_id=? AND state='active' AND employment_id=?",[a.id,emp.id]).filter(g=>{
  const s=JSON.parse(g.scope_json);
  return s.kind!=='unit_tree'||rootUnit(db,s.unit_id)===rootUnit(db,emp.unit_id);
 }).map(g=>({...g,scope:JSON.parse(g.scope_json)}));
 return {accounts:[a],policies,grants};
}
function readFor(db,a,action,id,d){
 return a.bootstrap===1?readManagerProjection(db,config(db).site,action,id,d):readAuthorized(db,security(db,a.id),a.id,action,id,d);
}
function directoryAllowed(db,a,action,anchorAction,id,d){
 return DIRECTORY_COMMANDS.includes(action)&&(a.bootstrap===1?!!readManagerProjection(db,config(db).site,anchorAction,id,d):canChangeDirectory(db,security(db,a.id),a.id,action,anchorAction,id,d));
}
function directoryView(db,a,action,data,d){
 const type=Object.keys(DIRECTORIES).find(t=>DIRECTORIES[t].read===action);
 if(!type)return data;
 const def=DIRECTORIES[type];
 return {...data,can_update:directoryAllowed(db,a,def.update,action,data.id,d),can_archive:!!def.archive&&directoryAllowed(db,a,def.archive,action,data.id,d)};
}
function photoAllowed(db,a,id,d){return !!sharedLibrary(db,a,config(db).site,d).read('sop.read_steps',id)||!!readFor(db,a,'sop.read_steps',id,d)&&(a.bootstrap===1||canReadSopPhoto(db,security(db,a.id),a.id,id,d))}
function libraryAccess(db,a,d){
 const shared=sharedLibrary(db,a,config(db).site,d);
 const fullAllows=(action,anchor,id)=>(LIBRARY_COMMANDS.includes(action)||DETAIL_ACTIONS.includes(action))&&!!readFor(db,a,anchor,id,d)&&(a.bootstrap===1?action!=='frv.finalize':canUseLibrary(db,security(db,a.id),a.id,action,anchor,id,d));
 const read=(action,id)=>readFor(db,a,action,id,d)||shared.read(action,id);
 return {read,fullAllows,allows:(action,anchor,id)=>action==='sop.read_public'?anchor==='sop.read_effective'&&!!read(anchor,id):fullAllows(action,anchor,id)||shared.allows(action,anchor,id),readScope:(kind,id)=>shared.readScope(kind,id)||(a.bootstrap===1?!!readManagerProjection(db,config(db).site,'operation.read',id,d):canReadLibraryAtOperation(db,security(db,a.id),a.id,kind,id,d)),permissions:[...new Set([...permissionsFor(db,a),...(shared.enabled?SHARED_LIBRARY_READS:[])])]};
}
// A revision and its historical FRV source are independently protected.
// The shared final-study floor does not disclose previously replaced sources.
function readableFrvOrigin(db,v,id){
 if(!isId(id)||!(v.read('sop.read_history',id)||v.read('sop.read_effective',id)))return null;
 const x=frvOriginSnapshot(db,id);
 if(!x||!v.read('frv.read',x.study_id)||!v.allows('frv.read_summary','frv.read',x.study_id))return null;
 if(!x.current&&!v.fullAllows('frv.read_summary','frv.read',x.study_id)&&!v.allows('frv.edit_draft','frv.read',x.study_id))return null;
 return x;
}
const publicFrvOrigin=({study_id,title,state,created_at,current})=>({study_id,title,state,created_at,current});
// Start with real, server-authorized choices even on a newly initialized site.
function libraryOptions(db,a,kind,d){
 const access=libraryAccess(db,a,d);
 must(access.permissions.includes(libraryReadAction(kind)),404,'Раздел недоступен');
 const can_prepare=a.bootstrap===1||!!a.person_id;
 return {can_prepare,operations:rows(db,'SELECT id FROM operation WHERE archived=0 ORDER BY name').flatMap(({id})=>{
  const r=access.read('operation.read',id);
  return r&&access.readScope(kind,id)&&access.allows(kind+'.create','operation.read',id)?[{id,name:r.data.name,code:r.data.code}]:[];
 }),operation_units:rows(db,'SELECT id FROM org_unit WHERE archived=0 ORDER BY name').flatMap(({id})=>{
  const r=readFor(db,a,'org.read',id,d);
  return can_prepare&&r&&directoryAllowed(db,a,'operation.create','org.read',id,d)?[{id,name:r.data.name}]:[];
 }),day:d};
}
function libraryPeople(db,a,d){
 return directoryPeople(db,d).filter(p=>p.id===a.person_id||readFor(db,a,'person.read_directory',p.id,d)).map(({id,employee_code,display_name,position,unit})=>({id,employee_code,display_name,position,unit,roles:[]}));
}
function trainingAccess(db,a,d){
 const clock=siteClock(db);d=clock.day;
 return {accountId:a.id,personId:a.person_id,credentialRevision:a.credential_revision,day:d,at:clock.at,offsetMinutes:clock.offset_minutes,permissions:permissionsFor(db,a),
 read:(action,id)=>readFor(db,a,action,id,d),
 scope:(action,id,resource)=>a.bootstrap===1?(READ_ACTIONS.includes(action)||DETAIL_ACTIONS.includes(action))&&bootstrapTrainingScope(db,config(db).site,resource):canUseTrainingResource(db,security(db,a.id),a.id,action,id,d,resource),
 allows:(action,id,resource)=>a.bootstrap===1?DETAIL_ACTIONS.includes(action)&&bootstrapTrainingScope(db,config(db).site,resource):canUseTrainingResource(db,security(db,a.id),a.id,action,id,d,resource),
 audit:(action,target)=>audit(db,a.id,action,target),
 actorAccess:(id,revision)=>{const other=account(db,id);return other&&other.credential_revision===revision?trainingAccess(db,other,d):null}};
}
function assistantAccess(db,a,d){
 const shared=sharedLibrary(db,a,config(db).site,d);
 return {...trainingAccess(db,a,d),sharedRead:(action,id)=>shared.read(action,id)};
}
function cardAllowed(db,a,id,d){
 return a.bootstrap===1?!!readManagerProjection(db,config(db).site,'person.read_basic',id,d):canReadPersonCard(db,security(db,a.id),a.id,id,d);
}
function documentLinks(db,a,id,kinds){
 return kinds.filter(k=>canExportForm(db,a,k,id));
}
function projectView(db,a,action,data,d){
 if(action==='person.read_basic'||action==='person.read_directory'){
  const view=directoryView(db,a,action,data,d);
  return cardAllowed(db,a,data.id,d)?{...view,can_card:true}:view;
 }
 if(action==='training.read'){
  const access=trainingAccess(db,a,d),resource=trainingAssignmentResource(db,data.id,d);
  return {...data,trainee_name:one(db,'SELECT display_name FROM person WHERE id=?',[data.trainee_id])?.display_name||'',operation_name:one(db,'SELECT name FROM operation WHERE id=?',[data.operation_id])?.name||'',can_detail:access.allows('training.detail',data.id,resource),can_sop:access.allows('training.read_sop',data.id,resource)};
 }
 if(['program.read','training.enrollment.read','preparation.read'].includes(action))return programView(db,trainingAccess(db,a,d),action,data);
 if(['employment.read','role_assignment.read'].includes(action))return personnelView(db,trainingAccess(db,a,d),action,data);
 if(action==='calendar.read')return scheduleView(db,trainingAccess(db,a,d),data);
 if(action==='roi.read')return roiView(db,trainingAccess(db,a,d),data);
 if(['skill.read','requirement.read','coverage.read','assessment.read'].includes(action))return competencyView(db,trainingAccess(db,a,d),action,data);
 if(['development.read','bank.read'].includes(action))return developmentView(db,trainingAccess(db,a,d),action,data);
 if(['audit.read','self.read'].includes(action))return qualityView(db,trainingAccess(db,a,d),action,data);
 if(['order.read','supplement.read'].includes(action))return workflowView(db,trainingAccess(db,a,d),action,data);
 if(['credential.read','appointment.read','authorization.read'].includes(action))return mentorView(db,trainingAccess(db,a,d),action.split('.')[0],data);
 if(action==='matrix.read'){
  const m=one(db,'SELECT * FROM competency_matrix WHERE id=?',[data.id]),r=matrixResource(db,m.unit_id,JSON.parse(m.roster_json),JSON.parse(m.columns_json),d,m.base_on);
  return {...data,can_detail:trainingAccess(db,a,d).allows('matrix.detail',data.id,r)};
 }
 if(action==='sop.read_history'){
  const v=libraryAccess(db,a,d),id=data.revision_id,active=!data.document_archived;
  return {...data,can_edit:active&&data.state==='draft'&&v.allows('sop.edit_draft',action,id),can_revise:active&&['effective','superseded','withdrawn'].includes(data.state)&&!one(db,"SELECT id FROM document_revision WHERE document_id=? AND state IN ('draft','review','approved')",[data.document_id])&&v.allows('sop.revise',action,id),can_passport:active&&data.state==='draft'&&v.allows('sop.passport',action,id)};
 }
 if(action==='sop.read_effective'){
  const v=libraryAccess(db,a,d),id=data.revision_id;
  return {...data,can_twi:v.allows('sop.read_twi',action,id),can_linked_frv:v.allows('sop.read_linked_frv',action,id),can_revise:!!v.read('sop.read_history',id)&&!one(db,"SELECT id FROM document_revision WHERE document_id=? AND state IN ('draft','review','approved')",[data.document_id])&&v.allows('sop.revise','sop.read_history',id)};
 }
 if(action==='frv.read'){
  const v=libraryAccess(db,a,d);
  return {...data,can_edit:data.state==='draft'&&v.allows('frv.edit_draft',action,data.id),can_finalize:!!a.person_id&&data.state==='draft'&&v.allows('frv.finalize',action,data.id),can_summary:v.allows('frv.read_summary',action,data.id),can_create_sop:data.state!=='archived'&&v.permissions.includes('sop.read_history')&&v.readScope('sop',data.operation_id)&&!!v.read('operation.read',data.operation_id)&&v.allows('sop.create','operation.read',data.operation_id)&&v.allows('sop.from_frv',action,data.id)};
 }
 if(action==='sop.read_steps')return {...data,can_read_photo:photoAllowed(db,a,data.revision_id,d)};
 if(action!=='task.read')return directoryView(db,a,action,data,d);
 const view=qualityView(db,trainingAccess(db,a,d),action,data),t=one(db,'SELECT kind,followup_assignment_id,followup_enrollment_id FROM action_item WHERE id=?',[data.id]);
 return {...view,can_implement:a.bootstrap!==1&&['open','in_progress','ineffective'].includes(view.state)&&canImplementOwnTask(db,security(db,a.id),a.id,data.id,d)&&(t.kind!=='trainee_training'||!!t.followup_assignment_id)&&(t.kind!=='instructor_training'||!!t.followup_enrollment_id)};
}
function permissionsFor(db,a){
 if(a.bootstrap===1)return [...READ_ACTIONS,...DIRECTORY_COMMANDS,...DETAIL_ACTIONS,...LIBRARY_COMMANDS.filter(x=>x!=='frv.finalize')]; // Unbound bootstrap cannot perform personal decisions.
 const d=day(db),s=security(db,a.id),out=new Set();
 for(const g of s.grants){
  if(g.revoked_at!==null||!period(g,d)||!roleRow(db,g.role_id))continue;
  const arow=one(db,'SELECT person_id,role_id,valid_from,valid_to FROM role_assignment WHERE id=?',[g.assignment_id]);
  if(!arow||arow.person_id!==a.person_id||arow.role_id!==g.role_id||!period(arow,d))continue;
  const policy=s.policies.find(p=>p.role_id===g.role_id&&p.revision===g.policy_revision);
  for(const p of policy?.permissions||[])out.add(p);
 }
 return PERMISSIONS.filter(p=>out.has(p));
}
function createAccountRecord(db,actor,input,revision){
 requireAdmin(db,actor,revision);must(keys(input,['person_id','login','password','generate']),400,'Неверные поля аккаунта');
 const {person_id,generate}=input,name=normalizeLogin(input.login);
 must(isId(person_id)&&activePerson(db,person_id)&&employment(db,person_id,day(db)).length===1&&name,422,'Нужен активный сотрудник, одно назначение и уникальный логин');
 must(!one(db,'SELECT id FROM lc81_account WHERE person_id=? OR login=?',[person_id,name]),409,'Аккаунт или логин уже существует');
 must(typeof generate==='boolean'&&(generate?input.password===null:validPassword(input.password)),422,'Укажите стойкий пароль');
 const secret=generate?generatePassword():input.password,id=uuid();
 db.run("INSERT INTO lc81_account(id,person_id,login,password_hash,state,bootstrap,created_at) VALUES(?,?,?,?,'active',0,?)",[id,person_id,name,hashPassword(secret),at()]);
 audit(db,actor,'account.create',id);return {id,login:name,...(generate?{issued_password:secret}:{})};
}
function grantRecord(db,actor,input,revision){
 requireAdmin(db,actor,revision);must(keys(input,['account_id','assignment_id','scope','valid_to']),400,'Неверные поля назначения');
 const a=account(db,input.account_id),d=day(db),assignment=one(db,'SELECT * FROM role_assignment WHERE id=?',[input.assignment_id]);
 must(a&&a.bootstrap!==1&&assignment?.person_id===a.person_id&&assignment.role_id!==config(db).admin&&period(assignment,d)&&roleRow(db,assignment.role_id),422,'Не найдено действующее назначение роли');
 const emp=employment(db,a.person_id,d)[0],p=one(db,'SELECT * FROM lc81_policy WHERE role_id=?',[assignment.role_id]),s=input.scope;
 must(p&&s&&((keys(s,['kind'])&&['self','assigned'].includes(s.kind))||(keys(s,['kind','unit_id'])&&s.kind==='unit_tree'&&rootUnit(db,s.unit_id)===rootUnit(db,emp.unit_id))),422,'Нет политики или неверная область');
 if(assignment.role_id===config(db).manager)must(s.kind==='unit_tree'&&s.unit_id===config(db).site,422,'Управляющий назначается на площадку');
 const end=input.valid_to;
 must(end===null||typeof end==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(end)&&Number.isFinite(Date.parse(end+'T00:00:00Z'))&&new Date(end+'T00:00:00Z').toISOString().slice(0,10)===end&&end>=d,422,'Неверный срок');
 const prior=rows(db,"SELECT id,scope_json,valid_from,valid_to FROM lc81_grant WHERE account_id=? AND assignment_id=? AND employment_id=? AND policy_revision=? AND state='active'",[a.id,assignment.id,emp.id,p.revision]).find(g=>period(g,d)&&JSON.parse(g.scope_json).kind===s.kind&&(s.kind!=='unit_tree'||JSON.parse(g.scope_json).unit_id===s.unit_id));
 must(!prior,409,'Такой доступ уже действует; отзовите прежнее назначение перед изменением срока');
 const id=uuid();db.run("INSERT INTO lc81_grant(id,account_id,role_id,assignment_id,employment_id,scope_json,policy_revision,state,valid_from,valid_to,revoked_at,issued_by,issued_at) VALUES(?,?,?,?,?,?,?,'active',?,?,NULL,?,?)",[id,a.id,assignment.role_id,assignment.id,emp.id,JSON.stringify(s),p.revision,d,end,actor,at()]);
 audit(db,actor,'grant.create',id);return {id};
}
function assignAccessRecord(db,actor,input,revision){
 requireAdmin(db,actor,revision);must(keys(input,['account_id','role_id','scope','valid_to']),400,'Неверные поля доступа');
 const a=account(db,input.account_id),d=day(db);
 must(a&&a.bootstrap!==1&&isId(input.role_id)&&input.role_id!==config(db).admin&&roleRow(db,input.role_id)&&one(db,'SELECT role_id FROM lc81_policy WHERE role_id=?',[input.role_id]),422,'Нужен действующий пользователь и роль с настроенными правами');
 const current=rows(db,'SELECT id,valid_from,valid_to FROM role_assignment WHERE person_id=? AND role_id=?',[a.person_id,input.role_id]).filter(r=>period(r,d));
 must(current.length<=1,409,'У сотрудника несколько действующих назначений одной роли');
 let id=current[0]?.id;
 if(!id){
  try{id=domainCreate(db,'role_assignment',{person_id:a.person_id,role_id:input.role_id,valid_from:d,valid_to:null})}catch{throw new PilotError(422,'Не удалось назначить роль; проверьте историю назначений')}
  audit(db,actor,'directory.create.role_assignment',id);
 }
 const result=grantRecord(db,actor,{account_id:a.id,assignment_id:id,scope:input.scope,valid_to:input.valid_to},revision);
 return {...result,assignment_id:id};
}
function checkPrivate(db){
 verifyDb(db);
 must(one(db,"SELECT value FROM lc81_meta WHERE key='service_schema'")?.value==='1',503,'Неизвестная схема авторизации');
 const tz=one(db,'SELECT value FROM lc81_meta WHERE key=?',[SITE_ZONE_KEY])?.value;
 must(tz===undefined||normalizeZone(tz)!==null,503,'Некорректный часовой пояс хранилища');
 const admins=rows(db,'SELECT * FROM lc81_account WHERE bootstrap=1');
 const cfg=config(db);
 must(isId(cfg.site)&&isId(cfg.admin)&&isId(cfg.manager)&&cfg.admin!==cfg.manager&&admins.length===1&&admins[0].state==='active'&&roleRow(db,cfg.admin)&&roleRow(db,cfg.manager)&&rootUnit(db,cfg.site)===cfg.site,503,'Нарушена целостность начального администратора');
 for(const a of rows(db,'SELECT login,password_hash FROM lc81_account'))must(normalizeLogin(a.login)===a.login&&validHash(a.password_hash),503,'Повреждены данные авторизации');
 for(const p of rows(db,'SELECT * FROM lc81_policy')){
  const ps=JSON.parse(p.permissions_json);must(Array.isArray(ps)&&new Set(ps).size===ps.length&&ps.every(x=>PERMISSIONS.includes(x))&&p.role_id!==cfg.admin,503,'Неверная политика');
 }
 must(!!one(db,'SELECT role_id FROM lc81_policy WHERE role_id=?',[cfg.manager]),503,'Нет политики управляющего');
}
const digest=b=>createHash('sha256').update(b).digest('hex');
function pack(db){
 const b=Buffer.from(bytesOf(db));must(b.length<=MAX,503,'Лимит QA-хранилища');
 return Buffer.concat([MAGIC,Buffer.from(digest(b)+'\n'),b]);
}
async function unpack(SQL,file){
 const st=await fs.stat(file);must(st.isFile()&&st.size<=MAX+MAGIC.length+65&&st.size>MAGIC.length+165,503,'Размер QA-хранилища');
 return unpackBytes(SQL,await fs.readFile(file));
}
function unpackBytes(SQL,b){
 must(b.length<=MAX+MAGIC.length+65&&b.length>MAGIC.length+165,503,'Размер QA-хранилища');
 const off=MAGIC.length+65,body=b.subarray(off);
 must(b.subarray(0,MAGIC.length).equals(MAGIC)&&b.subarray(MAGIC.length,off).toString()===digest(body)+'\n',503,'Повреждён контрольный снимок');
 const db=openDb(SQL,new Uint8Array(body),{upgrade:false});
 try{checkPrivate(db);return db}catch(e){db.close();throw e}
}
async function checkSources(db,dir){
 let total=0;
 for(const r of refsForDb(db)){
  const file=path.join(dir,'documents',r.sha256+'.json'),stat=await fs.stat(file);
  must(stat.isFile()&&stat.size===r.size&&stat.size<=MAX_CONTENT,503,'Отсутствует или повреждён исходник');
  total+=stat.size;must(total<=PILOT_DOCUMENT_LIMIT,503,'Лимит вложений QA');
  await checkContent(r,new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file)));
 }
}
async function copySources(db,target,readSource,write=atomicReplace){
 await fs.mkdir(path.join(target,'documents'),{mode:0o700});
 let total=0;
 for(const r of refsForDb(db)){
  const text=await checkContent(r,await readSource(r.sha256));
  total+=r.size;must(total<=PILOT_DOCUMENT_LIMIT,503,'Лимит вложений QA');
  await write(path.join(target,'documents',r.sha256+'.json'),Buffer.from(text,'utf8'));
 }
 await checkSources(db,target);
}
function selectRole(db,mapped,fallback,code,name){
 if(mapped!==null&&mapped!==undefined){
  must(isId(mapped)&&roleRow(db,mapped),422,'Выберите существующую активную роль');
  return mapped;
 }
 // Do not infer security roles from job titles or silently duplicate names.
 const collision=rows(db,'SELECT id,code,name FROM business_role').some(r=>r.id===fallback||r.code.toLowerCase()===code.toLowerCase()||r.name.trim().toLowerCase()===name.toLowerCase());
 must(!collision,422,'Роль уже существует: требуется явное сопоставление ID');
 return domainCreate(db,'business_role',{code,name},fallback);
}
// One-file import for a separately approved QA deployment. The upload
// service need only supply a readable file; runtime creates the private
// working directory itself. Never restore onto an existing directory.
const UPLOAD_LIMIT=64*1024*1024,UPLOAD_KEY='uploaded_qa_sha256';
const uploadSha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function uploadBytes(s,limit){
 must(typeof s==='string'&&s.length<=Math.ceil(limit/3)*4,400,'Неверный размер вложения загрузки');
 const b=Buffer.from(s,'base64');
 must(b.length<=limit&&b.toString('base64')===s,400,'Неверное кодирование загрузки');return b;
}
export async function restoreUploadedQA({bundleFile,expectedSha,dataDir,password,siteTimeZone=null}){
 must(path.isAbsolute(bundleFile)&&path.isAbsolute(dataDir)&&path.resolve(bundleFile)===bundleFile&&path.resolve(dataDir)===dataDir&&path.dirname(bundleFile)===path.dirname(dataDir)&&bundleFile!==dataDir&&uploadSha(expectedSha)&&validPassword(password),400,'Неверные параметры загрузки QA');
 const info=await fs.lstat(bundleFile);
 must(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=UPLOAD_LIMIT,400,'Неверный файл загрузки QA');
 const input=await fs.readFile(bundleFile);
 must(input.length===info.size&&input.length<=UPLOAD_LIMIT&&digest(input)===expectedSha,400,'Контрольная сумма загрузки QA не совпадает');
 let pkg;try{pkg=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input))}catch{throw new PilotError(400,'Неверный формат загрузки QA')}
 must(keys(pkg,['format','checkpoint','marker','documents'])&&pkg.format==='LC81-QA-UPLOAD-1'&&typeof pkg.marker==='string'&&pkg.documents&&typeof pkg.documents==='object'&&!Array.isArray(pkg.documents),400,'Неверный формат загрузки QA');
 const {SQL}=await pilotSql(),db=unpackBytes(SQL,uploadBytes(pkg.checkpoint,MAX+MAGIC.length+65));
 try{
  must(pkg.marker===meta(db,'database_id')+'\n',400,'Маркер загруженной базы не совпадает');
  must(!siteTimeZone||siteClock(db).configured&&normalizeZone(siteClock(db).zone)===normalizeZone(siteTimeZone),409,'Часовой пояс уже хранится в базе; настройте его явно через администратора');
  const refs=refsForDb(db),names=Object.keys(pkg.documents);
  must(names.length===refs.length&&names.every(uploadSha)&&refs.every(r=>Object.hasOwn(pkg.documents,r.sha256)),400,'Набор загруженных документов не совпадает');
  const documents=new Map();let total=0;
  for(const r of refs){
   const bytes=uploadBytes(pkg.documents[r.sha256],MAX_CONTENT);
   total+=bytes.length;must(total<=PILOT_DOCUMENT_LIMIT&&bytes.length===r.size,400,'Размер загруженного документа не совпадает');
   const text=await checkContent(r,new TextDecoder('utf-8',{fatal:true}).decode(bytes));documents.set(r.sha256,text);
  }
  // All imported credentials are replaced. Only the administrator gets
  // the explicitly supplied new secret. Staff keep their existing roles
  // and state but cannot authenticate with any previously issued password.
  tx(db,()=>{
   const administrator=one(db,'SELECT id FROM lc81_account WHERE bootstrap=1');
   for(const {id,bootstrap} of rows(db,'SELECT id,bootstrap FROM lc81_account')){
    db.run('UPDATE lc81_account SET password_hash=?,credential_revision=credential_revision+1 WHERE id=?',[hashPassword(bootstrap===1?password:generatePassword()),id]);
   }
   db.run('INSERT OR REPLACE INTO lc81_meta VALUES(?,?)',[UPLOAD_KEY,expectedSha]);
   audit(db,administrator.id,'storage.qa_upload',administrator.id);
  });checkPrivate(db);
  // mkdir is exclusive. No modification or cleanup of preexisting storage.
  await fs.mkdir(dataDir,{mode:0o700});
  const lock=path.join(dataDir,'writer.lock'),handle=await fs.open(lock,'wx',0o600);
  try{
   await handle.close();
   await copySources(db,dataDir,async sha=>documents.get(sha));
   const checkpoint=pack(db);
   await atomicReplace(path.join(dataDir,'secure.lc81'),checkpoint);
   await atomicReplace(path.join(dataDir,'initialized'),Buffer.from(pkg.marker));
   const checked=await unpack(SQL,path.join(dataDir,'secure.lc81'));
   try{await checkSources(checked,dataDir);must(meta(checked,'database_id')+'\n'===pkg.marker,503,'Копия не подтверждена')}finally{checked.close()}
   must((await fs.readFile(path.join(dataDir,'secure.lc81'))).equals(checkpoint),503,'Копия не подтверждена');
  }finally{await fs.rm(lock,{force:true})}
 }finally{db.close()}
}
async function storageStep(step,fn){
 try{return await fn()}catch(e){if(e&&typeof e==='object')e.lc81StorageStep=step;throw e}
}
export async function openSecureQA({dataDir,initialize=false,login='admin',password,write=atomicReplace,seed=null,siteTimeZone=null,importDigest=null}){
 const selectedZone=siteTimeZone===null?null:normalizeZone(siteTimeZone);
 must(siteTimeZone===null||selectedZone,422,'Укажите корректный IANA часовой пояс предприятия');
 must(path.isAbsolute(dataDir)&&dataDir!==path.parse(dataDir).root,503,'Требуется отдельная абсолютная папка QA');
 const {SQL,schema:domainSchema,migration}=await pilotSql();
 let fresh=false;
 try{await fs.mkdir(dataDir,{mode:0o700});fresh=true}catch(e){if(e.code!=='EEXIST')throw e}
 // An explicit init flag is required only for a newly created directory.
 // Never initialize an existing empty/corrupt directory or legacy volume.
 if(seed&&!fresh)throw new PilotError(409,'Миграция только в новую папку');
 if(fresh&&!initialize){await fs.rmdir(dataDir);throw new PilotError(503,'Первичный запуск требует явной инициализации')}
 if(fresh&&(!normalizeLogin(login)||!validPassword(password))){await fs.rmdir(dataDir);throw new PilotError(503,'Требуется начальный секрет администратора')}
 const lock=path.join(dataDir,'writer.lock'),file=path.join(dataDir,'secure.lc81'),marker=path.join(dataDir,'initialized');
 const h=await storageStep('LOCK',()=>fs.open(lock,'wx',0o600));await h.close();
 let current,poisoned=false,closed=false,copying=false,tail=Promise.resolve(),queued=0;
 const release=()=>fs.rm(lock,{force:true});
 try{
  if(fresh){
   current=seed?await readSnapshot(SQL,seed.snapshot.manifest,seed.snapshot.bytes):createDb(SQL,domainSchema,migration);
   must(!one(current,"SELECT name FROM sqlite_master WHERE name LIKE 'lc81_%' LIMIT 1"),422,'Источник уже содержит закрытые таблицы');
   if(seed){
    must(isId(seed.siteId)&&rootUnit(current,seed.siteId)===seed.siteId&&one(current,"SELECT id FROM org_unit WHERE id=? AND kind='Предприятие'",[seed.siteId]),422,'Выберите корень предприятия');
    must(rows(current,'SELECT id FROM org_unit WHERE archived=0').every(u=>rootUnit(current,u.id)===seed.siteId),422,'Пока поддерживается миграция одного предприятия; другие корни не удаляются');
   }
   current.run(schema);
   tx(current,()=>{
    current.run("INSERT INTO lc81_meta VALUES('service_schema','1')");
    if(selectedZone)current.run('INSERT INTO lc81_meta VALUES(?,?)',[SITE_ZONE_KEY,selectedZone]);
    const site=seed?seed.siteId:domainCreate(current,'org_unit',{code:'LC81-QA',name:'Учебное предприятие',kind:'Предприятие',parent_id:null},SITE);
    const admin=selectRole(current,seed?.adminRoleId,ADMIN_ROLE,'LC81_ACCESS_ADMIN','Администратор');
    const manager=selectRole(current,seed?.managerRoleId,MANAGER_ROLE,'LC81_CENTER_MANAGER','Управляющий центром TWI');
    must(admin!==manager,422,'Административная и рабочая роли должны различаться');
    for(const [k,v] of [['site_id',site],['admin_role_id',admin],['manager_role_id',manager]])current.run('INSERT INTO lc81_meta VALUES(?,?)',[k,v]);
    if(seed)current.run("INSERT INTO lc81_meta VALUES('migrated_snapshot_sha256',?)",[seed.snapshot.manifest.snapshot_sha256]);
    current.run('INSERT INTO lc81_policy VALUES(?,1,?)',[manager,JSON.stringify(PERMISSIONS)]);
    const id=uuid();current.run('INSERT INTO lc81_account(id,person_id,login,password_hash,state,bootstrap,created_at) VALUES(?,NULL,?,?,\'active\',1,?)',[id,normalizeLogin(login),hashPassword(password),at()]);
    audit(current,id,seed?'bootstrap.migrated':'bootstrap',id);
    if(!seed)installMissingRolePresets(current,[admin,manager],payload=>domainCreate(current,'business_role',payload),roleId=>audit(current,id,'role.preset.install',roleId));
   });
   checkPrivate(current);
   if(seed)await copySources(current,dataDir,seed.readSource,write);
   else await fs.mkdir(path.join(dataDir,'documents'),{mode:0o700});
   await write(file,pack(current));
   await write(marker,Buffer.from(meta(current,'database_id')+'\n'));
   current.close();current=null;
  }
  current=await storageStep('CHECKPOINT',()=>unpack(SQL,file));
  must(importDigest===null||uploadSha(importDigest)&&one(current,'SELECT value FROM lc81_meta WHERE key=?',[UPLOAD_KEY])?.value===importDigest,409,'Загрузка QA не совпадает с существующим хранилищем');
  must(!selectedZone||siteClock(current).configured&&normalizeZone(siteClock(current).zone)===selectedZone,409,'Часовой пояс уже хранится в базе; настройте его явно через администратора');
  must((await storageStep('MARKER',()=>fs.readFile(marker,'utf8')))===meta(current,'database_id')+'\n',503,'Отсутствует или повреждён маркер инициализации');
  await storageStep('DOCUMENTS',()=>checkSources(current,dataDir));
 }catch(e){current?.close();await release();throw e}
 const ready=()=>must(!closed&&!poisoned,503,'Защищённое хранилище требует проверки');
 const read=fn=>{ready();return fn(current)};
 function mutate(fn,beforeWrite=null){
  ready();must(!copying&&queued<8,429,'Очередь сохранения занята');queued++;
  const task=tail.then(async()=>{
   ready();const candidate=openDb(SQL,bytesOf(current),{upgrade:false});
   try{
    const result=tx(candidate,()=>fn(candidate));checkPrivate(candidate);
    if(beforeWrite)await beforeWrite(candidate);
    try{
     const packed=pack(candidate);await write(file,packed);
     const back=await unpack(SQL,file);try{must((await fs.readFile(file)).equals(packed),503,'Запись не подтверждена')}finally{back.close()}
    }catch(e){poisoned=true;throw new PilotError(503,'Запись не подтверждена; требуется проверка хранилища')}
    current.close();current=candidate;return result;
   }finally{if(candidate!==current)candidate.close()}
  });
  tail=task.catch(()=>{}).finally(()=>{queued--});return task;
 }
 const readFile=async ref=>{
  const name=path.join(dataDir,'documents',ref.sha256+'.json'),st=await fs.stat(name);
  must(st.isFile()&&st.size===ref.size&&st.size<=MAX_CONTENT,503,'Исходник не подтверждён');
  return new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(name));
 };
 async function persistSource(candidate,ref,text){
  const refs=refsForDb(candidate);
  must(refs.some(x=>x.sha256===ref.sha256)&&refs.reduce((n,x)=>n+x.size,0)<=PILOT_DOCUMENT_LIMIT,413,'Лимит исходников');
  const dir=path.join(dataDir,'documents'),name=path.join(dir,ref.sha256+'.json');
  let existing=false;
  try{await fs.stat(name);existing=true}catch(e){if(e.code!=='ENOENT')throw e}
  if(!existing){
   let total=0;
   for(const file of await fs.readdir(dir,{withFileTypes:true})){
    must(file.isFile(),503,'Неизвестный объект в хранилище');
    total+=(await fs.stat(path.join(dir,file.name))).size;
   }
   must(total+ref.size<=PILOT_DOCUMENT_LIMIT,413,'Лимит исходников, включая неподтверждённые файлы');
   await write(name,Buffer.from(text,'utf8'));
  }
  await checkContent(ref,await readFile(ref));
 }
 function checkedAccount(db,actor,revision){const a=account(db,actor);must(a&&a.credential_revision===revision,401,'Сеанс завершён');return a}
 const resolveCtx=(db,actor,revision,input)=>resolveLibraryContext(db,input,libraryAccess(db,checkedAccount(db,actor,revision),day(db)));
 return {
  get healthy(){return !closed&&!poisoned},
  authenticate(login,password){return read(db=>{
   const name=normalizeLogin(login);const a=name&&one(db,'SELECT * FROM lc81_account WHERE login=?',[name]);
   const ok=verifyPassword(password,a?.password_hash);
   return ok&&account(db,a.id)?sessionView(db,a):null;
  })},
  session(id,revision,withWorkspace=true){return read(db=>{const a=account(db,id);return a&&a.credential_revision===revision?sessionView(db,a,withWorkspace):null})},
  adminData(actor,revision){return read(db=>{
   requireAdmin(db,actor,revision);
   return {clock:siteClock(db),setup:{operations:one(db,'SELECT count(*) n FROM operation WHERE archived=0').n,sop:one(db,"SELECT count(*) n FROM document WHERE archived=0 AND kind='sop'").n,frv:one(db,"SELECT count(*) n FROM frv_study WHERE state<>'archived'").n},accounts:rows(db,'SELECT * FROM lc81_account ORDER BY login').map(a=>({...sanitized(db,a),employment_active:a.bootstrap===1||employment(db,a.person_id,day(db)).length===1})),
    people:rows(db,'SELECT id,display_name,employee_code FROM person WHERE archived=0 ORDER BY display_name'),
    units:rows(db,'SELECT id,parent_id,name,code FROM org_unit WHERE archived=0 ORDER BY name'),
    roles:rows(db,'SELECT id,code,name FROM business_role WHERE archived=0 ORDER BY name'),
    assignments:rows(db,'SELECT id,person_id,role_id,valid_from,valid_to,rev FROM role_assignment ORDER BY valid_from DESC,id'),
    employment:rows(db,'SELECT id,person_id,unit_id,valid_from,valid_to,rev FROM person_assignment ORDER BY valid_from DESC,id'),
    policies:rows(db,'SELECT * FROM lc81_policy').map(p=>({role_id:p.role_id,revision:p.revision,permissions:JSON.parse(p.permissions_json)})),
    grants:rows(db,'SELECT id,account_id,role_id,assignment_id,employment_id,scope_json,policy_revision,state,valid_from,valid_to,revoked_at FROM lc81_grant ORDER BY issued_at DESC,id').map(g=>{const x={...g,scope:JSON.parse(g.scope_json)};return {...x,status:grantStatus(db,x,day(db),config(db).site)}}),
    actions:PERMISSIONS,audit:auditView(db),site:config(db).site,protectedRoles:[config(db).admin,config(db).manager],rolePresets:rolePresetStatus(db,[config(db).admin,config(db).manager])};
  })},
  createReference(actor,type,payload,revision){
   return mutate(db=>{
    requireAdmin(db,actor,revision);
    must(REFERENCE_CREATE_TYPES.includes(type),403,'Неизвестное действие');
    must(payload&&typeof payload==='object'&&!Array.isArray(payload),400,'Неверные поля');
    // Only QA references; no generic writes, imports or business events.
    if(type==='org_unit')must(payload.parent_id&&rootUnit(db,payload.parent_id)===config(db).site&&payload.kind!=='Предприятие',400,'Подразделение вне учебной площадки');
    if(type==='business_role')must(typeof payload.code==='string'&&!payload.code.toUpperCase().startsWith('LC81_'),400,'Системный код защищён');
    if(type==='role_assignment')must(payload.role_id!==config(db).admin,403,'Системный администратор защищён');
    if(type==='person_assignment')must(rootUnit(db,payload.unit_id)===config(db).site,400,'Подразделение вне учебной площадки');
    let id;try{id=domainCreate(db,type,payload)}catch{throw new PilotError(422,'Запись не прошла доменную проверку')}
    audit(db,actor,'directory.create.'+type,id);return {id};
   });
  },
  createAccount(actor,input,revision){return mutate(db=>createAccountRecord(db,actor,input,revision))},
  // One explicit transaction: no partial employee/account/manager grants.
  provisionAccount(actor,input,revision){
   return mutate(db=>{
    requireAdmin(db,actor,revision);
    const withAccess=Object.hasOwn(input||{},'access');
    must(keys(input,['person_id','new_person','login','password','generate','manager',...(withAccess?['access']:[])])&&typeof input.manager==='boolean',400,'Неверные поля пользователя');
    if(withAccess)must(!input.manager&&keys(input.access,['role_id','scopes'])&&isId(input.access.role_id)&&Array.isArray(input.access.scopes)&&input.access.scopes.length>=1&&input.access.scopes.length<=2,400,'Неверный выбранный доступ');
    let id=input.person_id;
    if(id===null){
     must(keys(input.new_person,['employee_code','display_name','unit_id']),400,'Заполните сотрудника и подразделение');
     const d=day(db),a=account(db,actor);
     const result=applyDirectoryCommand(db,{type:'person',operation:'create',id:null,expected_revision:0,fields:input.new_person},{day:d,at:at(),site:config(db).site,read:(action,id)=>readFor(db,a,action,id,d),allows:(action,anchor,id)=>directoryAllowed(db,a,action,anchor,id,d),audit:(action,target)=>audit(db,actor,action,target)});
     id=result.id;
    }else must(input.new_person===null,400,'Выберите одного сотрудника');
    const result=createAccountRecord(db,actor,{person_id:id,login:input.login,password:input.password,generate:input.generate},revision);
    if(input.manager){
     // A deliberately selected manager gets the actual existing protected
     // manager policy, not a wildcard or silently upgraded old policy.
     assignAccessRecord(db,actor,{account_id:result.id,role_id:config(db).manager,scope:{kind:'unit_tree',unit_id:config(db).site},valid_to:null},revision);
    }
    if(withAccess){
     const cfg=config(db),p=rolePresetStatus(db,[cfg.admin,cfg.manager]).find(x=>x.role_id===input.access.role_id&&['ready','custom'].includes(x.status));
     must(p,422,'Выберите действующий рабочий профиль');
     const scopes=input.access.scopes,valid=scopes.every(s=>s&&typeof s==='object'&&(p.scope==='unit_tree'?keys(s,['kind','unit_id'])&&s.kind==='unit_tree':keys(s,['kind'])&&(s.kind===p.scope||p.scope==='assigned'&&s.kind==='self')));
     must(valid&&scopes.some(s=>s.kind===p.scope)&&new Set(scopes.map(x=>x.kind)).size===scopes.length,422,'Неверная область рабочего профиля');
     for(const scope of scopes)assignAccessRecord(db,actor,{account_id:result.id,role_id:p.role_id,scope,valid_to:null},revision);
    }
    return {...result,person_id:id,manager:input.manager};
   });
  },
  assignAccess(actor,input,revision){return mutate(db=>assignAccessRecord(db,actor,input,revision))},
  setState(actor,id,state,revision,expectedRevision=undefined){
   return mutate(db=>{
    requireAdmin(db,actor,revision);const a=one(db,'SELECT * FROM lc81_account WHERE id=?',[id]);
    must(a&&a.bootstrap!==1&&['active','blocked'].includes(state),403,'Защищённый аккаунт или неверное состояние');
    must(expectedRevision===undefined||a.credential_revision===expectedRevision,409,'Учётная запись изменилась');
    must(state!=='active'||activePerson(db,a.person_id)&&employment(db,a.person_id,day(db)).length===1,422,'Сначала зарегистрируйте действующее кадровое назначение');
    db.run('UPDATE lc81_account SET state=?,credential_revision=credential_revision+1 WHERE id=?',[state,id]);
    audit(db,actor,'account.'+state,id);return {id,state};
   });
  },
  changePassword(actor,revision,input){
   return mutate(db=>changeOwnPassword(db,checkedAccount(db,actor,revision),input,(k,id)=>audit(db,actor,k,id)));
  },
  resetPassword(actor,revision,input){
   return mutate(db=>{requireAdmin(db,actor,revision);return resetAccountPassword(db,input,(k,id)=>audit(db,actor,k,id))});
  },
  renameAccount(actor,revision,input){
   return mutate(db=>{requireAdmin(db,actor,revision);return renameAccount(db,input,(k,id)=>audit(db,actor,k,id))});
  },
  endRole(actor,revision,input){
   return mutate(db=>{requireAdmin(db,actor,revision);return endRole(db,input,{...siteClock(db),adminRole:config(db).admin,audit:(k,id)=>audit(db,actor,k,id)})});
  },
  endEmployment(actor,revision,input){
   return mutate(db=>{requireAdmin(db,actor,revision);return endEmployment(db,input,{...siteClock(db),audit:(k,id)=>audit(db,actor,k,id)})});
  },
  configureClock(actor,revision,input){
   return mutate(db=>{
    requireAdmin(db,actor,revision);must(keys(input,['zone','confirmed'])&&input.confirmed===true,400,'Подтвердите календарь предприятия');
    must(!siteClock(db).configured,409,'Часовой пояс уже установлен; изменение требует отдельной миграции');
    const zone=normalizeZone(input.zone);must(zone,422,'Укажите корректный IANA часовой пояс');
    db.run('INSERT INTO lc81_meta VALUES(?,?)',[SITE_ZONE_KEY,zone]);
    // The date boundary changes permission evaluation; require fresh sessions
    // without altering any historic domain record or role assignment.
    db.run('UPDATE lc81_account SET credential_revision=credential_revision+1 WHERE bootstrap=0');
    audit(db,actor,'site.clock.configure',config(db).site);return siteClock(db);
   });
  },
  installRolePresets(actor,input,revision){
   return mutate(db=>{
    requireAdmin(db,actor,revision);must(keys(input,['confirmed'])&&input.confirmed===true,400,'Подтвердите добавление недостающих ролей');
    const cfg=config(db),ids=installMissingRolePresets(db,[cfg.admin,cfg.manager],p=>domainCreate(db,'business_role',p),id=>audit(db,actor,'role.preset.install',id));
    return {created:ids.length};
   });
  },
  setPolicy(actor,input,revision){
   return mutate(db=>{
    requireAdmin(db,actor,revision);must(keys(input,['role_id','revision','permissions']),400,'Неверные поля политики');
    const {role_id,revision:policyRevision,permissions}=input;
    must(roleRow(db,role_id)&&role_id!==config(db).admin&&role_id!==config(db).manager,403,'Системная политика защищена');
    must(Array.isArray(permissions)&&permissions.length<=PERMISSIONS.length&&new Set(permissions).size===permissions.length&&permissions.every(p=>PERMISSIONS.includes(p)),422,'Неизвестное право');
    const old=one(db,'SELECT revision FROM lc81_policy WHERE role_id=?',[role_id]);must(policyRevision===(old?.revision||0),409,'Политика изменилась');
    db.run('INSERT INTO lc81_policy VALUES(?,?,?) ON CONFLICT(role_id) DO UPDATE SET revision=excluded.revision,permissions_json=excluded.permissions_json',[role_id,policyRevision+1,JSON.stringify([...permissions].sort())]);
    audit(db,actor,'policy.update',role_id);return {revision:policyRevision+1};
   });
  },
  grant(actor,input,revision){return mutate(db=>grantRecord(db,actor,input,revision))},
  revoke(actor,id,revision){
   return mutate(db=>{
    requireAdmin(db,actor,revision);must(one(db,"SELECT id FROM lc81_grant WHERE id=? AND state='active'",[id]),404,'Назначение не найдено');
    db.run("UPDATE lc81_grant SET state='revoked',revoked_at=? WHERE id=?",[at(),id]);audit(db,actor,'grant.revoke',id);return {id};
   });
  },
  readResource(actor,action,id){return read(db=>{
   const a=account(db,actor);if(!a)return null;
   const d=day(db),v=SHARED_LIBRARY_READS.includes(action)?libraryAccess(db,a,d).read(action,id):readFor(db,a,action,id,d);
   return v?projectView(db,a,action,v.data,day(db)):null;
  })},
  listResources(actor,action){return read(db=>{
   const a=account(db,actor);must(a,401,'Необходим вход');const d=day(db),shared=SHARED_LIBRARY_READS.includes(action),access=shared?libraryAccess(db,a,d):null;
   must(READ_ACTIONS.includes(action)&&(shared?access.permissions:permissionsFor(db,a)).includes(action),404,'Раздел недоступен');
   const table=RESOURCE_TABLES[action];
   const s=security(db,actor);return rows(db,'SELECT id FROM '+table+' ORDER BY id').map(({id})=>shared?access.read(action,id):a.bootstrap===1?readManagerProjection(db,config(db).site,action,id,d):readAuthorized(db,s,actor,action,id,d)).filter(Boolean).map(v=>projectView(db,a,action,v.data,d));
  })},
  trainingOptions(actor,revision,operationId=null){return read(db=>trainingOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),operationId))},
  async createTraining(actor,revision,input){
   const resolved=read(db=>resolveTrainingCreate(db,input,trainingAccess(db,checkedAccount(db,actor,revision),day(db))));
   try{await verifyDomainEvents([{id:uuid(),entity_type:'training_assignment',entity_id:uuid(),operation:'create',expected_revision:0,payload:resolved.payload,occurred_at:at()}],ref=>readFile(ref))}
   catch(e){throw new PilotError(422,'Проверьте исходный СОП, актуальный план TWI и методику: '+String(e.message||'ошибка').split('\n')[0].slice(0,200))}
   return mutate(db=>{
    const access=trainingAccess(db,checkedAccount(db,actor,revision),day(db)),next=resolveTrainingCreate(db,input,access);
    must(next.source.sha256===resolved.source.sha256&&JSON.stringify(next.payload)===JSON.stringify(resolved.payload)&&next.scenario===resolved.scenario&&next.rapidConfirm===resolved.rapidConfirm,409,'Назначение изменилось при проверке');
    return createTraining(db,next,access);
   });
  },
  changeTraining(actor,revision,input){return mutate(db=>changeTraining(db,input,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  productionPlans(actor,revision){return read(db=>productionPlans(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  createProductionPlan(actor,revision,input){return mutate(db=>createProductionPlan(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  approveProductionPlan(actor,revision,input){return mutate(db=>approveProductionPlan(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  recordInstructionProtocol(actor,revision,input){return mutate(db=>recordInstructionProtocol(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  recordAssessmentResult(actor,revision,input){return mutate(db=>recordAssessmentResult(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  trainingDetail(actor,revision,id){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return {...trainingDetail(db,a,id),forms:documentLinks(db,a,id,["training_plan","journal"])}})},
  trainingSop(actor,revision,id){return read(db=>trainingSop(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  programOptions(actor,revision){return read(db=>programOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  saveProgram(actor,revision,input){return mutate(db=>saveProgram(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  retireProgram(actor,revision,input){return mutate(db=>retireProgram(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  programDetail(actor,revision,id){return read(db=>programDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  enrollmentOptions(actor,revision){return read(db=>enrollmentOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  createEnrollment(actor,revision,input){return mutate(db=>createEnrollment(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  changeEnrollment(actor,revision,input){return mutate(db=>changeEnrollment(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  enrollmentDetail(actor,revision,id){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return {...enrollmentDetail(db,a,id),forms:documentLinks(db,a,id,['entry'])}})},
  preparationOptions(actor,revision){return read(db=>preparationOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  createPreparation(actor,revision,input){return mutate(db=>createPreparation(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  preparationFactOptions(actor,revision,id,on){return read(db=>preparationFactOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id,on))},
  recordPreparationFact(actor,revision,input){return mutate(db=>recordPreparationFact(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  preparationDetail(actor,revision,id){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return {...preparationDetail(db,a,id),forms:documentLinks(db,a,id,["adaptation","safety_program","internship_program","preparation","preparation_pack"])}})},
  orderOptions(actor,revision){return read(db=>orderOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  registerOrder(actor,revision,input){return mutate(db=>registerOrder(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  orderDetail(actor,revision,id){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return {...orderDetail(db,a,id),forms:documentLinks(db,a,id,["order"])}})},
  supplementOptions(actor,revision){return read(db=>supplementOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  createSupplement(actor,revision,input){return mutate(db=>createSupplement(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  supplementDetail(actor,revision,id){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return {...supplementDetail(db,a,id),forms:documentLinks(db,a,id,["supplement"])}})},
  changeSupplement(actor,revision,input){return mutate(db=>changeSupplement(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  developmentOptions(actor,revision){return read(db=>developmentOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  createDevelopment(actor,revision,input){return mutate(db=>createDevelopment(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  developmentDetail(actor,revision,id){return read(db=>developmentDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  changeDevelopment(actor,revision,input){return mutate(db=>changeDevelopment(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  developmentFromMatrix(actor,revision,input){return mutate(db=>developmentFromMatrix(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  bankOptions(actor,revision){return read(db=>bankOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  bankDetail(actor,revision,id){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return {...bankDetail(db,a,id),forms:documentLinks(db,a,id,["bank"])}})},
  saveBank(actor,revision,input){return mutate(db=>saveBank(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  mobileOptions(actor,revision){return read(db=>mobileOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  exportMobile(actor,revision,f){return mutate(db=>exportMobile(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  previewMobile(actor,revision,f){return read(db=>previewMobile(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  commitMobile(actor,revision,f){return mutate(db=>commitMobile(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  receiptMobile(actor,revision,f){return read(db=>receiptMobile(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  assistantRecords(actor,revision,kind){return read(db=>{const user=checkedAccount(db,actor,revision),d=day(db);return assistantRecords(db,assistantAccess(db,user,d),kind,id=>cardAllowed(db,user,id,d))})},
  assistantOptions(actor,revision){return read(db=>assistantOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  assistantContext(actor,revision,f){return read(db=>{const user=checkedAccount(db,actor,revision),d=day(db);return assistantContext(db,assistantAccess(db,user,d),f,id=>cardAllowed(db,user,id,d))})},
  assistantRequest(actor,revision,f){return read(db=>{const user=checkedAccount(db,actor,revision),d=day(db);return assistantRequest(db,assistantAccess(db,user,d),f,id=>cardAllowed(db,user,id,d))})},
  qualityOptions(actor,revision,kind){return read(db=>qualityOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),kind))},
  installMentorMethod(actor,revision,input){return mutate(db=>installMentorMethod(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  createAudit(actor,revision,input){return mutate(db=>createAudit(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  createSelf(actor,revision,input){return mutate(db=>createSelf(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  voidAudit(actor,revision,input){return mutate(db=>voidAudit(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  qualityDetail(actor,revision,kind,id){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return {...qualityDetail(db,a,kind,id),forms:documentLinks(db,a,id,[kind])}})},
  taskOptions(actor,revision,source){return read(db=>taskOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),source))},
  createTask(actor,revision,input){return mutate(db=>createTask(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  taskDetail(actor,revision,id){return read(db=>taskDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  changeTask(actor,revision,input){return mutate(db=>changeTask(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  mentorWorkspace(actor,revision){return read(db=>{const a=checkedAccount(db,actor,revision),d=day(db);return mentorWorkspace(db,trainingAccess(db,a,d),id=>cardAllowed(db,a,id,d))})},
  candidateOptions(actor,revision){return read(db=>candidateOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  candidateEvidence(actor,revision,id,from,to){return read(db=>candidateEvidence(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id,from,to))},
  recordCandidateEvidence(actor,revision,f){return mutate(db=>recordCandidateEvidence(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  voidCandidateEvidence(actor,revision,f){return mutate(db=>voidCandidateEvidence(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  mentorOptions(actor,revision,kind){return read(db=>mentorOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),kind))},
  changeMentor(actor,revision,input){return mutate(db=>changeMentor(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  calendarWorkspace(actor,revision,query){return read(db=>{
   const a=checkedAccount(db,actor,revision),d=day(db),access=trainingAccess(db,a,d),id=query.person_id||null;
   if(id)must(isId(id)&&cardAllowed(db,a,id,d)&&((query.mode==='plan'&&a.person_id===id&&workspaceActions(db,access,a.bootstrap===1).includes('plan.read'))||access.permissions.includes('calendar.read')),404,'План сотрудника недоступен');
   return calendarWorkspace(db,access,{...query,person_id:id});
  })},
  calendarOptions(actor,revision,type,sourceId=null){return read(db=>calendarOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),type,sourceId))},
  calendarDetail(actor,revision,id){return read(db=>calendarDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  createSchedule(actor,revision,input){return mutate(db=>createSchedule(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  changeSchedule(actor,revision,input){return mutate(db=>changeSchedule(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  centerOptions(actor,revision,kind){return read(db=>centerOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),kind))},
  historyOptions(actor,revision){return read(db=>historyOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  historyList(actor,revision,offset){return read(db=>historyList(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),offset))},
  historyDetail(actor,revision,id){return read(db=>historyDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  historyArchive(actor,revision,id){return read(db=>historyArchive(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  async previewHistory(actor,revision,f){
   must(keys(f,['raw','offset']),400,'Неверный запрос предпросмотра');
   const snapshot=read(db=>{assertImport(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)));return openDb(SQL,bytesOf(db),{upgrade:false})});
   try{const access=trainingAccess(snapshot,checkedAccount(snapshot,actor,revision),day(snapshot)),plan=await loadHistoryPlan(snapshot,access,f.raw),result=historyPreview(snapshot,access,plan,f.offset);
    read(db=>assertImport(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))));return result;
   }finally{snapshot.close()}
  },
  async importHistory(actor,revision,f){
   must(keys(f,['raw','token','selected','metadata','archive_hash']),400,'Неверный запрос импорта');
   const snapshot=read(db=>{assertImport(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)));return openDb(SQL,bytesOf(db),{upgrade:false})});
   let prepared;
   try{const access=trainingAccess(snapshot,checkedAccount(snapshot,actor,revision),day(snapshot)),plan=await loadHistoryPlan(snapshot,access,f.raw);prepared=await buildHistoryEvents(snapshot,access,f,plan)}
   finally{snapshot.close()}
   return mutate(db=>commitHistory(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f.raw,prepared));
  },
  subjectOptions(actor,revision,kind=null,sopKind='sop_evaluation'){return read(db=>subjectOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),kind,sopKind))},
  subjectReport(actor,revision,f){return read(db=>subjectReport(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  exportSubject(actor,revision,f){
   let result;return mutate(db=>{result=subjectWorkbook(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f);return result},async()=>{await serializeForm(result)});
  },
  async frvReport(actor,revision,id){
   const descriptor=db=>{const user=checkedAccount(db,actor,revision);subjectOptions(db,trainingAccess(db,user,day(db)),'frv');return detailDescriptor(db,'frv.read_summary',id,libraryAccess(db,user,day(db)))};
   const desc=read(descriptor),data=await checkedLibrarySource(desc,readFile);
   return read(db=>{must(descriptor(db).source.sha256===desc.source.sha256,409,'Исходник ФРВ изменился');return frvReportDetail(data.raw,id)});
  },
  centerWorkspace(actor,revision,kind,scope){return read(db=>centerWorkspace(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),kind,scope))},
  metricEvidence(actor,revision,kind,scope,id,offset){return read(db=>metricEvidence(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),kind,scope,id,offset))},
  roiOptions(actor,revision){return read(db=>roiOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  roiDetail(actor,revision,id){return read(db=>roiDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  createRoi(actor,revision,input){return mutate(db=>createRoi(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  changeRoi(actor,revision,input){return mutate(db=>changeRoi(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  roiTwiOptions(actor,revision,id){return read(db=>roiTwiOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  previewRoiTwi(actor,revision,input){return read(db=>previewRoiTwi(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  async measureRoi(actor,revision,input){
   const descriptor=read(db=>{
    const account=checkedAccount(db,actor,revision),d=day(db),ctx=roiMeasureContext(db,trainingAccess(db,account,d),input);
    return ctx.r.study_id?detailDescriptor(db,'frv.read_summary',ctx.r.study_id,libraryAccess(db,account,d)):null;
   });
   const verified=descriptor?await checkedLibrarySource(descriptor,readFile):null;
   // The mutation resolves the record, permissions, CAS, verified source
   // identity and current effective action evidence again after file I/O.
   return mutate(db=>measureRoi(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input,verified));
  },
  competencyOptions(actor,revision,kind,personId=null,skillId=null){return read(db=>competencyOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),kind,personId,skillId))},
  competencyChange(actor,revision,input){return mutate(db=>competencyChange(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  assessmentDetail(actor,revision,id){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return {...assessmentDetail(db,a,id),forms:documentLinks(db,a,id,["practical"])}})},
  suggestMatrix(actor,revision,input){return read(db=>suggestMatrix(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  matrixOverviewOptions(actor,revision){return read(db=>matrixOverviewOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  matrixOverview(actor,revision,f){return read(db=>{const a=checkedAccount(db,actor,revision),d=day(db);return matrixOverview(db,trainingAccess(db,a,d),f,id=>cardAllowed(db,a,id,d))})},
  matrixAssessmentHistory(actor,revision,personId,skillId,offset){return read(db=>matrixAssessmentHistory(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),personId,skillId,offset))},
  profileOptions(actor,revision){return read(db=>profileOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  professionProfile(actor,revision,profession,scale,effective){return read(db=>professionProfile(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),profession,scale,effective))},
  saveProfessionProfile(actor,revision,f){return mutate(db=>saveProfessionProfile(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  matrixInfo(actor,revision,unit=null,baseOn=null,filters={}){return read(db=>{const a=trainingAccess(db,checkedAccount(db,actor,revision),day(db));return matrixInfo(db,a,unit,baseOn??a.day,filters)})},
  saveMatrix(actor,revision,input){return mutate(db=>saveMatrix(db,input,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  retireMatrix(actor,revision,input){return mutate(db=>retireMatrix(db,input,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  matrixDetail(actor,revision,id){return read(db=>{const user=checkedAccount(db,actor,revision),d=day(db),a=trainingAccess(db,user,d),v=matrixDetail(db,a,id);return {...v,roster:v.roster.map(row=>({...row,can_card:cardAllowed(db,user,row.person_id,d)})),forms:documentLinks(db,a,id,["matrix"])}})},
  personCard(actor,revision,id){return read(db=>{
   const a=checkedAccount(db,actor,revision),d=day(db),access=trainingAccess(db,a,d),v=libraryAccess(db,a,d);
   must(cardAllowed(db,a,id,d),404,'Карточка сотрудника недоступна');
   const canTwiReport=access.permissions.includes('analytics.read')&&subjectOptions(db,access).reports.some(r=>r.id==='twi_effect');
   const canPlan=a.person_id===id&&workspaceActions(db,access,a.bootstrap===1).includes('plan.read')||access.permissions.includes('calendar.read');
   return personCard(db,access,id,i=>cardAllowed(db,a,i,d),{libraryRead:v.read,canTwiReport,canPlan});
  })},
  libraryInfo(actor,kind){
   return read(db=>{
    const a=account(db,actor);must(a&&['sop','frv'].includes(kind),404,'Раздел недоступен');
    return libraryOptions(db,a,kind,day(db));
   });
  },
  editorAiAccess(actor,revision,input){
   return read(db=>{
    const a=checkedAccount(db,actor,revision);
    if(unboundLibraryContext(input)){must(libraryOptions(db,a,input.kind,day(db)).can_prepare,403,'Редактор недоступен');return true}
    resolveCtx(db,actor,revision,input);return true;
   });
  },
  async openLibrary(actor,revision,input){
   if(unboundLibraryContext(input))return read(db=>{
    const a=checkedAccount(db,actor,revision),d=day(db),options=libraryOptions(db,a,input.kind,d);
    must(options.can_prepare,403,'Редактор недоступен');
    return {context:input,expected_revision:0,title:'',code:'',observed_at:'',operation:{name:'',unit:''},people:libraryPeople(db,a,d),text:null,options};
   });
   const ctx=read(db=>resolveCtx(db,actor,revision,input));
   let text;try{text=await sourceForEditor(ctx,readFile)}catch(e){if(e instanceof PilotError)throw e;throw new PilotError(422,'Не удалось подготовить проверенный исходник: '+String(e.message||'ошибка').split('\n')[0].slice(0,180))}
   return read(db=>{
    const next=resolveCtx(db,actor,revision,input);
    must(contextStamp(next)===contextStamp(ctx),409,'Документ изменился при открытии');
    const a=checkedAccount(db,actor,revision),d=day(db);
    // Only visible directory entries. Omit protected role names and unrelated personnel.
    const people=libraryPeople(db,a,d);
    return {context:ctx.input,expected_revision:ctx.expected,title:ctx.title,code:ctx.code,observed_at:ctx.observed_at,operation:ctx.operation,people,text};
   });
  },
  async saveLibrary(actor,revision,request){
   const combined=Object.hasOwn(request||{},'new_operation');
   must(keys(request,['request_id','context','expected_revision','title','code','observed_at','text',...(combined?['new_operation']:[])])&&typeof request.text==='string'&&Buffer.byteLength(request.text,'utf8')<=MAX_CONTENT,400,'Неверные поля сохранения');
   if(combined)must(unboundLibraryContext(request.context)&&request.expected_revision===0&&keys(request.new_operation,['unit_id','code','name'])&&Object.values(request.new_operation).every(x=>typeof x==='string'),400,'Неверная новая операция');
   const digest=requestDigest(request);
   const priorResult=db=>{
    const a=checkedAccount(db,actor,revision),prior=getReceipt(db,actor,request.request_id,digest);
    if(!prior)return null;
    const kind=request.context?.kind,access=libraryAccess(db,a,day(db));
    must(['sop','frv'].includes(kind)&&access.read(libraryReadAction(kind),kind==='sop'?prior.revision_id:prior.id),403,'Документ недоступен');
    return {...prior,duplicate:true};
   };
   const prior=read(priorResult);if(prior)return prior;
   // Combined operation + draft is one transaction. The operation command
   // uses the same scoped directory rights and domain validation as before.
   if(combined){
    const {new_operation, ...plain}=request;
    read(db=>{
     const a=checkedAccount(db,actor,revision),options=libraryOptions(db,a,plain.context.kind,day(db));
     must(options.operation_units.some(u=>u.id===new_operation.unit_id),403,'Нет права создавать операцию в этом подразделении');
    });
    const inspected=await inspectLibraryText(plain.context.kind,plain.text);
    let replay=false;
    return mutate(db=>{
     const existing=priorResult(db);if(existing){replay=true;return existing}
     const a=checkedAccount(db,actor,revision),d=day(db),options=libraryOptions(db,a,plain.context.kind,d);
     must(options.operation_units.some(u=>u.id===new_operation.unit_id),403,'Нет права создавать операцию в этом подразделении');
     const created=applyDirectoryCommand(db,{type:'operation',operation:'create',id:null,expected_revision:0,fields:{...new_operation,equipment_id:null,workplace_id:null,criticality:'normal'}},{day:d,at:at(),site:config(db).site,read:(action,id)=>readFor(db,a,action,id,d),allows:(action,anchor,id)=>directoryAllowed(db,a,action,anchor,id,d),audit:(action,target)=>audit(db,actor,action,target)});
     const linked={...plain,context:{...plain.context,operation_id:created.id}},ctx=resolveCtx(db,actor,revision,linked.context);
     const result=saveLibrary(db,linked,ctx,inspected,{at:at(),audit:(action,target)=>audit(db,actor,action,target)});
     addReceipt(db,actor,request.request_id,digest,result,at());return result;
    },candidate=>replay?undefined:persistSource(candidate,inspected.source,request.text));
   }
   const ctx=read(db=>resolveCtx(db,actor,revision,request.context));
   must(request.expected_revision===ctx.expected,409,'Документ изменился. Откройте актуальную редакцию.');
   // Revalidate the actual measured source when creating a draft from FRV.
   if(ctx.origin)try{await sourceForEditor(ctx,readFile)}catch(e){throw new PilotError(422,'Проект из ФРВ не подтверждён')}
   const inspected=await inspectLibraryText(ctx.input.kind,request.text);
   let replay=false;
   return mutate(db=>{
    const existing=priorResult(db);if(existing){replay=true;return existing}
    const current=resolveCtx(db,actor,revision,request.context);
    must(contextStamp(current)===contextStamp(ctx),409,'Документ изменился при сохранении');
    const result=saveLibrary(db,request,current,inspected,{at:at(),audit:(action,target)=>audit(db,actor,action,target)});
    addReceipt(db,actor,request.request_id,digest,result,at());return result;
   },candidate=>replay?undefined:persistSource(candidate,inspected.source,request.text));
  },
  passportLibrary(actor,revision,input){return mutate(db=>{
   const a=checkedAccount(db,actor,revision);
   const clock=siteClock(db);
   return passportLibrary(db,input,{...libraryAccess(db,a,clock.day),at:clock.at,offsetMinutes:clock.offset_minutes,audit:(action,target)=>audit(db,actor,action,target)});
  })},
  finalizeLibrary(actor,revision,input){return mutate(db=>{
   const a=checkedAccount(db,actor,revision);
   return finalizeLibrary(db,input,{...libraryAccess(db,a,day(db)),personId:a.person_id,at:at(),audit:(action,target)=>audit(db,actor,action,target)});
  })},
  libraryCard(actor,revision,id){
   return read(db=>{
    const a=checkedAccount(db,actor,revision),d=day(db),v=libraryAccess(db,a,d),access=trainingAccess(db,a,d);
    const history=isId(id)&&v.read('sop.read_history',id),effective=isId(id)&&v.read('sop.read_effective',id),entry=history||effective;
    must(entry,404,'Карточка СОП недоступна');
    const doc=entry.data.document_id;
    const versions=rows(db,'SELECT id FROM document_revision WHERE document_id=? ORDER BY version_no DESC',[doc]).flatMap(({id})=>{
     const h=v.read('sop.read_history',id)||v.read('sop.read_effective',id);
     return h?[h.data]:[];
    });
    const measured=rows(db,'SELECT id FROM frv_study WHERE revision_id=? ORDER BY observed_at DESC,id',[id]).flatMap(({id})=>{
     const f=v.read('frv.read',id);
     return f?[projectView(db,a,'frv.read',f.data,d)]:[];
    });
    // Do not infer access to confidential history, evaluations or measurements
    // from the public SOP. Reuse the existing action-specific projections.
    let canEffect=false;
    if(history&&access.permissions.includes('analytics.read')){
     const o=subjectOptions(db,access);
     canEffect=o.reports.some(r=>r.id==='twi_effect')&&subjectOptions(db,access,'twi_effect').revisions.some(r=>r.id===id);
    }
    const pub=effective?projectView(db,a,'sop.read_effective',effective.data,d):null;
    const rev=history?projectView(db,a,'sop.read_history',history.data,d):(pub||entry.data);
    const origin=readableFrvOrigin(db,v,id);
    return {day:d,revision:rev,versions,measured,origin:origin?publicFrvOrigin(origin):null,evaluations:sopEvaluationsForRevision(db,access,id),can_evaluation:access.permissions.includes('sop.evaluation.read')&&!!history,can_effectiveness:canEffect,can_rollout:canReadRollout(db,access,id),can_public:!!effective&&v.allows('sop.read_public','sop.read_effective',id),can_steps:!!v.read('sop.read_steps',id),can_twi:!!pub?.can_twi,can_linked_frv:!!pub?.can_linked_frv};
   });
  },
  rolloutDetail(actor,revision,id){return read(db=>rolloutDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  async saveRollout(actor,revision,f){
   const ctx=read(db=>prepareRollout(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f));
   const summary=await inspectRolloutSources(ctx,readFile);
   return mutate(db=>saveRollout(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f,ctx,summary));
  },
  async acceptRollout(actor,revision,f){
   const ctx=read(db=>prepareRolloutAcceptance(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f));
   const summary=await inspectRolloutSources(ctx,readFile);
   return mutate(db=>acceptRollout(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f,ctx,summary));
  },
  async libraryOrigin(actor,revision,id){
   const descriptor=db=>{
    const a=checkedAccount(db,actor,revision),d=day(db),x=readableFrvOrigin(db,libraryAccess(db,a,d),id);
    must(x,404,'Исходные замеры недоступны');return x;
   };
   const x=read(descriptor),text=await checkContent(x.source,await readFile(x.source));
   const inspected=await inspectSource(text,'frv');
   must(inspected.source.sha256===x.source.sha256&&inspected.source.size===x.source.size,503,'Исходник не подтверждён');
   const summary=projectLibraryDetail('frv.read_summary',JSON.parse(text));
   return read(db=>{
    const latest=descriptor(db);
    must(latest.study_id===x.study_id&&latest.source.sha256===x.source.sha256,409,'Связь с исходным ФРВ изменилась');
    return {...publicFrvOrigin(latest),summary};
   });
  },
  async libraryDetail(actor,revision,action,id){
   const desc=read(db=>detailDescriptor(db,action,id,libraryAccess(db,checkedAccount(db,actor,revision),day(db))));
   const data=await checkedLibrarySource(desc,readFile);
   return read(db=>{
    const latest=detailDescriptor(db,action,id,libraryAccess(db,checkedAccount(db,actor,revision),day(db)));
    must(latest.source.sha256===desc.source.sha256,409,'Материал изменился');
    return projectLibraryDetail(action,data.raw);
   });
  },
  async sopPhoto(actor,revision,id,position){
   must(isId(id)&&Number.isSafeInteger(position)&&position>=1&&position<=1000,404,'Фото недоступно');
   const descriptor=read(db=>{
    const a=account(db,actor);must(a&&a.credential_revision===revision&&photoAllowed(db,a,id,day(db)),404,'Фото недоступно');
    return photoDescriptor(db,id,position);
   });
   must(descriptor,404,'Фото недоступно');
   const file=path.join(dataDir,'documents',descriptor.source.sha256+'.json');
   const st=await fs.stat(file);must(st.isFile()&&st.size===descriptor.source.size&&st.size<=MAX_CONTENT,503,'Исходник не подтверждён');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file));
   const result=await extractPhoto(descriptor,text);
   // Authorization and effective revision may have changed during I/O.
   read(db=>{
    const a=account(db,actor),latest=photoDescriptor(db,id,position);
    must(a&&a.credential_revision===revision&&photoAllowed(db,a,id,day(db))&&latest?.source.sha256===descriptor.source.sha256&&latest.sourceId===descriptor.sourceId,404,'Фото недоступно');
   });
   return result;
  },
  upgradeManagerPolicy(actor,input,revision){
   return mutate(db=>{
    requireAdmin(db,actor,revision);must(keys(input,['revision']),400,'Неверные поля политики');
    const id=config(db).manager,old=one(db,'SELECT * FROM lc81_policy WHERE role_id=?',[id]);
    must(old&&old.revision===input.revision,409,'Политика изменилась');
    if(JSON.stringify([...JSON.parse(old.permissions_json)].sort())===JSON.stringify([...PERMISSIONS].sort()))return {revision:old.revision};
    db.run('UPDATE lc81_policy SET revision=revision+1,permissions_json=? WHERE role_id=?',[JSON.stringify(PERMISSIONS),id]);
    audit(db,actor,'policy.manager_upgrade',id);
    return {revision:old.revision+1};
   });
  },
  directoryInfo(actor,type){
   return read(db=>{
    const a=account(db,actor);
    must(a&&Object.hasOwn(DIRECTORIES,type),404,'Справочник недоступен');
    const d=DIRECTORIES[type],date=day(db);
    must(permissionsFor(db,a).includes(d.read),404,'Справочник недоступен');
    const refs={};
    for(const [t,action] of [['org_unit','org.read'],['equipment','equipment.read'],['workplace','workplace.read'],['profession','profession.read'],['position','position.read'],['work_shift','shift.read']]){
     refs[t]=rows(db,'SELECT id FROM '+t+' WHERE archived=0 ORDER BY id').flatMap(({id})=>{
      const r=readFor(db,a,action,id,date);
      return r?[{id,label:r.data.name,unit_id:r.data.unit_id??null,can_create:t==='org_unit'&&(!SITE_REFERENCE_TYPES.includes(type)||id===config(db).site)&&directoryAllowed(db,a,d.create,'org.read',id,date)}]:[];
     });
    }
    return {type,definition:directorySchema(type),refs,can_create:refs.org_unit.some(x=>x.can_create),day:date};
   });
  },
  journalWorkspace(actor,revision,f){return read(db=>journalWorkspace(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  async revisionChange(actor,revision,oldId,newId){
   const ctx=read(db=>revisionReviewContext(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),oldId,newId));
   const same=await inspectRevisionChange(ctx,readFile);
   return read(db=>{
    const current=revisionReviewContext(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),oldId,newId);
    must(current.old_source.sha256===ctx.old_source.sha256&&current.new_source.sha256===ctx.new_source.sha256,409,'Редакции изменились');
    return publicRevisionReview(current,same);
   });
  },
  async saveRevisionChange(actor,revision,f){
   const ctx=read(db=>revisionReviewContext(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f?.old_id,f?.new_id));
   must(ctx.can_review,403,'Нет полномочий принимать решение по изменению СОП');
   const same=await inspectRevisionChange(ctx,readFile);
   return mutate(db=>saveRevisionReview(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f,ctx,same));
  },
  retrainingWorkspace(actor,revision,f){return read(db=>retrainingWorkspace(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  sopEvaluationWorkspace(actor,revision,f){return read(db=>sopEvaluationWorkspace(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  sopEvaluationOptions(actor,revision){return read(db=>sopEvaluationOptions(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  sopEvaluationDetail(actor,revision,kind,id){return read(db=>sopEvaluationDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),kind,id))},
  createSopEvaluation(actor,revision,f){return mutate(db=>createSopEvaluation(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  installSopMethod(actor,revision,f){return mutate(db=>installSopMethod(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f))},
  importTypes(actor,revision){return read(db=>({types:importTypes(trainingAccess(db,checkedAccount(db,actor,revision),day(db))),max_bytes:2*1024*1024}))},
  async inspectDirectoryFile(actor,revision,f){
   read(db=>importAllowed(trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f?.type));
   const data=await inspectDirectoryFile(f);
   read(db=>importAllowed(trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f?.type));return data;
  },
  async previewDirectoryFile(actor,revision,f){
   read(db=>importAllowed(trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f?.type));
   const parsed=await parseDirectoryFile(f);
   return read(db=>{
    const a=checkedAccount(db,actor,revision),d=day(db),access=trainingAccess(db,a,d),copy=openDb(SQL,bytesOf(db),{upgrade:false});
    try{
     const result=planDirectoryImport(copy,access,parsed,{day:d,at:at(),site:config(copy).site,read:(action,id)=>readFor(copy,a,action,id,d),allows:(action,anchor,id)=>directoryAllowed(copy,a,action,anchor,id,d),audit:()=>{}});
     return {...result,token:result.can_commit?makeImportToken(db,access,parsed):null};
    }finally{copy.close()}
   });
  },
  async commitDirectoryFile(actor,revision,f){
   read(db=>importAllowed(trainingAccess(db,checkedAccount(db,actor,revision),day(db)),f?.type));
   const parsed=await parseDirectoryFile(f,true);
   return mutate(db=>{
    const a=checkedAccount(db,actor,revision),d=day(db),access=trainingAccess(db,a,d);
    importAllowed(access,parsed.type);checkImportToken(db,access,parsed,f.token);
    const result=planDirectoryImport(db,access,parsed,{day:d,at:at(),site:config(db).site,read:(action,id)=>readFor(db,a,action,id,d),allows:(action,anchor,id)=>directoryAllowed(db,a,action,anchor,id,d),audit:(action,target)=>audit(db,actor,action,target)});
    must(result.can_commit,409,'Импорт не подтверждён: появились конфликты. Выполните предварительную проверку');
    return {counts:result.counts};
   });
  },
  formsCatalog(actor,revision){return read(db=>formsCatalog(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db))))},
  exportForm(actor,revision,input){
   let result;
   return mutate(db=>{result=prepareForm(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input);return result},async()=>{await serializeForm(result)});
  },
  employmentDetail(actor,revision,id){return read(db=>employmentDetail(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),id))},
  transferEmployment(actor,revision,input){return mutate(db=>transferEmployment(db,trainingAccess(db,checkedAccount(db,actor,revision),day(db)),input))},
  changeDirectory(actor,revision,input){
   return mutate(db=>{
    const a=account(db,actor);must(a&&a.credential_revision===revision,401,'Сеанс завершён');
    const d=day(db);
    must(Object.hasOwn(DIRECTORIES,input?.type)&&permissionsFor(db,a).includes(DIRECTORIES[input.type].read),403,'Справочник недоступен');
    return applyDirectoryCommand(db,input,{day:d,at:at(),site:config(db).site,read:(action,id)=>readFor(db,a,action,id,d),allows:(action,anchorAction,id)=>directoryAllowed(db,a,action,anchorAction,id,d),audit:(action,target)=>audit(db,actor,action,target)});
   });
  },
  implementOwnTask(actor,revision,input){
   return mutate(db=>{
    const a=account(db,actor);
    must(a&&a.credential_revision===revision,401,'Сеанс завершён');
    must(keys(input,['id','expected_revision','result'])&&isId(input.id)&&Number.isSafeInteger(input.expected_revision)&&input.expected_revision>0&&typeof input.result==='string'&&input.result.trim().length>0&&input.result.length<=2000,400,'Неверные поля выполнения');
    const sec=security(db,actor),clock=siteClock(db),d=clock.day;
    must(a.bootstrap!==1&&canImplementOwnTask(db,sec,actor,input.id,d)&&readAuthorized(db,sec,actor,'task.read',input.id,d),403,'Можно выполнить только своё назначенное мероприятие');
    const row=one(db,'SELECT * FROM action_item WHERE id=?',[input.id]);
    must(row?.rev===input.expected_revision,409,'Запись изменилась; обновите данные');
    must(row.kind!=='trainee_training'||row.followup_assignment_id,422,'Сначала свяжите мероприятие с повторным обучением');
    must(row.kind!=='instructor_training'||row.followup_enrollment_id,422,'Сначала свяжите мероприятие с программой переобучения инструктора');
    const eventId=uuid();
    try{applyEvent(db,{id:eventId,entity_type:'action_item',entity_id:input.id,operation:'update',expected_revision:row.rev,payload:{command:'implement',result:input.result.trim(),business_offset_minutes:clock.offset_minutes},occurred_at:clock.at})}catch{throw new PilotError(422,'Выполнение не прошло существующие проверки мероприятия')}
    audit(db,actor,'task.implement_own',eventId);
    return one(db,'SELECT id,state,rev FROM action_item WHERE id=?',[input.id]);
   });
  },
  // Offline administrative maintenance only. No HTTP route exports this file.
  async copyCheckpoint(target){
   ready();must(path.isAbsolute(target),400,'Абсолютный путь новой папки');
   must(queued===0&&!copying,409,'Остановите сервер перед копированием');
   copying=true;let created=false;
   try{
    await fs.mkdir(target,{mode:0o700});created=true; // EEXIST is deliberate
    const checkpoint=pack(current),id=meta(current,'database_id');
    await copySources(current,target,async sha=>new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(path.join(dataDir,'documents',sha+'.json'))));
    await atomicReplace(path.join(target,'secure.lc81'),checkpoint);
    await atomicReplace(path.join(target,'initialized'),Buffer.from(id+'\n'));
    const checked=await unpack(SQL,path.join(target,'secure.lc81'));
    try{await checkSources(checked,target);must(meta(checked,'database_id')===id,503,'Копия другой базы')}finally{checked.close()}
    must((await fs.readFile(path.join(target,'secure.lc81'))).equals(checkpoint),503,'Копия не подтверждена');
    return {database_id:id,sha256:digest(checkpoint)};
   }catch(e){if(created)await fs.rm(target,{recursive:true,force:true});throw e}finally{copying=false}
  },
  async close(){if(closed)return;closed=true;await tail;current.close();await release()}
 };
}
