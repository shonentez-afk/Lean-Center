// Import original RC1 records, not inferred qualifications or invented training facts.
import {rows,one,invariant,isId,canonical,sha256} from '../../core/db.js';
import {validDate} from '../library/sop-review.js';
import {RC1_CRITERIA} from './builtin-forms.js';
const system='TWI_RC1',object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const str=(x,n=2000)=>typeof x==='string'&&x.length<=n;
const req=(x,n=2000)=>str(x,n)&&x.trim().length>0;
const exact=(p,ks)=>invariant(object(p)&&Object.keys(p).length===ks.length&&ks.every(k=>Object.hasOwn(p,k)),'Некорректные поля импорта RC1');
const insert=(db,t,p)=>db.run('INSERT INTO '+t+'('+Object.keys(p).join(',')+') VALUES('+Object.keys(p).map(()=>'?').join(',')+')',Object.values(p));
export const rc1Mapping=(db,type,id)=>one(db,'SELECT * FROM legacy_mapping WHERE source_system=? AND source_entity=? AND source_id=?',[system,type,id]);
const link=(db,type,id,target,tid,hash)=>insert(db,'legacy_mapping',{source_system:system,source_entity:type,source_id:id,target_entity:target,target_id:tid,source_hash:hash});
export const isRC1Import=e=>['import_rc1_method','import_rc1'].includes(e.payload?.command)&&['checklist_version','audit_session'].includes(e.entity_type);
const methodShape=m=>{
 exact(m,['id','keys','criteria']);
 invariant(req(m.id,160)&&Array.isArray(m.keys)&&Array.isArray(m.criteria)&&m.keys.length===m.criteria.length&&m.keys.length>0&&m.keys.length<=100&&new Set(m.keys).size===m.keys.length&&m.keys.every(k=>req(k,160)),'Некорректная версия чек-листа RC1');
 for(let i=0;i<m.criteria.length;i++){const q=m.criteria[i];exact(q,['code','section','question','recommendation']);invariant(q.code===i+1&&req(q.section,100)&&req(q.question,2500)&&str(q.recommendation,2500),'Некорректный критерий RC1')}
 return m
};
export const builtinRC1Method=()=>({id:'ji-l1-v1',keys:RC1_CRITERIA.map(q=>q.rc1_id),criteria:RC1_CRITERIA.map(({rc1_id,...q})=>q)});
function oldMethod(id,steps){invariant(Array.isArray(steps)&&steps.length>0&&steps.length<=100,'Отсутствуют исходные критерии '+id);const keys=[],criteria=[];for(const s of steps){invariant(object(s)&&Array.isArray(s.criteria),'Некорректный раздел RC1');for(const c of s.criteria){keys.push(c.id);criteria.push({code:criteria.length+1,section:s.title,question:c.text,recommendation:c.localRecommendation||''})}}return methodShape({id,keys,criteria})}
function normalizeAudit(raw,defaultVersion){
 invariant(object(raw)&&req(raw.id,180)&&(raw.level===undefined||raw.level===1),'Некорректный идентификатор или уровень RC1');
 const names={mentor:raw.instructor?.name||'',auditor:raw.trainer?.name||'',trainee:raw.trainee?.name||''},ids={mentor:raw.instructor?.id||'',auditor:raw.trainer?.id||'',trainee:raw.trainee?.id||''},responses=[];
 invariant(object(raw.responses),'Нет ответов аудита '+raw.id);
 for(const [key,r] of Object.entries(raw.responses)){invariant(object(r),'Некорректный ответ '+key);responses.push({key,value:r.value===undefined?null:r.value,note:r.note||''})}
 responses.sort((a,b)=>a.key.localeCompare(b.key,'en'));
 return recordShape({id:raw.id,version:raw.checklistVersion||defaultVersion,date:raw.date,status:raw.status||'active',revision:raw.revision||1,names,ids,job:raw.job?.name||'',responses,feedback:raw.improvementComment||''})
}
function recordShape(x){
 exact(x,['id','version','date','status','revision','names','ids','job','responses','feedback']);exact(x.names,['mentor','auditor','trainee']);exact(x.ids,['mentor','auditor','trainee']);
 invariant(req(x.id,180)&&req(x.version,160)&&validDate(x.date)&&['active','annulled'].includes(x.status)&&Number.isSafeInteger(x.revision)&&x.revision>0&&req(x.names.mentor,500)&&req(x.names.auditor,500)&&str(x.names.trainee,500)&&Object.values(x.ids).every(v=>str(v,180))&&str(x.job,1000)&&str(x.feedback,10000)&&Array.isArray(x.responses)&&x.responses.length<=100,'Некорректный аудит RC1');
 const seen=new Set();for(const a of x.responses){exact(a,['key','value','note']);invariant(req(a.key,160)&&!seen.has(a.key)&&(a.value===null||typeof a.value==='number'&&Number.isFinite(a.value)&&a.value>=0&&a.value<=1)&&str(a.note,2000),'Некорректная историческая оценка');seen.add(a.key)}return x
}
export async function rc1Plan(db,raw){
 invariant(object(raw)&&Array.isArray(raw.audits)&&raw.audits.length<=1000,'Ожидается база RC1 v2/v3 или мобильный пакет до 1000 аудитов');
 const mobile=raw.type==='twi-audit-transfer'&&raw.schemaVersion===1;
 invariant(mobile||[2,3].includes(raw.schemaVersion),'Неподдерживаемый формат RC1');
 const methods=new Map(),rd=raw.referenceData||{},definitions=Array.isArray(rd.checklists)?rd.checklists:[];
 for(const v of definitions){invariant(!methods.has(v.id),'Повтор версии RC1');methods.set(v.id,oldMethod(v.id,v.steps))}
 if(!definitions.length&&Array.isArray(rd.steps)&&rd.steps.length){const id=rd.checklistVersion||'ji-l1-v1';methods.set(id,oldMethod(id,rd.steps))}
 if(!methods.has('ji-l1-v1'))methods.set('ji-l1-v1',builtinRC1Method());
 for(const v of rows(db,"SELECT * FROM legacy_mapping WHERE source_system='TWI_RC1' AND source_entity='method'"))if(!methods.has(v.source_id)){const m=one(db,'SELECT legacy_context_json FROM checklist_version WHERE id=?',[v.target_id]);if(m?.legacy_context_json)methods.set(v.source_id,methodShape(JSON.parse(m.legacy_context_json)))}
 const versionPlans=new Map();for(const m of methods.values()){const hash=await sha256(canonical(m)),existing=rc1Mapping(db,'method',m.id);versionPlans.set(m.id,{method:m,hash,existing,conflict:!!existing&&existing.source_hash!==hash})}
 const seen=new Set(),items=[];
 for(const a of raw.audits){try{const record=normalizeAudit(a,rd.checklistVersion||'ji-l1-v1');invariant(!seen.has(record.id),'Повтор ID внутри файла');seen.add(record.id);const hash=await sha256(canonical(record)),existing=rc1Mapping(db,'audit',record.id),method=versionPlans.get(record.version);invariant(method&&!method.conflict,'Не найдена точная версия методики '+record.version+' или её содержание изменилось');invariant(record.responses.every(r=>method.method.keys.includes(r.key)),'В ответах есть критерии другой версии');items.push({record,hash,method,existing,status:existing?(existing.source_hash===hash?'duplicate':'conflict'):'ready'})}catch(e){items.push({record:null,status:'invalid',error:e.message})}}
 return {mobile,items,extra:{actions:Array.isArray(raw.correctiveActions)?raw.correctiveActions.length:0,cycles:Array.isArray(raw.auditCycles)?raw.auditCycles.length:0,changes:Array.isArray(raw.auditChangeLog)?raw.auditChangeLog.length:0}}
}
export function personMatch(people,name){const key=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU'),matches=people.filter(p=>key(p.display_name)===key(name));return name&&matches.length===1?matches[0].id:''}
export async function verifyRC1Event(e){if(!isRC1Import(e))return;const p=e.payload;invariant(await sha256(canonical(p.command==='import_rc1_method'?methodShape(p.method):recordShape(p.record)))===p.source_sha256,'Контрольная сумма исходной записи RC1 не совпадает')}
export function applyRC1Event(db,e,old){
 const p=e.payload,id=e.entity_id;invariant(e.operation==='create'&&!old&&/^[0-9a-f]{64}$/.test(p.source_sha256),'Импорт RC1 создаёт только новую историческую запись');
 if(p.command==='import_rc1_method'){
  exact(p,['command','format','method','source_sha256']);invariant(e.entity_type==='checklist_version'&&p.format==='lean-audit-checklist-v1','Неверный тип методики');const m=methodShape(p.method);invariant(!rc1Mapping(db,'method',m.id),'Версия RC1 уже импортирована');
  let c=one(db,"SELECT * FROM checklist WHERE code='TWI_L1_RC1'");if(!c){c={id};insert(db,'checklist',{id,code:'TWI_L1_RC1',name:'Аудит 1-го уровня'})}
  const num=one(db,'SELECT coalesce(max(version_no),0) n FROM checklist_version WHERE checklist_id=?',[c.id]).n+1;
  const method={format:p.format,title:'RC1 · историческая версия '+m.id,source_sha256:p.source_sha256,criteria:m.criteria};
  insert(db,'checklist_version',{id,checklist_id:c.id,version_no:num,state:'draft',methodology_json:canonical(method),legacy_context_json:canonical(m),rev:1});m.criteria.forEach(q=>insert(db,'checklist_criterion',{id:id+':'+q.code,version_id:id,code:String(q.code),section_code:q.section,position:q.code,question:q.question}));db.run("UPDATE checklist_version SET state='retired' WHERE id=?",[id]);link(db,'method',m.id,'checklist_version',id,p.source_sha256);return
 }
 exact(p,['command','record','source_sha256','method_id','mentor_id','auditor_id','trainee_id','revision_id']);invariant(e.entity_type==='audit_session','Неверный тип аудита');const a=recordShape(p.record),map=rc1Mapping(db,'method',a.version);
 invariant(!rc1Mapping(db,'audit',a.id)&&map?.target_id===p.method_id,'Аудит уже импортирован или не сопоставлена методика');
 const day=new Date(Date.parse(e.occurred_at)+14*3600000).toISOString().slice(0,10);invariant(a.date<=day,'Дата исторического аудита в будущем');
 for(const x of [p.mentor_id,p.auditor_id,...(p.trainee_id?[p.trainee_id]:[])])invariant(isId(x)&&one(db,'SELECT id FROM person WHERE id=?',[x]),'Сопоставьте существующего сотрудника');invariant(p.mentor_id!==p.auditor_id&&(!p.trainee_id||![p.mentor_id,p.auditor_id].includes(p.trainee_id)),'Роли аудита должны быть сопоставлены разным людям');
 const v=one(db,'SELECT * FROM checklist_version WHERE id=?',[p.method_id]),m=methodShape(JSON.parse(v.legacy_context_json)),answers=new Map(a.responses.map(x=>[x.key,x]));invariant(a.responses.every(x=>m.keys.includes(x.key)),'Неизвестные критерии исторической методики');
 const revision=p.revision_id?one(db,"SELECT r.id,d.operation_id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.kind='sop' AND r.state IN('effective','superseded','withdrawn')",[p.revision_id]):null;invariant(!p.revision_id||revision,'Укажите известную историческую редакцию СОП или оставьте без связи');
 insert(db,'audit_session',{id,version_id:p.method_id,mentor_id:p.mentor_id,auditor_id:p.auditor_id,trainee_id:p.trainee_id||null,operation_id:revision?.operation_id||null,standard_revision_id:revision?.id||null,observed_at:a.date,state:'draft',recorded_names_json:canonical(a.names),summary:a.feedback,recorded_at:e.occurred_at,legacy_context_json:canonical(a),rev:1});
 m.keys.forEach((k,i)=>{const x=answers.get(k);if(!x||x.value===null)return;const criterion=p.method_id+':'+(i+1);insert(db,'audit_response',{id:id+':'+criterion,audit_id:id,version_id:p.method_id,criterion_id:criterion,response:x.value===1?'yes':x.value===0?'no':'legacy',legacy_score:x.value>0&&x.value<1?x.value:null,note:x.note})});
 db.run('UPDATE audit_session SET state=?,void_reason=? WHERE id=?',[a.status==='annulled'?'void':'final',a.status==='annulled'?'Аннулирован в исходном RC1; причина не перенесена':null,id]);link(db,'audit',a.id,'audit_session',id,p.source_sha256)
}
