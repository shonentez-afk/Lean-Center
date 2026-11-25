import fs from 'node:fs';
import initSqlJs from 'sql.js';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {configureMigrations,createDb,Workspace,one,rows,uuid,sha256,backup} from '../src/core/db.js';
import {inspectSource,refsForDb,refsForEvents,unionRefs} from '../src/modules/library/domain.js';
import {makeTransfer} from '../src/modules/library/content.js';
import {sopTwiSignature,twiFields} from '../src/modules/library/linked-materials.js';
const read=p=>fs.readFileSync(p,'utf8');
export const schema=read('db/schema_v1.sql'),migrations=['002_lc1','003_lc2','004_lc3','005_lc3_requirements','006_stage43_checklist','007_lc4_training','008_lc4_corporate_forms','009_lc42_methods','010_lc43_matrix','011_lc5_audit'].map(x=>read('db/migrations/'+x+'.sql'));
configureMigrations(...migrations.slice(1));
export const SQL=await initSqlJs();
export const date='2026-01-20';
export const practicalMethod={format:'lean-practical-checklist-v1',title:'Синтетическая методика QA',source_sha256:'a'.repeat(64),criteria:Array.from({length:11},(_,i)=>({code:i+1,section:i<2?'Учебный раздел A':'Учебный раздел B',question:'Синтетический критерий '+(i+1)}))};
const img='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4jkAAAAASUVORK5CYII=';
export async function makeSop(action='Учебная операция',outdated=false){
 const s={schemaVersion:4,meta:{operation:'Учебная операция',workplace:'Стенд',tools:'Учебный инструмент',safety:'Учебные условия'},steps:[{id:1,action,keyMoments:['Учебный КМ'],reason:'Учебное основание',durationSeconds:15,hasPhoto:true,photoAnnotations:[]}],twi:{enabled:true}};
 for(const [section,key] of twiFields){s.twi[section]??={};s.twi[section][key]='Учебное поле '+section+' '+key}
 s.twi.sourceSignature=outdated?'sop1:obsolete':sopTwiSignature(s);
 const p={schemaVersion:2,document:{id:'QA-LC4',status:'Опубликован',number:'QA-LC4',version:1},constructor:s,photoAssets:{'1':{original:img,rendered:null,ext:'png',annotations:[]}}};
 const text=JSON.stringify({...p,integrity:{algorithm:'SHA-256',sha256:await sha256(JSON.stringify(p))}});return {text,...await inspectSource(text,'sop')}
}
export async function fixture({installMethod=true}={}){
 const w=new Workspace(SQL,createDb(SQL,schema,migrations[0])),sources=new Map(),readContent=async r=>sources.get(r.sha256)?.text;
 let clock=Date.parse(date+'T00:00:00Z');
 const save=async(t,p,id=null)=>{const old=id?one(w.working,'SELECT * FROM '+t+' WHERE id=?',[id]):null,e={id:uuid(),entity_type:t,entity_id:id||uuid(),operation:old?'update':'create',expected_revision:old?.rev||0,payload:p,occurred_at:new Date(clock++).toISOString()};await w.applyContentEvents([e],readContent);return e};
 const unit=w.edit('org_unit',null,{code:'QA',name:'Учебный участок',kind:'Участок',parent_id:null}),workplace=w.edit('workplace',null,{unit_id:unit,code:'QA-WP',name:'Стенд'}),operation=w.edit('operation',null,{unit_id:unit,workplace_id:workplace,equipment_id:null,code:'QA-OP',name:'Учебная операция',criticality:'normal'});
 const trainee=w.edit('person',null,{employee_code:'LC4-001',display_name:'Ученик Тестовый'}),mentor=w.edit('person',null,{employee_code:'LC4-002',display_name:'Инструктор Тестовый'}),actor=w.edit('person',null,{employee_code:'LC4-003',display_name:'Ответственный Тестовый'}),other=w.edit('person',null,{employee_code:'LC4-004',display_name:'Без полномочий'});
 const profession=w.edit('profession',null,{code:'QA-PR',name:'Учебная профессия'}),shift=w.edit('work_shift',null,{code:'QA-A',name:'Учебная смена А'});
 for(const id of [trainee,mentor,actor,other])w.edit('person_assignment',null,{person_id:id,unit_id:unit,profession_id:profession,position_id:null,shift_id:shift,shift_code:null,valid_from:'2020-01-01',valid_to:null});
 for(const [id,code,name] of [[trainee,'TRAINEE','Обучаемый'],[mentor,'INSTRUCTOR','Инструктор'],[other,'MENTOR','Наставник']]){
  const role=w.edit('business_role',null,{code,name});w.edit('role_assignment',null,{person_id:id,role_id:role,valid_from:'2020-01-01',valid_to:null})
 }
 const cat=w.edit('skill_category',null,{name:'Учебные навыки'}),skill=w.edit('skill',null,{category_id:cat,operation_id:operation,name:'Учебный навык'}),scale=w.edit('rating_scale',null,{name:'QA шкала 1–4',version_no:'1',levels:'1: Первый\n2: Второй\n3: Третий\n4: Четвёртый'});
 const source=await makeSop();sources.set(source.source.sha256,source);
 const doc=await save('document',{command:'create',code:'QA-LC4',title:'Учебная операция',operation_id:operation,source:source.source,projection:source.projection});
 async function publishRevision(docId,rev){await save('document',{command:'passport',revision_id:rev,print_format:'portrait',changed_on:date},docId);for(const command of ['submit','approve','effect'])await save('document',{command,revision_id:rev,actor_id:actor,note:''},docId)}
 await publishRevision(doc.entity_id,doc.id);
 const certificate=(await save('mentor_credential',{person_id:mentor,kind:'certificate',role:'instructor',number:'QA-CERT',issuer:'Учебный центр',issued_on:'2020-01-01',valid_until:null,evidence:'Синтетический документ',registered_by:actor})).entity_id;
 const appointment=(await save('mentor_appointment',{person_id:mentor,credential_id:certificate,role:'instructor',order_number:'QA-ORDER',order_on:'2020-01-01',approved_by:actor,valid_from:'2020-01-01',valid_to:null,acknowledged_on:'2020-01-01',evidence:'Синтетический приказ'})).entity_id;
 const auth=(await save('mentor_authorization',{person_id:mentor,operation_id:operation,approved_by:actor,valid_from:'2020-01-01',valid_to:null,credential_id:certificate,appointment_id:appointment})).entity_id;
 const method=installMethod?(await save('checklist_version',practicalMethod)).entity_id:null;
 const base={trainee_id:trainee,mentor_id:mentor,supervisor_id:null,authorization_id:auth,revision_id:doc.id,source:source.source,skill_id:skill,scale_id:scale,target_level:2,assigned_by:actor,assigned_on:date,due_on:'2027-01-31',reason:'Синтетическое обучение',variant:'classic',shift_id:shift,enrollment_id:null,program_task_id:null,plan_reviewed:true};
 const addAssignment=async(overrides={})=>(await save('training_assignment',{...base,...overrides})).entity_id;
 const getAssignment=id=>one(w.working,'SELECT * FROM training_assignment WHERE id=?',[id]);
 const approve=async id=>save('training_assignment',{command:'approve',responsible_id:actor,head_id:actor,approved_on:date,note:'Учебное согласование'},id);
 const stage=async(id,code,overrides={})=>save('training_session',{assignment_id:id,assignment_rev:getAssignment(id).rev,stage_code:code,held_at:date+'T08:00',duration_minutes:10,result:'completed',notes:'Учебный факт',witness_id:null,mentor_ack:true,trainee_ack:true,...overrides});
 const verify=async(id,kind,overrides={})=>save('training_verification',{assignment_id:id,assignment_rev:getAssignment(id).rev,kind,evaluator_id:actor,evaluated_on:date,result:'pass',evidence:'Учебное подтверждение',feedback:'Учебная обратная связь',...overrides});
 const assess=async(id,overrides={})=>save('assessment_session',{command:'practical',assignment_id:id,assignment_rev:getAssignment(id).rev,evaluator_id:actor,assessed_on:date,method_id:method,responses:rows(w.working,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[method]).map((x,i)=>({criterion_id:x.id,value:i===10?0:1,note:''})),conclusion:'basic',feedback:'Учебная обратная связь',...overrides});
 const qualify=async(id,practicalId,overrides={})=>save('assessment_session',{command:'qualification',assignment_id:id,assignment_rev:getAssignment(id).rev,evaluator_id:actor,assessed_on:date,practical_id:practicalId,observation_state:'rated',level:2,valid_until:null,evidence:'Учебный результат',feedback:'Учебная обратная связь',...overrides});
 const admit=async(id,overrides={})=>save('admission_decision',{assignment_id:id,assignment_rev:getAssignment(id).rev,actor_id:actor,decided_on:date,valid_until:null,decision:'granted',evidence:'Учебное решение',feedback:'Учебная обратная связь',...overrides});
 const backupBundle=async()=>makeTransfer('backup',await backup(w),unionRefs(refsForDb(w.base),refsForEvents(w.pending)),readContent);
 const revise=async(outdated=false)=>{const s=await makeSop('Новая учебная редакция',outdated);sources.set(s.source.sha256,s);const e=await save('document',{command:'revise',revision_id:null,title:'Учебная операция',operation_id:operation,source:s.source,projection:s.projection},doc.entity_id);await publishRevision(doc.entity_id,e.id);return {revision:e.id,source:s}};
 return {w,save,source,readContent,sources,unit,workplace,operation,trainee,mentor,actor,other,profession,shift,skill,scale,doc,certificate,appointment,auth,method,base,addAssignment,getAssignment,approve,stage,verify,assess,qualify,admit,backupBundle,revise}
}
