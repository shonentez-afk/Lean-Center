// Twelve completed calendar months of linked native LC3–LC7 domain events.
// No direct INSERT into business tables and no synthetic pre-migration inbox.
import assert from 'node:assert/strict';
import {one,rows} from '../src/core/db.js';
import {makeSop} from './lc4-fixture.mjs';
import {inspectSource} from '../src/modules/library/domain.js';
import {reviewDue} from '../src/modules/library/sop-review.js';
import {RC1_CRITERIA} from '../src/modules/training/builtin-forms.js';
import {PRACTICAL_V03,SELF_V03} from '../src/modules/training/standard-v03.js';
import {CORPORATE_SCALE_NAME,CORPORATE_SCALE_LEVELS,progressFor,admissionStatus} from '../src/modules/training/domain.js';
import {measurementOf,effectEvidence,effectCurrent,factCurrent,effectFacts} from '../src/modules/effect/domain.js';
import {auditDetails,actionStatus,actionRows} from '../src/modules/training/audit-domain.js';
export function completedMonths(now=new Date()){
 return Array.from({length:12},(_,i)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-12+i,1)).toISOString().slice(0,10));
}
const plus=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
export async function seedAnnualModules(f,months){
 const db=f.w.working,save=f.save,items=[];
 const scale=f.w.edit('rating_scale',null,{name:CORPORATE_SCALE_NAME,version_no:'1',levels:CORPORATE_SCALE_LEVELS.map(([n,s])=>n+': '+s).join('\n')});
 const category=one(db,'SELECT category_id FROM skill WHERE id=?',[f.skill]).category_id;
 const practicalMethod=(await save('checklist_version',PRACTICAL_V03)).entity_id;
 const auditMethod=(await save('checklist_version',{format:'lean-audit-checklist-v1',title:'QA RC1 · 20 критериев',source_sha256:'d'.repeat(64),criteria:RC1_CRITERIA.map(({rc1_id,...q})=>q)})).entity_id;
 const selfMethod=(await save('checklist_version',SELF_V03)).entity_id;
 const sopMethod=(await save('checklist_version',{format:'lean-sop-checklist-v1',title:'Синтетическая методика оценки СОП D4',source_sha256:'e'.repeat(64),criteria:Array.from({length:20},(_,i)=>({code:i+1,question:'Учебный критерий '+(i+1)}))})).entity_id;
 const criteria=id=>rows(db,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[id]);
 const answers=(id,value)=>criteria(id).map((q,i)=>({criterion_id:q.id,value:typeof value==='function'?value(i):value,note:''}));
 assert.equal(criteria(auditMethod).length,20);assert.equal(criteria(practicalMethod).length,11);
 for(let i=0;i<months.length;i++){
  const month=months[i],day=plus(month,4),next=plus(day,1),due=plus(day,12),suffix=month.slice(0,7);
  f.advanceTo(day);
  const title='Год D4 · '+suffix;
  const operation=f.w.edit('operation',null,{unit_id:f.unit,workplace_id:f.workplace,equipment_id:null,code:'D4-OP-'+suffix,name:title,criticality:'normal'});
  const skill=f.w.edit('skill',null,{category_id:category,operation_id:operation,name:'Навык '+suffix});
  const raw={schemaVersion:'FRV-1.3',study:{studyId:'D4-'+suffix,operationId:'D4-OP-'+suffix},comparisonApproved:true,cycles:[{phase:'baseline',observations:[{id:'o1',actionRaw:'Работа '+suffix,valueType:'VA',durationSec:120}]},{phase:'improved',observations:[{id:'o2',actionRaw:'Работа '+suffix,valueType:'VA',durationSec:60}]}]};
  const text=JSON.stringify(raw),frv={text,...await inspectSource(text,'frv')};f.sources.set(frv.source.sha256,frv);
  const study=(await save('frv_study',{command:'create',title:'ФРВ '+title,operation_id:operation,observed_at:day,source:frv.source,projection:frv.projection})).entity_id;
  await save('frv_study',{command:'finalize',actor_id:f.actor,note:'Учебные замеры до/после'},study);
  const source=await makeSop(title);f.sources.set(source.source.sha256,source);
  const document=await save('document',{command:'create',code:'D4-SOP-'+suffix,title,operation_id:operation,source:source.source,projection:source.projection});
  const revision=document.id,documentId=document.entity_id;
  await save('document',{command:'origin',revision_id:revision,study_id:study,source_sha256:frv.source.sha256},documentId);
  await save('document',{command:'passport',revision_id:revision,print_format:'portrait',changed_on:day},documentId);
  for(const command of ['submit','approve','effect'])await save('document',{command,revision_id:revision,actor_id:f.actor,note:''},documentId);
  const evaluation=(await save('sop_evaluation',{revision_id:revision,method_id:sopMethod,actor_id:f.actor,evaluated_on:day,place:'Учебный участок',source_sha256:source.source.sha256,responses:answers(sopMethod,n=>n===0&&i%2===0?0:1)})).entity_id;
  const authorization=(await save('mentor_authorization',{person_id:f.mentor,operation_id:operation,approved_by:f.actor,valid_from:day,valid_to:null,credential_id:f.certificate,appointment_id:f.appointment})).entity_id;
  await save('role_requirement',{profession_id:f.profession,skill_id:skill,scale_id:scale,required_level:i%2===0?2:3,criticality:'normal',valid_from:day,valid_to:null});
  const assignment=await f.addAssignment({revision_id:revision,source:source.source,authorization_id:authorization,skill_id:skill,scale_id:scale,assigned_on:day,due_on:due,method_version:'JI-2',method_config:{followups:3,segments:[],realShow:null,realTry:null,hazardous:false}});
  await save('training_assignment',{command:'approve',responsible_id:f.actor,head_id:f.actor,approved_on:day,note:'Учебное согласование'},assignment);
  const schedule=(await save('schedule_event',{assignment_id:assignment,owner_id:f.actor,due_on:day})).entity_id;
  const session=(await f.stage(assignment,'prepare',{held_at:day+'T08:00'})).entity_id;
  const audit=(await save('audit_session',{command:'observe_lc5',assignment_id:assignment,assignment_rev:f.getAssignment(assignment).rev,method_id:auditMethod,auditor_id:f.actor,session_id:session,observed_on:day,responses:answers(auditMethod,n=>n===0?0:1),feedback:'Учебное замечание'})).entity_id;
  assert.equal(auditDetails(db,audit).stats.no,1);
  await save('schedule_event',{command:'complete',audit_id:audit},schedule);
  const self=(await save('mentor_self_evaluation',{person_id:f.mentor,method_id:selfMethod,evaluated_on:day,place:'Учебный участок',responses:answers(selfMethod,2),feedback:'Учебная самооценка'})).entity_id;
  const task=(await save('action_item',{response_id:auditDetails(db,audit).questions[0].response_id,title:'Устранить замечание '+suffix,owner_id:f.trainee,subject_id:f.mentor,due_on:due,kind:'corrective',priority:'normal'})).entity_id;
  if(i%2===0){await save('action_item',{command:'implement',result:'Учебный результат без повторного аудита'},task);await save('action_item',{command:'verify',verifier_id:f.actor,audit_id:null,outcome:'insufficient',evidence:'Требуется последующий аудит'},task)}
  assert.equal(actionStatus(db,actionRows(db,task)[0]),i%2===0?'implemented':'open');
  for(const stage of progressFor(db,f.getAssignment(assignment)).stages.filter(s=>s.code!=='prepare'&&s.phase!=='support'&&s.phase!=='followup'))await f.stage(assignment,stage.code,{held_at:day+'T09:00'});
  const practical=(await f.assess(assignment,{assessed_on:day,method_id:practicalMethod,responses:answers(practicalMethod,1)})).entity_id;
  const qualification=(await f.qualify(assignment,practical,{assessed_on:day})).entity_id;
  await f.verify(assignment,'safety',{evaluated_on:day});await f.verify(assignment,'theory',{evaluated_on:day});
  const admission=(await f.admit(assignment,{decided_on:day})).entity_id;
  f.advanceTo(next);
  for(const stage of progressFor(db,f.getAssignment(assignment)).stages.filter(s=>['support','followup'].includes(s.phase)))await f.stage(assignment,stage.code,{held_at:next+'T08:00'});
  assert.equal(f.getAssignment(assignment).state,'completed');assert(admissionStatus(db,f.trainee,operation,next).current);
  const improvement=(await save('action_item',{response_id:null,title:'ФРВ: улучшение '+suffix,owner_id:f.mentor,subject_id:null,due_on:due,kind:'corrective',priority:'normal',source_link:{kind:'frv_study',id:study}})).entity_id;
  await save('action_item',{command:'implement',result:'Подтверждённое учебное улучшение'},improvement);
  await save('action_item',{command:'verify',verifier_id:f.actor,audit_id:null,outcome:'effective',evidence:'Независимая учебная проверка'},improvement);
  const plan={deltaSeconds:60,cyclesPerYear:3600,hourRate:100,realization:50,investment:1000,annualCost:500};
  const effect=(await save('economic_effect',{command:'create',study_id:study,action_id:null,owner_id:f.mentor,unit_id:f.unit,currency:'RUB',method:'time',title:'Эффект '+suffix,plan,plan_basis:'Синтетический объём и ставка',review_due:due})).entity_id;
  const get=()=>one(db,'SELECT * FROM economic_effect WHERE id=?',[effect]);
  await save('economic_effect',{command:'measure',inputs:plan,measurement:measurementOf(raw),reviewer_id:f.actor,evidence:'Учебная проверка замеров',actions:effectEvidence(db,get()),source:frv.source},effect);
  assert(effectCurrent(db,get()));
  const fact=(await save('economic_fact',{command:'create',effect_id:effect,actual_event_id:get().actual_event_id,period_from:day,period_to:day,gross_minor:40000,recurring_minor:5000,investment_minor:2000,registered_by:f.mentor,evidence:'Синтетический акт '+suffix})).entity_id;
  await save('economic_fact',{command:'confirm',verifier_id:f.actor,note:'Независимая проверка учебного факта'},fact);
  assert(factCurrent(db,get(),effectFacts(db,effect)[0]));
  items.push({month,day,due,operation,skill,study,revision,documentId,evaluation,authorization,assignment,schedule,audit,self,task,practical,qualification,admission,improvement,effect,fact,reviewDue:reviewDue(day),level:2,target:i%2===0?2:3});
 }
 const from=items[0].day,to=plus(new Date(Date.UTC(Number(months.at(-1).slice(0,4)),Number(months.at(-1).slice(5,7)),1)).toISOString().slice(0,10),-1);
 assert.deepEqual(rows(db,'PRAGMA foreign_key_check'),[]);
 return {months,items,from,to,scale,trainee:f.trainee,mentor:f.mentor,actor:f.actor,practicalMethod,auditMethod,selfMethod,sopMethod};
}
