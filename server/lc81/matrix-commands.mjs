// Existing corporate matrix calculation, no manually assigned scores.
import {one,rows,uuid,isId,applyEvent} from '../../src/core/db.js';
import {matrixRoster,columnChoices,matrixBaseline,matrixProjection,matrixFromRecord,LEVEL_TEXT} from '../../src/modules/training/matrix-view.js';
import {autoMatrix,profileEdits} from '../../src/modules/training/matrix-assistant.js';
import {matrixData,latestQualification,corporateScaleValid,CORPORATE_SCALE_NAME} from '../../src/modules/training/domain.js';
import {competencyChange} from './competency-commands.mjs';
import {matrixResource,programResource,requirementResource,assessmentResource,trainingAssignmentResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(ok,status,msg)=>{if(!ok)throw new PilotError(status,msg)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const scaleFor=(db,a)=>rows(db,'SELECT id,name FROM rating_scale WHERE archived=0 AND name=? ORDER BY id',[CORPORATE_SCALE_NAME]).filter(s=>corporateScaleValid(db,s.id)&&a.read('scale.read',s.id));
const readablePerson=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
function unitResource(unit){return {data:{},self:null,units:[unit],assigned:[]}}
export function matrixInfo(db,a,unit=null,baseOn=a.day,filters={}){
 must(a.personId&&a.permissions.includes('matrix.create'),403,'Создание матриц недоступно');
 const units=rows(db,'SELECT id,name,code FROM org_unit WHERE archived=0 ORDER BY name').filter(u=>a.read('org.read',u.id)&&a.allows('matrix.create',u.id,unitResource(u.id)));
 const refs=table=>rows(db,'SELECT id,name FROM '+table+' WHERE archived=0 ORDER BY name,id');
 const shifts=refs('work_shift'),professions=refs('profession'),categories=refs('skill_category');
 if(unit===null)return {units,day:a.day,shifts,professions,categories};
 must(date(baseOn)&&baseOn<=a.day&&units.some(u=>u.id===unit),403,'Подразделение или дата недоступны');
 const {shift_id=null,profession_id=null,workplace_id=null,category_id=null}=filters;
 const workplaces=rows(db,'SELECT id,name,unit_id FROM workplace WHERE archived=0 ORDER BY name,id').filter(w=>a.read('workplace.read',w.id)&&a.allows('matrix.create',w.id,unitResource(w.unit_id))&&one(db,'WITH RECURSIVE scope(id) AS (SELECT ? UNION SELECT u.id FROM org_unit u JOIN scope s ON u.parent_id=s.id) SELECT id FROM scope WHERE id=?',[unit,w.unit_id]));
 must([[shift_id,shifts],[profession_id,professions],[workplace_id,workplaces],[category_id,categories]].every(([id,list])=>id===null||list.some(x=>x.id===id)),403,'Фильтр матрицы недоступен');
 const today=new Set(matrixRoster(db,a.day,unit).map(x=>x.person_id));
 const roster=matrixRoster(db,baseOn,unit,shift_id||'',profession_id||'').filter(r=>readablePerson(a,r.person_id)&&today.has(r.person_id));
 const columns=columnChoices(db,unit,workplace_id||'',category_id||'').filter(x=>x.skill_id&&(x.document_id===null||a.read('operation.read',x.operation_id)&&rows(db,"SELECT id FROM document_revision WHERE document_id=? AND state='effective'",[x.document_id]).some(v=>a.read('sop.read_effective',v.id))));
 return {units,day:a.day,baseOn,shifts,professions,categories,workplaces,roster,columns:columns.map(({skill_id,document_id,title,skill,operation_id})=>({skill_id,document_id,title,skill,operation_id})),scales:scaleFor(db,a)};
}
export function suggestMatrix(db,a,f){
 must(exact(f,['unit_id','base_on','filters','scale_id','person_ids','include_sops'])&&isId(f.unit_id)&&date(f.base_on)&&isId(f.scale_id)&&exact(f.filters,['shift_id','profession_id','workplace_id','category_id'])&&Array.isArray(f.person_ids)&&f.person_ids.length>0&&f.person_ids.length<=300&&new Set(f.person_ids).size===f.person_ids.length&&f.person_ids.every(isId)&&typeof f.include_sops==='boolean',400,'Неверный состав для подбора');
 const d=matrixInfo(db,a,f.unit_id,f.base_on,f.filters);
 must(d.scales.some(s=>s.id===f.scale_id)&&f.person_ids.every(id=>d.roster.some(r=>r.person_id===id)),403,'Состав или шкала недоступны');
 const selected=d.roster.filter(r=>f.person_ids.includes(r.person_id)),catalog=d.columns.map(c=>({...c,key:c.skill_id+':'+c.document_id}));
 const s=autoMatrix(db,selected,catalog,f.base_on,f.scale_id,{allSops:f.include_sops});
 return {keys:s.keys,missing:s.missing.length,ambiguous:s.ambiguous.length,unprofiled:s.unprofiled.length,requirements:s.requirements};
}
function authorizeMatrix(db,a,m,action){
 must(a.read('matrix.read',m.id)&&a.allows(action,m.id,matrixResource(db,m.unit_id,m.roster,m.columns,a.day,m.base_on)),403,'Матрица недоступна');
}
export function saveMatrix(db,input,a){
 const keys=['code','title','unit_id','scale_id','base_on','target_on','person_ids','columns','previous_id','previous_rev'],filtered=exact(input,[...keys,'shift_id','profession_id','workplace_id','category_id']);
 must((exact(input,keys)||filtered)&&a.personId&&typeof input.code==='string'&&input.code.trim().length>0&&input.code.length<=80&&input.code===input.code.trim()&&typeof input.title==='string'&&input.title.trim().length>0&&input.title.length<=200&&isId(input.unit_id)&&isId(input.scale_id)&&date(input.base_on)&&date(input.target_on)&&input.base_on<=a.day&&input.target_on>=input.base_on,400,'Неверные реквизиты матрицы');
 must(Array.isArray(input.person_ids)&&input.person_ids.length>0&&input.person_ids.length<=300&&input.person_ids.every(isId)&&new Set(input.person_ids).size===input.person_ids.length&&Array.isArray(input.columns)&&input.columns.length>0&&input.columns.length<=150&&input.person_ids.length*input.columns.length<=12000&&input.columns.every(x=>exact(x,['skill_id','document_id'])&&isId(x.skill_id)&&(x.document_id===null||isId(x.document_id)))&&new Set(input.columns.map(x=>x.skill_id)).size===input.columns.length,400,'Неверный состав матрицы');
 const filters=filtered?Object.fromEntries(['shift_id','profession_id','workplace_id','category_id'].map(k=>[k,input[k]])):{};
 const info=matrixInfo(db,a,input.unit_id,input.base_on,filters);
 const roster=input.person_ids.map(id=>info.roster.find(r=>r.person_id===id));
 const columns=input.columns.map(c=>info.columns.find(x=>x.skill_id===c.skill_id&&x.document_id===c.document_id)).map(c=>c&&({skill_id:c.skill_id,document_id:c.document_id,title:c.title}));
 must(roster.every(Boolean)&&columns.every(Boolean)&&info.scales.some(x=>x.id===input.scale_id),403,'Состав или шкала недоступны');
 const resource=matrixResource(db,input.unit_id,roster,columns,a.day,input.base_on);
 must(a.allows('matrix.create',input.unit_id,resource)&&a.allows('matrix.read',input.unit_id,resource),403,'Матрица выходит за область полномочий');
 const past=rows(db,'SELECT * FROM competency_matrix WHERE code=?',[input.code]);
 for(const row of past){must(row.unit_id===input.unit_id,403,'Матрица недоступна');authorizeMatrix(db,a,matrixFromRecord(row),'matrix.create')}
 const previous=past.find(x=>x.state==='active');
 must(input.previous_id===(previous?.id??null)&&input.previous_rev===(previous?.rev??0),409,'Матрица изменена, обновите карточку');
 const payload={code:input.code,title:input.title.trim(),author_id:a.personId,unit_id:input.unit_id,shift_id:filters.shift_id??null,scale_id:input.scale_id,base_on:input.base_on,target_on:input.target_on,roster,columns,baseline:matrixBaseline(db,roster,columns,input.scale_id,input.base_on),previous_id:input.previous_id,previous_rev:input.previous_rev};
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
 return {id:m.id,code:m.code,title:m.title,version_no:m.version_no,rev:m.rev,state:m.state,unit_id:m.unit_id,shift_id:m.shift_id,scale_id:m.scale_id,base_on:m.base_on,target_on:m.target_on,day:a.day,columns:m.columns,roster:m.roster,levels:LEVEL_TEXT,
 cells:m.roster.map(r=>m.columns.map(c=>{const x=p.cells.get(r.person_id+':'+c.skill_id);return {base:x.base,actual:x.actual,target:x.target,need:x.need,reason:x.reason,admission:x.admission}})),
 totals:p.total,byPerson:m.roster.map(r=>p.byPerson.get(r.person_id)),bySkill:m.columns.map(c=>p.bySkill.get(c.skill_id)),
 can_develop:!!a.personId&&m.state==='active'&&a.allows('development.from_matrix',m.id,resource),
 can_revise:!!a.personId&&m.state==='active'&&a.allows('matrix.create',m.id,resource),can_retire:!!a.personId&&m.state==='active'&&a.allows('matrix.retire',m.id,resource)};
}


// General matrix is a live projection of the original LC7 matrixData.
// Do not use partial/hidden evidence as zero or fabricate a qualification.
const siteRight=(db,a,k)=>{const r=programResource(db);return !!r&&a.scope(k,r.units[0],r)};
const refOptions=(db,a,table,action)=>rows(db,'SELECT id FROM '+table+' WHERE archived=0 ORDER BY name,id').flatMap(x=>{const r=a.read(action,x.id);return r?[{id:x.id,name:r.data.name}]:[]});
export function matrixOverviewOptions(db,a){
 must(['matrix.read','skill.read','requirement.read','assessment.read','assessment.detail'].every(k=>a.permissions.includes(k)),403,'Для общей матрицы необходим доступ к требованиям и оценкам');
 const units=refOptions(db,a,'org_unit','org.read').filter(u=>a.scope('matrix.read',u.id,unitResource(u.id)));
 const all=siteRight(db,a,'matrix.read');
 must(all||units.length,403,'Нет области общей матрицы');
 return {day:a.day,units,all,default_unit:all?'':units[0].id,professions:refOptions(db,a,'profession','profession.read'),shifts:refOptions(db,a,'work_shift','shift.read'),categories:refOptions(db,a,'skill_category','category.read'),workplaces:refOptions(db,a,'workplace','workplace.read')};
}
const assessmentState=(fact,day)=>!fact?'none':fact.observation_state!=='rated'?fact.observation_state:fact.valid_until&&fact.valid_until<day?'expired':'rated';
const stateReason={none:'Нет оценки',not_observed:'Не наблюдалось',not_applicable:'Неприменимо',expired:'Срок оценки истёк'};
function readableAssessment(db,a,id){
 const r=one(db,'SELECT * FROM assessment_session WHERE id=?',[id]),resource=assessmentResource(db,r,a.day);
 return !!resource&&!!a.read('assessment.read',id)&&a.scope('assessment.detail',id,resource);
}
export function matrixOverview(db,a,f,canCard){
 const o=matrixOverviewOptions(db,a),checks={unit_id:o.units,profession_id:o.professions,shift_id:o.shifts,category_id:o.categories,workplace_id:o.workplaces};
 must(exact(f,[...Object.keys(checks),'q','gaps','person_page','skill_page'])&&typeof f.q==='string'&&f.q.length<=200&&typeof f.gaps==='boolean'&&[f.person_page,f.skill_page].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=10000),400,'Неверные фильтры матрицы');
 for(const [k,list] of Object.entries(checks))must(typeof f[k]==='string'&&(!f[k]&&(k!=='unit_id'||o.all)||list.some(x=>x.id===f[k])),403,'Фильтр матрицы недоступен');
 const m=matrixData(db,a.day),q=f.q.trim().toLocaleLowerCase('ru-RU'),op=new Map(rows(db,'SELECT id,workplace_id FROM operation WHERE archived=0').map(x=>[x.id,x.workplace_id]));
 let people=m.people.flatMap(p=>{
  const v=readablePerson(a,p.id);
  if(!v||!p.unit_id||!a.scope('matrix.read',p.id,{...unitResource(p.unit_id),self:p.id})||f.unit_id&&p.unit_id!==f.unit_id||f.profession_id&&p.profession_id!==f.profession_id||f.shift_id&&p.shift_id!==f.shift_id||q&&![v.data.display_name,v.data.employee_code].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(q))return [];
  return [{id:p.id,name:v.data.display_name,code:v.data.employee_code??null,can_card:canCard(p.id)}];
 });
 const skills=m.skills.filter(s=>a.read('skill.read',s.id)&&(!f.category_id||s.category_id===f.category_id)&&(!f.workplace_id||op.get(s.operation_id)===f.workplace_id));
 const requirements=new Map(),facts=new Map(),admissions=new Map();
 const visible=(map,id,fn)=>{if(!map.has(id))map.set(id,!!fn());return map.get(id)};
 const fullRequirements=siteRight(db,a,'requirement.read');
 function cell(p,s){
  const c=m.cells.get(p.id+':'+s.id),goal=c?.goal,fact=c?.fact;
  if(!c||!fullRequirements||goal&&!visible(requirements,goal.id,()=>a.read('requirement.read',goal.id))||fact&&!visible(facts,fact.session_id,()=>readableAssessment(db,a,fact.session_id)))return {restricted:true};
  const admission=c.admission?.record,canAdmission=!!admission?.assignment_id&&visible(admissions,admission.assignment_id,()=>{
   const resource=trainingAssignmentResource(db,admission.assignment_id,a.day);
   return !!resource&&!!a.read('training.read',admission.assignment_id)&&a.scope('training.detail',admission.assignment_id,resource);
  });
  const status=assessmentState(fact,a.day),reason=stateReason[status]||(!c.same?'Другая шкала':!c.revisionCurrent?'Прежняя редакция СОП':c.gap?'Ниже требования':c.revisionEquivalent?'Подтверждена редакционная эквивалентность СОП':goal?'Требование покрыто':'Нет требования');
  return {restricted:false,actual:fact?.observation_state==='rated'?fact.level:null,observation:fact?.observation_state??null,assessment_state:status,assessed_on:fact?.assessed_at.slice(0,10)??null,valid_until:fact?.valid_until??null,target:goal?.required_level??null,gap:c.gap,reason,admission:canAdmission?c.admission.status:null,assessment_id:fact?.session_id??null};
 }
 if(f.gaps)people=people.filter(p=>skills.some(s=>cell(p,s).gap===true));
 const person_page=Math.min(f.person_page,Math.max(0,Math.ceil(people.length/40)-1)),skill_page=Math.min(f.skill_page,Math.max(0,Math.ceil(skills.length/20)-1));
 const selected=people.slice(person_page*40,person_page*40+40),columns=skills.slice(skill_page*20,skill_page*20+20);
 return {day:a.day,people:selected,skills:columns.map(s=>({id:s.id,name:s.name,category:s.category})),cells:selected.map(p=>columns.map(s=>cell(p,s))),person_count:people.length,skill_count:skills.length,person_page,skill_page};
}
// Match the live cell boundary, then filter each immutable observation
// separately. An inaccessible record never contributes to a history count.
export function matrixAssessmentHistory(db,a,personId,skillId,offset=0){
 matrixOverviewOptions(db,a);
 must(isId(personId)&&isId(skillId)&&Number.isSafeInteger(offset)&&offset>=0&&offset<=10000,400,'Неверная ячейка или страница');
 const p=one(db,"SELECT p.id,a.unit_id,a.profession_id FROM person p JOIN person_assignment a ON a.id=(SELECT id FROM person_assignment WHERE person_id=p.id AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1) WHERE p.archived=0 AND p.id=?",[a.day,a.day,personId]),person=p&&readablePerson(a,p.id),skill=a.read('skill.read',skillId);
 must(p&&person&&skill&&p.unit_id&&a.scope('matrix.read',p.id,{...unitResource(p.unit_id),self:p.id})&&siteRight(db,a,'requirement.read'),404,'История ячейки недоступна');
 const goal=one(db,"SELECT id FROM role_requirement WHERE profession_id=? AND skill_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=?",[p.profession_id,skillId,a.day,a.day]),latest=latestQualification(db,personId,skillId,a.day);
 must((!goal||a.read('requirement.read',goal.id))&&(!latest||readableAssessment(db,a,latest.session_id)),404,'История ячейки недоступна');
 const facts=rows(db,`SELECT i.session_id,i.observation_state,i.level,i.valid_until,s.assessed_at,s.evaluator_id,s.standard_revision_id
 FROM assessment_item i JOIN assessment_session s ON s.id=i.session_id
 WHERE s.person_id=? AND i.skill_id=? AND s.state='confirmed' AND substr(s.assessed_at,1,10)<=?
 ORDER BY s.assessed_at DESC,coalesce(s.recorded_at,'') DESC,s.id DESC`,[personId,skillId,a.day]).filter(x=>readableAssessment(db,a,x.session_id));
 const items=facts.slice(offset,offset+50).map(x=>({id:x.session_id,assessed_on:x.assessed_at.slice(0,10),state:assessmentState(x,a.day),level:x.observation_state==='rated'?x.level:null,valid_until:x.valid_until,evaluator:readablePerson(a,x.evaluator_id)?.data.display_name??null,latest:x.session_id===latest?.session_id}));
 return {day:a.day,person:person.data.display_name,skill:skill.data.name,items,offset,next:offset+50<facts.length?offset+50:null};
}
export function profileOptions(db,a){
 must(siteRight(db,a,'requirement.read')&&a.permissions.includes('skill.read'),403,'Профили профессий недоступны');
 const professions=refOptions(db,a,'profession','profession.read'),scales=scaleFor(db,a);
 return {day:a.day,professions,scales,levels:LEVEL_TEXT,can_edit:!!a.personId&&siteRight(db,a,'requirement.create')&&siteRight(db,a,'requirement.close')};
}
export function professionProfile(db,a,professionId,scaleId,effective){
 const o=profileOptions(db,a);
 must(o.professions.some(p=>p.id===professionId)&&o.scales.some(s=>s.id===scaleId)&&date(effective)&&effective>=a.day,400,'Выберите профессию, корпоративную шкалу и дату');
 const requirements=rows(db,'SELECT * FROM role_requirement WHERE profession_id=? AND valid_from<=? AND coalesce(valid_to,\'9999-12-31\')>=?',[professionId,effective,effective]),map=new Map(requirements.map(x=>[x.skill_id,x]));
 const items=rows(db,'SELECT s.id,s.name,c.name category FROM skill s JOIN skill_category c ON c.id=s.category_id WHERE s.archived=0 AND c.archived=0 ORDER BY c.name,s.name,s.id').flatMap(s=>{
  if(!a.read('skill.read',s.id))return [];
  const old=map.get(s.id);
  if(old&&!a.read('requirement.read',old.id))return [];
  const resource=requirementResource(db,{skill_id:s.id});
  const editable=!!resource&&o.can_edit&&a.scope('requirement.create',s.id,resource)&&(!old||a.scope('requirement.close',old.id,resource));
  return [{...s,editable,level:old?.required_level??null,criticality:old?.criticality||'normal',scale_id:old?.scale_id??null,valid_from:old?.valid_from??null,expected_id:old?.id??null,expected_rev:old?.rev??0}];
 });
 return {...o,profession_id:professionId,scale_id:scaleId,effective,items};
}
export function saveProfessionProfile(db,a,f){
 must(exact(f,['profession_id','scale_id','effective','entries'])&&Array.isArray(f.entries)&&f.entries.length>0&&f.entries.length<=150&&new Set(f.entries.map(e=>e.skill_id)).size===f.entries.length&&f.entries.every(e=>exact(e,['skill_id','level','criticality','expected_id','expected_rev'])&&isId(e.skill_id)&&(e.level===null||[1,2,3,4].includes(e.level))&&['normal','important','critical'].includes(e.criticality)&&(e.expected_id===null||isId(e.expected_id))&&Number.isSafeInteger(e.expected_rev)),400,'Некорректный профиль');
 const p=professionProfile(db,a,f.profession_id,f.scale_id,f.effective);must(p.can_edit,403,'Изменение профиля недоступно');
 for(const e of f.entries){const old=p.items.find(x=>x.id===e.skill_id);must(old?.editable,403,'Навык недоступен');must(old.expected_id===e.expected_id&&old.expected_rev===e.expected_rev,409,'Профиль изменён другим пользователем')}
 let changes;try{changes=profileEdits(db,{professionId:f.profession_id,scaleId:f.scale_id,effective:f.effective,entries:f.entries})}catch(e){throw new PilotError(422,String(e.message||'Проверьте даты профиля').slice(0,250))}
 // The enclosing store mutation is atomic and each old command checks its
 // exact permission and domain revision. No score or admission is written.
 const items=changes.map(x=>x.old?competencyChange(db,a,{command:'requirement.close',fields:{id:x.old.id,rev:x.old.rev,valid_to:x.payload.valid_to}}):competencyChange(db,a,{command:'requirement.create',fields:x.payload}));
 return {changed:items.length,items};
}
