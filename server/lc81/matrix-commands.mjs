// Existing corporate matrix calculation, no manually assigned scores.
import {one,rows,uuid,isId,applyEvent} from '../../src/core/db.js';
import {matrixRoster,columnChoices,matrixBaseline,matrixProjection,matrixFromRecord,LEVEL_TEXT} from '../../src/modules/training/matrix-view.js';
import {matrixResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,msg)=>{if(!ok)throw new PilotError(status,msg)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const scaleFor=db=>rows(db,"SELECT id,name FROM rating_scale WHERE archived=0 AND name='Производственная компетенция (1–4)' ORDER BY id");
const readablePerson=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
function unitResource(unit){return {data:{},self:null,units:[unit],assigned:[]}}
export function matrixInfo(db,a,unit=null,baseOn=a.day){
 must(a.personId&&a.permissions.includes('matrix.create'),403,'Создание матриц недоступно');
 const units=rows(db,'SELECT id,name,code FROM org_unit WHERE archived=0 ORDER BY name').filter(u=>a.read('org.read',u.id)&&a.allows('matrix.create',u.id,unitResource(u.id)));
 if(unit===null)return {units,day:a.day};
 must(date(baseOn)&&baseOn<=a.day&&units.some(u=>u.id===unit),403,'Подразделение или дата недоступны');
 const today=new Set(matrixRoster(db,a.day,unit).map(x=>x.person_id));
 const roster=matrixRoster(db,baseOn,unit).filter(r=>readablePerson(a,r.person_id)&&today.has(r.person_id));
 const columns=columnChoices(db,unit).filter(x=>x.skill_id&&x.document_id&&a.read('operation.read',x.operation_id)&&rows(db,"SELECT id FROM document_revision WHERE document_id=? AND state='effective'",[x.document_id]).some(v=>a.read('sop.read_effective',v.id)));
 return {units,day:a.day,baseOn,roster,columns:columns.map(({skill_id,document_id,title,skill,operation_id})=>({skill_id,document_id,title,skill,operation_id})),scales:scaleFor(db)};
}
function authorizeMatrix(db,a,m,action){
 must(a.read('matrix.read',m.id)&&a.allows(action,m.id,matrixResource(db,m.unit_id,m.roster,m.columns,a.day,m.base_on)),403,'Матрица недоступна');
}
export function saveMatrix(db,input,a){
 must(exact(input,['code','title','unit_id','scale_id','base_on','target_on','person_ids','columns','previous_id','previous_rev'])&&a.personId&&typeof input.code==='string'&&input.code.trim().length>0&&input.code.length<=80&&input.code===input.code.trim()&&typeof input.title==='string'&&input.title.trim().length>0&&input.title.length<=200&&isId(input.unit_id)&&isId(input.scale_id)&&date(input.base_on)&&date(input.target_on)&&input.base_on<=a.day&&input.target_on>=input.base_on,400,'Неверные реквизиты матрицы');
 must(Array.isArray(input.person_ids)&&input.person_ids.length>0&&input.person_ids.length<=300&&input.person_ids.every(isId)&&new Set(input.person_ids).size===input.person_ids.length&&Array.isArray(input.columns)&&input.columns.length>0&&input.columns.length<=150&&input.person_ids.length*input.columns.length<=12000&&input.columns.every(x=>exact(x,['skill_id','document_id'])&&isId(x.skill_id)&&isId(x.document_id))&&new Set(input.columns.map(x=>x.skill_id)).size===input.columns.length,400,'Неверный состав матрицы');
 const info=matrixInfo(db,a,input.unit_id,input.base_on);
 const roster=input.person_ids.map(id=>info.roster.find(r=>r.person_id===id));
 const columns=input.columns.map(c=>info.columns.find(x=>x.skill_id===c.skill_id&&x.document_id===c.document_id)).map(c=>c&&({skill_id:c.skill_id,document_id:c.document_id,title:c.title}));
 must(roster.every(Boolean)&&columns.every(Boolean)&&info.scales.some(x=>x.id===input.scale_id),403,'Состав или шкала недоступны');
 const resource=matrixResource(db,input.unit_id,roster,columns,a.day,input.base_on);
 must(a.allows('matrix.create',input.unit_id,resource),403,'Матрица выходит за область полномочий');
 const past=rows(db,'SELECT * FROM competency_matrix WHERE code=?',[input.code]);
 for(const row of past)authorizeMatrix(db,a,matrixFromRecord(row),'matrix.create');
 const previous=past.find(x=>x.state==='active');
 must(input.previous_id===(previous?.id??null)&&input.previous_rev===(previous?.rev??0),409,'Матрица изменена, обновите карточку');
 const payload={code:input.code,title:input.title.trim(),author_id:a.personId,unit_id:input.unit_id,shift_id:null,scale_id:input.scale_id,base_on:input.base_on,target_on:input.target_on,roster,columns,baseline:matrixBaseline(db,roster,columns,input.scale_id,input.base_on),previous_id:input.previous_id,previous_rev:input.previous_rev};
 const id=uuid(),eventId=uuid();
 try{applyEvent(db,{id:eventId,entity_type:'competency_matrix',entity_id:id,operation:'create',expected_revision:0,payload,occurred_at:a.at})}catch(e){throw new PilotError(422,'Матрица не прошла проверку: '+String(e.message||'ошибка').split('\n')[0].slice(0,220))}
 a.audit('matrix.create',eventId);
 return one(db,'SELECT id,rev,version_no,state FROM competency_matrix WHERE id=?',[id]);
}
export function retireMatrix(db,input,a){
 must(exact(input,['id','expected_revision','reason'])&&isId(input.id)&&Number.isSafeInteger(input.expected_revision)&&typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=2000&&a.personId,400,'Неверное закрытие матрицы');
 must(a.read('matrix.read',input.id),404,'Матрица недоступна');
 const m=matrixFromRecord(one(db,'SELECT * FROM competency_matrix WHERE id=?',[input.id]));
 authorizeMatrix(db,a,m,'matrix.retire');must(m.rev===input.expected_revision,409,'Матрица изменена');
 const eventId=uuid();
 try{applyEvent(db,{id:eventId,entity_type:'competency_matrix',entity_id:m.id,operation:'update',expected_revision:m.rev,payload:{command:'retire',reason:input.reason.trim()},occurred_at:a.at})}catch(e){throw new PilotError(422,'Матрица не прошла проверку')}
 a.audit('matrix.retire',eventId);return {id:m.id,rev:m.rev+1,state:'retired'};
}
export function matrixDetail(db,a,id){
 must(isId(id)&&a.read('matrix.read',id),404,'Матрица недоступна');
 const m=matrixFromRecord(one(db,'SELECT * FROM competency_matrix WHERE id=?',[id]));
 authorizeMatrix(db,a,m,'matrix.detail');
 const p=matrixProjection(db,m,a.day),resource=matrixResource(db,m.unit_id,m.roster,m.columns,a.day,m.base_on);
 return {id:m.id,code:m.code,title:m.title,version_no:m.version_no,rev:m.rev,state:m.state,unit_id:m.unit_id,scale_id:m.scale_id,base_on:m.base_on,target_on:m.target_on,day:a.day,columns:m.columns,roster:m.roster,levels:LEVEL_TEXT,
 cells:m.roster.map(r=>m.columns.map(c=>{const x=p.cells.get(r.person_id+':'+c.skill_id);return {base:x.base,actual:x.actual,target:x.target,need:x.need,reason:x.reason,admission:x.admission}})),
 totals:p.total,byPerson:m.roster.map(r=>p.byPerson.get(r.person_id)),bySkill:m.columns.map(c=>p.bySkill.get(c.skill_id)),
 can_revise:!!a.personId&&m.state==='active'&&a.allows('matrix.create',m.id,resource),can_retire:!!a.personId&&m.state==='active'&&a.allows('matrix.retire',m.id,resource)};
}
