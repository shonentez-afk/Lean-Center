// Historical RC1 import: reuse the original normalizer and immutable events.
// Site-wide, separately granted access; history never becomes an active fact.
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {one,rows,uuid,isId,canonical,meta,applyEvent} from '../../src/core/db.js';
import {rc1Plan,rc1Mapping,rc1Annulment,personMatch,verifyRC1Event} from '../../src/modules/training/rc1-import.js';
import {programResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===k.length&&k.every(y=>Object.hasOwn(x,y));
const secret=randomBytes(32),hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const site=(db,a,k)=>{const r=programResource(db);return !!r&&a.scope(k,r.units[0],r)};
const permitted=(db,a)=>site(db,a,'audit.history.read')&&site(db,a,'audit.read')&&site(db,a,'audit.detail');
export function isHistoricalRC1(db,id){
 if(!isId(id))return false;
 return !!one(db,"SELECT m.target_id FROM legacy_mapping m JOIN audit_session a ON a.id=m.target_id WHERE m.source_system='TWI_RC1' AND m.source_entity='audit' AND m.target_entity='audit_session' AND m.target_id=? AND a.legacy_context_json IS NOT NULL",[id]);
}
export function historyAllowed(db,a,id){return permitted(db,a)&&isHistoricalRC1(db,id)}
function assertRead(db,a){must(permitted(db,a),403,'Исторический RC1 доступен только с правами на архив и аудит предприятия')}
export function assertImport(db,a){
 assertRead(db,a);must(a.personId&&['audit.history.import','person.read_directory','sop.read_history','employment.read'].every(k=>site(db,a,k)),403,'Импорт исторического RC1 недоступен');
}
const people=(db,a)=>rows(db,'SELECT id,display_name FROM person ORDER BY display_name,id').filter(p=>a.read('person.read_directory',p.id));
const revisions=(db,a)=>rows(db,"SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE d.kind='sop' AND r.state IN('effective','superseded','withdrawn') ORDER BY d.code,r.version_no").flatMap(r=>{const x=a.read('sop.read_history',r.id)?.data;return x&&a.read('operation.read',x.operation_id)?[{id:r.id,label:x.code+' · '+x.title+' · v'+x.version_no}]:[]});
export function historyOptions(db,a){
 assertRead(db,a);let can_import=false;try{assertImport(db,a);can_import=true}catch{}
 return {day:a.day,can_import,people:can_import?people(db,a).map(p=>({id:p.id,label:p.display_name})):[],revisions:can_import?revisions(db,a):[]};
}
export function historyList(db,a,offset=0){
 assertRead(db,a);must(Number.isSafeInteger(offset)&&offset>=0&&offset<=1000000,400,'Неверная страница');
 const audits=rows(db,"SELECT a.id,a.observed_at,a.state,a.legacy_context_json,m.source_id FROM legacy_mapping m JOIN audit_session a ON a.id=m.target_id WHERE m.source_system='TWI_RC1' AND m.source_entity='audit' AND m.target_entity='audit_session' AND a.legacy_context_json IS NOT NULL ORDER BY a.observed_at DESC,a.id");
 const archives=rows(db,'SELECT id,recorded_at,records_json FROM rc1_archive ORDER BY recorded_at DESC,id');
 return {total:audits.length,archive_total:archives.length,offset,items:audits.slice(offset,offset+100).map(x=>{const r=JSON.parse(x.legacy_context_json);return {id:x.id,source_id:x.source_id,date:x.observed_at,state:x.state,mentor:r.names.mentor,auditor:r.names.auditor,job:r.job,version:r.version}}),archives:archives.slice(offset,offset+100).map(x=>{const r=JSON.parse(x.records_json);return {id:x.id,at:x.recorded_at,counts:Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v.length]))}})};
}
export function historyDetail(db,a,id){
 must(historyAllowed(db,a,id),404,'Историческая запись недоступна');
 const t=one(db,'SELECT * FROM audit_session WHERE id=?',[id]),m=one(db,'SELECT legacy_context_json FROM checklist_version WHERE id=?',[t.version_id]),r=JSON.parse(t.legacy_context_json),method=JSON.parse(m.legacy_context_json);
 const by=new Map(r.responses.map(q=>[q.key,q])),annul=rc1Annulment(db,t);
 return {id,date:r.date,state:t.state,source_id:r.id,version:r.version,source_revision:r.revision,names:r.names,job:r.job,feedback:r.feedback,questions:method.criteria.map((q,i)=>({position:q.code,section:q.section,question:q.question,value:by.get(method.keys[i])?.value??null,note:by.get(method.keys[i])?.note||''})),annulment:annul?{status:annul.status,reason:annul.reason??null,time:annul.time??null,source:annul.source??null}:null};
}
export function historyArchive(db,a,id){
 assertRead(db,a);const r=isId(id)&&one(db,'SELECT * FROM rc1_archive WHERE id=?',[id]);must(r,404,'Архив недоступен');return {id:r.id,at:r.recorded_at,records:JSON.parse(r.records_json)};
}
function stamp(db,a,raw){return canonical({db:meta(db,'database_id'),account:a.accountId,revision:a.credentialRevision,day:a.day,domain:one(db,'SELECT count(*) n FROM change_event').n,security:one(db,'SELECT count(*) n FROM lc81_audit').n,hash:hash(raw)})}
const sign=(s,t)=>createHmac('sha256',secret).update(t+'|'+s).digest('hex');
const token=s=>{const t=Date.now()+10*60*1000;return t+'.'+sign(s,t)};
function verifyToken(s,v){must(typeof v==='string'&&/^\d{13}\.[a-f0-9]{64}$/.test(v),409,'Повторите предпросмотр');const [t,h]=v.split('.');must(+t>=Date.now()&&+t<=Date.now()+600000&&timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(sign(s,t),'hex')),409,'Файл, права или база изменились; повторите предпросмотр')}
export async function loadHistoryPlan(db,a,raw){
 assertImport(db,a);must(raw&&Array.isArray(raw.audits)&&raw.audits.length<=20000&&Buffer.byteLength(JSON.stringify(raw))<=5*1024*1024,413,'Исторический JSON до 5 МБ и 20 000 аудитов');
 try{return {plan:await rc1Plan(db,raw),stamp:stamp(db,a,raw)}}catch(e){throw new PilotError(422,'RC1: '+String(e.message).slice(0,200))}
}
export function historyPreview(db,a,p,offset){
 must(Number.isSafeInteger(offset)&&offset>=0&&offset<=1000000,400,'Неверная страница');const {plan}=p,all=people(db,a);
 const entries=plan.items.map(x=>x.status==='ready'&&x.record.date>a.day?{...x,status:'invalid',error:'Дата в будущем'}:x);
 return {token:token(p.stamp),total:entries.length,offset,counts:Object.fromEntries(['ready','duplicate','conflict','metadata','invalid'].map(k=>[k,entries.filter(x=>x.status===k).length])),items:entries.slice(offset,offset+100).map(x=>({status:x.status,error:x.error||'',id:x.record?.id??null,hash:x.hash??null,date:x.record?.date??null,version:x.record?.version??null,names:x.record?.names??null,job:x.record?.job??null,suggestions:x.record?Object.fromEntries(Object.entries(x.record.names).map(([k,v])=>[k,personMatch(all,v)])):null,annulment:x.annulment??null})),archive:plan.archiveChunks.map(x=>({hash:x.hash,counts:Object.fromEntries(Object.entries(x.records).map(([k,v])=>[k,v.length]))})),archive_error:plan.archiveError};
}
export async function buildHistoryEvents(db,a,f,p){
 assertImport(db,a);must(exact(f,['raw','token','selected','metadata','archive_hash'])&&Array.isArray(f.selected)&&Array.isArray(f.metadata)&&f.selected.length+f.metadata.length<=100&&(f.selected.length+f.metadata.length>0||typeof f.archive_hash==='string')&&(f.archive_hash===null||typeof f.archive_hash==='string'),400,'Выберите до 100 записей или пакет истории');
 verifyToken(p.stamp,f.token);
 const plan=p.plan,items=new Map(plan.items.filter(x=>x.record).map(x=>[x.record.id,x])),ids=new Set(),events=[],methods=new Map(),notes=[];
 const ps=new Set(people(db,a).map(x=>x.id)),rs=new Set(revisions(db,a).map(x=>x.id));
 const push=(entity_type,payload)=>{const e={id:uuid(),entity_type,entity_id:uuid(),operation:'create',expected_revision:0,payload,occurred_at:a.at};events.push(e);return e.entity_id};
 for(const s of f.selected){
  must(exact(s,['id','hash','mentor_id','auditor_id','trainee_id','revision_id'])&&!ids.has(s.id),400,'Неверное сопоставление');ids.add(s.id);
  const x=items.get(s.id);
  must(x?.status==='ready'&&x.hash===s.hash&&x.record.date<=a.day,409,'Запись RC1 изменилась или уже принята');
  const chosen=[s.mentor_id,s.auditor_id,...(s.trainee_id?[s.trainee_id]:[])];
  must(chosen.every(id=>ps.has(id))&&new Set(chosen).size===chosen.length&&(s.trainee_id===null||isId(s.trainee_id))&&(s.revision_id===null||rs.has(s.revision_id)),422,'Сопоставьте существующих разных сотрудников и известную редакцию СОП');
  const m=x.method,mid=m.existing?.target_id||methods.get(m.method.id)||push('checklist_version',{command:'import_rc1_method',format:'lean-audit-checklist-v1',method:m.method,source_sha256:m.hash});methods.set(m.method.id,mid);
  push('audit_session',{command:'import_rc1',record:x.record,source_sha256:x.hash,method_id:mid,mentor_id:s.mentor_id,auditor_id:s.auditor_id,trainee_id:s.trainee_id,revision_id:s.revision_id});if(x.annulment)notes.push(x.annulment);
 }
 for(const id of f.metadata){const x=items.get(id);must(!ids.has(id)&&x?.status==='metadata'&&x.annulment,409,'История аннулирования изменилась');ids.add(id);notes.push(x.annulment)}
 if(notes.length){const records={actions:[],cycles:[],changes:notes,mobileLog:[]};push('rc1_archive',{command:'archive_rc1',records,source_sha256:hash(records)})}
 if(f.archive_hash!==null){const x=plan.archiveChunks.find(x=>x.hash===f.archive_hash);must(x,409,'Пакет истории изменился');push('rc1_archive',{command:'archive_rc1',records:x.records,source_sha256:x.hash})}
 for(const e of events)await verifyRC1Event(e);
 return {events,stamp:p.stamp,imported:f.selected.length,metadata:f.metadata.length,archive:f.archive_hash!==null};
}
export function commitHistory(db,a,raw,prepared){
 assertImport(db,a);must(stamp(db,a,raw)===prepared.stamp,409,'База или полномочия изменились; повторите предпросмотр');
 for(const e of prepared.events){try{applyEvent(db,e)}catch(err){throw new PilotError(422,'Исторический RC1: '+String(err.message).slice(0,200))}a.audit('audit.history.import',e.id)}
 return {imported:prepared.imported,metadata:prepared.metadata,archive:prepared.archive};
}
