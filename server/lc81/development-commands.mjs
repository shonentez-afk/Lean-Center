// LC8.1: protected development plans and versioned corporate question banks.
import {one,rows,isId,uuid,applyEvent} from '../../src/core/db.js';
import {matrixData} from '../../src/modules/training/domain.js';
import {matrixFromRecord, matrixProjection} from '../../src/modules/training/matrix-view.js';
import {bankRows,bankChanges,bankBaseline} from '../../src/modules/training/standard-workflows.js';
import {QUESTION_BANK_V03} from '../../src/modules/training/question-bank-v03.js';
import {developmentResource,matrixResource,programResource,personWorkResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const must=(v,s,m)=>{if(!v)throw new PilotError(s,m)};
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const txt=(s,n=500)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const who=(a,id)=>a.read('person.read_directory',id)||a.read('person.read_basic',id);
const allowed=(a,k,id,r)=>!!r&&a.allows(k,id,r);
const name=(a,id)=>who(a,id)?.data.display_name??null;
const planRow=(db,id)=>isId(id)?one(db,'SELECT * FROM development_plan WHERE id=?',[id]):null;
const site=(db,a,k)=>{const r=programResource(db);return !!r&&allowed(a,k,r.units[0],r)};
function emit(db,a,t,id,operation,rev,payload,action){
 const event=uuid();
 try{applyEvent(db,{id:event,entity_type:t,entity_id:id,operation,expected_revision:rev,payload,occurred_at:a.at})}
 catch(e){throw new PilotError(422,'Проверка развития: '+String(e.message||'ошибка').split('\n')[0].slice(0,250))}
 a.audit(action,event);return {id,rev:one(db,'SELECT rev FROM '+t+' WHERE id=?',[id]).rev};
}
function skillVisible(db,a,s){
 return s&&(!s.operation_id||a.read('operation.read',s.operation_id));
}
function planAllowed(db,a,p,action,skills=[]){return p&&allowed(a,action,p.id||p.person_id,developmentResource(db,p,a.day,skills))}
export function developmentOptions(db,a){
 must(a.personId&&a.permissions.includes('development.create')&&a.permissions.includes('development.read'),403,'Создание плана недоступно');
 const people=rows(db,'SELECT id,display_name name FROM person WHERE archived=0 ORDER BY display_name,id').filter(p=>p.id!==a.personId&&who(a,p.id)&&planAllowed(db,a,{person_id:p.id,start_on:a.day},'development.create'));
 return {day:a.day,people};
}
export function createDevelopment(db,a,f){
 must(a.personId&&exact(f,['person_id','title','start_on','due_on'])&&isId(f.person_id)&&f.person_id!==a.personId&&txt(f.title)&&date(f.start_on)&&f.start_on>=a.day&&date(f.due_on)&&f.due_on>=f.start_on,400,'Неверные реквизиты плана');
 must(who(a,f.person_id)&&planAllowed(db,a,f,'development.create')&&planAllowed(db,a,f,'development.read'),403,'План выходит за область полномочий');
 return emit(db,a,'development_plan',uuid(),'create',0,f,'development.create');
}
function skillTarget(db,p,g,day){
 const t=JSON.parse(g.target_json),x=g.skill_id?matrixData(db,day).cells.get(p.person_id+':'+g.skill_id):null;
 const actual=x?.valid&&x.revisionCurrent&&x.fact.scale_id===t.scale_id?x.fact.level:null;
 return {...t,actual,reached:g.skill_id!==null&&actual!==null&&actual>=t.target_level};
}
function goalOptions(db,a,p){
 const skills=rows(db,'SELECT id,name,operation_id FROM skill WHERE archived=0 ORDER BY name,id').filter(s=>skillVisible(db,a,s)&&planAllowed(db,a,p,'development.goal.create',[s.id])&&planAllowed(db,a,p,'development.read',[s.id]));
 const scales=rows(db,'SELECT id,name FROM rating_scale WHERE archived=0 ORDER BY name,id').map(s=>({...s,levels:rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[s.id])}));
 return {skills,scales};
}
export function developmentDetail(db,a,id){
 const p=planRow(db,id);must(p&&a.read('development.read',id)&&planAllowed(db,a,p,'development.detail'),404,'План развития недоступен');
 const cap=k=>!!a.personId&&a.personId!==p.person_id&&p.state==='active'&&planAllowed(db,a,p,k);
 const goals=rows(db,'SELECT * FROM development_goal WHERE plan_id=? ORDER BY due_on,id',[id]).map(g=>{
  const s=g.skill_id?one(db,'SELECT id,name,operation_id FROM skill WHERE id=?',[g.skill_id]):null;
  const v=skillTarget(db,p,g,a.day);
  return {id:g.id,rev:g.rev,title:g.title,skill_id:g.skill_id,skill:skillVisible(db,a,s)?s.name:null,due_on:g.due_on,state:g.state,...v};
 });
 return {id:p.id,rev:p.rev,person_id:p.person_id,person_name:name(a,p.person_id),title:p.title,start_on:p.start_on,due_on:p.due_on,state:p.state,goals,day:a.day,can_goal:cap('development.goal.create'),can_close_goal:cap('development.goal.close'),can_close:cap('development.close'),can_task:cap('task.create'),...(cap('development.goal.create')?goalOptions(db,a,p):{})};
}
function goalPayload(db,a,p,g){
 must(exact(g,['skill_id','scale_id','target_level','title','due_on'])&&txt(g.title)&&date(g.due_on)&&g.due_on>=a.day&&g.due_on>=p.start_on&&g.due_on<=p.due_on,400,'Неверная цель или срок');
 if(g.skill_id===null)must(g.scale_id===null&&g.target_level===null,400,'Без навыка не указывается уровень');
 else{
  must(isId(g.skill_id)&&isId(g.scale_id)&&Number.isSafeInteger(g.target_level),400,'Выберите навык и целевой уровень');
  const s=one(db,'SELECT id,name,operation_id FROM skill WHERE id=? AND archived=0',[g.skill_id]);
  must(skillVisible(db,a,s)&&planAllowed(db,a,p,'development.goal.create',[g.skill_id])&&planAllowed(db,a,p,'development.read',[g.skill_id]),403,'Навык недоступен');
  must(one(db,'SELECT l.value FROM rating_level l JOIN rating_scale s ON s.id=l.scale_id WHERE s.archived=0 AND l.scale_id=? AND l.value=?',[g.scale_id,g.target_level]),400,'Уровень недоступен');
  const fact=matrixData(db,a.day).cells.get(p.person_id+':'+g.skill_id);
  must(!(fact?.valid&&fact.revisionCurrent&&fact.fact.scale_id===g.scale_id&&fact.fact.level>=g.target_level),422,'Целевой уровень уже подтверждён');
  const duplicate=rows(db,"SELECT g.target_json FROM development_goal g JOIN development_plan p ON p.id=g.plan_id WHERE p.person_id=? AND p.state='active' AND g.state='open' AND g.skill_id=?",[p.person_id,g.skill_id]).some(x=>{const t=JSON.parse(x.target_json);return t.scale_id===g.scale_id&&t.target_level>=g.target_level});
  must(!duplicate,409,'Уже есть открытая цель не ниже выбранного уровня');
 }
 return {plan_id:p.id,...g};
}
export function changeDevelopment(db,a,f){
 must(a.personId&&exact(f,['id','expected_revision','command','fields'])&&isId(f.id)&&Number.isSafeInteger(f.expected_revision)&&['goal.create','goal.finish','goal.cancel','finish','cancel'].includes(f.command),400,'Неверная команда развития');
 const p=planRow(db,f.id);must(p&&a.read('development.read',p.id)&&a.personId!==p.person_id,404,'План развития недоступен');
 const action=f.command==='goal.create'?'development.goal.create':f.command.startsWith('goal.')?'development.goal.close':'development.close';
 must(planAllowed(db,a,p,action),403,'Нет полномочий на изменение плана');
 must(p.rev===f.expected_revision&&p.state==='active',409,'План изменён или закрыт');
 if(f.command==='goal.create')return emit(db,a,'development_goal',uuid(),'create',0,goalPayload(db,a,p,f.fields),action);
 if(f.command.startsWith('goal.')){
  const v=f.fields;must(exact(v,['goal_id','goal_rev','reason'])&&isId(v.goal_id)&&Number.isSafeInteger(v.goal_rev)&&txt(v.reason,2000),400,'Укажите цель и результат');
  const g=one(db,'SELECT * FROM development_goal WHERE id=? AND plan_id=?',[v.goal_id,p.id]);must(g?.rev===v.goal_rev&&g.state==='open',409,'Цель изменена или закрыта');
  if(f.command==='goal.finish'&&g.skill_id)must(skillTarget(db,p,g,a.day).reached,422,'Целевой уровень ещё не подтверждён оценкой');
  return emit(db,a,'development_goal',g.id,'update',g.rev,{command:f.command.split('.')[1],reason:v.reason},action);
 }
 must(exact(f.fields,['reason'])&&txt(f.fields.reason,2000),400,'Укажите основание');
 return emit(db,a,'development_plan',p.id,'update',p.rev,{command:f.command,reason:f.fields.reason},action);
}
export function developmentFromMatrix(db,a,f){
 must(a.personId&&exact(f,['matrix_id','matrix_rev','person_id','skill_id','target_level','due_on'])&&[f.matrix_id,f.person_id,f.skill_id].every(isId)&&f.person_id!==a.personId&&Number.isSafeInteger(f.matrix_rev)&&Number.isSafeInteger(f.target_level)&&f.target_level>=1&&f.target_level<=4&&date(f.due_on)&&f.due_on>=a.day,400,'Укажите ячейку, уровень и срок');
 const m=a.read('matrix.read',f.matrix_id)&&one(db,'SELECT * FROM competency_matrix WHERE id=?',[f.matrix_id]);must(m,404,'Матрица недоступна');
 const cfg=matrixFromRecord(m),r=matrixResource(db,m.unit_id,cfg.roster,cfg.columns,a.day,m.base_on);
 must(allowed(a,'matrix.detail',m.id,r)&&allowed(a,'development.from_matrix',m.id,r),403,'Нет полномочий на развитие из матрицы');
 must(m.state==='active'&&m.rev===f.matrix_rev&&cfg.roster.some(x=>x.person_id===f.person_id)&&cfg.columns.some(x=>x.skill_id===f.skill_id),409,'Матрица или состав изменились');
 const p={person_id:f.person_id,title:'Развитие по матрице '+m.code,start_on:a.day,due_on:f.due_on};
 must(who(a,p.person_id)&&planAllowed(db,a,p,'development.create',[f.skill_id])&&planAllowed(db,a,p,'development.read',[f.skill_id]),403,'План недоступен');
 const plan=emit(db,a,'development_plan',uuid(),'create',0,p,'development.create');
 const g={skill_id:f.skill_id,scale_id:m.scale_id,target_level:f.target_level,title:'Освоить: '+cfg.columns.find(x=>x.skill_id===f.skill_id).title,due_on:f.due_on};
 const goal=emit(db,a,'development_goal',uuid(),'create',0,goalPayload(db,a,{...p,id:plan.id},g),'development.goal.create');
 return {id:plan.id,goal_id:goal.id};
}
export function bankOptions(db,a){
 must(a.personId&&site(db,a,'bank.save')&&site(db,a,'bank.read'),403,'Банк вопросов недоступен');
 return {day:a.day,professions:rows(db,'SELECT id,name FROM profession WHERE archived=0 ORDER BY name,id'),template:QUESTION_BANK_V03.blocks};
}
export function bankDetail(db,a,id){
 const b=isId(id)&&a.read('bank.read',id)&&bankRows(db).find(x=>x.id===id);
 must(b&&site(db,a,'bank.detail'),404,'Редакция банка недоступна');
 const latest=bankRows(db).find(x=>x.profession_id===b.profession_id),base=bankBaseline(db,b.profession_id,b.reviewed_on);
 return {id:b.id,profession_id:b.profession_id,profession:one(db,'SELECT name FROM profession WHERE id=?',[b.profession_id])?.name??'Общий',version_no:b.version_no,reviewed_on:b.reviewed_on,note:b.note,blocks:b.blocks,changes:base?bankChanges(base.blocks,b.blocks):[],can_revise:!!a.personId&&latest?.id===b.id&&site(db,a,'bank.save')};
}
export function saveBank(db,a,f){
 must(a.personId&&site(db,a,'bank.save')&&site(db,a,'bank.read'),403,'Банк вопросов недоступен');
 must(exact(f,['profession_id','reviewed_on','previous_id','note','blocks'])&&(f.profession_id===null||isId(f.profession_id))&&(f.previous_id===null||isId(f.previous_id))&&date(f.reviewed_on)&&f.reviewed_on<=a.day&&txt(f.note,2000)&&Array.isArray(f.blocks)&&f.blocks.length===QUESTION_BANK_V03.blocks.length&&f.blocks.every(b=>Array.isArray(b.questions)&&b.questions.length<=300),400,'Неверные реквизиты банка');
 const latest=bankRows(db).find(x=>x.profession_id===f.profession_id);
 must(f.previous_id===(latest?.id??null),409,'Банк уже актуализирован');
 return emit(db,a,'twi_knowledge_bank',uuid(),'create',0,{...f,author_id:a.personId},'bank.save');
}
export function developmentView(db,a,action,data){
 if(action==='bank.read')return {...data,profession:one(db,'SELECT name FROM profession WHERE id=?',[data.profession_id])?.name??'Общий',can_detail:site(db,a,'bank.detail')};
 const p=planRow(db,data.id);return {...data,person_name:name(a,p.person_id),can_detail:planAllowed(db,a,p,'development.detail')};
}
