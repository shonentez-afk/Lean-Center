import {TRAINING_TYPES,isTrainingEvent,applyTrainingEvent,verifyTrainingSource} from '../training/domain.js';
import {applyStage43Checklist,verifyStage43Checklist} from './stage43-checklist.js';
import {applySopMethod,applySopEvaluation,reviewDue,validDate} from './sop-review.js';
// LC3: aggregate events + detached original Stage43 content.
import {invariant,isId,one,rows,canonical,sha256,foldKey} from '../../core/db.js';
export const DOMAIN_TYPES=Object.freeze({document:'Библиотека СОП',frv_study:'Исследования ФРВ',checklist_version:'Методика оценки СОП',sop_evaluation:'Оценка СОП',sop_stage43_checklist:'Чек-лист Stage43',...TRAINING_TYPES});
export const MAX_CONTENT=30*1024*1024;
const MIME={sop:'application/vnd.lean.stage43.sop+json',frv:'application/vnd.lean.stage43.frv+json'};
const encoder=new TextEncoder();
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const string=(x,max=20000)=>typeof x==='string'&&x.length<=max;
const nonempty=(x,max=500)=>string(x,max)&&x.trim().length>0;
const date=x=>string(x,10)&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const digest=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const types=new Set(['VA','NVA_Necessary','NVA_Waste','WAIT','BREAK','OTHER']);
const exact=(p,keys)=>invariant(obj(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)),'Неверные поля события LC3');
const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const safeImage=x=>string(x,MAX_CONTENT)&&/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(x);
export function validateRef(ref){exact(ref,['sha256','size','kind']);invariant(digest(ref.sha256)&&Number.isSafeInteger(ref.size)&&ref.size>0&&ref.size<=MAX_CONTENT&&Object.hasOwn(MIME,ref.kind),'Некорректная ссылка на исходный файл');return ref}
export async function checkContent(ref,text){validateRef(ref);invariant(typeof text==='string'&&text.length<=MAX_CONTENT,'Исходный файл отсутствует или слишком велик');const bytes=encoder.encode(text);invariant(bytes.length===ref.size&&await sha256(bytes)===ref.sha256,'Исходный файл повреждён: '+ref.sha256);return text}
// Historical employee snapshots are part of the hashed source, not authorization.
 // Legacy imports may have plain text without a directory link.
function verifyPeople(source,kind){
 const refs=source.leanCenterPeople;if(refs===undefined)return;
 invariant(Array.isArray(refs)&&refs.length<=1000,'Некорректные ссылки на сотрудников');
 const seen=new Set(),single=new Set();
 for(const x of refs){
  exact(x,['slot','person_id','employee_code','display_name','position','unit']);
  invariant(isId(x.person_id)&&nonempty(x.display_name,500)&&nonempty(x.employee_code,200)&&string(x.position,500)&&string(x.unit,500)&&string(x.slot,100),'Некорректный снимок сотрудника');
  const key=x.slot+':'+x.person_id;invariant(!seen.has(key),'Повтор ссылки сотрудника');seen.add(key);
  if(x.slot!=='sop_observer'){invariant(!single.has(x.slot),'Два сотрудника в одном поле');single.add(x.slot)}
  let name,post=null;
  if(kind==='frv'){invariant(['operator','observer'].includes(x.slot),'Недопустимая роль сотрудника в ФРВ');name=source[x.slot]}
  else if(x.slot==='approver'){name=source.meta.approverName;post=source.meta.approverPost||''}
  else if(x.slot==='sop_observer'){invariant(String(source.frvMeta?.observers||'').split(/\r?\n/).includes(x.display_name),'Снимок наблюдателя не соответствует печатному полю');continue}
  else if(['trainer','trainee'].includes(x.slot))name=source.twi?.[x.slot];
  else{const m=/^(workgroup|agree):(\d+)$/.exec(x.slot);invariant(m,'Недопустимая роль сотрудника в СОП');if(m[1]==='workgroup')name=source.responsibles?.[Number(m[2])];else {const a=source.agreedList?.[Number(m[2])];name=a?.name;post=a?.post||''}}
  invariant(name===x.display_name&&(post===null||post===x.position),'Снимок сотрудника не соответствует печатным полям');
 }
}
export async function inspectSource(text,kind){
 invariant(Object.hasOwn(MIME,kind)&&typeof text==='string'&&text.length<=MAX_CONTENT,'Неверный тип или размер исходного файла');
 const bytes=encoder.encode(text);invariant(bytes.length>0&&bytes.length<=MAX_CONTENT,'Исходный JSON не должен превышать 30 МБ');
 const p=JSON.parse(text);invariant(obj(p),'Ожидался JSON Stage43');
 let projection;
 if(kind==='sop'){
  invariant(p.schemaVersion===2&&obj(p.document)&&Object.hasOwn(p,'constructor')&&obj(p.constructor)&&Array.isArray(p.constructor.steps)&&obj(p.photoAssets)&&p.integrity?.algorithm==='SHA-256'&&digest(p.integrity.sha256),'Ожидалась переносимая копия СОП Stage43 с SHA-256');
  const base={schemaVersion:p.schemaVersion,document:p.document,constructor:p.constructor,photoAssets:p.photoAssets};
  invariant(await sha256(JSON.stringify(base))===p.integrity.sha256,'Контрольная сумма переносимого СОП не совпадает');
  const s=p.constructor,d=p.document,seen=new Set();invariant(obj(s.meta)&&s.steps.length<=1000,'Некорректные шаги СОП');verifyPeople(s,'sop');
  const steps=s.steps.map(st=>{
   invariant(obj(st)&&Number.isSafeInteger(st.id)&&st.id>0&&!seen.has(st.id)&&string(st.action)&&Array.isArray(st.keyMoments)&&st.keyMoments.length<=5&&st.keyMoments.every(x=>string(x))&&string(st.reason)&&num(st.durationSeconds)&&typeof st.hasPhoto==='boolean','Некорректный шаг СОП');seen.add(st.id);
   if(st.hasPhoto){const a=p.photoAssets[String(st.id)];invariant(obj(a)&&safeImage(a.original)&&(!a.rendered||safeImage(a.rendered)),'Отсутствует или неподдерживаемое фото шага '+st.id)}
   return {source_id:String(st.id),action:st.action,key_points:st.keyMoments,reason:st.reason,seconds:st.durationSeconds,photo:st.hasPhoto};
  });
  invariant(Object.keys(p.photoAssets).every(k=>steps.some(st=>st.source_id===k&&st.photo)),'Есть фото без соответствующего шага');
  projection={title:String(s.meta.operation||'').slice(0,500),number:String(d.number||s.meta.sopNumber||'').slice(0,200),legacy_id:String(d.id||'').slice(0,200),legacy_version:String(d.version??'').slice(0,50),legacy_status:String(d.status||'').slice(0,80),photos:steps.filter(x=>x.photo).length,twi:!!s.twi?.enabled,steps};
 }else{
  invariant(['FRV-1.2','FRV-1.3'].includes(p.schemaVersion)&&obj(p.study)&&Array.isArray(p.cycles)&&p.cycles.length<=1000,'Ожидалась копия исследования ФРВ FRV-1.2/1.3');
  verifyPeople(p.study,'frv');const seen=new Set(),measurements=[];let complete=0,unmeasured=0,count=0;
  for(const [i,c] of p.cycles.entries()){
   invariant(obj(c)&&Array.isArray(c.observations)&&c.observations.length<=1000,'Некорректный цикл ФРВ');let full=c.observations.length>0;
   const phase=['baseline','improved','unassigned'].includes(c.phase)?c.phase:'unassigned';
   for(const o of c.observations){count++;invariant(count<=5000&&obj(o)&&nonempty(o.id,200)&&!seen.has(o.id)&&string(o.actionRaw)&&(!o.valueType||types.has(o.valueType)),'Некорректное наблюдение ФРВ');seen.add(o.id);
    const v=o.durationSec;invariant(v==null||num(v),'Время наблюдения должно быть числом секунд или null');
    if(v==null||!o.actionRaw.trim()){unmeasured++;full=false;continue}
    if(v===0)full=false;
    measurements.push({source_id:o.id,cycle:i+1,phase,action:o.actionRaw,category:o.valueType||'OTHER',seconds:v});
   }if(full)complete++;
  }
  projection={title:String(p.study.operationId||p.study.processDescription||p.study.studyId||'').slice(0,500),number:String(p.study.studyId||'').slice(0,200),legacy_id:String(p.study.libraryId||'').slice(0,200),legacy_version:String(p.study.version||'').slice(0,50),legacy_status:String(p.study.status||'').slice(0,80),cycles:p.cycles.length,complete,unmeasured,measurements};
 }
 invariant(encoder.encode(canonical(projection)).length<=2*1024*1024,'Слишком большая проекция для одного пакета; разделите источник');
 return {source:{sha256:await sha256(bytes),size:bytes.length,kind},projection}
}
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
 for(const e of events||[]){if(!Object.hasOwn(DOMAIN_TYPES,e.entity_type)||!e.payload?.source)continue;
  const ref=validateRef(e.payload.source);invariant(typeof readContent==='function','Пакет содержит документы; требуется полный комплект исходных файлов');
  let result=checked.get(ref.sha256);if(!result){const text=await checkContent(ref,await readContent(ref));result=await inspectSource(text,ref.kind);result.raw=JSON.parse(text);checked.set(ref.sha256,result)}
  if(isTrainingEvent(e)){verifyTrainingSource(e,result.source,result.raw);continue}
  if(e.entity_type==='sop_stage43_checklist'){invariant(ref.kind==='sop'&&canonical(result.source)===canonical(ref),'Неверный исходник чек-листа');verifyStage43Checklist(e.payload,result.raw.constructor);continue}
  invariant(canonical(result.source)===canonical(ref)&&canonical(result.projection)===canonical(e.payload.projection),'Проекция не совпадает с исходным файлом');
 }
}
function register(db,ref){validateRef(ref);const old=one(db,'SELECT * FROM attachment WHERE sha256=?',[ref.sha256]);if(old){invariant(old.mime===MIME[ref.kind]&&old.byte_size===ref.size,'Конфликт содержимого');return}db.run('INSERT INTO attachment(sha256,mime,byte_size,original_name) VALUES(?,?,?,?)',[ref.sha256,MIME[ref.kind],ref.size,ref.sha256+'.json'])}
function link(db,ref,type,id){register(db,ref);db.run("DELETE FROM attachment_link WHERE entity_type=? AND entity_id=? AND purpose='stage43-source'",[type,id]);db.run('INSERT INTO attachment_link(id,sha256,entity_type,entity_id,purpose) VALUES(?,?,?,?,?)',[id+':source',ref.sha256,type,id,'stage43-source'])}
function active(db,table,id){invariant(isId(id)&&one(db,'SELECT id FROM '+table+' WHERE id=? AND archived=0',[id]),'Выберите действующую запись: '+table)}
function operation(db,id){if(id!==null)active(db,'operation',id)}
function sourcePayload(p,kind){validateRef(p.source);invariant(p.source.kind===kind&&obj(p.projection)&&nonempty(p.title)&&string(p.projection.title,500),'Неверное содержимое');return canonical({source:p.source,projection:p.projection})}
function docSteps(db,rid,p){invariant(Array.isArray(p.projection.steps)&&p.projection.steps.length<=1000,'Некорректные шаги');db.run('DELETE FROM document_step WHERE revision_id=?',[rid]);for(const [i,s] of p.projection.steps.entries()){invariant(string(s.action)&&Array.isArray(s.key_points)&&s.key_points.every(x=>string(x))&&string(s.reason)&&num(s.seconds),'Некорректный шаг');db.run('INSERT INTO document_step(id,revision_id,position,action_text,key_points_json,reason_text,duration_seconds) VALUES(?,?,?,?,?,?,?)',[rid+':'+(i+1),rid,i+1,s.action,canonical(s.key_points),s.reason,s.seconds])}}
function revision(db,id,docId){const r=one(db,'SELECT * FROM document_revision WHERE id=? AND document_id=?',[id,docId]);invariant(r,'Версия не принадлежит документу');return r}
function openRevision(db,id){return one(db,"SELECT id FROM document_revision WHERE document_id=? AND state IN ('draft','review','approved')",[id])}
function newRevision(db,e,p,version){
 const payload=sourcePayload(p,'sop');register(db,p.source);
 db.run("INSERT INTO document_revision(id,document_id,version_no,state,payload_json,created_at) VALUES(?,?,?,'draft',?,?)",[e.id,e.entity_id,version,payload,e.occurred_at]);docSteps(db,e.id,p);link(db,p.source,'document_revision',e.id)
}
export function applyDomainEvent(db,e,old){
 const p=e.payload,id=e.entity_id;
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
   exact(p,['command','revision_id','print_format','changed_on']);
   const v=revision(db,p.revision_id,id);invariant(v.state==='draft','Паспорт редактируется только у черновика');
   invariant(['portrait','landscape'].includes(p.print_format)&&validDate(p.changed_on)&&p.changed_on<=e.occurred_at.slice(0,10),'Выберите формат и фактическую дату изменения');
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
   db.run('UPDATE document SET title=?,operation_id=?,rev=rev+1 WHERE id=?',[p.title.trim(),p.operation_id,id]);return
  }
  exact(p,['command','revision_id','actor_id','note']);const v=revision(db,p.revision_id,id);invariant(string(p.note,2000),'Некорректное примечание');active(db,'person',p.actor_id);
  const transitions={submit:['draft','review'],return:['review','draft'],approve:['review','approved'],effect:['approved','effective'],withdraw:['effective','withdrawn']};
  const tr=Object.hasOwn(transitions,p.command)&&transitions[p.command];invariant(tr&&v.state===tr[0],'Недопустимый переход статуса');
  if(['submit','approve','effect'].includes(p.command)){active(db,'operation',old.operation_id);const steps=rows(db,'SELECT action_text FROM document_step WHERE revision_id=?',[v.id]);invariant(steps.length&&steps.every(s=>s.action_text.trim()),'Заполните действия всех шагов');invariant(v.print_format&&v.changed_on&&v.review_due,'Заполните паспорт: формат А3 и дата изменения');invariant(steps.length<=(v.print_format==='portrait'?9:12),'Количество шагов превышает формат А3');invariant(v.workplace_id&&one(db,'SELECT workplace_id FROM operation WHERE id=?',[old.operation_id])?.workplace_id===v.workplace_id,'Паспорт: подтвердите рабочее место операции');if(p.command!=='submit'){const src=JSON.parse(v.payload_json).projection;invariant(src.steps.every(s=>s.seconds>0&&s.key_points.some(k=>k.trim())&&s.reason.trim()&&s.photo),'Перед согласованием заполните время, ключевые моменты, причины и визуализацию всех шагов')}}
  if(p.command==='return'||p.command==='withdraw')invariant(p.note.trim(),'Укажите причину');
  if(p.command==='effect'){db.run("UPDATE document_revision SET state='superseded' WHERE document_id=? AND state='effective'",[id]);db.run("UPDATE document_revision SET state='effective',effective_at=? WHERE id=?",[e.occurred_at,v.id])}
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
