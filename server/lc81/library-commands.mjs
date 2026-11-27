// Document commands over the existing LC3 domain. All scope/actor inputs come
// from the authenticated server, never from source JSON or the browser.
import {one,rows,isId,uuid,canonical,applyEvent} from '../../src/core/db.js';
import {sha256} from '../../src/core/primitives.js';
import {inspectSource,checkContent,validateRef,MAX_CONTENT} from '../../src/modules/library/domain.js';
import {linkedTwi,linkedFrv} from '../../src/modules/library/linked-materials.js';
import {frvSummary,draftFromFrv} from '../../src/modules/library/frv-summary.js';
import {documentTitle} from '../../src/modules/library/revision-title.js';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,msg)=>{if(!ok)throw new PilotError(status,msg)};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const clean=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export const CONTEXT_FIELDS=Object.freeze(['kind','command','id','revision_id','operation_id','origin_id','origin_revision']);
export const libraryReadAction=kind=>kind==='sop'?'sop.read_history':'frv.read';
const sourceOf=(row,field)=>{const p=JSON.parse(row[field]);return {source:validateRef(p.source),projection:p.projection}};
const opName=(db,id)=>one(db,'SELECT o.name,u.name unit FROM operation o JOIN org_unit u ON u.id=o.unit_id WHERE o.id=? AND o.archived=0 AND u.archived=0',[id]);
export function resolveLibraryContext(db,input,{read,allows,permissions,readScope,fullAllows=allows}){
 must(exact(input,CONTEXT_FIELDS)&&['sop','frv'].includes(input.kind)&&['create','save','revise'].includes(input.command),400,'Неверный контекст редактора');
 const {kind,command,id,revision_id,operation_id,origin_id,origin_revision}=input,creating=command==='create';
 must(isId(operation_id)&&read('operation.read',operation_id),403,'Операция недоступна');
 must(permissions.includes(libraryReadAction(kind)),403,'Нет доступа к библиотеке');
 must((origin_id===null&&origin_revision===null)||(kind==='sop'&&creating&&isId(origin_id)&&Number.isSafeInteger(origin_revision)&&origin_revision>0),400,'Неверная связь ФРВ');
 const operation=opName(db,operation_id);must(operation,403,'Операция недоступна');
 let row=null,rev=null,descriptor=null,origin=null,expected=0,title='',code='',observed_at='';
 if(creating){
  must(id===null&&revision_id===null&&readScope(kind,operation_id)&&allows(kind+'.create','operation.read',operation_id),403,'Нет права создавать документы для операции');
  title=operation.name;
  if(origin_id!==null){
   must(read('frv.read',origin_id)&&allows('sop.from_frv','frv.read',origin_id),403,'Исследование недоступно');
   const study=one(db,'SELECT * FROM frv_study WHERE id=?',[origin_id]);
   must(study&&study.state!=='archived'&&study.operation_id===operation_id&&study.rev===origin_revision,409,'Исследование изменилось или не соответствует операции');
   origin={study_id:origin_id,source_sha256:sourceOf(study,'context_json').source.sha256,descriptor:sourceOf(study,'context_json')};
  }
 }else if(kind==='sop'){
  must(isId(id)&&isId(revision_id)&&read('sop.read_history',revision_id),403,'Редакция недоступна');
  const action=command==='save'?'sop.edit_draft':'sop.revise';
  must(allows(action,'sop.read_history',revision_id),403,'Нет права на изменение редакции');
  row=one(db,"SELECT * FROM document WHERE id=? AND kind='sop' AND archived=0",[id]);
  rev=one(db,'SELECT * FROM document_revision WHERE id=? AND document_id=?',[revision_id,id]);
  must(row&&rev&&row.operation_id===operation_id,403,'Редакция недоступна');
  if(command==='save')must(rev.state==='draft',409,'Изменяется только черновик');
  else must(['effective','superseded','withdrawn'].includes(rev.state)&&!one(db,"SELECT id FROM document_revision WHERE document_id=? AND state IN ('draft','review','approved')",[id]),409,'Сначала завершите текущую редакцию');
  descriptor=sourceOf(rev,'payload_json');expected=row.rev;title=documentTitle(db,id,revision_id);code=row.code;
 }else{
  must(command==='save'&&isId(id)&&revision_id===null&&read('frv.read',id)&&allows('frv.edit_draft','frv.read',id),403,'Нет права на изменение ФРВ');
  row=one(db,'SELECT * FROM frv_study WHERE id=?',[id]);
  must(row&&row.operation_id===operation_id&&row.state==='draft',409,'Изменяется только черновик ФРВ');
  descriptor=sourceOf(row,'context_json');expected=row.rev;title=row.title;observed_at=row.observed_at;
 }
 const publicRevision=kind==='sop'&&command==='revise'&&!fullAllows('sop.revise','sop.read_history',revision_id);
 const publicOrigin=!!origin&&!fullAllows('sop.from_frv','frv.read',origin_id);
 return {input,expected,title,code,observed_at,operation,descriptor,origin,publicRevision,publicOrigin};
}
export function contextStamp(ctx){
 return canonical({input:ctx.input,expected:ctx.expected,source:ctx.descriptor?.source??null,origin:ctx.origin?{study_id:ctx.origin.study_id,source_sha256:ctx.origin.source_sha256}:null,publicRevision:ctx.publicRevision,publicOrigin:ctx.publicOrigin});
}
export async function checkedLibrarySource(descriptor,readFile){
 const text=await checkContent(descriptor.source,await readFile(descriptor.source));
 const inspected=await inspectSource(text,descriptor.source.kind);
 must(canonical(inspected.source)===canonical(descriptor.source)&&canonical(inspected.projection)===canonical(descriptor.projection),503,'Исходник и проекция не совпадают');
 return {text,raw:JSON.parse(text),...inspected};
}
// Shared revision preparation uses the verified visible document, not raw
// personnel snapshots, TWI personal fields or distinct unrendered photos.
const publicMeta=s=>Object.fromEntries(['branch','department','workplace','operation','sopNumber','safety','tools','material'].map(k=>[k,typeof s.meta?.[k]==='string'?s.meta[k]:'']));
async function signedDraft(base){
 const text=JSON.stringify({...base,integrity:{algorithm:'SHA-256',sha256:await sha256(JSON.stringify(base))}},null,2);await inspectSource(text,'sop');return text;
}
async function publicRevisionSource(raw){
 const s=raw.constructor,photoAssets={},steps=s.steps.map(v=>{
  if(v.hasPhoto){const a=raw.photoAssets[String(v.id)];photoAssets[String(v.id)]={original:a.rendered||a.original,rendered:a.rendered||a.original}}
  const f=v.frv||{};
  return {id:v.id,action:v.action,keyMoments:v.keyMoments,reason:v.reason,durationSeconds:v.durationSeconds,hasPhoto:v.hasPhoto,photoAnnotations:[],frv:{vdc:f.vdc===true,m1:typeof f.m1==='number'||typeof f.m1==='string'?f.m1:'',m2:typeof f.m2==='number'||typeof f.m2==='string'?f.m2:'',move:typeof f.move==='number'||typeof f.move==='string'?f.move:'',comment:'',autoFullStep:f.autoFullStep===true}};
 });
 return signedDraft({schemaVersion:2,document:{id:uuid(),number:'Черновик',status:'Черновик',version:1},constructor:{schemaVersion:4,meta:{...publicMeta(s),date:'',executor:'',approverPost:'',approverName:''},steps,description:typeof s.description==='string'?s.description:'',responsibles:[''],agreedList:[{post:'',name:''}],totalTimeSeconds:steps.reduce((n,v)=>n+v.durationSeconds,0),twi:{enabled:false}},photoAssets});
}
export async function sourceForEditor(ctx,readFile){
 if(ctx.origin){
  const data=await checkedLibrarySource(ctx.origin.descriptor,readFile),draft=await draftFromFrv(data.text);
  if(!ctx.publicOrigin)return draft.text;
  const raw=JSON.parse(draft.text),base={schemaVersion:raw.schemaVersion,document:raw.document,constructor:raw.constructor,photoAssets:raw.photoAssets};base.constructor.meta.executor='';
  return signedDraft(base);
 }
 if(!ctx.descriptor)return null;
 const data=await checkedLibrarySource(ctx.descriptor,readFile);
 return ctx.publicRevision?publicRevisionSource(data.raw):data.text;
}
export async function inspectLibraryText(kind,text){
 must(typeof text==='string'&&Buffer.byteLength(text,'utf8')<=MAX_CONTENT,413,'Исходник превышает 30 МБ');
 try{return await inspectSource(text,kind)}catch(e){throw new PilotError(422,'Исходник не прошёл проверку: '+String(e.message||'Неверный JSON').split('\n')[0].slice(0,220))}
}
function apply(db,event,audit,action){
 try{applyEvent(db,event)}catch(e){throw new PilotError(422,'Документ не прошёл проверку: '+String(e.message||'Неверная операция').split('\n')[0].slice(0,240))}
 audit(action,event.id);
}
export function saveLibrary(db,request,ctx,inspected,{at,audit}){
 must(exact(request,['request_id','context','expected_revision','title','code','observed_at','text'])&&Number.isSafeInteger(request.expected_revision)&&request.expected_revision===ctx.expected,409,'Документ изменился. Откройте актуальную редакцию.');
 const {kind,command,id,revision_id,operation_id}=ctx.input;
 must(clean(request.title,500),422,'Укажите название');
 must(kind==='sop'?request.observed_at===null&& (command==='create'?clean(request.code,200):request.code===null):request.code===null&&date(request.observed_at),422,'Заполните реквизиты документа');
 const entity_id=id||uuid(),eventId=uuid(),entity_type=kind==='sop'?'document':'frv_study';
 const payload={command,title:request.title.trim(),operation_id,source:inspected.source,projection:inspected.projection};
 if(kind==='sop'){
  if(command==='create')payload.code=request.code.trim();
  else payload.revision_id=command==='save'?revision_id:null;
 }else payload.observed_at=request.observed_at;
 const ev={id:eventId,entity_type,entity_id,operation:command==='create'?'create':'update',expected_revision:ctx.expected,payload,occurred_at:at};
 apply(db,ev,audit,kind+(command==='save'?'.edit_draft':'.'+command));
 if(ctx.origin){
  apply(db,{id:uuid(),entity_type:'document',entity_id,operation:'update',expected_revision:1,payload:{command:'origin',revision_id:eventId,study_id:ctx.origin.study_id,source_sha256:ctx.origin.source_sha256},occurred_at:at},audit,'sop.from_frv');
 }
 const current=one(db,'SELECT rev FROM '+entity_type+' WHERE id=?',[entity_id]);
 return {id:entity_id,revision_id:kind==='sop'?(command==='save'?revision_id:eventId):null,rev:current.rev,state:'draft',source_sha256:inspected.source.sha256};
}
export function passportLibrary(db,input,{read,allows,at,offsetMinutes=0,audit}){
 must(exact(input,['id','revision_id','expected_revision','print_format','changed_on'])&&isId(input.id)&&isId(input.revision_id)&&Number.isSafeInteger(input.expected_revision)&&date(input.changed_on)&&['portrait','landscape'].includes(input.print_format),400,'Неверные поля паспорта');
 must(read('sop.read_history',input.revision_id)&&allows('sop.passport','sop.read_history',input.revision_id),403,'Паспорт недоступен');
 const r=one(db,"SELECT d.id,d.rev FROM document d JOIN document_revision v ON v.document_id=d.id WHERE d.id=? AND d.archived=0 AND v.id=? AND v.state='draft'",[input.id,input.revision_id]);
 must(r?.rev===input.expected_revision,409,'Документ изменился или не является черновиком');
 apply(db,{id:uuid(),entity_type:'document',entity_id:r.id,operation:'update',expected_revision:r.rev,payload:{command:'passport',revision_id:input.revision_id,print_format:input.print_format,changed_on:input.changed_on,business_offset_minutes:offsetMinutes},occurred_at:at},audit,'sop.passport');
 return {id:r.id,revision_id:input.revision_id,rev:r.rev+1};
}
export function finalizeLibrary(db,input,{read,allows,personId,at,audit}){
 must(exact(input,['id','expected_revision','note'])&&isId(input.id)&&Number.isSafeInteger(input.expected_revision)&&typeof input.note==='string'&&input.note.length<=2000,400,'Неверные поля завершения');
 must(isId(personId)&&read('frv.read',input.id)&&allows('frv.finalize','frv.read',input.id),403,'Требуется полномочие сотрудника');
 const r=one(db,"SELECT id,rev FROM frv_study WHERE id=? AND state='draft'",[input.id]);
 must(r?.rev===input.expected_revision,409,'Исследование изменилось или завершено');
 apply(db,{id:uuid(),entity_type:'frv_study',entity_id:r.id,operation:'update',expected_revision:r.rev,payload:{command:'finalize',actor_id:personId,note:input.note.trim()},occurred_at:at},audit,'frv.finalize');
 return {id:r.id,rev:r.rev+1,state:'final'};
}
export function detailDescriptor(db,action,id,{read,allows}){
 const spec={'sop.read_public':['sop.read_effective','document_revision','payload_json'],'sop.read_twi':['sop.read_effective','document_revision','payload_json'],'sop.read_linked_frv':['sop.read_effective','document_revision','payload_json'],'frv.read_summary':['frv.read','frv_study','context_json']}[action];
 must(spec&&isId(id)&&read(spec[0],id)&&allows(action,spec[0],id),404,'Материал недоступен');
 const r=one(db,'SELECT '+spec[2]+' FROM '+spec[1]+' WHERE id=?',[id]);
 must(r,404,'Материал недоступен');return sourceOf(r,spec[2]);
}
export function projectLibraryDetail(action,raw){
 if(action==='sop.read_public')return {meta:publicMeta(raw.constructor),description:typeof raw.constructor.description==='string'?raw.constructor.description:''};
 if(action==='sop.read_twi'){const {exists,filled,status,outdated,fields}=linkedTwi(raw.constructor);return {exists,filled,status,outdated,fields}}
 if(action==='sop.read_linked_frv'){const {rows,totals,invalid,exists}=linkedFrv(raw.constructor);return {rows,totals,invalid,exists,source:'linked_sop_not_measured'}}
 if(action==='frv.read_summary')return {...frvSummary(raw),source:'measured_frv'};
 throw new PilotError(404,'Материал недоступен');
}
