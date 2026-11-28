// TWI 03, section 4.1.3. A dossier for the changed SOP, not a second
// task, instruction, competence assessment or permission-to-work registry.
import {one,rows,isId,uuid,canonical} from '../../src/core/db.js';
import {currentStandard,progressFor,latestAssessment} from '../../src/modules/training/training-facts.js';
import {activeEmployment,latestQualification} from '../../src/modules/training/domain.js';
import {personWorkResource,trainingResource} from './read-policy.mjs';
import {recordAccess} from './center-commands.mjs';
import {checkedLibrarySource} from './library-commands.mjs';
import {frvSummary} from '../../src/modules/library/frv-summary.js';
import {directoryPeople} from '../../src/modules/master-data/people-directory.js';
import {PilotError} from '../lc74-store.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const txt=(s,n=1500)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const who=(a,id)=>a.read('person.read_basic',id)||a.read('person.read_directory',id);
const personName=(db,id)=>one(db,'SELECT display_name FROM person WHERE id=?',[id])?.display_name??'';
const exists=db=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc81_operation_rollout'");
const schema=`CREATE TABLE IF NOT EXISTS lc81_operation_rollout(
 id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES document_revision(id),
 version INTEGER NOT NULL CHECK(version>0),payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 created_by TEXT NOT NULL REFERENCES person(id),created_at TEXT NOT NULL,
 accepted_json TEXT CHECK(accepted_json IS NULL OR json_valid(accepted_json)),
 UNIQUE(revision_id,version));`;
const latest=(db,id)=>exists(db)?one(db,'SELECT * FROM lc81_operation_rollout WHERE revision_id=? ORDER BY version DESC LIMIT 1',[id]):null;
const scope=(a,k,id,r)=>!!r&&a.scope(k,id,{...r,self:null,assigned:[]});
function anchor(db,a,id){
 if(!isId(id))return null;
 const r=currentStandard(db,id),op=r&&a.read('operation.read',r.operation_id)?.data;
 if(!r||!op||!a.read('sop.read_history',id))return null;
 const resource=personWorkResource(db,[],a.day,[],[r.operation_id]);
 if(!['training.read','training.detail','assessment.read','assessment.detail','frv.read','frv.read_summary','task.read','task.detail','skill.read','scale.read'].every(k=>scope(a,k,id,resource)))return null;
 return {r,op,resource};
}
export function canReadRollout(db,a,id){return !!anchor(db,a,id)}
const effective=(c,a)=>c.r.state==='effective'&&!c.r.archived&&!!a.read('sop.read_effective',c.r.id);
const canWrite=(a,c,r=c.resource)=>!!a.personId&&effective(c,a)&&scope(a,'training.create',c.r.id,r)&&scope(a,'training.approve_responsible',c.r.id,r);
function skillScale(db,a,c,skillId,scaleId){
 const skill=isId(skillId)&&one(db,'SELECT * FROM skill WHERE id=? AND operation_id=? AND archived=0',[skillId,c.r.operation_id]);
 const scale=isId(scaleId)&&one(db,'SELECT * FROM rating_scale WHERE id=? AND archived=0',[scaleId]);
 const levels=scale?rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[scaleId]):[];
 return skill&&scale&&a.read('skill.read',skillId)&&a.read('scale.read',scaleId)&&levels.map(x=>x.value).join(',')==='1,2,3,4'?{skill,scale}:null;
}
function taskView(db,a,id){
 const t=isId(id)&&one(db,'SELECT * FROM action_item WHERE id=?',[id]);
 if(!t||!recordAccess(db,a,'task',id)||!who(a,t.owner_id))return null;
 return {id:t.id,title:t.title,owner_id:t.owner_id,owner:personName(db,t.owner_id),state:t.state,rev:t.rev};
}
function study(db,a,c,id,{allowArchived=false}={}){
 const x=isId(id)&&one(db,'SELECT * FROM frv_study WHERE id=? AND operation_id=?',[id,c.r.operation_id]);
 if(!x||!(x.state==='final'||allowArchived&&x.state==='archived')||!a.read('frv.read',id)||!scope(a,'frv.read_summary',id,c.resource))return null;
 const descriptor=JSON.parse(x.context_json);
 if(!descriptor.source||descriptor.source.kind!=='frv')return null;
 return {id:x.id,title:x.title,day:x.observed_at.slice(0,10),state:x.state,rev:x.rev,descriptor};
}
const studyPublic=x=>({id:x.id,title:x.title,day:x.day,state:x.state,rev:x.rev});
function rosterResource(db,a,c,roster,task,trialOn){
 return trainingResource(db,c.r.operation_id,[...roster.map(x=>x.person_id),task.owner_id],a.day,trialOn);
}
function storedContext(db,a,c,p){
 const t=taskView(db,a,p.task_id),baseline=study(db,a,c,p.baseline_id,{allowArchived:true}),control=p.control_id?study(db,a,c,p.control_id,{allowArchived:true}):null;
 const ss=skillScale(db,a,c,p.skill_id,p.scale_id);
 const resource=t&&rosterResource(db,a,c,p.roster,t,p.trial_on);
 if(!t||!baseline||p.control_id&&!control||!ss||!resource||!p.roster.every(x=>who(a,x.person_id))||
 !['training.read','training.detail','assessment.read','assessment.detail'].every(k=>scope(a,k,c.r.id,resource)))return null;
 return {t,baseline,control,ss,resource};
}
function factsFor(db,a,c,p,row){
 const t=one(db,"SELECT * FROM training_assignment WHERE trainee_id=? AND sop_revision_id=? AND skill_id=? AND scale_id=? AND state<>'cancelled' AND source_sha256=? ORDER BY assigned_on DESC, (SELECT max(occurred_at) FROM change_event e WHERE e.entity_type='training_assignment' AND e.entity_id=training_assignment.id AND e.operation='create') DESC,id DESC LIMIT 1",[row.person_id,c.r.id,p.skill_id,p.scale_id,c.r.source.sha256]);
 const visible=t&&recordAccess(db,a,'training',t.id);
 const base={person_id:row.person_id,name:row.name,target_level:row.target_level,assignment:null,practical:null,qualification:null,actual:null,day:null,ready:false,support_pending:false,status:'Нет доступного назначения по этой редакции'};
 if(!visible)return base;
 const pr=progressFor(db,t),introDates=pr.facts.filter(x=>x.result==='completed'&&pr.stages.some(s=>s.code===x.stage_code&&!['support','followup'].includes(s.phase))).map(x=>x.held_at.slice(0,10));
 const result={...base,assignment:{id:t.id,rev:t.rev},support_pending:!pr.complete,status:'Инструктаж не подтверждён'};
 if(!t.approval_json||!pr.intro||!introDates.length||introDates.some(x=>x<p.trial_on||x>a.day))return result;
 result.status='Нет подтверждённой практической оценки';
 const practical=latestAssessment(db,t.id,'practical'),q=latestQualification(db,row.person_id,p.skill_id,a.day);
 if(!practical||!recordAccess(db,a,'assessment',practical.id))return result;
 result.practical={id:practical.id,conclusion:practical.conclusion,day:practical.assessed_at.slice(0,10)};
 result.status='Не достигнут актуальный целевой уровень';
 if(!q||!recordAccess(db,a,'assessment',q.session_id))return result;
 result.qualification={id:q.session_id,day:q.assessed_at.slice(0,10)};result.actual=q.observation_state==='rated'?q.level:null;
 const assessment=one(db,'SELECT * FROM assessment_session WHERE id=?',[q.session_id]);
 const day=q.assessed_at.slice(0,10);
 if(q.assignment_id!==t.id||q.standard_revision_id!==c.r.id||q.scale_id!==p.scale_id||assessment?.practical_id!==practical.id||practical.conclusion==='not_meet'||q.observation_state!=='rated'||q.level<row.target_level||q.valid_until&&q.valid_until<a.day||day<p.trial_on||day>a.day)return result;
 return {...result,day,ready:true,status:pr.complete?'Инструктаж и уровень подтверждены':'Вводный инструктаж и уровень подтверждены; поддержка продолжается'};
}
function reportProjection(db,a,c,record){
 const p=JSON.parse(record.payload_json),ctx=storedContext(db,a,c,p);
 must(ctx,404,'Полный состав отчёта или его основания недоступны');
 const participants=p.roster.map(x=>factsFor(db,a,c,p,x)),blockers=[];
 if(!effective(c,a))blockers.push('Редакция больше не действует');
 if(ctx.t.state==='cancelled')blockers.push('Задача отменена');
 if(ctx.baseline.state!=='final'||ctx.baseline.descriptor.source.sha256!==p.baseline.source_sha256)blockers.push('Исходное ФРВ больше не подтверждено');
 if(!ctx.control)blockers.push('Не выбрано контрольное ФРВ');
 else if(ctx.control.state!=='final'||ctx.control.descriptor.source.sha256!==p.control?.source_sha256)blockers.push('Контрольное ФРВ больше не подтверждено');
 if(participants.some(x=>!x.ready))blockers.push('Не у всех подтверждённых исполнителей завершено обучение и достигнут целевой уровень');
 if(ctx.control&&participants.some(x=>x.day&&ctx.control.day<x.day))blockers.push('Контрольные замеры предшествуют подтверждению обучения исполнителей');
 const accepted=record.accepted_json?JSON.parse(record.accepted_json):null;
 const currentEvidence=participants.map(x=>({person_id:x.person_id,assignment:x.assignment?.id??null,practical:x.practical?.id??null,qualification:x.qualification?.id??null,level:x.actual}));
 const unchanged=!!accepted&&canonical(currentEvidence)===canonical(accepted.evidence)&&!blockers.length;
 const acceptance=accepted?{on:accepted.on,actor:who(a,accepted.actor_id)?accepted.actor_name:null,quality:accepted.quality,report:accepted.report,current:unchanged}:null;
 return {id:record.id,version:record.version,task:ctx.t,baseline:{...studyPublic(ctx.baseline),...p.baseline},control:ctx.control?{...studyPublic(ctx.control),...p.control}:null,trial_on:p.trial_on,trial_reference:p.trial_reference,roster_note:p.roster_note,change_reason:p.change_reason,skill_id:p.skill_id,scale_id:p.scale_id,skill:ctx.ss.skill.name,scale:ctx.ss.scale.name,participants,blockers,acceptance,ready:!blockers.length,can_accept:!accepted&&!blockers.length&&a.personId!==ctx.t.owner_id&&canWrite(a,c,ctx.resource),can_edit:canWrite(a,c,ctx.resource)};
}
export function rolloutDetail(db,a,id){
 const c=anchor(db,a,id);must(c,404,'Отчёт о внедрении недоступен');
 const record=latest(db,id),report=record?reportProjection(db,a,c,record):null;
 const can_edit=canWrite(a,c)&&(!report||report.can_edit);
 const options={tasks:[],studies:[],skills:[],scales:[],people:[]};
 if(can_edit){
  options.tasks=rows(db,"SELECT id FROM action_item WHERE state<>'cancelled' ORDER BY due_on,id").map(x=>taskView(db,a,x.id)).filter(Boolean);
  options.studies=rows(db,"SELECT id FROM frv_study WHERE operation_id=? AND state='final' ORDER BY observed_at,id",[c.r.operation_id]).flatMap(x=>{const s=study(db,a,c,x.id);return s?[studyPublic(s)]:[]});
  options.skills=rows(db,'SELECT id,name FROM skill WHERE operation_id=? AND archived=0 ORDER BY name',[c.r.operation_id]).filter(x=>a.read('skill.read',x.id));
  options.scales=rows(db,'SELECT id,name FROM rating_scale WHERE archived=0 ORDER BY name').filter(x=>a.read('scale.read',x.id)&&rows(db,'SELECT value FROM rating_level WHERE scale_id=? ORDER BY value',[x.id]).map(l=>l.value).join(',')==='1,2,3,4');
  const suggestions=new Set(rows(db,"SELECT DISTINCT trainee_id FROM training_assignment WHERE operation_id=? AND state<>'cancelled'",[c.r.operation_id]).map(x=>x.trainee_id));
  options.people=directoryPeople(db,a.day).filter(x=>who(a,x.id)&&activeEmployment(db,x.id,a.day)&&canWrite(a,c,trainingResource(db,c.r.operation_id,[x.id],a.day))).map(x=>({id:x.id,name:x.display_name,unit:x.unit,position:x.position,suggested:suggestions.has(x.id)}));
 }
 const versions=exists(db)?rows(db,'SELECT * FROM lc81_operation_rollout WHERE revision_id=? ORDER BY version DESC',[id]).flatMap(x=>{
  const p=JSON.parse(x.payload_json);
  if(!storedContext(db,a,c,p))return [];
  const ac=x.accepted_json?JSON.parse(x.accepted_json):null;
  return [{version:x.version,created_on:x.created_at.slice(0,10),reason:p.change_reason,accepted_on:ac?.on??null}];
 }):[];
 return {revision_id:id,title:c.r.code+' · v'+c.r.version_no+' · '+c.r.title,day:a.day,report,can_edit,options,versions};
}
export function prepareRollout(db,a,f){
 must(exact(f,['revision_id','expected_version','task_id','baseline_id','control_id','trial_on','trial_reference','skill_id','scale_id','roster','roster_confirmed','roster_note','change_reason'])&&isId(f.revision_id)&&Number.isSafeInteger(f.expected_version)&&f.expected_version>=0&&isId(f.task_id)&&isId(f.baseline_id)&&(f.control_id===null||isId(f.control_id)&&f.control_id!==f.baseline_id)&&date(f.trial_on)&&f.trial_on<=a.day&&txt(f.trial_reference)&&f.roster_confirmed===true&&txt(f.roster_note)&&txt(f.change_reason)&&Array.isArray(f.roster)&&f.roster.length>=1&&f.roster.length<=200&&f.roster.every(x=>exact(x,['person_id','target_level'])&&isId(x.person_id)&&[1,2,3,4].includes(x.target_level))&&new Set(f.roster.map(x=>x.person_id)).size===f.roster.length,400,'Укажите задачу, фактическую апробацию, полный состав исполнителей и целевые уровни');
 const c=anchor(db,a,f.revision_id);must(c&&canWrite(a,c),403,'Нет полномочий по внедрению редакции');
 must(f.trial_on>=c.r.created_at.slice(0,10),422,'Апробация не может предшествовать созданию редакции');
 const prior=latest(db,f.revision_id);
 must((prior?.version??0)===f.expected_version,409,'Состав отчёта изменился');
 if(prior)must(reportProjection(db,a,c,prior).can_edit,403,'Прежний полный состав недоступен для изменения');
 const ctx=storedContext(db,a,c,f);
 must(ctx&&canWrite(a,c,ctx.resource)&&f.roster.every(x=>activeEmployment(db,x.person_id,a.day)),403,'Сотрудник, задача, шкала или ФРВ недоступны в вашей области');
 must(ctx.t.state!=='cancelled'&&ctx.baseline.state==='final'&&(!ctx.control||ctx.control.state==='final'),422,'Нужны действующая задача и завершённые фактические исследования');
 must(ctx.baseline.day<=f.trial_on&&(!ctx.control||ctx.control.day>=f.trial_on&&ctx.control.day<=a.day),422,'Проверьте даты исходного ФРВ, апробации и контрольных замеров');
 const {revision_id,expected_version,roster_confirmed,...payload}=f;
 payload.roster=payload.roster.map(x=>({...x,name:personName(db,x.person_id)}));
 return {revision_id,expected_version,payload,sop_sha:c.r.source.sha256,baseline:ctx.baseline,control:ctx.control,task:ctx.t};
}
export async function inspectRolloutSources(ctx,readFile){
 const summary=async(x,phase)=>{
  const checked=await checkedLibrarySource(x.descriptor,readFile),s=frvSummary(checked.raw),cycles=s.cycles.filter(c=>c.complete&&c.phase===phase);
  must(cycles.length>0,422,phase==='baseline'?'В исходном ФРВ нет полных циклов «до»':'В контрольном ФРВ нет полных циклов «после»');
  return {source_sha256:x.descriptor.source.sha256,count:cycles.length,mean_seconds:cycles.reduce((n,x)=>n+x.seconds,0)/cycles.length,cycles:cycles.map(c=>({index:c.index,seconds:c.seconds}))};
 };
 return {baseline:await summary(ctx.baseline,'baseline'),control:ctx.control?await summary(ctx.control,'improved'):null};
}
export function saveRollout(db,a,f,checked,summaries){
 const ctx=prepareRollout(db,a,f);
 must(canonical(ctx)===canonical(checked),409,'Основания отчёта изменились при проверке');
 db.run(schema);const id=uuid(),version=f.expected_version+1,p={...ctx.payload,...summaries};
 db.run('INSERT INTO lc81_operation_rollout(id,revision_id,version,payload_json,created_by,created_at) VALUES(?,?,?,?,?,?)',[id,ctx.revision_id,version,canonical(p),a.personId,a.at]);
 a.audit('training.rollout_save',id);return {id,version};
}
export function prepareRolloutAcceptance(db,a,f){
 must(exact(f,['revision_id','expected_version','roster_confirmed','quality','report'])&&isId(f.revision_id)&&Number.isSafeInteger(f.expected_version)&&f.roster_confirmed===true&&txt(f.quality)&&txt(f.report),400,'Подтвердите полный состав, контроль качества и вывод руководителя');
 const c=anchor(db,a,f.revision_id),r=c&&latest(db,f.revision_id);
 must(r&&r.version===f.expected_version,409,'Состав отчёта изменился');
 const v=reportProjection(db,a,c,r);must(v.can_accept,422,'Отчёт не готов или нет полномочий независимого руководителя: '+v.blockers.join('; '));
 const p=JSON.parse(r.payload_json),ctx=storedContext(db,a,c,p);
 return {id:r.id,version:r.version,payload:p,baseline:ctx.baseline,control:ctx.control,view:v};
}
export function acceptRollout(db,a,f,checked,summaries){
 const ctx=prepareRolloutAcceptance(db,a,f);
 must(canonical(ctx)===canonical(checked)&&canonical(summaries.baseline)===canonical(ctx.payload.baseline)&&canonical(summaries.control)===canonical(ctx.payload.control),409,'Основания отчёта изменились при проверке');
 const evidence=ctx.view.participants.map(x=>({person_id:x.person_id,assignment:x.assignment.id,practical:x.practical.id,qualification:x.qualification.id,level:x.actual}));
 const data={actor_id:a.personId,actor_name:personName(db,a.personId),on:a.day,at:a.at,quality:f.quality,report:f.report,evidence};
 db.run('UPDATE lc81_operation_rollout SET accepted_json=? WHERE id=? AND accepted_json IS NULL',[canonical(data),ctx.id]);a.audit('training.rollout_accept',ctx.id);
 return {id:ctx.id,version:ctx.version,accepted:true};
}
