// LC8.1: authenticated handoff of the existing RC1 offline form.
// Only the signed-in internal trainer can export/import their own observation.
// The offline file is not proof of identity; commit requires a live session.
import {createHash} from 'node:crypto';
import {one,rows,uuid,isId,canonical,meta,applyEvent} from '../../src/core/db.js';
import {mobileRecord,mobileMapping,mobileContext,mobileObservationExists,mobileSelectionConflicts,mobileAuditHtml} from '../../src/modules/training/mobile-audit.js';
import {auditMethods,practicalCriteria,AUDIT_CODE} from '../../src/modules/training/domain.js';
import {matchesRoleKind} from '../../src/modules/master-data/role-matching.js';
import {trainingAssignmentResource,auditResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,message)=>{if(!ok)throw new PilotError(status,message)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const hash=r=>createHash('sha256').update(canonical(r)).digest('hex');
const name=(a,id)=>(a.read('person.read_directory',id)||a.read('person.read_basic',id))?.data.display_name??null;
const role=(db,id,on)=>rows(db,"SELECT b.code,b.name FROM role_assignment a JOIN business_role b ON b.id=a.role_id WHERE a.person_id=? AND b.archived=0 AND a.valid_from<=? AND coalesce(a.valid_to,'9999-12-31')>=?",[id,on,on]).some(x=>matchesRoleKind(x,'internal_trainer'));
const full=(a,k,id,r)=>!!r&&a.scope(k,id,{...r,self:null,assigned:[]});
function access(db,a,t,k,on,people=[]){
 if(!t||!a.personId||a.personId===t.trainee_id||a.personId===t.mentor_id||!t.approval_json||t.state==='cancelled'||!t.source_sha256||!role(db,a.personId,on)||!role(db,a.personId,a.day))return false;
 const r=trainingAssignmentResource(db,t.id,a.day,[a.personId,...people].filter(Boolean),on);
 return !!a.read('training.read',t.id)&&!!a.read('sop.read_history',t.sop_revision_id)&&!!a.read('operation.read',t.operation_id)&&[t.mentor_id,t.trainee_id,a.personId].every(id=>name(a,id))&&['training.detail','audit.read','audit.create',k].every(p=>full(a,p,t.id,r));
}
const methods=db=>auditMethods(db).filter(x=>x.method_code===AUDIT_CODE&&x.state==='active'&&!x.legacy_context_json);
const assignment=(db,id)=>isId(id)?one(db,'SELECT * FROM training_assignment WHERE id=?',[id]):null;
const assignmentLabel=(a,t)=>name(a,t.trainee_id)+' · '+(a.read('operation.read',t.operation_id)?.data.name||'Операция')+' · инструктор '+name(a,t.mentor_id);
export function mobileOptions(db,a){
 must(a.personId&&a.permissions.includes('audit.read')&&a.permissions.includes('audit.create')&&['audit.mobile.export','audit.mobile.import'].some(k=>a.permissions.includes(k)),403,'Мобильный аудит недоступен');
 const out={day:a.day,can_import:a.permissions.includes('audit.mobile.import'),methods:[],assignments:[]};
 if(a.permissions.includes('audit.mobile.export')){
  out.methods=methods(db).map(m=>({id:m.id,label:'RC1 · версия '+m.version_no}));
  out.assignments=rows(db,"SELECT * FROM training_assignment WHERE source_sha256 IS NOT NULL AND approval_json IS NOT NULL AND state<>'cancelled' ORDER BY assigned_on DESC,id").filter(t=>access(db,a,t,'audit.mobile.export',a.day)).map(t=>({id:t.id,rev:t.rev,label:assignmentLabel(a,t)}));
 }
 return out;
}
export function exportMobile(db,a,f){
 must(exact(f,['assignment_id','assignment_rev','method_id','confirmed'])&&f.confirmed===true&&Number.isSafeInteger(f.assignment_rev)&&isId(f.method_id),400,'Подтвердите сохранение автономного бланка');
 const t=assignment(db,f.assignment_id),m=methods(db).find(x=>x.id===f.method_id);
 must(access(db,a,t,'audit.mobile.export',a.day),403,'Назначение недоступно');
 must(t.rev===f.assignment_rev&&m,409,'Назначение или методика изменились');
 const config={database_id:meta(db,'database_id'),assignment_id:t.id,revision_id:t.sop_revision_id,mentor_id:t.mentor_id,trainee_id:t.trainee_id,auditor_id:a.personId,method_id:m.id,method_json:m.methodology_json,label:assignmentLabel(a,t)+' · ВТ: '+name(a,a.personId),criteria:practicalCriteria(db,m.id).map(q=>({id:q.id,position:q.position,question:q.question,section_code:q.section_code}))};
 const html=mobileAuditHtml(config).replace('<meta charset="utf-8">','<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">').replace('На ПК примите локальные изменения, затем сформируйте подтверждение по исходному JSON и загрузите его здесь.','В защищённом центре импортируйте JSON от своего имени. Скачайте подтверждение по исходному пакету и загрузите его здесь.');
 a.audit('audit.mobile.export',t.id);return {filename:'LeanCenter-L1-mobile.html',html};
}
function packet(a,raw){
 must(a.personId&&a.permissions.includes('audit.mobile.import')&&a.permissions.includes('audit.read')&&a.permissions.includes('audit.create'),403,'Импорт мобильного аудита недоступен');
 must(exact(raw,['type','schemaVersion','audits'])&&raw.type==='lean-l1-mobile-v1'&&raw.schemaVersion===1&&Array.isArray(raw.audits)&&raw.audits.length>0&&raw.audits.length<=100,400,'Ожидается мобильный JSON до 100 записей');
 const ids=new Set();for(const x of raw.audits){if(x&&isId(x.id)){must(!ids.has(x.id),422,'Повтор ID в пакете');ids.add(x.id)}}
 return raw.audits;
}
function checked(db,a,x){
 const r=mobileRecord(x);
 must(r.auditor_id===a.personId&&r.database_id===meta(db,'database_id')&&r.observed_on<=a.day,403,'Пакет другой базы, другого ВТ или будущей даты');
 const t=assignment(db,r.assignment_id);
 must(access(db,a,t,'audit.mobile.import',r.observed_on),403,'Назначение недоступно');
 const h=hash(r),old=mobileMapping(db,r.id);
 if(old){
  const v=one(db,'SELECT * FROM audit_session WHERE id=?',[old.target_id]);
  must(v&&v.auditor_id===a.personId&&v.assignment_id===t.id&&a.read('audit.read',v.id)&&full(a,'audit.detail',v.id,auditResource(db,v,a.day)),403,'Ранее принятая запись недоступна');
  return {record:r,hash:h,t,old,status:old.source_hash===h?'duplicate':'conflict',facts:[]};
 }
 const ctx=mobileContext(db,r),criteria=practicalCriteria(db,ctx.method.id);
 must(criteria.length===r.responses.length&&criteria.every((q,i)=>q.id===r.responses[i].criterion_id)&&r.observed_on>=t.assigned_on,422,'Методика, ответы или дата не совпадают с назначением');
 const facts=rows(db,"SELECT id,stage_code,held_at,mentor_id,witness_id FROM training_session WHERE assignment_id=? AND stage_code IS NOT NULL AND substr(held_at,1,10)<=? ORDER BY held_at DESC,id",[t.id,r.observed_on]).filter(f=>!mobileObservationExists(db,r,f.id)&&access(db,a,t,'audit.mobile.import',f.held_at.slice(0,10),[f.mentor_id,f.witness_id]));
 return {record:r,hash:h,t,status:facts.length?'ready':'waiting',facts};
}
export function previewMobile(db,a,raw){
 return {items:packet(a,raw).map((x,i)=>{
  try{
   const p=checked(db,a,x);
   return {row:i+1,id:p.record.id,hash:p.hash,assignment_rev:p.t.rev,label:assignmentLabel(a,p.t),observed_on:p.record.observed_on,status:p.status,facts:p.facts.map(f=>({id:f.id,label:f.held_at+' · '+f.stage_code})),message:p.status==='waiting'?'Нет доступного незанятого факта. Сначала зарегистрируйте инструктаж.':p.status==='duplicate'?'Ранее принят, можно скачать подтверждение':p.status==='conflict'?'ID уже принят с другим содержимым':'Выберите фактический этап'};
  }catch(e){return {row:i+1,status:'invalid',message:'Запись не прошла проверку базы, сотрудника, прав, даты или методики'}}
 })};
}
export function commitMobile(db,a,f){
 must(exact(f,['packet','selected'])&&Array.isArray(f.selected)&&f.selected.length>0&&f.selected.length<=100,400,'Выберите наблюдения для импорта');
 const records=packet(a,f.packet),seen=new Set(),chosen=f.selected.map(s=>{
  must(exact(s,['id','hash','assignment_rev','session_id'])&&isId(s.id)&&isId(s.session_id)&&Number.isSafeInteger(s.assignment_rev)&&typeof s.hash==='string'&&/^[a-f0-9]{64}$/.test(s.hash)&&!seen.has(s.id),400,'Неверная выбранная запись');
  seen.add(s.id);const p=checked(db,a,records.find(x=>x?.id===s.id));
  must(p.status==='ready'&&p.hash===s.hash&&p.t.rev===s.assignment_rev&&p.facts.some(x=>x.id===s.session_id),409,'Изменилось назначение, запись или факт; повторите предварительную проверку');
  return {...p,sessionId:s.session_id};
 });
 must(!mobileSelectionConflicts(db,chosen).size,409,'Конфликт выбранных наблюдений: один факт, ВТ, методика и дата');
 for(const p of chosen){
  const r=p.record,id=uuid(),event=uuid(),payload={command:'mobile_lc5',assignment_id:p.t.id,assignment_rev:p.t.rev,method_id:r.method_id,auditor_id:a.personId,session_id:p.sessionId,observed_on:r.observed_on,responses:r.responses,feedback:r.feedback,mobile_record:r,mobile_hash:p.hash};
  try{applyEvent(db,{id:event,entity_type:'audit_session',entity_id:id,operation:'create',expected_revision:0,payload,occurred_at:a.at})}catch(e){throw new PilotError(422,'Проверка мобильного аудита: '+String(e.message).split('\n')[0].slice(0,240))}
  a.audit('audit.mobile.import',event);
 }
 return {imported:chosen.length};
}
export function receiptMobile(db,a,raw){
 const accepted=[];
 for(const x of packet(a,raw)){try{const p=checked(db,a,x);if(p.status==='duplicate')accepted.push({id:p.record.id,hash:p.hash,audit_id:p.old.target_id})}catch{}}
 must(accepted.length>0,404,'Нет принятых совпадающих наблюдений');
 return {type:'lean-l1-mobile-receipt-v1',schemaVersion:1,database_id:meta(db,'database_id'),accepted};
}
