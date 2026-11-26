// LC6.2: TWI facts, not invented ratings or financial attribution.
import {rows,one,invariant,canonical} from '../../core/db.js';
import {matrixData,coverageData,admissionStatus,jiStages} from './domain.js';
import {jiConfig} from './ji-v03.js';
import {preparationForEnrollment} from './preparation-results.js';
import {sharedTrainingTask} from './standard-workflows.js';
import {auditRegistry} from './audit-analytics.js';
import {actionRows,actionStatus} from './audit-domain.js';
const dayOf=x=>String(x||'').slice(0,10);
const within=(x,from,to)=>!!x&&(!from||dayOf(x)>=from)&&dayOf(x)<=to;
const unique=xs=>[...new Set(xs.filter(Boolean))];
const median=xs=>{const a=[...xs].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length?(a.length%2?a[i]:(a[i-1]+a[i])/2):null};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const elapsed=(a,b)=>(Date.parse(dayOf(b))-Date.parse(dayOf(a)))/86400000;
const inScope=(x,s)=> (!s.unitId||x.unit_id===s.unitId)&&(!s.operationId||x.operation_id===s.operationId)&&(!s.revisionId||x.sop_revision_id===s.revisionId)&&(!s.programId||x.program_id===s.programId);
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const sorted=(xs,date)=>[...xs].sort((a,b)=>String(a[date]).localeCompare(String(b[date]))||String(a.recorded_at||'').localeCompare(String(b.recorded_at||''))||a.id.localeCompare(b.id));
const grouped=(xs,key)=>{const m=new Map();for(const x of xs){const k=key(x);if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return m};
export function trainingFacts(db){
 const assignments=rows(db,`SELECT a.*,o.unit_id,d.document_id,e.program_id FROM training_assignment a JOIN operation o ON o.id=a.operation_id LEFT JOIN document_revision d ON d.id=a.sop_revision_id LEFT JOIN training_enrollment e ON e.id=a.enrollment_id WHERE a.source_sha256 IS NOT NULL ORDER BY a.assigned_on,a.id`);
 const sessions=grouped(rows(db,'SELECT * FROM training_session WHERE stage_code IS NOT NULL ORDER BY held_at,recorded_at,id'),x=>x.assignment_id);
 const practices=grouped(rows(db,"SELECT * FROM assessment_session WHERE assessment_kind='practical' AND state='confirmed' ORDER BY assessed_at,recorded_at,id"),x=>x.assignment_id);
 const admissions=grouped(rows(db,'SELECT * FROM admission_decision ORDER BY decided_on,recorded_at,id'),x=>x.assignment_id);
 return assignments.map(a=>({...a,sessions:sessions.get(a.id)||[],practices:practices.get(a.id)||[],admissions:admissions.get(a.id)||[]}));
}
function rowFor(db,a,day,to){
 const practices=sorted(a.practices.filter(x=>within(x.assessed_at,'',to)),'assessed_at'),admissions=sorted(a.admissions.filter(x=>within(x.decided_on,'',to)),'decided_on');
 const grant=admissions.find(x=>x.decision==='granted'&&elapsed(a.assigned_on,x.decided_on)>=0)||null;
 const current=admissionStatus(db,a.trainee_id,a.operation_id,day),facts=a.sessions.filter(x=>within(x.held_at,'',to)),known=facts.filter(x=>Number.isFinite(x.duration_minutes)&&x.duration_minutes>=0);
 const introStages=jiStages(a.method_variant,jiConfig(a)).filter(x=>!['support','followup'].includes(x.phase)),beforeGrant=grant?facts.filter(x=>introStages.some(s=>s.code===x.stage_code)&&dayOf(x.held_at)<=grant.decided_on&&(!x.recorded_at||x.recorded_at<=grant.recorded_at)):[],completeTime=!!grant&&beforeGrant.length>0&&beforeGrant.every(x=>Number.isFinite(x.duration_minutes)&&x.duration_minutes>=0)&&jiStages(a.method_variant,jiConfig(a)).filter(x=>!['support','followup'].includes(x.phase)).every(s=>beforeGrant.some(x=>x.stage_code===s.code&&x.result==='completed'));
 return {...a,first:practices[0]||null,last:practices.at(-1)||null,grant,current:current.current&&current.record?.assignment_id===a.id,currentLabel:current.record?.assignment_id===a.id?current.status:'Нет актуального допуска по назначению',elapsed:grant?elapsed(a.assigned_on,grant.decided_on):null,knownMinutes:known.reduce((s,x)=>s+x.duration_minutes,0),missing:facts.length-known.length,completeTime,minutesToGrant:completeTime?beforeGrant.reduce((s,x)=>s+x.duration_minutes,0):null,sourceFacts:beforeGrant.map(x=>[x.id,x.duration_minutes,x.held_at,x.result,x.stage_code])};
}
export const hasRepeatPractice=a=>a.first?.conclusion==='not_meet'&&!!a.last&&a.last.id!==a.first.id;
export const twiDetailRows=(cohort,detail='all')=>cohort.filter(a=>detail==='all'||detail==='granted'&&a.grant||detail==='assessed'&&a.first||detail==='first'&&a.first&&a.first.conclusion!=='not_meet'||detail==='repeat'&&hasRepeatPractice(a)||detail==='completed'&&a.state==='completed'||detail==='current'&&a.current);
const summarize=as=>({assignments:as.length,people:unique(as.map(a=>a.trainee_id)).length,completed:as.filter(a=>a.state==='completed').length,granted:as.filter(a=>a.grant).length,current:as.filter(a=>a.current).length,assessed:as.filter(a=>a.first).length,firstPass:as.filter(a=>a.first&&a.first.conclusion!=='not_meet').length,repeat:as.filter(hasRepeatPractice).length,recovered:as.filter(a=>hasRepeatPractice(a)&&a.last.conclusion!=='not_meet').length,medianDays:median(as.filter(a=>a.elapsed!==null).map(a=>a.elapsed)),durationN:as.filter(a=>a.completeTime).length,meanMinutes:mean(as.filter(a=>a.completeTime).map(a=>a.minutesToGrant))});
export function twiOverview(db,s,{matrix:cachedMatrix=null}={}){
 const requestedTo=s.to||s.day,from=s.from||'',role=s.role||'all',person=s.personId||'';
 invariant(validDay(s.day)&&validDay(requestedTo)&&(!from||validDay(from)&&from<=requestedTo),'Укажите корректный период');const to=requestedTo<s.day?requestedTo:s.day;
 const all=trainingFacts(db).filter(a=>a.state!=='cancelled'&&inScope(a,s));
 const roleMatch=a=>!person||role==='trainee'?(!person||a.trainee_id===person):role==='mentor'?(a.mentor_id===person||a.sessions.some(x=>x.mentor_id===person)):role==='auditor'?false:a.trainee_id===person||a.mentor_id===person||a.supervisor_id===person||a.assigned_by===person||a.sessions.some(x=>x.mentor_id===person||x.witness_id===person)||a.practices.some(x=>x.evaluator_id===person)||a.admissions.some(x=>x.actor_id===person);
 const scoped=role==='auditor'?[]:all.filter(roleMatch),cohort=scoped.filter(a=>within(a.assigned_on,from,to)).map(a=>rowFor(db,a,s.day,to));
 // Activity counts by actual date, independent of the assignment cohort.
 const sessions=(role==='auditor'?[]:all).flatMap(a=>a.sessions.filter(x=>within(x.held_at,from,to)&&(!person||role==='mentor'?(!person||x.mentor_id===person):role==='trainee'?a.trainee_id===person:role==='auditor'?false:roleMatch(a))).map(x=>({...x,assignment:a})));
 const audits=auditRegistry(db).filter(x=>x.state==='final'&&within(x.observed_at,from,to)&&(!s.unitId||x.unit_id===s.unitId)&&(!s.operationId||x.operation_id===s.operationId)&&(!s.revisionId||x.standard_revision_id===s.revisionId)&&(!s.programId||all.some(a=>a.id===x.assignment_id))&&(!person||role==='auditor'?(!person||x.auditor_id===person):role==='mentor'?x.mentor_id===person:role==='trainee'?x.trainee_id===person:[x.mentor_id,x.auditor_id,x.trainee_id].includes(person)));
 const auditGroups=[...grouped(audits,x=>x.version_id)].map(([id,x])=>({id,version:x[0].version_no,methodCode:x[0].method_code,count:x.length,observed:x.reduce((n,a)=>n+(a.observed||0),0),passed:x.reduce((n,a)=>n+(a.passed||0),0)}));
 const self=rows(db,'SELECT * FROM mentor_self_evaluation ORDER BY evaluated_on,id').filter(x=>within(x.evaluated_on,from,to)&&(!s.unitId||one(db,"SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[x.person_id,x.evaluated_on,x.evaluated_on])?.unit_id===s.unitId)&&!s.operationId&&!s.revisionId&&!s.programId&&(!person||['all','mentor'].includes(role)&&x.person_id===person));
 const enrollments=(role==='auditor'?[]:rows(db,'SELECT e.*,p.title program_title,p.kind FROM training_enrollment e JOIN training_program p ON p.id=e.program_id ORDER BY e.start_on,e.id')).filter(x=>x.state!=='cancelled'&&within(x.start_on,from,to)&&!s.operationId&&!s.revisionId&&(!s.programId||x.program_id===s.programId)&&(!s.unitId||one(db,"SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[x.trainee_id,x.start_on,x.start_on])?.unit_id===s.unitId)&&(!person||role==='trainee'?(!person||x.trainee_id===person):role==='mentor'?x.mentor_id===person:role==='auditor'?false:[x.trainee_id,x.mentor_id,x.manager_id,x.finished_by].includes(person)));
 const matrix=cachedMatrix||matrixData(db,s.day),skills=matrix.skills.filter(x=>!s.operationId||x.operation_id===s.operationId),people=matrix.people.filter(p=>(!s.unitId||p.unit_id===s.unitId)&&(!person||p.id===person)&&(!person||['all','trainee'].includes(role)));
 const requirements=s.revisionId||s.programId||role==='auditor'||role==='mentor'?[]:people.flatMap(p=>skills.map(k=>({person:p,skill:k,cell:matrix.cells.get(p.id+':'+k.id)})).filter(x=>x.cell?.goal));
 const coverage=person||s.revisionId||s.programId||role==='auditor'||role==='mentor'?[]:coverageData(db,s.day,matrix).filter(x=>(!s.unitId||x.unit_id===s.unitId)&&skills.some(k=>k.id===x.skill_id));
 const skillHistory=s.programId?[]:rows(db,`SELECT i.*,s.person_id,s.operation_id,s.standard_revision_id,s.assessed_at,s.recorded_at FROM assessment_item i JOIN assessment_session s ON s.id=i.session_id WHERE s.state='confirmed' AND i.observation_state='rated' ORDER BY s.assessed_at,s.recorded_at,s.id`).filter(x=>within(x.assessed_at,from,to)&&(!s.operationId||x.operation_id===s.operationId)&&(!s.revisionId||x.standard_revision_id===s.revisionId)&&['all','trainee'].includes(role)&&(!person||x.person_id===person)&&(!s.unitId||one(db,"SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[x.person_id,dayOf(x.assessed_at),dayOf(x.assessed_at)])?.unit_id===s.unitId));
 const changes=[...grouped(skillHistory,x=>canonical([x.person_id,x.skill_id,x.scale_id,x.standard_revision_id])).values()].filter(xs=>xs.length>=2).map(xs=>({first:xs[0],last:xs.at(-1),delta:xs.at(-1).level-xs[0].level}));
 const retraining=actionRows(db).filter(a=>a.kind==='trainee_training'&&a.source_assessment_id&&a.state!=='cancelled').map(a=>({action:a,source:one(db,'SELECT * FROM assessment_session WHERE id=?',[a.source_assessment_id]),next:a.followup_assignment_id?all.find(x=>x.id===a.followup_assignment_id):null,status:actionStatus(db,a)})).filter(x=>x.source&&within(x.source.assessed_at,from,to)&&(!s.operationId||x.source.operation_id===s.operationId)&&(!s.revisionId||x.source.standard_revision_id===s.revisionId)&&(!s.programId||all.some(a=>a.id===x.source.assignment_id))&&(!s.unitId||one(db,'SELECT unit_id FROM operation WHERE id=?',[x.source.operation_id])?.unit_id===s.unitId)&&(!person||role==='trainee'?(!person||x.source.person_id===person):role==='mentor'?all.some(a=>a.id===x.source.assignment_id&&a.mentor_id===person):role==='auditor'?false:[x.source.person_id,x.source.evaluator_id,x.action.owner_id].includes(person)));
 const stats=summarize(cohort);
 const mentors=[...grouped(cohort,x=>x.mentor_id||'').entries()].map(([id,x])=>({id,...summarize(x)}));
 const units=[...grouped(cohort,x=>x.unit_id||'').entries()].map(([id,x])=>({id,...summarize(x)}));
 const months=[...grouped(cohort,x=>dayOf(x.assigned_on).slice(0,7)).entries()].map(([id,x])=>({id,...summarize(x)})).sort((a,b)=>a.id.localeCompare(b.id));
 return {cohort,sessions,audits,auditGroups,self,enrollments,requirements,coverage,changes,retraining,stats,mentors,units,months,minutes:sessions.reduce((sum,x)=>sum+(Number.isFinite(x.duration_minutes)?x.duration_minutes:0),0),missingMinutes:sessions.filter(x=>!Number.isFinite(x.duration_minutes)).length};
}
// A comparison uses complete, admitted training cohorts on the same exact
// operation/revision/method/skill/scale/target or same exact program version.
// Failed, incomplete and censored assignments stay visible in denominators.
export function twiComparison(db,p,day){
 invariant(p&&['assignment','program'].includes(p.kind)&&typeof p.source_id==='string'&&[p.before_from,p.before_to,p.after_from,p.after_to,day].every(validDay)&&p.before_from<=p.before_to&&p.before_to<p.after_from&&p.after_from<=p.after_to&&p.after_to<=day,'Укажите два завершённых непересекающихся периода');
 let source,all,unitId;
 if(p.kind==='assignment'){
  source=trainingFacts(db).find(x=>x.id===p.source_id);invariant(source&&source.state!=='cancelled','Назначение обучения недоступно');unitId=source.unit_id;
  const key=x=>canonical([x.operation_id,x.sop_revision_id,x.skill_id,x.scale_id,x.target_level,x.method_variant,x.method_version,x.method_config_json||null]);
  all=trainingFacts(db).filter(x=>x.state!=='cancelled'&&key(x)===key(source)).map(x=>({id:x.id,person:x.trainee_id,date:x.assigned_on,record:x}));
 }else{
  source=one(db,'SELECT * FROM training_program WHERE id=?',[p.source_id]);invariant(source,'Версия программы недоступна');
  invariant(typeof p.unit_id==='string'&&!!p.unit_id&&one(db,'SELECT id FROM org_unit WHERE id=?',[p.unit_id]),'Выберите подразделение программы');unitId=p.unit_id;
  all=rows(db,"SELECT * FROM training_enrollment WHERE program_id=? AND state<>'cancelled' ORDER BY start_on,id",[source.id]).filter(x=>one(db,"SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[x.trainee_id,x.start_on,x.start_on])?.unit_id===unitId).map(x=>({id:x.id,person:x.trainee_id,date:x.start_on,record:x}));
 }
 const cohort=(from,to)=>all.filter(x=>within(x.date,from,to)).map(x=>{
  const a=x.record;
  if(p.kind==='assignment'){const v=rowFor(db,a,day,to);return {id:x.id,person:x.person,complete:!!(v.completeTime&&v.grant&&!v.grant.revoked_at&&v.grant.decided_on<=to&&v.practices.some(q=>q.id===v.grant.practical_id)&&one(db,"SELECT id FROM assessment_session WHERE id=? AND state='confirmed'",[v.grant.qualification_id])&&!!v.first&&v.last?.conclusion!=='not_meet'),minutes:v.minutesToGrant,days:v.elapsed,assignmentIds:[x.id],grant:v.grant?.id||null,practice:v.last?.id||null,facts:v.sourceFacts}}
  const tasks=rows(db,'SELECT id FROM training_program_task WHERE program_id=? ORDER BY position,id',[source.id]),results=rows(db,'SELECT * FROM training_task_result WHERE enrollment_id=? AND held_on<=? ORDER BY held_on,recorded_at,id',[a.id,to]);
  const linked=trainingFacts(db).filter(x=>x.state!=='cancelled'&&within(x.assigned_on,a.start_on,to));
  const detailed=rows(db,'SELECT * FROM training_program_task WHERE program_id=? ORDER BY position,id',[source.id]),facts=[],assignmentIds=[];
  let done=detailed.length>0;const prep=preparationForEnrollment(db,a.id);
  for(const task of detailed){
   if(task.sop_revision_id){
    const shared=sharedTrainingTask(db,a.id,task.id),as=linked.filter(x=>x.enrollment_id===(shared?.enrollmentId||a.id)&&x.program_task_id===(shared?.taskId||task.id));const last=as.at(-1);
    if(!last||(!prep&&last.state!=='completed')||last.sop_revision_id!==task.sop_revision_id){done=false;continue}
    for(const x of as){assignmentIds.push(x.id);const fs=x.sessions.filter(y=>within(y.held_at,a.start_on,to)&&(!prep||!jiStages(x.method_variant,jiConfig(x)).some(s=>s.code===y.stage_code&&s.phase==='followup')));facts.push(...fs.map(y=>[y.id,y.duration_minutes,y.held_at,y.result]));if(!fs.length||fs.some(y=>!Number.isFinite(y.duration_minutes)))done=false}
    if(!jiStages(last.method_variant,jiConfig(last)).filter(s=>!prep||s.phase!=='followup').every(s=>last.sessions.some(y=>dayOf(y.held_at)<=to&&y.stage_code===s.code&&y.result==='completed')))done=false;
   }else{const rs=results.filter(y=>y.task_id===task.id);if(rs.at(-1)?.result!=='completed')done=false;facts.push(...rs.map(y=>[y.id,y.minutes,y.held_on,y.result]))}
  }
  const complete=!!(a.state==='completed'&&dayOf(a.finished_at)<=to&&a.conclusion&&a.conclusion!=='not_meet'&&done&&facts.length&&facts.every(y=>Number.isFinite(y[1])&&y[1]>=0&&dayOf(y[2])<=dayOf(a.finished_at)));
  return {id:x.id,person:x.person,complete,minutes:complete?facts.reduce((n,y)=>n+y[1],0):null,days:complete?elapsed(a.start_on,a.finished_at):null,finish:a.finished_at,conclusion:a.conclusion,assignmentIds,facts}
 }).sort((a,b)=>a.id.localeCompare(b.id));
 const before=cohort(p.before_from,p.before_to),after=cohort(p.after_from,p.after_to),stat=a=>({total:a.length,complete:a.filter(x=>x.complete).length,people:unique(a.map(x=>x.person)).length,meanMinutes:mean(a.filter(x=>x.complete).map(x=>x.minutes)),medianDays:median(a.filter(x=>x.complete).map(x=>x.days))});
 const b=stat(before),a=stat(after),comparable=b.total>0&&a.total>0&&b.complete===b.total&&a.complete===a.total;
 return {kind:p.kind,source_id:p.source_id,unit_id:unitId,before,after,baseline:b,result:a,comparable,deltaMinutes:comparable?b.meanMinutes-a.meanMinutes:null};
}
