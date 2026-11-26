// Standard 03 §3.4. Independent evidence, no duplicate qualifications or automatic admission.
import {one,rows,canonical,invariant,isId} from '../../core/db.js';
import {validDate} from '../library/sop-review.js';
import {enrollmentTasks,progressFor,latestAssessment,isCurrentStandard,certificateValid} from './domain.js';
import {PRACTICAL_V03} from './standard-v03.js';

export const PREPARATION_FACT_TYPES=Object.freeze({twi_preparation_fact:'Факт подготовки / протокол'});
export const isLC65Event=e=>e.entity_type==='twi_preparation_fact'||(e.entity_type==='training_assignment'&&e.payload?.method_version==='JI-2');
export const THEORY_BLOCKS=['technology','quality','equipment','lean'];
export const COMMISSION_ROLES={manager:'Непосредственный руководитель',mentor:'Наставник',trainer:'Внутренний тренер',agent:'Агент перемен',hr:'Сотрудник отдела персонала'};
export const RESULT_LABELS={completed:'Завершена',incomplete:'Не завершена',pass:'Пройдено',fail:'Не пройдено',not_meet:'Не соответствует',basic:'Соответствует базовому уровню ЗУН',exceeds:'Превосходит базовый уровень ЗУН'};
const parse=s=>JSON.parse(s);
const dateOf=d=>String(d||'').slice(0,10);
const required=(s,n=4000)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const exact=(v,k)=>invariant(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x)),'Некорректные поля факта подготовки');
const day=e=>new Date(Date.parse(e.occurred_at)+14*3600000).toISOString().slice(0,10);
const person=(db,id)=>{invariant(isId(id)&&one(db,'SELECT id FROM person WHERE id=? AND archived=0',[id]),'Выберите сотрудника из справочника');return id};
const active=(db,t,id)=>isId(id)&&one(db,'SELECT id FROM '+t+' WHERE id=? AND archived=0',[id]);
const enrollment=(db,id)=>one(db,'SELECT * FROM training_enrollment WHERE id=?',[id]);
const latest=(facts,kind)=>facts.find(f=>f.kind===kind)||null;
export function preparationFacts(db,id){return rows(db,'SELECT * FROM twi_preparation_fact WHERE preparation_id=? ORDER BY fact_on DESC,recorded_at DESC,id DESC',[id]).map(x=>({...x,data:parse(x.payload_json)}))}
export function preparationForEnrollment(db,id){return one(db,'SELECT * FROM twi_preparation WHERE adaptation_id=? OR safety_id=? OR internship_id=?',[id,id,id])}
export function preparationShiftFacts(facts){const by=new Map();for(const f of facts.filter(x=>x.kind==='shift')){const k=f.fact_on+':'+f.data.shift_id;if(!by.has(k))by.set(k,f)}return [...by.values()].sort((a,b)=>a.fact_on.localeCompare(b.fact_on)||a.data.shift_id.localeCompare(b.data.shift_id))}
export function exactPracticalMethod(db,id){
 const m=one(db,'SELECT methodology_json FROM checklist_version WHERE id=?',[id]);if(!m)return false;
 const p=parse(m.methodology_json);return p.format===PRACTICAL_V03.format&&canonical((p.criteria||[]).map(q=>[q.code,q.section,q.question]))===canonical(PRACTICAL_V03.criteria.map(q=>[q.code,q.section,q.question]))
}
// Only the actual training through step 4 counts as completed training in preparation.
// Subsequent checks remain open in their own instruction, not in the internship period.
export function preparationTrainingDone(db,a){
 if(!a||a.state==='cancelled')return false;const p=progressFor(db,a);return p.intro&&p.done.has('support')
}
function taskEvidence(db,n,{mainOnly=false}={}){
 if(!n||n.state==='cancelled')return {tasks:[],operations:[],ready:false,positive:false,refs:[],dates:[]};
 const tasks=enrollmentTasks(db,n).filter(t=>!(mainOnly&&t.sop_revision_id&&t.shared));
 const refs=[],dates=[],operations=[];
 let ready=tasks.length>0,positive=true;
 for(const t of tasks){
  if(!t.sop_revision_id){const r=t.result;refs.push([t.id,r?.id||null]);if(r)dates.push(r.held_on);if(r?.result!=='completed')ready=false;continue}
  const a=t.assignment,pr=a?progressFor(db,a):null,finished=!!(pr&&a.state!=='cancelled'&&pr.intro&&pr.done.has('support')),p=a&&latestAssessment(db,a.id,'practical'),q=a&&latestAssessment(db,a.id,'qualification'),item=q&&one(db,'SELECT * FROM assessment_item WHERE session_id=?',[q.id]);
  const coreFacts=pr?.facts.filter(f=>pr.stages.some(s=>s.code===f.stage_code&&s.phase!=='followup'))||[];
  const exact=!!(p&&exactPracticalMethod(db,p.method_id)),linked=!!(q&&p&&q.practical_id===p.id&&item?.skill_id===t.skill_id&&item?.scale_id===t.scale_id);
  const rated=linked&&item.observation_state==='rated'&&[1,2,3,4].includes(item.level),valid=!!(a&&a.sop_revision_id===t.sop_revision_id&&a.skill_id===t.skill_id&&isCurrentStandard(db,a.sop_revision_id));
  const observed=!!(finished&&valid&&exact&&p&&(p.conclusion==='not_meet'||rated));
  const ok=!!(observed&&p.conclusion!=='not_meet'&&rated);
  operations.push({task:t,assignment:a,practical:p,qualification:linked?q:null,level:rated?item.level:null,validUntil:rated?item.valid_until:null,observed,ok,exact});
  refs.push([t.id,a?.id||null,coreFacts.map(x=>x.id),p?.id||null,linked?q.id:null,item?.id||null,valid]);
  dates.push(...coreFacts.map(f=>dateOf(f.held_at)),...(p?[dateOf(p.assessed_at)]:[]),...(linked?[dateOf(q.assessed_at)]:[]));
  if(!observed)ready=false;if(!ok)positive=false
 }
 return {tasks,operations,ready,positive,refs,dates}
}
const validLevels=(x,on)=>x.operations.every(o=>!o.validUntil||o.validUntil>=on);
const before=(dates,d)=>dates.every(v=>v&&v<=d);
const same=(a,b)=>canonical(a)===canonical(b);
function currentStage(db,b,facts,kind){
 const fact=latest(facts,kind);
 const n=enrollment(db,kind==='safety'?b.safety_id:b.internship_id);
 const e=taskEvidence(db,n);if(!fact)return {fact:null,current:false,pass:false,evidence:e};
 const shifts=kind==='internship'?preparationShiftFacts(facts):[],completed=shifts.filter(x=>x.data.result==='completed');
 const snapshot={tasks:e.refs,...(kind==='internship'?{shifts:completed.map(x=>x.id)}:{})};
 const current=!!(e.ready&&(kind==='safety'||e.operations.length>0&&completed.length>=2)&&before(e.dates,fact.fact_on)&&completed.every(x=>x.fact_on<=fact.fact_on)&&validLevels(e,fact.fact_on)&&same(snapshot,fact.data.snapshot));
 const pass=current&&fact.data.result==='pass'&&e.positive;return {fact,current,pass,evidence:e}
}
function currentQuestions(db,b,facts){
 const fact=latest(facts,'questions');if(!fact)return null;
 const bank=one(db,'SELECT * FROM twi_knowledge_bank WHERE id=?',[fact.data.bank_id]);if(!bank)return null;
 const blocks=parse(bank.blocks_json);
 const issued=fact.data.blocks.map(x=>({id:x.block,questions:x.question_ids.map(id=>blocks.find(b=>b.id===x.block)?.questions.find(q=>q.id===id)).filter(Boolean)}));
 return {fact,bank,issued}
}
export function preparationProgress(db,b){
 const facts=preparationFacts(db,b.id),shifts=preparationShiftFacts(facts),safety=currentStage(db,b,facts,'safety'),internship=currentStage(db,b,facts,'internship'),questions=currentQuestions(db,b,facts),main=taskEvidence(db,enrollment(db,b.adaptation_id),{mainOnly:true}),commission=latest(facts,'commission');
 const snapshot={safety:safety.fact?.id||null,internship:internship.fact?.id||null,questions:questions?.fact.id||null,tasks:main.refs};
 const current=!!(commission&&safety.current&&internship.current&&questions&&main.ready&&main.operations.length>0&&validLevels(main,commission.fact_on)&&before(main.dates,commission.fact_on)&&safety.fact.fact_on<=commission.fact_on&&internship.fact.fact_on<=commission.fact_on&&questions.fact.fact_on<commission.fact_on&&same(snapshot,commission.data.snapshot));
 const positive=current&&safety.pass&&internship.pass&&main.positive&&commission.data.theory.every(x=>x.result==='pass')&&commission.data.conclusion!=='not_meet';
 const documents=[b.adaptation_id,b.safety_id,b.internship_id].map(id=>enrollment(db,id));
 const status=documents.some(x=>!x||x.state==='cancelled')?'Требует решения':commission&&!current?'Требует повторной проверки':current&&commission.data.conclusion==='not_meet'?'Не соответствует':positive?(documents.every(x=>x.state==='completed')?'Комплект завершён':'Решение положительное · завершите документы'):'В процессе подготовки';
 return {facts,shifts,safety,internship,questions,main,commission,current,positive,status,snapshot}
}
export function preparationFinishAllowed(db,n,conclusion){
 const b=preparationForEnrollment(db,n.id);if(!b)return;
 const q=preparationProgress(db,b);
 if(n.id===b.adaptation_id)invariant(q.current&&q.commission.data.conclusion===conclusion,'Сначала зарегистрируйте актуальное решение комиссии и укажите такое же заключение');
 else {const stage=n.id===b.safety_id?q.safety:q.internship;invariant(stage.current&&(stage.fact.data.result==='pass')===(conclusion!=='not_meet'),'Сначала зарегистрируйте актуальный протокол / итог стажировки с соответствующим заключением')}
}
function validateQuestionIssue(db,b,p){
 exact(p.data,['bank_id','blocks','note']);invariant(required(p.data.note),'Укажите основание выдачи вопросов');
 const bank=one(db,'SELECT * FROM twi_knowledge_bank WHERE id=?',[p.data.bank_id]);
 const n=enrollment(db,b.adaptation_id),profession=one(db,"SELECT profession_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[b.trainee_id,n.start_on,n.start_on])?.profession_id||null;
 invariant(bank&&bank.reviewed_on<=p.fact_on&&(bank.profession_id===null||bank.profession_id===profession),'Выберите действующую на дату выдачи редакцию вопросов для этой профессии или общий перечень');
 const latest=one(db,"SELECT id FROM twi_knowledge_bank WHERE profession_id IS ? AND reviewed_on<=? ORDER BY version_no DESC LIMIT 1",[bank.profession_id,p.fact_on]);invariant(latest?.id===bank.id,'Выберите последнюю редакцию банка на дату выдачи');
 const blocks=parse(bank.blocks_json);invariant(Array.isArray(p.data.blocks)&&p.data.blocks.length===4,'Укажите вопросы по четырём профессиональным блокам');
 for(let i=0;i<THEORY_BLOCKS.length;i++){const x=p.data.blocks[i];exact(x,['block','question_ids']);const block=blocks.find(b=>b.id===x.block);invariant(x.block===THEORY_BLOCKS[i]&&Array.isArray(x.question_ids)&&x.question_ids.length>0&&new Set(x.question_ids).size===x.question_ids.length&&x.question_ids.every(id=>block?.questions.some(q=>q.id===id)),'Выберите вопросы каждого блока из указанной редакции')}
 return p.data
}
export function applyPreparationEvent(db,e,old){
 const p=e.payload;invariant(!old&&e.operation==='create','Факты неизменяемы; зарегистрируйте повторную проверку / уточнение');
 exact(p,['preparation_id','kind','actor_id','fact_on','data']);
 const b=one(db,'SELECT * FROM twi_preparation WHERE id=?',[p.preparation_id]);invariant(b,'Комплект подготовки не найден');person(db,p.actor_id);
 invariant(p.actor_id!==b.trainee_id&&validDate(p.fact_on)&&p.fact_on<=day(e),'Укажите фактическую дату и отдельного ответственного');
 const n=enrollment(db,b.adaptation_id),s=enrollment(db,b.safety_id),j=enrollment(db,b.internship_id),q=preparationProgress(db,b);
 invariant(n&&s&&j&&[n,s,j].every(x=>x.state!=='cancelled')&&p.fact_on>=n.start_on,'Нельзя регистрировать факты отменённой или ещё не начавшейся подготовки');
 const last=latest(q.facts,p.kind);if(last&&p.kind!=='shift')invariant(p.fact_on>=last.fact_on,'Не подменяйте историю более ранним фактом');
 let data;
 if(p.kind==='shift'){
  exact(p.data,['shift_id','result','minutes','note']);invariant(p.fact_on>=j.start_on&&p.fact_on<=j.due_on&&active(db,'work_shift',p.data.shift_id)&&['completed','incomplete'].includes(p.data.result)&&Number.isSafeInteger(p.data.minutes)&&p.data.minutes>0&&p.data.minutes<=1440&&required(p.data.note),'Укажите фактически отработанную смену, результат и основание в периоде стажировки');
  invariant([j.mentor_id,j.manager_id,b.manager_id].includes(p.actor_id),'Факт смены подтверждает наставник стажировки или руководитель');
  data=p.data
 }else if(p.kind==='questions'){data=validateQuestionIssue(db,b,p)}
 else if(p.kind==='safety'||p.kind==='internship'){
  const isSafety=p.kind==='safety',doc=isSafety?s:j,te=taskEvidence(db,doc),completed=isSafety?[]:q.shifts.filter(x=>x.data.result==='completed');
  exact(p.data,['result','reference','feedback']);invariant(['pass','fail'].includes(p.data.result)&&required(p.data.reference)&&required(p.data.feedback),'Укажите результат, реквизиты протокола / отметки и обратную связь');
  invariant(p.fact_on>=doc.start_on&&te.ready&&before(te.dates,p.fact_on)&&validLevels(te,p.fact_on),'Сначала зарегистрируйте факты обучения и оценки по действующим СОП и приложению 9');
  if(!isSafety)invariant(completed.length>=2&&completed.every(x=>x.fact_on<=p.fact_on)&&te.operations.length>0,'Не менее двух фактически завершённых смен и оценка базовых операций');
  if(p.data.result==='pass')invariant(te.positive,'Положительный итог требует положительной практики и подтверждённого уровня по каждой операции');
  data={...p.data,snapshot:{tasks:te.refs,...(!isSafety?{shifts:completed.map(x=>x.id)}:{})}}
 }else if(p.kind==='commission'){
  exact(p.data,['members','theory','conclusion','reference','feedback']);exact(p.data.members,Object.keys(COMMISSION_ROLES));
  for(const id of Object.values(p.data.members)){person(db,id);invariant(id!==b.trainee_id,'Обучаемый не входит в комиссию')}
  invariant(new Set(Object.values(p.data.members)).size===5&&p.actor_id===b.manager_id&&p.data.members.manager===b.manager_id&&p.data.members.mentor===n.mentor_id,'Укажите пять участников комиссии: руководителя и наставника комплекта, ВТ, агента перемен и HR; решение регистрирует руководитель');
  const trainer=p.data.members.trainer;invariant(rows(db,"SELECT id FROM mentor_credential WHERE person_id=? AND role='internal_trainer' AND kind='certificate'",[trainer]).some(c=>certificateValid(db,c.id,p.fact_on)),'У ВТ комиссии должен быть действующий сертификат');
  invariant(q.safety.current&&q.internship.current&&q.safety.fact.fact_on<=p.fact_on&&q.internship.fact.fact_on<=p.fact_on,'Сначала зарегистрируйте актуальные результаты ОТ и стажировки');
  invariant(q.questions&&q.questions.fact.fact_on<p.fact_on,'Сначала выдайте вопросы четырёх блоков заранее');
  invariant(q.main.ready&&q.main.operations.length>0&&before(q.main.dates,p.fact_on)&&validLevels(q.main,p.fact_on),'Нужны факты обучения и оценка основных операций по приложению 9');
  invariant(Array.isArray(p.data.theory)&&p.data.theory.length===4,'Укажите результаты четырёх блоков теории');
  p.data.theory.forEach((x,i)=>{exact(x,['block','result','note']);invariant(x.block===THEORY_BLOCKS[i]&&['pass','fail'].includes(x.result)&&required(x.note),'Заполните фактический результат и основание каждого блока')});
  invariant(['not_meet','basic','exceeds'].includes(p.data.conclusion)&&required(p.data.reference)&&required(p.data.feedback),'Укажите заключение комиссии, реквизиты и рекомендации по развитию');
  if(p.data.conclusion!=='not_meet')invariant(q.safety.pass&&q.internship.pass&&q.main.positive&&p.data.theory.every(x=>x.result==='pass'),'Положительное решение возможно только при положительных результатах всех этапов');
  data={...p.data,snapshot:q.snapshot}
 }else throw Error('Неизвестный этап подготовки');
 db.run('INSERT INTO twi_preparation_fact(id,preparation_id,kind,actor_id,fact_on,payload_json,recorded_at,rev) VALUES(?,?,?,?,?,?,?,1)',[e.entity_id,b.id,p.kind,p.actor_id,p.fact_on,canonical(data),e.occurred_at])
}
