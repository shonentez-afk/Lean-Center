export {sharedTrainingTask} from './training-facts.js';
// TWI standard 03: persisted preparation, knowledge-bank revisions and supplement requests.
import {one,rows,invariant,canonical,isId} from '../../core/primitives.js';
import {validDate} from '../library/sop-review.js';
import {TWI_POLICY} from './standard-v03.js';
import {QUESTION_BANK_V03} from './question-bank-v03.js';
import {preparationProgress} from './preparation-results.js';

export const STANDARD_TYPES=Object.freeze({twi_preparation:'Программа подготовки',twi_knowledge_bank:'Банк вопросов',twi_supplement:'Ходатайство о доплате'});
export const PROGRAM_DOCS=Object.freeze({
 entry:{kind:'entry',title:'План ввода в профессию',appendix:1},
 adaptation:{kind:'entry',title:'План адаптации по профессии',appendix:2},
 safety:{kind:'production',title:'Программа обучения безопасным методам и приёмам',appendix:3},
 internship:{kind:'internship',title:'Программа стажировки',appendix:4},
 production:{kind:'production',title:'Производственное обучение',appendix:6}
});
export const SUPPLEMENT_TASKS=Object.freeze({
 internal_trainer:[
 ['sop','Управление СОПами: шаблоны, согласование, хранение и своевременное обновление'],
 ['instructors','Подготовка инструкторов'],
 ['training_plan','Планирование обучения согласно матрице компетенций'],
 ['matrix','Актуализация матрицы компетенций'],
 ['audit_plan','Разработка графиков аудитов инструктажей'],
 ['audit','Аудит и ротация инструкторов (годовая норма L1)'],
 ['motivation','Стимулирование и мотивация'],
 ['best_practices','Обмен лучшими практиками, унификация обслуживания оборудования'],
 ['connections','Связи с инструкторами, HR и другими ПП; Клуб наставников, стенды TWI'],
 ['continuous','Организация непрерывного обучения'],
 ['reporting','Ведение отчётности и статистики TWI, актуализация ресурсов'],
 ['meetings','Участие в общих собраниях TWI СБЕ МИ']
 ],
 instructor:[
 ['analysis','Анализ операций: декомпозиция, классификация, ранжирование, матрица компетенций'],
 ['sop','Разработка и актуализация СОП'],
 ['instruction','Проведение производственных инструктажей'],
 ['support','Помощь в овладении стандартизированной работой по СОП'],
 ['improvement','Совершенствование существующих методов и стандартов работы'],
 ['exchange','Обмен опытом, участие в Клубе наставников']
 ]
});
export const isLC64Event=e=>Object.hasOwn(STANDARD_TYPES,e.entity_type)||(e.entity_type==='training_program'&&Object.hasOwn(e.payload||{},'standard_kind'))||(e.entity_type==='training_assignment'&&Object.hasOwn(e.payload||{},'method_version'));
const exact=(o,k)=>invariant(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x)),'Некорректные поля TWI 03');
const text=(v,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const day=e=>new Date(Date.parse(e.occurred_at)+14*3600000).toISOString().slice(0,10);
const active=(db,t,id)=>{invariant(isId(id),'Выберите '+t);const r=one(db,'SELECT * FROM '+t+' WHERE id=?',[id]);invariant(r&&!r.archived,'Запись недоступна: '+t);return r};
const insert=(db,t,o)=>{const k=Object.keys(o);db.run('INSERT INTO '+t+'('+k.join(',')+') VALUES('+k.map(()=>'?').join(',')+')',k.map(x=>o[x]))};
const update=(db,t,id,o)=>{const k=Object.keys(o);db.run('UPDATE '+t+' SET '+k.map(x=>x+'=?').join(',')+',rev=rev+1 WHERE id=?',[...k.map(x=>o[x]),id])};
const onlyCreate=(e,old)=>invariant(!old&&e.operation==='create','Создайте отдельную запись');
const monthEnd=(d,m)=>{const [y,mo,n]=d.split('-').map(Number);const a=new Date(Date.UTC(y,mo-1+m,1)),last=new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+1,0)).getUTCDate();a.setUTCDate(Math.min(n,last));a.setUTCDate(a.getUTCDate()-1);return a.toISOString().slice(0,10)};
export function adaptationBounds(start,category){invariant(validDate(start)&&['new','transfer'].includes(category),'Укажите дату начала и категорию подготовки');return {min:monthEnd(start,1),max:monthEnd(start,category==='transfer'?1:3)}}
const doc=(db,id)=>one(db,'SELECT e.*,p.title,p.kind,p.standard_kind,p.version_no FROM training_enrollment e JOIN training_program p ON p.id=e.program_id WHERE e.id=?',[id]);
const key=t=>canonical([t.sop_revision_id,t.skill_id,t.scale_id,t.target_level]);
export function preparationRows(db,personId=''){
 return rows(db,'SELECT * FROM twi_preparation ORDER BY created_at DESC,id').map(x=>({...x,documents:[doc(db,x.adaptation_id),doc(db,x.safety_id),doc(db,x.internship_id)],shifts:JSON.parse(x.shifts_json),shared:rows(db,'SELECT * FROM twi_preparation_shared WHERE preparation_id=?',[x.id]),progress:preparationProgress(db,x)})).filter(x=>!personId||[x.trainee_id,x.manager_id,...x.documents.flatMap(d=>[d?.mentor_id,d?.manager_id])].includes(personId))
}
export function preparationState(r){return r.progress?.status|| (r.documents.some(d=>!d||d.state==='cancelled')?'Требует решения':r.documents.every(d=>d.state==='completed')?'Все три документа завершены':'В процессе')}
export function bankRows(db){return rows(db,'SELECT * FROM twi_knowledge_bank ORDER BY reviewed_on DESC,version_no DESC,id').map(x=>({...x,blocks:JSON.parse(x.blocks_json)}))}
const norm=s=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU');
export function bankChanges(previous,next){
 return previous.map(b=>{const n=next.find(x=>x.id===b.id),old=new Map(b.questions.map(q=>[q.id,norm(q.text)])),oldTexts=new Set(old.values()),counted=new Set();let changed=0;
  for(const q of n?.questions||[]){const t=norm(q.text);if(old.get(q.id)===t||oldTexts.has(t)||counted.has(t))continue;counted.add(t);changed++}
  const required=Math.ceil(b.questions.length*TWI_POLICY.questionUpdateMin);return {id:b.id,title:b.title,previous:b.questions.length,changed,required,ok:changed>=required}
 })
}
export function bankBaseline(db,professionId,reviewedOn){return bankRows(db).filter(x=>x.profession_id===professionId&&x.reviewed_on.slice(0,4)<reviewedOn.slice(0,4))[0]||null}
function validateBlocks(blocks){
 invariant(Array.isArray(blocks)&&blocks.length===QUESTION_BANK_V03.blocks.length,'Нужны все пять блоков приложения 10');const seen=new Set();
 for(let i=0;i<blocks.length;i++){const b=blocks[i],ref=QUESTION_BANK_V03.blocks[i];exact(b,['id','title','questions']);invariant(b.id===ref.id&&b.title===ref.title&&Array.isArray(b.questions)&&b.questions.length>0&&b.questions.length<=300,'Состав блока не соответствует приложению 10');for(let j=0;j<b.questions.length;j++){const q=b.questions[j];exact(q,['id','number','text']);invariant(typeof q.id==='string'&&/^[a-z0-9_-]{1,100}$/.test(q.id)&&!seen.has(q.id)&&q.number===j+1&&text(q.text),'Некорректный или повторный вопрос');seen.add(q.id)}}
}
export function bankControl(db,asOf){
 const list=bankRows(db),scopes=new Map();for(const x of list.filter(x=>x.reviewed_on<=asOf)){const k=x.profession_id||'';if(!scopes.has(k))scopes.set(k,x)}return [...scopes.values()].map(x=>{const year=asOf.slice(0,4),base=bankBaseline(db,x.profession_id,year+'-01-01'),changes=base?bankChanges(base.blocks,x.blocks):[];return {...x,year,changes,stale:x.reviewed_on.slice(0,4)<year,status:x.reviewed_on.slice(0,4)<year?'Требуется актуализация за '+year:base?'Актуализация подтверждена':'Исходная версия'}})
}
export function supplementRows(db,personId=''){return rows(db,'SELECT * FROM twi_supplement ORDER BY month DESC,created_at DESC,id').map(x=>({...x,tasks:JSON.parse(x.tasks_json)})).filter(x=>!personId||x.person_id===personId||x.manager_id===personId)}
export function supplementStatus(role,tasks){const rule=TWI_POLICY.supplement[role];return {count:new Set(tasks.map(x=>x.code)).size,minimum:rule?.minTasks??null,amount:rule?.amount??null,eligible:!!rule&&new Set(tasks.map(x=>x.code)).size>=rule.minTasks}}
function checkSupplement(db,personId,role,month,tasks,asOf){
 invariant(Object.hasOwn(SUPPLEMENT_TASKS,role)&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month>='2025-01'&&month<=asOf.slice(0,7),'Укажите календарный месяц и роль инструктора или ВТ');
 const codes=new Set(SUPPLEMENT_TASKS[role].map(x=>x[0])),seen=new Set(),certs=rows(db,"SELECT * FROM mentor_credential WHERE person_id=? AND role=? AND kind='certificate'",[personId,role]);
 const valid=d=>certs.some(c=>c.issued_on<=d&&(!c.valid_until||c.valid_until>=d)&&(!c.revoked_at||c.revoked_at.slice(0,10)>d));
 invariant(certs.some(c=>c.issued_on<=month+'-31'&&(!c.valid_until||c.valid_until>=month+'-01')&&(!c.revoked_at||c.revoked_at.slice(0,10)>month+'-01')),'Нет сертификата этой роли в указанном месяце');
 invariant(Array.isArray(tasks)&&tasks.length<=codes.size,'Некорректный список задач');
 for(const x of tasks){exact(x,['code','done_on','evidence']);invariant(codes.has(x.code)&&!seen.has(x.code)&&validDate(x.done_on)&&x.done_on.slice(0,7)===month&&x.done_on<=asOf&&valid(x.done_on)&&text(x.evidence),'Каждая задача должна быть уникальна, выполнена в месяце при действующем сертификате и иметь основание');seen.add(x.code)}
}
export function applyStandardEvent(db,e,old){
 const p=e.payload,t=e.entity_type,id=e.entity_id,asOf=day(e);
 if(t==='twi_preparation'){
  onlyCreate(e,old);exact(p,['trainee_id','manager_id','category','adaptation_id','safety_id','internship_id','shifts','note']);
  active(db,'person',p.trainee_id);active(db,'person',p.manager_id);invariant(p.trainee_id!==p.manager_id&&text(p.note),'Укажите руководителя и основание');
  const docs=[doc(db,p.adaptation_id),doc(db,p.safety_id),doc(db,p.internship_id)],kinds=['adaptation','safety','internship'];
  invariant(new Set(docs.map(x=>x?.id)).size===3&&docs.every((x,i)=>x&&x.standard_kind===kinds[i]&&x.trainee_id===p.trainee_id&&x.state!=='cancelled'),'Выберите три разных документа подготовки одного сотрудника');
  const [a,s,j]=docs,b=adaptationBounds(a.start_on,p.category);
  invariant(a.due_on>=b.min&&a.due_on<=b.max,'Срок адаптации: новый сотрудник 1–3 месяца, перевод 1 месяц');
  invariant([s,j].every(x=>x.start_on>=a.start_on&&x.due_on<=a.due_on),'ОТ и стажировка должны входить в период адаптации');
  invariant(!one(db,'SELECT id FROM twi_preparation WHERE adaptation_id=? OR safety_id=? OR internship_id=?',[a.id,s.id,j.id]),'Документ уже связан с программой подготовки');
  invariant(Array.isArray(p.shifts)&&p.shifts.length>=TWI_POLICY.internshipMinShifts&&p.shifts.length<=366,'Запланируйте не менее двух смен стажировки');const seen=new Set();
  for(const v of p.shifts){exact(v,['date','shift_id']);active(db,'work_shift',v.shift_id);const k=v.date+':'+v.shift_id;invariant(validDate(v.date)&&v.date>=j.start_on&&v.date<=j.due_on&&!seen.has(k),'Смены должны быть разными и входить в срок стажировки');seen.add(k)}
  const tasks=x=>rows(db,'SELECT * FROM training_program_task WHERE program_id=? AND sop_revision_id IS NOT NULL',[x.program_id]),intern=tasks(j),mapping=[];
  for(const task of tasks(a)){const same=intern.filter(v=>key(v)===key(task));if(!same.length)continue;invariant(same.length===1&&!mapping.some(x=>x.internship_task_id===same[0].id),'Неоднозначное соответствие базовых операций; уточните шаблоны');
   invariant(!one(db,"SELECT id FROM training_assignment WHERE enrollment_id=? AND program_task_id=? AND state<>'cancelled'",[a.id,task.id]),'Сначала свяжите документы, затем назначайте общие инструктажи; в адаптации уже есть отдельное назначение');
   mapping.push({preparation_id:id,adaptation_task_id:task.id,internship_task_id:same[0].id})
  }
  const {shifts,...o}=p;insert(db,t,{id,...o,shifts_json:canonical(shifts),created_at:e.occurred_at,rev:1});for(const m of mapping)insert(db,'twi_preparation_shared',m);return
 }
 if(t==='twi_knowledge_bank'){
  onlyCreate(e,old);exact(p,['profession_id','author_id','reviewed_on','previous_id','note','blocks']);if(p.profession_id!==null)active(db,'profession',p.profession_id);active(db,'person',p.author_id);
  invariant(validDate(p.reviewed_on)&&p.reviewed_on<=asOf&&text(p.note),'Укажите дату актуализации и основание');validateBlocks(p.blocks);
  const latest=bankRows(db).find(x=>x.profession_id===p.profession_id)||null;invariant(p.previous_id===(latest?.id||null)&&(!latest||p.reviewed_on>=latest.reviewed_on),'Исходная версия банка изменилась или дата предшествует последней редакции');
  const base=bankBaseline(db,p.profession_id,p.reviewed_on);if(base)invariant(bankChanges(base.blocks,p.blocks).every(x=>x.ok),'Ежегодная актуализация: измените или добавьте не менее 10% вопросов каждого блока');
  const {blocks,...o}=p;insert(db,t,{id,...o,version_no:(latest?.version_no||0)+1,blocks_json:canonical(blocks),created_at:e.occurred_at,rev:1});return
 }
 if(t==='twi_supplement'){
  if(!old){onlyCreate(e,old);exact(p,['person_id','manager_id','role','month','tasks']);active(db,'person',p.person_id);active(db,'person',p.manager_id);invariant(p.person_id!==p.manager_id,'Руководитель не может согласовать собственное ходатайство');checkSupplement(db,p.person_id,p.role,p.month,p.tasks,asOf);
   invariant(!one(db,'SELECT id FROM twi_supplement WHERE person_id=? AND role=? AND month=?',[p.person_id,p.role,p.month]),'Ходатайство за эту роль и месяц уже существует');const {tasks,...o}=p;insert(db,t,{id,...o,tasks_json:canonical(tasks),state:'draft',created_at:e.occurred_at,rev:1});return
  }
  invariant(e.operation==='update'&&old.state==='draft','Ходатайство уже рассмотрено; решение хранится в истории');
  if(p.command==='revise'){exact(p,['command','tasks']);checkSupplement(db,old.person_id,old.role,old.month,p.tasks,asOf);update(db,t,id,{tasks_json:canonical(p.tasks)});return}
  exact(p,['command','actor_id','note']);invariant(['approve','decline'].includes(p.command)&&p.actor_id===old.manager_id&&text(p.note),'Решение принимает указанный руководитель с основанием');active(db,'person',p.actor_id);
  const tasks=JSON.parse(old.tasks_json);if(p.command==='approve'){checkSupplement(db,old.person_id,old.role,old.month,tasks,asOf);invariant(supplementStatus(old.role,tasks).eligible,'Не выполнен минимальный объём задач за месяц')}
  update(db,t,id,{state:p.command==='approve'?'approved':'declined',decision_note:p.note,decided_at:e.occurred_at});return
 }
 throw Error('Неизвестная запись TWI 03')
}
