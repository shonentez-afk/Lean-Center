// Scoped competency catalogue, profession profiles, coverage and factual
// general-skill observations. No arbitrary cell editing or auto admission.
import {one,rows,isId,uuid,foldKey,applyEvent} from '../../src/core/db.js';
import {coverageData,latestQualification} from '../../src/modules/training/domain.js';
import {columnChoices,LEVEL_TEXT} from '../../src/modules/training/matrix-view.js';
import {skillResource,requirementResource,coverageResource,assessmentResource,personWorkResource,programResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const text=(s,n=500)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const active=(db,t,id)=>isId(id)?one(db,'SELECT * FROM '+t+' WHERE id=? AND archived=0',[id]):null;
const who=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
const name=(a,id)=>who(a,id)?.data.display_name??null;
const allowed=(a,k,id,r)=>!!r&&a.allows(k,id,r);
const site=(db,a,k)=>{const r=programResource(db);return !!r&&allowed(a,k,r.units[0],r)};
const refs=(db,t)=>rows(db,'SELECT id,name FROM '+t+' WHERE archived=0 ORDER BY name,id');
const scaleOptions=db=>refs(db,'rating_scale').map(s=>({...s,levels:rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[s.id])}));
function skillLabel(db,id){return one(db,'SELECT name FROM skill WHERE id=?',[id])?.name??'—'}
function emit(db,a,t,id,operation,rev,payload,action){
 const event=uuid();try{applyEvent(db,{id:event,entity_type:t,entity_id:id,operation,expected_revision:rev,payload,occurred_at:a.at})}
 catch(e){throw new PilotError(422,'Проверка компетенций: '+String(e.message||'ошибка').split('\n')[0].slice(0,250))}
 a.audit(action,event);return {id,rev:one(db,'SELECT rev FROM '+t+' WHERE id=?',[id]).rev};
}
const readableSkill=(db,a,s)=>!!s&&(!s.operation_id||!!a.read('operation.read',s.operation_id));
const skillRow=(db,s)=>({id:s.id,name:s.name,operation_id:s.operation_id,category:one(db,'SELECT name FROM skill_category WHERE id=?',[s.category_id])?.name??''});
export function competencyOptions(db,a,kind,personId=null,skillId=null){
 must(['skill','requirement','coverage','assessment'].includes(kind),400,'Неизвестный раздел');
 const read=kind==='skill'?'skill.read':kind+'.read';
 must(a.permissions.includes(read),403,'Раздел недоступен');
 const skills=rows(db,'SELECT * FROM skill WHERE archived=0 ORDER BY name,id').filter(s=>active(db,'skill_category',s.category_id)&&readableSkill(db,a,s));
 const out={day:a.day,scales:scaleOptions(db),categories:refs(db,'skill_category')};
 if(kind==='skill'){
  out.can_category=!!a.personId&&site(db,a,'skill.category.create');out.can_general=!!a.personId&&site(db,a,'skill.create')&&site(db,a,'skill.read');
  out.sops=a.personId?columnChoices(db).filter(c=>!c.skill_id&&c.document_id&&a.read('operation.read',c.operation_id)&&allowed(a,'skill.from_sop',c.operation_id,skillResource(db,{operation_id:c.operation_id}))&&allowed(a,'skill.read',c.operation_id,skillResource(db,{operation_id:c.operation_id}))).flatMap(c=>{
   // Revision rows have no rev column: optimistic concurrency uses the parent document.
   const r=one(db,"SELECT r.id,d.rev FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.document_id=? AND r.state='effective' AND d.archived=0",[c.document_id]);return r&&a.read('sop.read_effective',r.id)?[{id:r.id,rev:r.rev,label:c.title}]:[];
  }):[];
 }else if(kind==='requirement'){
  out.can_create=!!a.personId&&site(db,a,'requirement.create')&&site(db,a,'requirement.read');
  if(out.can_create){out.professions=refs(db,'profession');out.skills=skills.filter(s=>allowed(a,'requirement.create',s.id,requirementResource(db,{skill_id:s.id}))).map(s=>skillRow(db,s))}
 }else if(kind==='coverage'){
  out.units=refs(db,'org_unit').filter(u=>a.read('org.read',u.id)&&allowed(a,'coverage.save',u.id,{data:{},self:null,units:[u.id],assigned:[]})&&allowed(a,'coverage.read',u.id,{data:{},self:null,units:[u.id],assigned:[]}));
  out.shifts=rows(db,'SELECT code,name FROM work_shift WHERE archived=0 ORDER BY code');
  out.skills=skills.filter(s=>out.units.some(u=>allowed(a,'coverage.save',u.id,coverageResource(db,{unit_id:u.id,skill_id:s.id})))).map(s=>skillRow(db,s));
 }else{
  const r=id=>personWorkResource(db,[id,a.personId],a.day);
  out.people=a.personId?rows(db,'SELECT id,display_name name FROM person WHERE archived=0 ORDER BY display_name,id').filter(p=>p.id!==a.personId&&who(a,p.id)&&allowed(a,'assessment.general',p.id,r(p.id))&&allowed(a,'assessment.read',p.id,r(p.id))):[];
  out.skills=out.people.length?skills.filter(s=>s.operation_id===null).map(s=>skillRow(db,s)):[];
  if(personId!==null||skillId!==null){
   must(out.people.some(x=>x.id===personId)&&out.skills.some(x=>x.id===skillId),403,'Сотрудник или навык недоступен');
   const last=latestQualification(db,personId,skillId);
   if(last){const row=one(db,'SELECT * FROM assessment_session WHERE id=?',[last.session_id]);must(a.read('assessment.read',row.id)&&allowed(a,'assessment.general',row.id,assessmentResource(db,row,a.day)),403,'Предыдущая оценка вне разрешённой области')}
   out.previous=last?{id:last.session_id,day:last.assessed_at.slice(0,10)}:null;
  }
 }
 return out;
}
export function competencyChange(db,a,f){
 must(a.personId&&exact(f,['command','fields'])&&typeof f.command==='string',400,'Неверная команда компетенций');
 const v=f.fields,k=f.command;
 if(k==='category.create'){
  must(site(db,a,'skill.category.create')&&exact(v,['name'])&&text(v.name,200),403,'Создание категории недоступно');
  return emit(db,a,'skill_category',uuid(),'create',0,v,'skill.category.create');
 }
 if(k==='skill.create'){
  must(site(db,a,'skill.create')&&site(db,a,'skill.read')&&exact(v,['category_id','name'])&&active(db,'skill_category',v.category_id)&&text(v.name,500),403,'Создание общего навыка недоступно');
  return emit(db,a,'skill',uuid(),'create',0,{...v,operation_id:null},'skill.create');
 }
 if(k==='skill.from_sop'){
  must(exact(v,['category_id','revisions'])&&active(db,'skill_category',v.category_id)&&Array.isArray(v.revisions)&&v.revisions.length>0&&v.revisions.length<=100&&v.revisions.every(r=>exact(r,['id','rev'])&&isId(r.id)&&Number.isSafeInteger(r.rev))&&new Set(v.revisions.map(r=>r.id)).size===v.revisions.length,400,'Выберите категорию и редакции СОП');
  const pending=[];
  for(const r of v.revisions){
   const x=a.read('sop.read_effective',r.id),current=one(db,"SELECT r.id,d.rev,r.state,d.operation_id,d.code,d.archived FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.kind='sop'",[r.id]);
   const resource=current&&skillResource(db,{operation_id:current.operation_id});
   must(x&&current&&!current.archived&&current.state==='effective'&&a.read('operation.read',current.operation_id)&&allowed(a,k,current.operation_id,resource)&&allowed(a,'skill.read',current.operation_id,resource),403,'Редакция СОП недоступна');
   must(r.rev===current.rev,409,'Редакция СОП изменилась');
   must(!one(db,'SELECT id FROM skill WHERE operation_id=? AND archived=0',[current.operation_id])&&!pending.some(p=>p.operation_id===current.operation_id),409,'Навык по операции уже существует; выберите действующий навык');
   pending.push({category_id:v.category_id,operation_id:current.operation_id,name:(x.data.code+' · '+x.data.title).slice(0,500)});
  }
  return {items:pending.map(p=>emit(db,a,'skill',uuid(),'create',0,p,k))};
 }
 if(k==='requirement.create'){
  must(exact(v,['profession_id','skill_id','scale_id','required_level','criticality','valid_from','valid_to'])&&[v.profession_id,v.skill_id,v.scale_id].every(isId)&&Number.isSafeInteger(v.required_level)&&day(v.valid_from)&&v.valid_from>=a.day&&(v.valid_to===null||day(v.valid_to))&&['normal','important','critical'].includes(v.criticality),400,'Неверные параметры требования');
  const r=requirementResource(db,v);
  must(readableSkill(db,a,active(db,'skill',v.skill_id))&&allowed(a,k,v.skill_id,r)&&allowed(a,'requirement.read',v.skill_id,r),403,'Профиль профессии недоступен');
  return emit(db,a,'role_requirement',uuid(),'create',0,v,k);
 }
 if(k==='requirement.close'){
  must(exact(v,['id','rev','valid_to'])&&isId(v.id)&&Number.isSafeInteger(v.rev)&&day(v.valid_to)&&v.valid_to>=a.day,400,'Укажите последний день действия');
  const old=a.read('requirement.read',v.id)&&one(db,'SELECT * FROM role_requirement WHERE id=?',[v.id]);
  must(old&&allowed(a,k,v.id,requirementResource(db,old)),403,'Требование недоступно');must(old.rev===v.rev,409,'Требование изменено');
  return emit(db,a,'role_requirement',old.id,'update',old.rev,{command:'close',valid_to:v.valid_to},k);
 }
 if(k==='coverage.save'){
  must(exact(v,['id','rev','unit_id','skill_id','shift_code','min_people','scale_id','required_level'])&&(v.id===null||isId(v.id))&&Number.isSafeInteger(v.rev)&&[v.unit_id,v.skill_id,v.scale_id].every(isId)&&typeof v.shift_code==='string'&&v.shift_code.length<=100&&Number.isSafeInteger(v.min_people)&&v.min_people>=0&&v.min_people<=100000&&Number.isSafeInteger(v.required_level),400,'Неверная потребность покрытия');
  const r=coverageResource(db,v);must(a.read('org.read',v.unit_id)&&readableSkill(db,a,active(db,'skill',v.skill_id))&&allowed(a,k,v.unit_id,r)&&allowed(a,'coverage.read',v.unit_id,r),403,'Покрытие недоступно');
  const old=one(db,'SELECT * FROM coverage_requirement WHERE unit_id=? AND skill_id=? AND shift_code=?',[v.unit_id,v.skill_id,v.shift_code]);
  must(v.id===(old?.id??null)&&v.rev===(old?.rev??0),409,'Потребность изменилась; откройте текущую запись');
  const {id,rev,...payload}=v;
  return emit(db,a,'coverage_requirement',id??uuid(),old?'update':'create',rev,payload,k);
 }
 if(k==='assessment.general'){
  must(exact(v,['person_id','skill_id','scale_id','assessed_on','observation_state','level','valid_until','evidence','feedback','previous_assessment_id'])&&[v.person_id,v.skill_id,v.scale_id].every(isId)&&v.person_id!==a.personId&&day(v.assessed_on)&&v.assessed_on<=a.day&&['rated','not_observed','not_applicable'].includes(v.observation_state)&&(v.level===null||Number.isSafeInteger(v.level))&&(v.valid_until===null||day(v.valid_until))&&text(v.evidence,2000)&&text(v.feedback,2000)&&(v.previous_assessment_id===null||isId(v.previous_assessment_id)),400,'Неверная оценка общего навыка');
  const s=active(db,'skill',v.skill_id),resource=personWorkResource(db,[v.person_id,a.personId],a.day,[v.assessed_on]),r=resource&&{...resource,self:v.person_id};
  must(s&&s.operation_id===null&&who(a,v.person_id)&&allowed(a,k,v.person_id,r)&&allowed(a,'assessment.read',v.person_id,r),403,'Оценка общего навыка недоступна; операции оцениваются через СОП');
  const last=latestQualification(db,v.person_id,v.skill_id);
  if(last){const row=one(db,'SELECT * FROM assessment_session WHERE id=?',[last.session_id]);must(a.read('assessment.read',row.id)&&allowed(a,k,row.id,assessmentResource(db,row,a.day)),403,'Предыдущая оценка вне разрешённой области')}
  return emit(db,a,'assessment_session',uuid(),'create',0,{...v,command:'general_skill',evaluator_id:a.personId},k);
 }
 throw new PilotError(400,'Неизвестная команда компетенций');
}
export function assessmentDetail(db,a,id){
 const r=isId(id)&&a.read('assessment.read',id)&&one(db,'SELECT * FROM assessment_session WHERE id=?',[id]);
 must(r&&allowed(a,'assessment.detail',id,assessmentResource(db,r,a.day)),404,'Оценка недоступна');
 const items=rows(db,'SELECT skill_id,scale_id,level,observation_state,valid_until,evidence_note FROM assessment_item WHERE session_id=?',[id]).map(x=>({...x,skill:skillLabel(db,x.skill_id),scale:one(db,'SELECT name FROM rating_scale WHERE id=?',[x.scale_id])?.name??''}));
 return {id,kind:r.assessment_kind,person:name(a,r.person_id),evaluator:name(a,r.evaluator_id),assessed_on:r.assessed_at.slice(0,10),feedback:r.feedback,conclusion:r.conclusion,items,assignment_id:r.assignment_id&&a.read('training.read',r.assignment_id)&&allowed(a,'training.detail',r.assignment_id,assessmentResource(db,r,a.day))?r.assignment_id:null};
}
export function competencyView(db,a,action,data){
 if(action==='skill.read')return {...data,category:one(db,'SELECT name FROM skill_category WHERE id=?',[data.category_id])?.name??'',operation:a.read('operation.read',data.operation_id)?.data.name??null};
 if(action==='requirement.read')return {...data,profession:one(db,'SELECT name FROM profession WHERE id=?',[data.profession_id])?.name??'',skill:skillLabel(db,data.skill_id),scale:one(db,'SELECT name FROM rating_scale WHERE id=?',[data.scale_id])?.name??'',can_close:!!a.personId&&!data.valid_to&&allowed(a,'requirement.close',data.id,requirementResource(db,data))};
 if(action==='coverage.read'){
  const c=coverageData(db,a.day).find(x=>x.id===data.id);
  return {...data,unit:a.read('org.read',data.unit_id)?.data.name??null,skill:skillLabel(db,data.skill_id),competent:c?.competent??null,competence_deficit:c?.competence_deficit??null,actual:c?.actual??null,deficit:c?.deficit??null,requires_admission_measure:c?.requires_admission_measure??false,can_edit:!!a.personId&&allowed(a,'coverage.save',data.id,coverageResource(db,data))};
 }
 const r=one(db,'SELECT * FROM assessment_session WHERE id=?',[data.id]);
 return {...data,person_name:name(a,r.person_id),evaluator_name:name(a,r.evaluator_id),title:rows(db,'SELECT s.name FROM assessment_item i JOIN skill s ON s.id=i.skill_id WHERE i.session_id=?',[r.id]).map(x=>x.name).join(' · '),can_detail:allowed(a,'assessment.detail',r.id,assessmentResource(db,r,a.day))};
}
