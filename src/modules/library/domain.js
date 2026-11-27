import {economicEventDay} from '../../core/business-clock.js';
import {MIME,obj,string,nonempty,date,types,exact,num,validateRef,checkContent,inspectSource} from './source-validation.js';
export {MAX_CONTENT,validateRef,checkContent,inspectSource} from './source-validation.js';
import {isLC6Event,applyEconomicEvent,verifyEconomicSource} from '../effect/domain.js';
import {documentTitle} from './revision-title.js';
import {hasSopKeyMomentsAndReason} from './sop-step-quality.js';
import {MAX_SOP_KEY_MOMENTS} from './sop-limits.js';
import {verifyMobileEvent} from '../training/mobile-audit.js';
import {verifyRC1Event} from '../training/rc1-import.js';
import {TRAINING_TYPES,isTrainingEvent,applyTrainingEvent,verifyTrainingSource} from '../training/domain.js';
import {applyStage43Checklist,verifyStage43Checklist} from './stage43-checklist.js';
import {applySopMethod,applySopEvaluation,reviewDue,validDate} from './sop-review.js';
// LC3: aggregate events + detached original Stage43 content.
import {invariant,isId,one,rows,canonical,sha256,foldKey} from '../../core/primitives.js';
export const DOMAIN_TYPES=Object.freeze({document:'Библиотека СОП',frv_study:'Исследования ФРВ',checklist_version:'Методика оценки СОП',sop_evaluation:'Оценка СОП',sop_stage43_checklist:'Чек-лист Stage43',...TRAINING_TYPES,economic_effect:'Экономический эффект',economic_fact:'Денежный факт'});
export function refsForEvents(events){const out=new Map();for(const e of events||[])if(Object.hasOwn(DOMAIN_TYPES,e.entity_type)&&e.payload?.source){const r=validateRef(e.payload.source);out.set(r.sha256,r)}return [...out.values()]}
// The original FRV snapshot remains independently readable after a study edit.
export function frvOriginSnapshot(db,revisionId){
 const x=one(db,`SELECT o.study_id,o.source_sha256,o.created_at,f.title,f.state,f.context_json,a.byte_size,a.mime
 FROM sop_frv_origin o JOIN frv_study f ON f.id=o.study_id JOIN attachment a ON a.sha256=o.source_sha256
 WHERE o.revision_id=?`,[revisionId]);
 if(!x)return null;
 invariant(x.mime===MIME.frv,'Некорректный тип исходных замеров');
 const source=validateRef({sha256:x.source_sha256,size:x.byte_size,kind:'frv'});
 return {study_id:x.study_id,title:x.title,state:x.state,created_at:x.created_at,source,current:JSON.parse(x.context_json).source.sha256===source.sha256}
}
export function refsForDb(db){return rows(db,'SELECT sha256,byte_size,mime FROM attachment WHERE mime IN (?,?) ORDER BY sha256',[MIME.sop,MIME.frv]).map(x=>validateRef({sha256:x.sha256,size:x.byte_size,kind:x.mime===MIME.sop?'sop':'frv'}))}
export function unionRefs(...groups){const m=new Map();for(const refs of groups)for(const ref of refs){validateRef(ref);const old=m.get(ref.sha256);invariant(!old||canonical(old)===canonical(ref),'Несогласованные метаданные исходного файла');m.set(ref.sha256,ref)}return [...m.values()]}
export async function verifyDomainEvents(events,readContent){
 const checked=new Map();
 for(const e of events||[]){await verifyRC1Event(e);await verifyMobileEvent(e);if(!Object.hasOwn(DOMAIN_TYPES,e.entity_type)||!e.payload?.source)continue;
  const ref=validateRef(e.payload.source);invariant(typeof readContent==='function','Пакет содержит документы; требуется полный комплект исходных файлов');
  let result=checked.get(ref.sha256);if(!result){const text=await checkContent(ref,await readContent(ref));result=await inspectSource(text,ref.kind);result.raw=JSON.parse(text);checked.set(ref.sha256,result)}
  if(isLC6Event(e)){verifyEconomicSource(e,result);continue}
  if(isTrainingEvent(e)){verifyTrainingSource(e,result.source,result.raw);continue}
  if(e.entity_type==='sop_stage43_checklist'){invariant(ref.kind==='sop'&&canonical(result.source)===canonical(ref),'Неверный исходник чек-листа');verifyStage43Checklist(e.payload,result.raw.constructor);continue}
  invariant(canonical(result.source)===canonical(ref)&&canonical(result.projection)===canonical(e.payload.projection),'Проекция не совпадает с исходным файлом');
 }
}
function register(db,ref){validateRef(ref);const old=one(db,'SELECT * FROM attachment WHERE sha256=?',[ref.sha256]);if(old){invariant(old.mime===MIME[ref.kind]&&old.byte_size===ref.size,'Конфликт содержимого');return}db.run('INSERT INTO attachment(sha256,mime,byte_size,original_name) VALUES(?,?,?,?)',[ref.sha256,MIME[ref.kind],ref.size,ref.sha256+'.json'])}
function link(db,ref,type,id){register(db,ref);db.run("DELETE FROM attachment_link WHERE entity_type=? AND entity_id=? AND purpose='stage43-source'",[type,id]);db.run('INSERT INTO attachment_link(id,sha256,entity_type,entity_id,purpose) VALUES(?,?,?,?,?)',[id+':source',ref.sha256,type,id,'stage43-source'])}
function active(db,table,id){invariant(isId(id)&&one(db,'SELECT id FROM '+table+' WHERE id=? AND archived=0',[id]),'Выберите действующую запись: '+table)}
function operation(db,id){if(id!==null)active(db,'operation',id)}
function sourcePayload(p,kind){validateRef(p.source);invariant(p.source.kind===kind&&obj(p.projection)&&nonempty(p.title)&&string(p.projection.title,500),'Неверное содержимое');return canonical({source:p.source,projection:p.projection,...(kind==='sop'?{title:p.title.trim()}:{})})}
function docSteps(db,rid,p){invariant(Array.isArray(p.projection.steps)&&p.projection.steps.length<=1000,'Некорректные шаги');db.run('DELETE FROM document_step WHERE revision_id=?',[rid]);for(const [i,s] of p.projection.steps.entries()){invariant(string(s.action)&&Array.isArray(s.key_points)&&s.key_points.every(x=>string(x))&&string(s.reason)&&num(s.seconds),'Некорректный шаг');db.run('INSERT INTO document_step(id,revision_id,position,action_text,key_points_json,reason_text,duration_seconds) VALUES(?,?,?,?,?,?,?)',[rid+':'+(i+1),rid,i+1,s.action,canonical(s.key_points),s.reason,s.seconds])}}
function revision(db,id,docId){const r=one(db,'SELECT * FROM document_revision WHERE id=? AND document_id=?',[id,docId]);invariant(r,'Версия не принадлежит документу');return r}
function openRevision(db,id){return one(db,"SELECT id FROM document_revision WHERE document_id=? AND state IN ('draft','review','approved')",[id])}
function newRevision(db,e,p,version){
 const payload=sourcePayload(p,'sop');register(db,p.source);
 db.run("INSERT INTO document_revision(id,document_id,version_no,state,payload_json,created_at) VALUES(?,?,?,'draft',?,?)",[e.id,e.entity_id,version,payload,e.occurred_at]);docSteps(db,e.id,p);link(db,p.source,'document_revision',e.id)
}
export function applyDomainEvent(db,e,old){
 const p=e.payload,id=e.entity_id;
 if(isLC6Event(e))return applyEconomicEvent(db,e,old);
 if(isTrainingEvent(e))return applyTrainingEvent(db,e,old);
 if(e.entity_type==='checklist_version')return applySopMethod(db,e,old);
 if(e.entity_type==='sop_evaluation')return applySopEvaluation(db,e,old);
 if(e.entity_type==='sop_stage43_checklist')return applyStage43Checklist(db,e,old);
 if(e.entity_type==='document'){
  if(e.operation==='create'){
   exact(p,['command','code','title','operation_id','source','projection']);invariant(!old&&p.command==='create'&&nonempty(p.code,200)&&nonempty(p.title),'Неверный новый СОП');operation(db,p.operation_id);invariant(!rows(db,'SELECT code FROM document').some(x=>foldKey(x.code)===foldKey(p.code)),'Номер документа уже существует');
   db.run("INSERT INTO document(id,code,kind,operation_id,title,rev) VALUES(?,?,'sop',?,?,1)",[id,p.code.trim(),p.operation_id,p.title.trim()]);newRevision(db,e,p,1);return
  }
  invariant(old&&!old.archived&&old.kind==='sop','СОП отсутствует или архивирован');
  if(e.operation==='archive'){invariant(p===null&&!one(db,"SELECT id FROM document_revision WHERE document_id=? AND state NOT IN ('superseded','withdrawn')",[id]),'Сначала выведите версии из действия');db.run('UPDATE document SET archived=1,rev=rev+1 WHERE id=?',[id]);return}
  invariant(e.operation==='update'&&obj(p),'Неверная операция с СОП');
  if(p.command==='passport'){
   exact(p,['command','revision_id','print_format','changed_on',...(Object.hasOwn(p,'business_offset_minutes')?['business_offset_minutes']:[])]);
   const v=revision(db,p.revision_id,id);invariant(v.state==='draft','Паспорт редактируется только у черновика');
   invariant(['portrait','landscape'].includes(p.print_format)&&validDate(p.changed_on)&&p.changed_on<=economicEventDay(e),'Выберите формат и фактическую дату изменения');
   const steps=rows(db,'SELECT * FROM document_step WHERE revision_id=?',[v.id]);invariant(steps.length<=(p.print_format==='portrait'?9:12),'Количество шагов превышает выбранный формат А3');
   const op=old.operation_id?one(db,'SELECT * FROM operation WHERE id=? AND archived=0',[old.operation_id]):null;
   const w=op?.workplace_id?one(db,'SELECT * FROM workplace WHERE id=? AND archived=0',[op.workplace_id]):null;
   const equipment=op?.equipment_id?one(db,'SELECT * FROM equipment WHERE id=?',[op.equipment_id]):null;
   db.run('UPDATE document_revision SET print_format=?,changed_on=?,review_due=?,workplace_id=?,workplace_name=?,equipment_name=? WHERE id=?',[p.print_format,p.changed_on,reviewDue(p.changed_on),w?.id||null,w?.name||null,equipment?.name||null,v.id]);db.run('UPDATE document SET rev=rev+1 WHERE id=?',[id]);return
  }
  if(p.command==='origin'){
   exact(p,['command','revision_id','study_id','source_sha256']);
   const v=revision(db,p.revision_id,id);invariant(v.state==='draft','Связь ФРВ задаётся у нового черновика');
   const f=one(db,'SELECT * FROM frv_study WHERE id=?',[p.study_id]);
   invariant(f&&f.state!=='archived'&&f.operation_id===old.operation_id&&JSON.parse(f.context_json).source.sha256===p.source_sha256,'Исследование изменилось или не соответствует операции');
   invariant(!one(db,'SELECT revision_id FROM sop_frv_origin WHERE revision_id=?',[v.id]),'Связь с ФРВ уже установлена');
   db.run('INSERT INTO sop_frv_origin VALUES(?,?,?,?)',[v.id,f.id,p.source_sha256,e.occurred_at]);db.run('UPDATE document SET rev=rev+1 WHERE id=?',[id]);return
  }
  if(p.command==='save'||p.command==='revise'){
   exact(p,['command','revision_id','title','operation_id','source','projection']);operation(db,p.operation_id);const payload=sourcePayload(p,'sop');
   if(p.command==='save'){
    const v=revision(db,p.revision_id,id);invariant(v.state==='draft','Редактируется только черновик');db.run('UPDATE document_revision SET payload_json=?,print_format=NULL,changed_on=NULL,review_due=NULL,workplace_id=NULL,workplace_name=NULL,equipment_name=NULL WHERE id=?',[payload,v.id]);docSteps(db,v.id,p);link(db,p.source,'document_revision',v.id)
   }else{invariant(p.revision_id===null&&!openRevision(db,id),'Сначала завершите текущую версию');const version=one(db,'SELECT max(version_no) n FROM document_revision WHERE document_id=?',[id]).n+1;newRevision(db,e,p,version)}
   // The operation belongs to the document identity. Once effective versions
   // exist, association must not be silently changed for historical versions.
   invariant(old.operation_id===p.operation_id||!one(db,"SELECT id FROM document_revision WHERE document_id=? AND state IN ('approved','effective','superseded','withdrawn')",[id]),'Связь действовавшего СОП с операцией неизменяема');
   const effective=one(db,"SELECT id FROM document_revision WHERE document_id=? AND state='effective'",[id]);db.run('UPDATE document SET title=?,operation_id=?,rev=rev+1 WHERE id=?',[effective?documentTitle(db,id,effective.id):p.title.trim(),p.operation_id,id]);return
  }
  exact(p,['command','revision_id','actor_id','note']);const v=revision(db,p.revision_id,id);invariant(string(p.note,2000),'Некорректное примечание');active(db,'person',p.actor_id);
  const transitions={submit:['draft','review'],return:['review','draft'],approve:['review','approved'],effect:['approved','effective'],withdraw:['effective','withdrawn']};
  const tr=Object.hasOwn(transitions,p.command)&&transitions[p.command];invariant(tr&&v.state===tr[0],'Недопустимый переход статуса');
  if(['submit','approve','effect'].includes(p.command)){active(db,'operation',old.operation_id);const steps=rows(db,'SELECT action_text FROM document_step WHERE revision_id=?',[v.id]);invariant(steps.length&&steps.every(s=>s.action_text.trim()),'Заполните действия всех шагов');invariant(v.print_format&&v.changed_on&&v.review_due,'Заполните паспорт: формат А3 и дата изменения');invariant(steps.length<=(v.print_format==='portrait'?9:12),'Количество шагов превышает формат А3');invariant(v.workplace_id&&one(db,'SELECT workplace_id FROM operation WHERE id=?',[old.operation_id])?.workplace_id===v.workplace_id,'Паспорт: подтвердите рабочее место операции');if(p.command!=='submit'){const src=JSON.parse(v.payload_json).projection;invariant(src.steps.every(s=>s.seconds>0&&hasSopKeyMomentsAndReason(s)&&s.photo),'Перед согласованием заполните время, ключевые моменты, причины и визуализацию всех шагов')}}
  if(p.command==='return'||p.command==='withdraw')invariant(p.note.trim(),'Укажите причину');
  if(p.command==='effect'){db.run("UPDATE document_revision SET state='superseded' WHERE document_id=? AND state='effective'",[id]);db.run("UPDATE document_revision SET state='effective',effective_at=? WHERE id=?",[e.occurred_at,v.id]);db.run('UPDATE document SET title=? WHERE id=?',[documentTitle(db,id,v.id),id])}
  else db.run('UPDATE document_revision SET state=? WHERE id=?',[tr[1],v.id]);
  if(p.command==='approve'||p.command==='return')db.run('INSERT INTO document_approval(id,revision_id,actor_id,decision,decided_at,note) VALUES(?,?,?,?,?,?)',[e.id,v.id,p.actor_id,p.command==='approve'?'approved':'returned',e.occurred_at,p.note]);
  db.run('UPDATE document SET rev=rev+1 WHERE id=?',[id]);return
 }
 invariant(e.entity_type==='frv_study','Неизвестное событие');
 if(e.operation==='archive'){invariant(old&&old.state!=='archived'&&p===null,'Исследование недоступно');db.run("UPDATE frv_study SET state='archived',rev=rev+1 WHERE id=?",[id]);return}
 if(e.operation==='update'&&p?.command==='finalize'){
  exact(p,['command','actor_id','note']);active(db,'person',p.actor_id);invariant(old?.state==='draft'&&string(p.note,2000),'Финализация только черновика');active(db,'operation',old.operation_id);invariant(JSON.parse(old.context_json).projection.complete>0,'Нет полностью измеренного цикла');db.run("UPDATE frv_study SET state='final',rev=rev+1 WHERE id=?",[id]);return
 }
 exact(p,['command','title','operation_id','observed_at','source','projection']);invariant(date(p.observed_at),'Укажите фактическую дату наблюдения');operation(db,p.operation_id);const context=sourcePayload(p,'frv');
 invariant(e.operation==='create'?!old&&p.command==='create':old?.state==='draft'&&p.command==='save','Редактируется только черновик ФРВ');
 if(!old)db.run("INSERT INTO frv_study(id,operation_id,title,observed_at,state,context_json,rev) VALUES(?,?,?,?,'draft',?,1)",[id,p.operation_id,p.title.trim(),p.observed_at,context]);
 else db.run('UPDATE frv_study SET operation_id=?,title=?,observed_at=?,context_json=?,rev=rev+1 WHERE id=?',[p.operation_id,p.title.trim(),p.observed_at,context,id]);
 db.run('DELETE FROM frv_measurement WHERE study_id=?',[id]);invariant(Array.isArray(p.projection.measurements)&&p.projection.measurements.length<=5000,'Некорректные наблюдения');for(const [i,m] of p.projection.measurements.entries()){invariant(nonempty(m.action,20000)&&types.has(m.category)&&num(m.seconds),'Некорректное измерение');db.run('INSERT INTO frv_measurement(id,study_id,position,activity,category,duration_seconds,raw_json) VALUES(?,?,?,?,?,?,?)',[id+':'+(i+1),id,i+1,m.action,m.category,m.seconds,canonical(m)])}
 link(db,p.source,'frv_study',id);
}
