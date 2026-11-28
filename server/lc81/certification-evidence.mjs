// Training evidence, not an independent authorization, certificate or production
// instruction. The existing source registers remain authoritative. Before
// certification, supervised candidate practice can be documented separately.
import {one,rows,isId,uuid,canonical} from '../../src/core/db.js';
import {AUDIT_V03,SELF_V03,TWI_POLICY} from '../../src/modules/training/standard-v03.js';
import {auditRegistry,annualAuditCoverage} from '../../src/modules/training/audit-analytics.js';
import {progressFor,certificateValid,currentStandard} from '../../src/modules/training/training-facts.js';
import {personWorkResource,programResource} from './read-policy.mjs';
import {recordAccess} from './center-commands.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const txt=(s,n=1200)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const who=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
const name=(a,id)=>who(a,id)?.data.display_name??null;
const allowed=(a,k,id,r)=>!!r&&a.scope(k,id,r);
const site=(db,a,k)=>{const r=programResource(db);return !!r&&allowed(a,k,r.units[0],r)};
const hasTable=db=>!!one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='lc81_candidate_evidence'");
export const CANDIDATE_KINDS=Object.freeze({
 sop:'Участие в разработке / актуализации СОП',
 ji:'Практический инструктаж кандидата 1+3+4+1',
 app13:'Оценка действий кандидата · приложение 13',
 app14:'Подписанная самооценка кандидата · приложение 14',
 vt_full:'Внутреннее обучение по полному циклу TWI при ВТ',
 vt_exam:'Контрольное обучение TWI в присутствии комиссии',
 vt_interview:'Устное собеседование кандидата в ВТ'
});
const schema=`CREATE TABLE IF NOT EXISTS lc81_candidate_evidence(
 id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES person(id),
 kind TEXT NOT NULL CHECK(kind IN('sop','ji','app13','app14','vt_full','vt_exam','vt_interview')),
 held_on TEXT NOT NULL,revision_id TEXT REFERENCES document_revision(id),trainee_id TEXT REFERENCES person(id),
 actor_id TEXT NOT NULL REFERENCES person(id),credential_id TEXT NOT NULL REFERENCES mentor_credential(id),
 source_key TEXT NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),reference TEXT NOT NULL,
 recorded_at TEXT NOT NULL,voided_at TEXT,void_reason TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS ix_lc81_candidate_active ON lc81_candidate_evidence(person_id,kind,source_key) WHERE voided_at IS NULL;`;
function trainerCertificate(db,id,on){
 return rows(db,"SELECT id FROM mentor_credential WHERE person_id=? AND role='internal_trainer' AND kind='certificate' ORDER BY issued_on DESC,id",[id]).find(c=>certificateValid(db,c.id,on))?.id??null;
}
function candidateResource(db,id,day,dates=[],extra=[],ops=[]){
 const r=personWorkResource(db,[id,...extra],day,dates,ops);
 return r?{...r,self:id}:null;
}
function readable(db,a,id){
 return !!isId(id)&&!!who(a,id)&&allowed(a,'credential.read',id,candidateResource(db,id,a.day));
}
function canRegister(db,a,id,on=a.day,extra=[],ops=[]){
 return !!a.personId&&a.personId!==id&&!!trainerCertificate(db,a.personId,a.day)&&!!trainerCertificate(db,a.personId,on)&&
 readable(db,a,id)&&allowed(a,'credential.register',id,candidateResource(db,id,a.day,[on],extra,ops));
}
function revisionView(a,r){return r&&(a.read('sop.read_history',r.id)||a.read('sop.read_effective',r.id))?{id:r.id,label:r.code+' · v'+r.version_no+' · '+r.title,document_id:r.document_id,operation_id:r.operation_id}:null}
export function candidateOptions(db,a){
 must(a.permissions.includes('credential.read'),403,'Подготовка кандидатов недоступна');
 return {day:a.day,people:rows(db,'SELECT id,display_name FROM person WHERE archived=0 ORDER BY display_name,id').filter(p=>readable(db,a,p.id)).map(p=>({id:p.id,name:p.display_name}))};
}
function evidenceRows(db,a,id,from,to){
 if(!hasTable(db))return [];
 return rows(db,'SELECT * FROM lc81_candidate_evidence WHERE person_id=? AND held_on BETWEEN ? AND ? ORDER BY held_on DESC,recorded_at DESC,id DESC',[id,from,to]).flatMap(e=>{
  const r=e.revision_id&&currentStandard(db,e.revision_id),v=r&&revisionView(a,r);
  if(e.revision_id&&!v)return [];
  const resource=candidateResource(db,id,a.day,[e.held_on],[e.actor_id,...(e.trainee_id?[e.trainee_id]:[])],r?[r.operation_id]:[]);
  if(!allowed(a,'credential.read',id,resource))return [];
  const data=JSON.parse(e.payload_json);
  return [{id:e.id,kind:e.kind,day:e.held_on,revision:v,trainee:e.trainee_id?name(a,e.trainee_id):null,trainee_id:e.trainee_id,source_key:e.source_key,reference:e.reference,data,voided:!!e.voided_at,void_reason:e.void_reason,can_void:!e.voided_at&&e.actor_id===a.personId&&canRegister(db,a,id,e.held_on,[e.actor_id,...(e.trainee_id?[e.trainee_id]:[])],r?[r.operation_id]:[])}];
 });
}
function exactMethod(db,id,ref){
 const x=one(db,'SELECT methodology_json FROM checklist_version WHERE id=?',[id]);if(!x)return false;
 const m=JSON.parse(x.methodology_json);
 return m.format===ref.format&&canonical((m.criteria||[]).map(q=>[q.code,q.section,q.question]))===canonical(ref.criteria.map(q=>[q.code,q.section,q.question]))&&(!ref.levels||canonical(m.levels)===canonical(ref.levels));
}
const keyFor=(trainee,op,day)=>[trainee,op,day].join(':');
export function candidateEvidence(db,a,id,from,to){
 must(readable(db,a,id),404,'Кандидат недоступен');
 must(date(from)&&date(to)&&from<=to&&to<=a.day&&Date.parse(to)-Date.parse(from)<=366*86400000,400,'Укажите период подготовки до одного года');
 const saved=evidenceRows(db,a,id,from,to),actual=saved.filter(e=>!e.voided);
 const sop=new Map(),instructions=new Map();
 for(const x of rows(db,"SELECT id FROM document_revision WHERE author_id=? AND substr(created_at,1,10) BETWEEN ? AND ? AND state IN('effective','superseded') ORDER BY created_at,id",[id,from,to])){
  const v=revisionView(a,currentStandard(db,x.id));if(v)sop.set(v.document_id,{type:'sop',id:v.id,label:v.label,source:'Автор редакции'});
 }
 for(const e of actual.filter(x=>x.kind==='sop'))sop.set(e.revision.document_id,{type:'sop',id:e.revision.id,label:e.revision.label,source:'Подтверждённое участие'});
 const audits=auditRegistry(db).filter(x=>x.mentor_id===id&&x.state==='final'&&x.observed_at.slice(0,10)>=from&&x.observed_at.slice(0,10)<=to&&recordAccess(db,a,'audit',x.id)?.type==='audit');
 const corporate=audits.filter(x=>x.method_code==='TWI_L1_APP13'&&x.expected===17&&x.observed===17&&exactMethod(db,x.version_id,AUDIT_V03));
 for(const t of rows(db,"SELECT * FROM training_assignment WHERE mentor_id=? AND method_variant='classic' AND state<>'cancelled' AND source_sha256 IS NOT NULL",[id])){
  if(!recordAccess(db,a,'training',t.id))continue;
  const p=progressFor(db,t),start=p.facts.find(f=>f.stage_code==='prepare'&&f.result==='completed'),end=p.facts.find(f=>f.stage_code==='support'&&f.result==='completed'),on=end?.held_at.slice(0,10);
  if(!p.intro||!p.done.has('support')||!start||!end||on<from||on>to)continue;
  const day=start.held_at.slice(0,10),k=keyFor(t.trainee_id,t.operation_id,day);
  const observed=corporate.some(x=>x.assignment_id===t.id&&p.facts.some(f=>f.id===x.training_session_id&&f.held_at.slice(0,10)===x.observed_at.slice(0,10))&&trainerCertificate(db,x.auditor_id,x.observed_at.slice(0,10)));
  const label=revisionView(a,currentStandard(db,t.sop_revision_id))?.label??'Связанная операция';
  const old=instructions.get(k);instructions.set(k,{type:'training',id:t.id,day,label,observed:!!(observed||old?.observed),source:'Факты JI'});
 }
 for(const e of actual.filter(x=>x.kind==='ji')){
  const k=keyFor(e.trainee_id,e.revision.operation_id,e.day),old=instructions.get(k);
  if(!old)instructions.set(k,{type:null,id:e.id,day:e.day,label:e.revision.label,observed:e.data.present,source:'Документ практики кандидата'});
  else if(e.data.present)old.observed=true;
 }
 const evaluations=[...corporate.map(x=>({type:'audit',id:x.id,day:x.observed_at.slice(0,10),score:x.passed/17,source:'Приложение 13'})),
  ...actual.filter(x=>x.kind==='app13').map(e=>({type:null,id:e.id,day:e.day,score:e.data.answers.reduce((n,x)=>n+x,0)/17,source:'Подписанная оценка кандидата'}))].sort((x,y)=>y.day.localeCompare(x.day)||x.id.localeCompare(y.id));
 // On the latest date a conflicting/negative assessment must not be hidden.
 const latest=evaluations[0]&&evaluations.filter(x=>x.day===evaluations[0].day).sort((x,y)=>x.score-y.score)[0];
 const self=rows(db,'SELECT id,method_id,evaluated_on FROM mentor_self_evaluation WHERE person_id=? AND evaluated_on BETWEEN ? AND ? ORDER BY evaluated_on DESC,id',[id,from,to]).filter(x=>exactMethod(db,x.method_id,SELF_V03)&&recordAccess(db,a,'self',x.id)).map(x=>({type:'self',id:x.id,day:x.evaluated_on}));
 const certs=rows(db,"SELECT * FROM mentor_credential WHERE person_id=? AND role='instructor' AND kind='certificate' ORDER BY issued_on DESC,id",[id]).filter(x=>a.read('credential.read',x.id)&&certificateValid(db,x.id,a.day));
 const vt=Object.fromEntries(['vt_full','vt_exam','vt_interview'].map(k=>[k,actual.filter(x=>x.kind===k).length]));
 const allVisible=['credential.read','training.read','training.detail','audit.read','audit.detail','self.read','self.detail','sop.read_history'].every(k=>site(db,a,k));
 // The standard gives the annual count but not a deduplication rule for mixed
 // methods. Show a conservative corporate-only result, never combine scores.
 const year=to.slice(0,4);
 const norm=allVisible?annualAuditCoverage(db,year,a.day,{eligible:x=>x.method_code==='TWI_L1_APP13'&&x.expected===17&&x.observed===17&&exactMethod(db,x.version_id,AUDIT_V03)}).find(x=>x.personId===id):null;
 const rc=audits.filter(x=>x.method_code==='TWI_L1_RC1').length;
 const observed=[...instructions.values()].filter(x=>x.observed).length;
 const selfCount=self.length+actual.filter(x=>x.kind==='app14').length;
 const checks=[{label:'Разработанные / актуализированные СОП (разные документы)',required:2,actual:sop.size,ok:sop.size>=2},
  {label:'Классические практические инструктажи',required:7,actual:instructions.size,ok:instructions.size>=7},
  {label:'Из них в присутствии ВТ',required:2,actual:observed,ok:observed>=2},
  {label:'Последняя полная оценка приложения 13',required:'≥ 0,8',actual:latest?latest.score:null,ok:!!latest&&latest.score>=TWI_POLICY.certification.scoreMin,score:true},
  {label:'Самооценка приложения 14',required:1,actual:selfCount,ok:selfCount>0},
  {label:'Для ВТ: действующий сертификат инструктора',required:1,actual:certs.length?1:0,ok:!!certs.length,vt:true},
  ...[['vt_full','Для ВТ: внутреннее обучение при ВТ'],['vt_exam','Для ВТ: экзаменационное обучение при комиссии'],['vt_interview','Для ВТ: устное собеседование']].map(([k,label])=>({label,required:1,actual:vt[k],ok:vt[k]>0,vt:true}))];
 const can_record=canRegister(db,a,id),revisions=can_record?rows(db,"SELECT id FROM document_revision WHERE state IN('effective','superseded') ORDER BY created_at DESC,id").flatMap(x=>{
  const r=currentStandard(db,x.id),v=revisionView(a,r);return v&&canRegister(db,a,id,a.day,[],[r.operation_id])?[{id:v.id,label:v.label}]:[];
 }):[];
 const trainees=can_record?rows(db,'SELECT id,display_name name FROM person WHERE archived=0 ORDER BY display_name').filter(x=>x.id!==id&&x.id!==a.personId&&who(a,x.id)&&canRegister(db,a,id,a.day,[x.id])).map(x=>({id:x.id,name:x.name})):[];
 return {id,name:name(a,id),day:a.day,from,to,checks,all_visible:allVisible,can_record,revisions,trainees,kinds:CANDIDATE_KINDS,
  sops:[...sop.values()],instructions:[...instructions.values()],evaluations,self,saved,app13:AUDIT_V03.criteria.map(q=>q.question),app14:SELF_V03.criteria.map(q=>q.question),
  annual:norm?{year,required:norm.required,actual:norm.audits.length,remaining:norm.remaining,duplicates:norm.duplicates.length,unlinked:norm.unlinked.length}:null,rc1_in_period:rc};
}
export function recordCandidateEvidence(db,a,f){
 must(exact(f,['person_id','kind','held_on','reference','fields'])&&isId(f.person_id)&&Object.hasOwn(CANDIDATE_KINDS,f.kind)&&date(f.held_on)&&f.held_on<=a.day&&txt(f.reference)&&f.fields&&typeof f.fields==='object',400,'Укажите вид, фактическую дату и реквизиты документа');
 const k=f.kind,v=f.fields;let rev=null,trainee=null,key,data;
 if(k==='sop'||k==='ji'){
  must(exact(v,k==='sop'?['revision_id','contribution']:['revision_id','trainee_id','present','confirmed'])&&isId(v.revision_id),400,'Укажите подтверждённую редакцию СОП');
  rev=currentStandard(db,v.revision_id);
  must(rev&&['effective','superseded'].includes(rev.state)&&revisionView(a,rev),404,'Редакция недоступна');
  if(k==='sop'){
   must(txt(v.contribution),400,'Укажите вклад кандидата');key=rev.document_id;data={contribution:v.contribution};
  }else{
   must(isId(v.trainee_id)&&v.trainee_id!==f.person_id&&v.trainee_id!==a.personId&&who(a,v.trainee_id)&&typeof v.present==='boolean'&&v.confirmed===true,400,'Подтвердите полный классический инструктаж, ученика и участие ВТ');
   trainee=v.trainee_id;key=keyFor(trainee,rev.operation_id,f.held_on);data={present:v.present,confirmed:true};
  }
 }else if(k==='app13'||k==='app14'){
  const n=k==='app13'?17:16,max=k==='app13'?1:3;
  must(exact(v,['answers'])&&Array.isArray(v.answers)&&v.answers.length===n&&v.answers.every(x=>Number.isInteger(x)&&x>=0&&x<=max),400,'Заполните все критерии утверждённого приложения');
  data={answers:v.answers,method_sha256:(k==='app13'?AUDIT_V03:SELF_V03).source_sha256};key=f.held_on+':'+f.reference.trim().toLocaleLowerCase('ru-RU');
 }else{
  must(exact(v,['description'])&&txt(v.description),400,'Укажите состав участников / комиссии, содержание и подтверждённый итог');
  data={description:v.description};key=f.held_on+':'+f.reference.trim().toLocaleLowerCase('ru-RU');
 }
 must(canRegister(db,a,f.person_id,f.held_on,trainee?[trainee]:[],rev?[rev.operation_id]:[]),403,'Факт подготовки подтверждает другой уполномоченный сертифицированный ВТ в своей области');
 db.run(schema);
 must(!one(db,'SELECT id FROM lc81_candidate_evidence WHERE person_id=? AND kind=? AND source_key=? AND voided_at IS NULL',[f.person_id,k,key]),409,'Такое основание уже зарегистрировано');
 const id=uuid();db.run('INSERT INTO lc81_candidate_evidence(id,person_id,kind,held_on,revision_id,trainee_id,actor_id,credential_id,source_key,payload_json,reference,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[id,f.person_id,k,f.held_on,rev?.id??null,trainee,a.personId,trainerCertificate(db,a.personId,f.held_on),key,canonical(data),f.reference,a.at]);
 a.audit('credential.candidate_evidence',id);return {id};
}
export function voidCandidateEvidence(db,a,f){
 must(exact(f,['id','reason'])&&isId(f.id)&&txt(f.reason),400,'Укажите причину аннулирования');
 const e=hasTable(db)&&one(db,'SELECT * FROM lc81_candidate_evidence WHERE id=?',[f.id]),r=e?.revision_id&&currentStandard(db,e.revision_id);
 must(e&&!e.voided_at&&e.actor_id===a.personId&&canRegister(db,a,e.person_id,e.held_on,[e.actor_id,...(e.trainee_id?[e.trainee_id]:[])],r?[r.operation_id]:[]),403,'Аннулирование недоступно');
 db.run('UPDATE lc81_candidate_evidence SET voided_at=?,void_reason=? WHERE id=?',[a.at,f.reason,e.id]);a.audit('credential.candidate_evidence_void',e.id);return {id:e.id};
}
