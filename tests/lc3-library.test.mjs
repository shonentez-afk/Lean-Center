import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {configureMigrations,createDb,openDb,bytesOf,Workspace,meta,rows,one,uuid,now,sha256,canonical,setMeta,prepareSnapshot,readSnapshot,restore,encode,backup,mergePackage} from '../src/core/db.js';
import {inspectSource,refsForDb,refsForEvents,unionRefs,checkContent} from '../src/modules/library/domain.js';
import {ContentStore,makeTransfer,unpackTransfer,restoreContents} from '../src/modules/library/content.js';
import * as net from '../src/storage/network.js';
const SQL=await initSqlJs(),schema=fs.readFileSync('db/schema_v1.sql','utf8'),m2=fs.readFileSync('db/migrations/002_lc1.sql','utf8'),m3=fs.readFileSync('db/migrations/003_lc2.sql','utf8'),m4=fs.readFileSync('db/migrations/004_lc3.sql','utf8');
configureMigrations(m3,m4,fs.readFileSync('db/migrations/005_lc3_requirements.sql','utf8'),fs.readFileSync('db/migrations/006_stage43_checklist.sql','utf8'));
const fresh=()=>new Workspace(SQL,createDb(SQL,schema,m2));
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4jkAAAAASUVORK5CYII=';
async function sop(action='Проверка',photo=true){
 const p={schemaVersion:2,document:{id:'SOP-original',status:'Опубликован',number:'15.1.2026 1',version:1},constructor:{schemaVersion:4,meta:{operation:'Проверка стенда'},steps:[{id:1,action,keyMoments:['Безопасность'],reason:'Не допустить ошибку',durationSeconds:15,hasPhoto:photo,photoAnnotations:[]}],twi:{enabled:true,trainer:'Учебный'}},photoAssets:photo?{'1':{original:image,rendered:null,ext:'png',annotations:[]}}:{}};
 const text=JSON.stringify({...p,integrity:{algorithm:'SHA-256',sha256:await sha256(JSON.stringify(p))}},null,2);
 return {text,...await inspectSource(text,'sop')}
}
async function frv(){const text=JSON.stringify({schemaVersion:'FRV-1.3',study:{libraryId:'original-FRV',studyId:'F-1',operationId:'Проверка',status:'Draft'},cycles:[{id:'c1',phase:'baseline',observations:[{id:'o1',actionRaw:'Проверить',valueType:'VA',durationSec:8},{id:'o2',actionRaw:'Подготовить',valueType:'NVA_Necessary',durationSec:2}]},{id:'c2',phase:'improved',observations:[{id:'o3',actionRaw:'Ожидание',valueType:'WAIT',durationSec:null}]}]});return {text,...await inspectSource(text,'frv')}}
const readFrom=(...sources)=>async ref=>sources.find(s=>s.source.sha256===ref.sha256)?.text;
function event(w,type,id,payload,operation){const row=id?one(w.working,'SELECT rev FROM '+type+' WHERE id=?',[id]):null;return {id:uuid(),entity_type:type,entity_id:id||uuid(),operation:operation||(id?'update':'create'),expected_revision:row?.rev||0,payload,occurred_at:now()}}
const projection=s=>({source:s.source,projection:s.projection});
function masters(w){const u=w.edit('org_unit',null,{code:'U',name:'Цех',kind:'Цех',parent_id:null}),workplace=w.edit('workplace',null,{unit_id:u,code:'WP',name:'Учебное место'}),op=w.edit('operation',null,{unit_id:u,equipment_id:null,workplace_id:workplace,code:'OP',name:'Проверка',criticality:'normal'}),p=w.edit('person',null,{employee_code:'1',display_name:'Учебный согласующий'});return {op,p}}
function createDoc(w,s,op=null){return event(w,'document',null,{command:'create',code:'SOP-1',title:'Проверка',operation_id:op,...projection(s)})}
async function passport(w,id,rev){await w.applyContentEvents([event(w,'document',id,{command:'passport',revision_id:rev,print_format:'portrait',changed_on:'2026-11-20'})])}
async function action(w,doc,rev,actor,cmd,note=''){const e=event(w,'document',doc,{command:cmd,revision_id:rev,actor_id:actor,note});await w.applyContentEvents([e]);return e}
test('source portable integrity, exact bytes, photo/TWI and tamper checks',async()=>{const s=await sop();assert.equal(s.projection.photos,1);assert.equal(s.projection.twi,true);assert.equal(s.projection.steps[0].seconds,15);assert.equal(await checkContent(s.source,s.text),s.text);await assert.rejects(inspectSource(s.text.replace('Проверка','Подмена'),'sop'),/сумма/);const p=JSON.parse(s.text);delete p.photoAssets['1'];const {integrity,...body}=p;p.integrity.sha256=await sha256(JSON.stringify(body));await assert.rejects(inspectSource(JSON.stringify(p),'sop'),/фото/);await assert.rejects(checkContent(s.source,s.text+' '),/повреждён/)});
test('draft, review, approval, effective and next version: no mutation of history',async()=>{const w=fresh(),{op,p}=masters(w),s=await sop(),d=createDoc(w,s,op),id=d.entity_id,rev=d.id;await w.applyContentEvents([d],readFrom(s));assert.equal(one(w.working,'SELECT state FROM document_revision').state,'draft');assert.equal(one(w.working,'SELECT action_text FROM document_step').action_text,'Проверка');assert.equal(refsForDb(w.working)[0].sha256,s.source.sha256);await assert.rejects(w.applyContentEvents([event(w,'document',id,{command:'effect',revision_id:rev,actor_id:p,note:''})]),/переход/);await passport(w,id,rev);await action(w,id,rev,p,'submit');await action(w,id,rev,p,'return','Уточнить');await action(w,id,rev,p,'submit');await action(w,id,rev,p,'approve');await action(w,id,rev,p,'effect');const s2=await sop('Новая инструкция');await assert.rejects(w.applyContentEvents([event(w,'document',id,{command:'save',revision_id:rev,title:'Проверка',operation_id:op,...projection(s2)})],readFrom(s2)),/черновик/);const e=event(w,'document',id,{command:'revise',revision_id:null,title:'Проверка',operation_id:op,...projection(s2)});await w.applyContentEvents([e],readFrom(s2));await passport(w,id,e.id);await action(w,id,e.id,p,'submit');await action(w,id,e.id,p,'approve');await action(w,id,e.id,p,'effect');assert.deepEqual(rows(w.working,'SELECT state FROM document_revision ORDER BY version_no').map(x=>x.state),['superseded','effective']);assert.equal(one(w.working,'SELECT action_text FROM document_step WHERE revision_id=?',[rev]).action_text,'Проверка');assert.equal(refsForDb(w.working).length,2);assert.equal(rows(w.working,'SELECT * FROM document_approval').length,3);assert.throws(()=>w.edit('operation',op,null,'archive'),/документами/);await w.acceptOwn(readFrom(s,s2));assert.equal(w.pending.length,0)});
test('content is mandatory and projection is verified before atomic batch; duplicate source events safe',async()=>{const w=fresh(),s=await sop(),d=createDoc(w,s);await assert.rejects(w.applyContentEvents([d]),/комплект/);const fake=structuredClone(d);fake.payload.projection.steps[0].action='Forged';await assert.rejects(w.applyContentEvents([fake],readFrom(s)),/Проекция/);assert.equal(one(w.working,'SELECT count(*) n FROM document').n,0);await w.applyContentEvents([d],readFrom(s));const pkg=await w.package();const publisher=new Workspace(SQL,openDb(SQL,bytesOf(w.base)));await assert.rejects(publisher.accept(pkg),/комплект/);assert.equal((await publisher.accept(pkg,readFrom(s))).count,1);assert.equal((await publisher.accept(pkg)).duplicate,true);assert.equal(one(publisher.base,'SELECT count(*) n FROM document').n,1);assert.equal(one(publisher.base,'SELECT count(*) n FROM attachment').n,1)});
test('FRV independent cycles: unknown durations are not converted to zero; final immutable',async()=>{const w=fresh(),{op,p}=masters(w),s=await frv(),d=event(w,'frv_study',null,{command:'create',title:'Исследование',operation_id:op,observed_at:'2026-11-20',...projection(s)});assert.equal(s.projection.complete,1);assert.equal(s.projection.unmeasured,1);await w.applyContentEvents([d],readFrom(s));assert.equal(one(w.working,'SELECT sum(duration_seconds) n FROM frv_measurement').n,10);assert.equal(one(w.working,'SELECT count(*) n FROM frv_measurement').n,2);await w.applyContentEvents([event(w,'frv_study',d.entity_id,{command:'finalize',actor_id:p,note:''})]);assert.equal(one(w.working,'SELECT state FROM frv_study').state,'final');await assert.rejects(w.applyContentEvents([event(w,'frv_study',d.entity_id,{command:'save',title:'Подмена',operation_id:op,observed_at:'2026-11-20',...projection(s)})],readFrom(s)),/черновик/);await w.acceptOwn(readFrom(s))});
test('v3 database migrates without replacing the master rows or publication ID',async()=>{const db=new SQL.Database();db.run(schema);db.run(m2);db.run(m3);setMeta(db,'database_id',uuid());const id=uuid();db.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[id,'0004','История']);const old=bytesOf(db);const n=openDb(SQL,old);assert.equal(meta(n,'schema_version'),'6');assert.equal(one(n,'SELECT id FROM person').id,id);assert.equal(meta(db,'schema_version'),'3');assert.deepEqual(rows(n,'PRAGMA foreign_key_check'),[])});
test('complete manual backup: raw assets included, restore requires full checked set',async()=>{const w=fresh(),s=await sop(),d=createDoc(w,s);await w.applyContentEvents([d],readFrom(s));const b=await makeTransfer('backup',await backup(w),unionRefs(refsForDb(w.base),refsForEvents(w.pending)),readFrom(s));const {payload,contents}=unpackTransfer(b,'backup'),store=new ContentStore(()=>null,()=>null);assert.equal(contents[0].text,s.text);await assert.rejects(restoreContents([],refsForEvents(w.pending),()=>{}),/Неполный/);await restoreContents(contents,refsForEvents(w.pending),(r,t)=>store.put(r,t));const next=await restore(SQL,payload,r=>store.get(r));assert.equal(one(next.working,'SELECT count(*) n FROM document').n,1);assert.equal(await store.get(s.source),s.text);const tampered=structuredClone(contents);tampered[0].text+=' ';await assert.rejects(restoreContents(tampered,refsForEvents(w.pending),()=>{}),/повреждён/)});
const missing=()=>Object.assign(new Error('missing'),{name:'NotFoundError'});
class FileHandle{constructor(){this.kind='file';this.data=new Uint8Array()}async getFile(){return new Blob([this.data])}async createWritable(){let data;return {write:async d=>{data=typeof d==='string'?new TextEncoder().encode(d):new Uint8Array(d)},close:async()=>{this.data=data},abort:async()=>{}}}}
class Folder{constructor(){this.kind='directory';this.files=new Map()}async queryPermission(){return 'granted'}async requestPermission(){return 'granted'}async getFileHandle(n,{create=false}={}){if(!this.files.has(n)){if(!create)throw missing();this.files.set(n,new FileHandle())}const f=this.files.get(n);assert.equal(f.kind,'file');return f}async getDirectoryHandle(n,{create=false}={}){if(!this.files.has(n)){if(!create)throw missing();this.files.set(n,new Folder())}const f=this.files.get(n);assert.equal(f.kind,'directory');return f}async *entries(){yield* this.files.entries()}}
test('network files precede package and snapshot, two clients read exact source; corrupted content blocks publish',async()=>{const dir=new Folder(),master=fresh(),first=await prepareSnapshot(master);await net.publishSnapshot(dir,SQL,first);master.replaceBase((await net.latestSnapshot(dir,SQL)).db);const client=new Workspace(SQL,(await net.latestSnapshot(dir,SQL)).db),s=await sop(),e=createDoc(client,s);await client.applyContentEvents([e],readFrom(s));const p=await client.package();await assert.rejects(net.sendPackage(dir,p),/Нет исходного/);await net.sendPackage(dir,p,readFrom(s));assert.equal(await net.readContent(dir,s.source),s.text);assert.equal((await master.accept(p,r=>net.readContent(dir,r))).count,1);const next=await prepareSnapshot(master);await net.publishSnapshot(dir,SQL,next,r=>net.readContent(dir,r));client.replaceBase((await net.latestSnapshot(dir,SQL)).db);assert.equal(client.pending.length,0);assert.equal(refsForDb(client.base)[0].sha256,s.source.sha256);const content=(await dir.getDirectoryHandle('Documents')).files.get(s.source.sha256+'.json');content.data[0]^=1;await assert.rejects(net.readContent(dir,s.source));master.replaceBase((await net.latestSnapshot(dir,SQL)).db);const third=await prepareSnapshot(master);await assert.rejects(net.publishSnapshot(dir,SQL,third));assert.equal((await net.latestSnapshot(dir,SQL)).manifest.id,next.manifest.id)});

import {reviewDue,validateChecklist,sopMethods,sopCriteria,evaluationResult} from '../src/modules/library/sop-review.js';
import {frvSummary,draftFromFrv} from '../src/modules/library/frv-summary.js';
test('passport is required for review, has calendar-year review due, and is invalidated on content edit',async()=>{
 const w=fresh(),{op,p}=masters(w),s=await sop(),d=createDoc(w,s,op);
 await w.applyContentEvents([d],readFrom(s));await assert.rejects(action(w,d.entity_id,d.id,p,'submit'),/паспорт/);
 assert.equal(reviewDue('2024-02-29'),'2025-02-28');assert.throws(()=>reviewDue('2025-02-29'));
 await passport(w,d.entity_id,d.id);
 const v=one(w.working,'SELECT * FROM document_revision WHERE id=?',[d.id]);
 assert.equal(v.review_due,'2027-11-20');assert(v.workplace_id);assert.equal(v.workplace_name,'Учебное место');
 const s2=await sop('Новая проверка');
 await w.applyContentEvents([event(w,'document',d.entity_id,{command:'save',revision_id:d.id,title:'Проверка',operation_id:op,...projection(s2)})],readFrom(s2));
 assert.equal(one(w.working,'SELECT review_due FROM document_revision WHERE id=?',[d.id]).review_due,null);
 await assert.rejects(action(w,d.entity_id,d.id,p,'submit'),/паспорт/);
});
test('SOP assessment separate versioned 20-criterion methodology; unanswered is not zero; complete result is immutable',async()=>{
 const w=fresh(),{op,p}=masters(w),s=await sop(),d=createDoc(w,s,op);
 await w.applyContentEvents([d],readFrom(s));
 const m={format:'lean-sop-checklist-v1',title:'Учебная форма',source_sha256:'a'.repeat(64),criteria:Array.from({length:20},(_,i)=>({code:i+1,question:'Учебный критерий '+(i+1)}))};
 assert.throws(()=>validateChecklist({...m,criteria:m.criteria.slice(0,19)}),/20/);
 const me=event(w,'checklist_version',null,m);await w.applyContentEvents([me]);
 assert.equal(sopMethods(w.working).length,1);await assert.rejects(w.applyContentEvents([event(w,'checklist_version',null,m)]),/уже загружена/);
 const qs=sopCriteria(w.working,me.entity_id),responses=qs.map((q,i)=>({criterion_id:q.id,value:i<17?1:0,note:''}));
 assert.equal(evaluationResult(responses.slice(0,19)).fraction,null);assert.equal(evaluationResult(responses).fraction,.85);
 const payload={revision_id:d.id,method_id:me.entity_id,actor_id:p,evaluated_on:'2026-11-20',place:'Учебное место',source_sha256:s.source.sha256,responses};
 await assert.rejects(w.applyContentEvents([event(w,'sop_evaluation',null,{...payload,responses:responses.slice(0,19)})]),/20/);
 await assert.rejects(w.applyContentEvents([event(w,'sop_evaluation',null,{...payload,source_sha256:'b'.repeat(64)})]),/изменились/);
 const ev=event(w,'sop_evaluation',null,payload);await w.applyContentEvents([ev]);assert.equal(one(w.working,'SELECT count(*) n FROM sop_evaluation_response').n,20);
 await assert.rejects(w.applyContentEvents([event(w,'sop_evaluation',ev.entity_id,payload)]),/неизменяема/);
 await w.applyContentEvents([event(w,'checklist_version',null,{...m,source_sha256:'b'.repeat(64),criteria:m.criteria.map(q=>({...q,question:q.question+' v2'}))})]);
 assert.equal(sopMethods(w.working)[0].version_no,2);assert.deepEqual(sopMethods(w.working).map(m=>m.state),['active','retired']);assert.equal(one(w.working,'SELECT method_id FROM sop_evaluation').method_id,me.entity_id);
 await w.acceptOwn(readFrom(s));assert.equal(one(w.base,'SELECT count(*) n FROM sop_evaluation_response').n,20);
});
test('FRV statistics preserve seconds, incomplete cycles, approved comparisons and actual/planned distinction with linked draft',async()=>{
 const w=fresh(),{op}=masters(w);
 const raw={schemaVersion:'FRV-1.3',study:{studyId:'QA-FRV',operationId:'Проверка'},cycles:[
 {id:'c1',cycleNo:1,phase:'baseline',observations:[{id:'o1',actionRaw:'Проверка',valueType:'VA',durationSec:4000,standardCandidate:true}]},
 {id:'c2',cycleNo:2,phase:'improved',observations:[{id:'o2',actionRaw:'Проверка',valueType:'VA',durationSec:2000,standardCandidate:true}]},
 {id:'c3',cycleNo:3,phase:'improved',observations:[{id:'o3',actionRaw:'Ожидание',valueType:'WAIT',durationSec:null}]}],
 comparisonApproved:false,standard:{outdated:false,steps:[{action:'Проверка',plannedTimeSec:1800,sourceObservationIds:['o1','o2'],keyMoment:'КМ',reason:'Причина',valueType:'VA'}]}};
 const a=frvSummary(raw);assert.equal(a.totals.VA,6000);assert.equal(a.missing,1);assert.equal(a.before,4000);assert.equal(a.after,2000);assert.equal(a.delta,null);
 raw.comparisonApproved=true;assert.equal(frvSummary(raw).percent,50);
 const text=JSON.stringify(raw),s={text,...await inspectSource(text,'frv')},study=event(w,'frv_study',null,{command:'create',title:'Исследование',operation_id:op,observed_at:'2026-11-20',...projection(s)});
 await w.applyContentEvents([study],readFrom(s));
 const draft=await draftFromFrv(text),step=JSON.parse(draft.text).constructor.steps[0];assert.equal(step.durationSeconds,1800);assert.equal(step.frvSource.observedTimeSec,3000);assert.equal(step.frvSource.projectTimeSec,1800);assert.equal(step.hasPhoto,false);
 const doc=createDoc(w,draft,op);await w.applyContentEvents([doc],readFrom(draft));
 const origin={command:'origin',revision_id:doc.id,study_id:study.entity_id,source_sha256:s.source.sha256};
 await assert.rejects(w.applyContentEvents([event(w,'document',doc.entity_id,{...origin,source_sha256:'c'.repeat(64)})]),/изменилось/);
 await w.applyContentEvents([event(w,'document',doc.entity_id,origin)]);
 assert.equal(one(w.working,'SELECT study_id FROM sop_frv_origin').study_id,study.entity_id);
 assert.equal(one(w.working,'SELECT sum(duration_seconds) n FROM frv_measurement').n,6000);await w.acceptOwn(readFrom(s,draft));
 raw.standard.outdated=true;await assert.rejects(draftFromFrv(JSON.stringify(raw)),/актуальный проект/);
});

import {linkedFrv,linkedTwi,sopTwiSignature} from '../src/modules/library/linked-materials.js';
test('SOP-linked FRV projects the same revision; no fictitious measured rows or double counted categories',()=>{
 const s={steps:[{action:'A',durationSeconds:12,keyMoments:[],frv:{vdc:true,m1:'3',m2:'2',move:'1.5'}},{action:'B',durationSeconds:8,keyMoments:[],frv:{}},{action:'C',durationSeconds:5,frv:{m1:'6'}}]};
 const a=linkedFrv(s);assert.equal(a.totals.seconds,25);assert.equal(a.totals.vdc,7);assert.equal(a.totals.m1,3);assert.equal(a.totals.m2,2);assert.equal(a.totals.unclassified,8);assert.equal(a.totals.distance,1.5);assert.equal(a.invalid,1);assert.equal(a.rows[2].m1,null);assert.equal(a.rows[1].start,12);
});
test('TWI registry distinguishes empty, historical manual and outdated plan; SOP changes invalidate signature',()=>{
 const s={meta:{operation:'Тест'},steps:[{action:'A',keyMoments:['K'],reason:'R'}],twi:{enabled:true,trainer:'Тренер'}};
 assert.equal(linkedTwi(s).exists,false);s.twi.prepare={purpose:'Цель'};assert.equal(linkedTwi(s).status,'Требует проверки');
 s.twi.sourceSignature=sopTwiSignature(s);assert.equal(linkedTwi(s).status,'Сформирован');s.steps[0].reason='Новая причина';assert.equal(linkedTwi(s).outdated,true);
});
test('Employee snapshots stay in immutable original, validate against printed fields and reject false identity attachment',async()=>{
 const old=await sop(),raw=JSON.parse(old.text),p=uuid();
 raw.constructor.meta.approverName='Учебный сотрудник';raw.constructor.meta.approverPost='Мастер';
 raw.constructor.leanCenterPeople=[{slot:'approver',person_id:p,employee_code:'Q-1',display_name:'Учебный сотрудник',position:'Мастер',unit:'Учебный участок'}];
 const pack=async()=>{const {integrity,...base}=raw;return JSON.stringify({...base,integrity:{algorithm:'SHA-256',sha256:await sha256(JSON.stringify(base))}})};
 const text=await pack();assert((await inspectSource(text,'sop')).source.sha256);raw.constructor.meta.approverName='Другое имя';await assert.rejects(inspectSource(await pack(),'sop'),/не соответствует/);
});

import {stage43Checklist,weightedResult,stage43Checks} from '../src/modules/library/stage43-checklist.js';
test('Stage43 checklist automatically projected, edited independently, guarded by exact source and preserved on backup',async()=>{
 const w=fresh(),{op,p}=masters(w),initial=await sop(),raw=JSON.parse(initial.text);
 raw.constructor.checklist=Array.from({length:13},(_,i)=>({id:i+1,req:'Учебный критерий '+(i+1),weight:i===0?.5:1,score:i===0?.3:1,comment:'',scoreSource:i===0?'auto':'seed'}));
 async function pack(){const {integrity,...base}=raw;const text=JSON.stringify({...base,integrity:{algorithm:'SHA-256',sha256:await sha256(JSON.stringify(base))}});return {text,...await inspectSource(text,'sop')}}
 const s=await pack(),d=createDoc(w,s,op);await w.applyContentEvents([d],readFrom(s));
 const original=stage43Checklist(raw.constructor),changed=original.map((x,i)=>i===0?{...x,score:.7,comment:'Уточнено',scoreSource:'manual'}:x);
 assert.equal(weightedResult(original).seed,12);assert.equal(weightedResult(changed).points,12.35);
 const payload={revision_id:d.id,source:s.source,rows:changed,actor_id:p},e=event(w,'sop_stage43_checklist',null,payload);
 const tampered=structuredClone(e);tampered.payload.rows[0].weight=2;
 await assert.rejects(w.applyContentEvents([tampered],readFrom(s)),/веса/);
 await w.applyContentEvents([e],readFrom(s));assert.equal(stage43Checks(w.working,d.id).length,1);
 assert.equal(one(w.working,'SELECT rev FROM document WHERE id=?',[d.entity_id]).rev,1);
 assert.equal(JSON.parse(one(w.working,'SELECT payload_json FROM document_revision WHERE id=?',[d.id]).payload_json).source.sha256,s.source.sha256);
 const next={...payload,rows:changed.map((x,i)=>i===0?{...x,score:1}:x)};
 await w.applyContentEvents([event(w,'sop_stage43_checklist',e.entity_id,next)],readFrom(s));
 assert.equal(stage43Checks(w.working,d.id)[0].rev,2);
 await assert.rejects(w.applyContentEvents([event(w,'sop_stage43_checklist',null,payload)],readFrom(s)),/уже сохранён/);
 const backupData=await backup(w),restored=await restore(SQL,backupData,readFrom(s));assert.equal(stage43Checks(restored.working,d.id)[0].rev,2);restored.close();
 raw.constructor.steps[0].action='Изменённый исходник';const s2=await pack();
 await w.applyContentEvents([event(w,'document',d.entity_id,{command:'save',revision_id:d.id,title:'Проверка',operation_id:op,...projection(s2)})],readFrom(s2));
 await assert.rejects(w.applyContentEvents([event(w,'sop_stage43_checklist',e.entity_id,next)],readFrom(s)),/изменилась/);
 assert.equal(stage43Checks(w.working,d.id)[0].source_sha256,s.source.sha256);
 await w.acceptOwn(readFrom(s,s2));assert.equal(stage43Checks(w.base,d.id).length,1);
 assert.deepEqual(rows(w.base,'PRAGMA foreign_key_check'),[])
});
test('existing v5 snapshot migrates to v6 without changing master identity or legacy checklist data',()=>{
 const d=new SQL.Database();d.run(schema);d.run(m2);d.run(m3);d.run(m4);d.run(fs.readFileSync('db/migrations/005_lc3_requirements.sql','utf8'));setMeta(d,'database_id',uuid());const p=uuid();d.run('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)',[p,'0001','Учебный']);const n=openDb(SQL,bytesOf(d));assert.equal(meta(d,'schema_version'),'5');assert.equal(meta(n,'schema_version'),'6');assert.equal(one(n,'SELECT id FROM person').id,p);assert.equal(one(n,'SELECT count(*) n FROM sop_stage43_checklist').n,0);assert.deepEqual(rows(n,'PRAGMA foreign_key_check'),[]);n.close();d.close()
});
