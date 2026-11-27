// Subject reports use the LC7 domain projections, not a second scoring engine.
// A detailed aggregate is withheld unless its complete source cohort is readable.
import {one,rows,isId} from '../../src/core/db.js';
import {validDate} from '../../src/modules/library/sop-review.js';
import {auditRegistry,summarizeAudits,annualAuditCoverage} from '../../src/modules/training/audit-analytics.js';
import {assessmentRegistry,assessmentSummary,assessmentAnswers,assessmentScore} from '../../src/modules/training/assessment-review.js';
import {compareMentor} from '../../src/modules/training/mentor-comparison.js';
import {preparationControl,preparationStats,prepLabels} from '../../src/modules/training/standard-overview.js';
import {twiOverview} from '../../src/modules/training/twi-effectiveness.js';
import {corporateEvaluations,corporateAnswers,weightedHistory} from '../../src/modules/library/sop-assessment-review.js';
import {frvRegistry,frvLosses} from '../../src/modules/library/frv-effect.js';
import {effectOverview,effectStatus} from '../../src/modules/effect/domain.js';
import {actionRows,actionStatus,ACTION_STATES} from '../../src/modules/training/audit-domain.js';
import {matrixData,coverageData} from '../../src/modules/training/domain.js';
import {personUnit,centerProjection} from '../../src/modules/training/center-overview.js';
import {splitEvidence} from '../../src/modules/training/metric-catalog.js';
import {programResource,trainingAssignmentResource} from './read-policy.mjs';
import {recordAccess,centerWorkspace,financialScope,financialRecordAllowed} from './center-commands.mjs';
import {historyAllowed,isHistoricalRC1} from './rc1-history.mjs';
import {evaluationAccess} from './sop-evaluation-commands.mjs';
import {excelJS} from './form-commands.mjs';
import {PilotError} from '../lc74-store.mjs';
import {createHash} from 'node:crypto';
const must=(x,s,m)=>{if(!x)throw new PilotError(s,m)};
const exact=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===k.length&&k.every(y=>Object.hasOwn(x,y));
const site=(db,a,k)=>{const r=programResource(db);return !!r&&a.scope(k,r.units[0],r)};
const who=(a,id)=>id?(a.read('person.read_directory',id)||a.read('person.read_basic',id))?.data.display_name??null:null;
const name=(a,k,id)=>id?a.read(k,id)?.data.name??null:null;
const AUDIT=['audit.read','audit.detail'],PRACTICE=['assessment.read','assessment.detail','training.read','training.detail'],SELF=['self.read','self.detail'],SOP=['sop.read_history','sop.evaluation.read'],TASK=['task.read','task.detail'],PREP=['preparation.read','preparation.detail','training.enrollment.read','training.enrollment.detail',...PRACTICE],SKILL=['skill.read','requirement.read','coverage.read','assessment.read','assessment.detail'],TWI=['training.read','training.detail','training.enrollment.read','training.enrollment.detail','program.read','program.detail','sop.read_history','sop.read_effective',...PRACTICE,...AUDIT,...SELF,...TASK,...SKILL];
const BASE=['analytics.read','org.read','person.read_basic'];
const specs={
 preparation:{label:'Подготовка сотрудников',rights:PREP,filters:['person','state']},
 twi_effect:{label:'Эффективность TWI',rights:TWI,filters:['person','role','operation','revision','program']},
 practical:{label:'Практические оценки',rights:PRACTICE,filters:['method','person','shift']},
 competence:{label:'Компетенции и обеспеченность',rights:SKILL,filters:['person','shift']},
 audit:{label:'Аудит L1',rights:AUDIT,filters:['method','person','shift']},
 self_eval:{label:'Самооценка',rights:SELF,filters:['method','person','shift']},
 comparison:{label:'Самооценка и аудиты',rights:[...SELF,...AUDIT,'sop.read_history'],filters:['person','method','self','revision']},
 sop:{label:'Оценки СОП',rights:SOP,filters:['sop_kind','method','person']},
 frv:{label:'ФРВ',rights:['frv.read','frv.read_summary','operation.read'],filters:['person','operation']},
 actions:{label:'Мероприятия и результативность',rights:TASK,filters:['person','state']},
 effect:{label:'Экономическая эффективность',rights:['roi.read','roi.detail'],filters:['person']}
};
const has=(db,a,k)=>Object.hasOwn(specs,k)&&[...BASE,...specs[k].rights].every(x=>site(db,a,x))&&(k!=='effect'||financialScope(db,a));
const personOptions=(db,a)=>rows(db,'SELECT id FROM person ORDER BY display_name,id').flatMap(x=>{const label=who(a,x.id);return label?[{id:x.id,label}]:[]});
const refs=(db,a,table,action)=>rows(db,'SELECT id FROM '+table+' ORDER BY name,id').flatMap(x=>{const label=name(a,action,x.id);return label?[{id:x.id,label}]:[]});
const revisionLabel=(a,id)=>{const x=a.read('sop.read_history',id)?.data;return x?x.code+' · '+x.title+' · v'+x.version_no:null};
const revs=(db,a)=>rows(db,"SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE d.kind='sop' ORDER BY d.code,r.version_no").flatMap(x=>{const label=revisionLabel(a,x.id);return label?[{id:x.id,label}]:[]});
const programs=(db,a)=>rows(db,'SELECT id FROM training_program ORDER BY code,version_no').flatMap(x=>{const v=a.read('program.read',x.id)?.data;return v?[{id:x.id,label:v.code+' · '+v.title+' · v'+v.version_no}]:[]});
const auditRoute=(db,a,x)=>isHistoricalRC1(db,x.id)?historyAllowed(db,a,x.id)?{type:'rc1_history',id:x.id}:null:recordAccess(db,a,'audit',x.id)?{type:'audit',id:x.id}:null;
const weightedKey=e=>createHash('sha256').update(e.methodKey).digest('hex');
const historical=(db,id)=>!!one(db,'SELECT id FROM checklist_version WHERE id=? AND legacy_context_json IS NOT NULL',[id]);
const methods=(db,a,codes)=>rows(db,'SELECT v.id,v.version_no,v.state,v.legacy_context_json,c.code FROM checklist_version v JOIN checklist c ON c.id=v.checklist_id ORDER BY c.code,v.version_no DESC').filter(x=>codes.includes(x.code)&&(!x.legacy_context_json||site(db,a,'audit.history.read'))).map(x=>({id:x.id,label:x.code+' · v'+x.version_no+' · '+(x.legacy_context_json?'Исторический RC1':x.state==='active'?'Действует':'История')}));
const methodOptions=(db,a,k,kind)=>k==='audit'?methods(db,a,['TWI_L1_RC1','TWI_L1_APP13']):k==='comparison'?methods(db,a,['TWI_L1_RC1']).filter(x=>!historical(db,x.id)):k==='self_eval'?methods(db,a,['TWI_SELF_APP12']):k==='practical'?rows(db,"SELECT DISTINCT v.id,v.version_no,c.code FROM assessment_session s JOIN checklist_version v ON v.id=s.method_id JOIN checklist c ON c.id=v.checklist_id WHERE s.assessment_kind='practical' ORDER BY v.version_no DESC").filter(x=>assessmentRegistry(db,'practical').some(q=>q.method_id===x.id&&recordAccess(db,a,'assessment',q.id))).map(x=>({id:x.id,label:x.code+' · v'+x.version_no})):k==='sop'?[...new Map((kind==='weighted_sop'?weightedHistory(db):corporateEvaluations(db)).filter(e=>evaluationAccess(db,a,kind,e.id)).map(e=>[kind==='weighted_sop'?weightedKey(e):e.method_id,{id:kind==='weighted_sop'?weightedKey(e):e.method_id,label:kind==='weighted_sop'?'Набор требований '+weightedKey(e).slice(0,8):'Методика v'+e.method_version}])).values()]:[];
export function subjectOptions(db,a,k=null,kind='sop_evaluation'){
 must(a.permissions.includes('analytics.read'),403,'Аналитика недоступна');
 const reports=Object.entries(specs).filter(([id])=>has(db,a,id)).map(([id,x])=>({id,label:x.label}));
 if(k===null)return {day:a.day,reports};
 must(has(db,a,k),403,'Для полного отчёта необходим доступ к исходным регистрам предприятия');
 must(['sop_evaluation','weighted_sop'].includes(kind),400,'Вид оценки недоступен');
 return {day:a.day,reports,filters:specs[k].filters,units:refs(db,a,'org_unit','org.read'),people:personOptions(db,a),shifts:site(db,a,'shift.read')?refs(db,a,'work_shift','shift.read'):[],operations:site(db,a,'operation.read')?refs(db,a,'operation','operation.read'):[],revisions:site(db,a,'sop.read_history')?revs(db,a):[],programs:site(db,a,'program.read')?programs(db,a):[],methods:methodOptions(db,a,k,kind),selves:k==='comparison'?assessmentRegistry(db,'self_eval').filter(x=>recordAccess(db,a,'self',x.id)&&who(a,x.person_id)).map(x=>({id:x.id,person_id:x.person_id,label:who(a,x.person_id)+' · '+x.date+' · v'+x.version_no})):[]};
}
const labels={all:'Все',open:'Открытые',overdue:'Просроченные',...prepLabels,verified:'Эффект подтверждён',ineffective:'Эффект не подтверждён',implemented:'Ожидает проверки',in_progress:'В работе',cancelled:'Отменено'};
const fields=['kind','from','to','unit_id','person_id','shift_id','operation_id','revision_id','program_id','method_id','self_id','role','state','sop_kind'];
function checked(db,a,f){
 must(exact(f,fields)&&has(db,a,f.kind)&&validDate(f.from)&&validDate(f.to)&&f.from<=f.to&&f.to<=a.day&&['sop_evaluation','weighted_sop'].includes(f.sop_kind)&&['all','mentor','trainee','auditor'].includes(f.role)&&typeof f.state==='string'&&Object.hasOwn(labels,f.state),400,'Неверный или недоступный отчёт');
 const o=subjectOptions(db,a,f.kind,f.sop_kind);
 const allowed={unit_id:o.units,person_id:o.people,shift_id:o.shifts,operation_id:o.operations,revision_id:o.revisions,program_id:o.programs,method_id:o.methods,self_id:o.selves};
 const fieldMap={person_id:'person',shift_id:'shift',operation_id:'operation',revision_id:'revision',program_id:'program',method_id:'method',self_id:'self'};
 for(const [k,v] of Object.entries(allowed))must(typeof f[k]==='string'&&(!f[k]||(!fieldMap[k]||o.filters.includes(fieldMap[k]))&&v.some(x=>x.id===f[k])),400,'Неверный или недоступный фильтр: '+k);
 must((o.filters.includes('role')||f.role==='all')&&(o.filters.includes('state')||f.state==='all'),400,'Фильтр неприменим');
 return o;
}
function build(db,a,f){
 const opts=checked(db,a,f),out={title:specs[f.kind].label,scope:f,day:a.day,notes:[],facts:[],tables:[],charts:[],can_export:!!a.personId&&site(db,a,'forms.export')};
 const note=x=>out.notes.push(x),fact=(label,value)=>out.facts.push({label,value}),tab=(title,headers,items)=>out.tables.push({title,headers,items});
 const row=(cells,route=null)=>({cells,route});
 const link=(type,id)=>{const x=recordAccess(db,a,type,id);must(x,403,'Не все исходные записи отчёта доступны');return {type:x.type,id:x.id}};
 const requiredName=id=>{if(!id)return null;const n=who(a,id);must(n!==null,403,'Не все сотрудники отчёта доступны');return n};
 const labelRef=(k,id)=>{if(!id)return null;const n=name(a,k,id);must(n!==null,403,'Не все справочники отчёта доступны');return n};
 const revision=id=>{if(!id)return null;const n=revisionLabel(a,id);must(n!==null,403,'Редакция СОП недоступна');return n};
 const auditLink=x=>{const v=auditRoute(db,a,x);must(v,403,'Не все наблюдения доступны');return v};
 const chart=(title,keys,series)=>{if(keys.length>50)note(title+': показаны первые 50 групп; полный набор — в таблицах.');if(keys.length)out.charts.push({title,labels:keys.slice(0,50),series:series.map(s=>({...s,data:s.data.slice(0,50)}))})};
 const scope={day:a.day,from:f.from,to:f.to,unitId:f.unit_id,personId:f.person_id},between=x=>!!x&&x.slice(0,10)>=f.from&&x.slice(0,10)<=f.to;
 const filters={versionId:f.method_id,from:f.from,to:f.to,unitId:f.unit_id,shiftId:f.shift_id,personId:f.person_id};
 const pct=(n,d)=>d?100*n/d:null,stats=x=>[x.yes,x.no,x.observed,x.expected,x.pct,x.not_observed,x.not_applicable,x.legacy,x.missing];
 const binaryHeaders=['Да','Нет','Наблюдалось','Ожидалось','Да, %','Не наблюдалось','Не применимо','Историческая доля','Нет ответа'];
 const measureHeaders=['Ответов','Ожидалось','Результат','Нет ответа'];
 const score=x=>[x.count,x.expected,x.value,x.missing];
 const tasks=xs=>{const rs=xs.map(x=>row([x.title,x.due_on,ACTION_STATES[actionStatus(db,x)]||actionStatus(db,x)],link('task',x.id)));if(rs.length)tab('Связанные мероприятия',['Задача','Срок','Состояние'],rs)};
 if(['audit','practical','self_eval','sop','comparison'].includes(f.kind)&&!f.method_id){note('Выберите одну конкретную версию методики. Разные версии не объединяются.');return out}
 if(f.kind==='audit'){
  const x=summarizeAudits(db,{...filters,mentorId:f.person_id}),by=new Map(x.audits.map(y=>[y.id,auditLink(y)]));
  note('Доля «Да» = да / бинарные наблюдения. Исторические долевые оценки и пропуски не входят в знаменатель. Повторы — разные факты, не количество отчётов.');fact('Аудитов',x.audits.length);fact('Доля «Да», %',x.stats.pct);fact('Бинарных наблюдений',x.stats.observed);fact('Критических отклонений',x.stats.critical);fact('Повторяющихся контекстов',x.repeated.length);
  tab('Критерии и отклонения',['№','Критерий',...binaryHeaders],x.byCriterion.map(y=>row([y.criterion.position,y.criterion.question,...stats(y)])));
  for(const [title,group,label] of [['По разделам',x.groups,k=>k],['По месяцам',x.byMonth,k=>k],['По инструкторам',x.byMentor,requiredName],['По подразделениям',x.byUnit,k=>labelRef('org.read',k)],['По сменам',x.byShift,k=>labelRef('shift.read',k)]])tab(title,['Группа','Аудитов',...binaryHeaders],group.map(y=>row([label(y.key),y.audits,...stats(y)])));
  const pareto=x.byCriterion.filter(y=>y.no>0).sort((a,b)=>b.no-a.no),sum=pareto.reduce((n,y)=>n+y.no,0);let acc=0;chart('Парето отклонений',pareto.map(y=>String(y.criterion.position)),[{name:'Нет',data:pareto.map(y=>y.no)},{name:'Накопительная доля, %',type:'line',yAxisIndex:1,data:pareto.map(y=>100*(acc+=y.no)/sum)}]);
  chart('Динамика наблюдений',x.byMonth.map(y=>y.key),[{name:'Да',data:x.byMonth.map(y=>y.yes)},{name:'Нет',data:x.byMonth.map(y=>y.no)}]);
  tab('Повторы по конкретному контексту',['Инструктор','Операция','Редакция','Критерий','Различных фактов','Отрицательных отчётов','Без привязки'],[...x.repeated,...x.unlinked.filter(y=>!x.repeated.some(z=>z.key===y.key))].map(y=>{const [p,o,r,q]=y.context;return row([requiredName(p),labelRef('operation.read',o),revision(r),x.criteria.find(z=>z.id===q)?.question,y.factCount,y.negativeReports,y.unlinked])}));
  tab('Матрица наблюдений по инструкторам',['Инструктор',...x.criteria.map(q=>String(q.position))],x.byMentor.map(p=>row([requiredName(p.key),...x.criteria.map(q=>{const v=x.heatmap.get(JSON.stringify([p.key,q.id]));return v?v.yes+' / '+v.observed:null})])));
  tab('Исходные аудиты',['Дата','Инструктор','ВТ','Методика','Да','Наблюдалось'],x.audits.map(y=>row([y.observed_at,isHistoricalRC1(db,y.id)?JSON.parse(y.legacy_context_json).names.mentor:requiredName(y.mentor_id),isHistoricalRC1(db,y.id)?JSON.parse(y.legacy_context_json).names.auditor:requiredName(y.auditor_id),y.version_no,y.passed,y.observed],by.get(y.id))));
 }else if(['practical','self_eval'].includes(f.kind)){
  const type=f.kind,x=assessmentSummary(db,type,filters),kind=type==='practical'?'assessment':'self',by=new Map(x.records.map(y=>[y.id,link(kind,y.id)]));note(type==='practical'?'Практическая оценка: положительные бинарные ответы; решение о допуске отдельно.':'Самооценка — собственная шкала выбранной версии, не процент аудита.');
  fact('Записей',x.records.length);fact('Ответов',x.stats.count);fact('Среднее по методике',x.stats.value);
  if(type==='practical')for(const [k,l] of [['not_meet','Не соответствует'],['basic','Базовый'],['exceeds','Выше базового']])fact(l,x.conclusions[k]);
  tab('Критерии',['№','Критерий',...measureHeaders],x.byCriterion.map(y=>row([y.position,y.question,...score(y)])));
  for(const [title,group,label] of [['По разделам',x.sections,k=>k],['По месяцам',x.byMonth,k=>k],['По сотрудникам',x.byPerson,requiredName],['По подразделениям',x.byUnit,k=>labelRef('org.read',k)],['По сменам',x.byShift,k=>labelRef('shift.read',k)]])tab(title,['Группа',...measureHeaders],group.map(y=>row([label(y.key),...score(y)])));
  chart('Динамика выбранной методики',x.byMonth.map(y=>y.key),[{name:'Результат',type:'line',data:x.byMonth.map(y=>y.value)}]);
  tab('Матрица критериев',['Сотрудник',...x.criteria.map(q=>String(q.position))],x.heat.map(p=>row([requiredName(p.personId),...p.cells.map(v=>v.value)])));
  if(x.repeats.length)tab('Повторные отрицательные оценки',['Сотрудник','Операция','Редакция','Критерий','Повторов'],x.repeats.map(y=>row([requiredName(y.context[0]),labelRef('operation.read',y.context[1]),revision(y.context[2]),y.question,y.count])));
  tab('Исходные оценки',['Дата','Сотрудник','Заключение','Результат','Ответов'],x.records.map(y=>{const s=assessmentScore(assessmentAnswers(db,y,type),type);return row([y.date,requiredName(y.person_id),y.conclusion??null,s.value,s.count],by.get(y.id))}));if(TASK.every(k=>site(db,a,k))&&x.actions.every(y=>recordAccess(db,a,'task',y.id)))tasks(x.actions);else note('Связанные мероприятия не раскрыты: отдельные права.');
 }else if(f.kind==='comparison'){
  if(!f.self_id){note('Выберите конкретную сохранённую самооценку.');return out}
  const s=assessmentRegistry(db,'self_eval').find(y=>y.id===f.self_id);must(s&&(!f.person_id||f.person_id===s.person_id)&&(!f.unit_id||f.unit_id===s.unit_id),400,'Самооценка не соответствует фильтру');const sr=link('self',s.id);
  // The next self-evaluation determines the end of the comparison window.
  must(assessmentRegistry(db,'self_eval').filter(y=>y.person_id===s.person_id&&y.date>=s.date).every(y=>recordAccess(db,a,'self',y.id)),403,'Не вся история самооценок доступна');
  const x=compareMentor(db,{selfId:s.id,versionId:f.method_id,from:f.from,to:f.to,revisionId:f.revision_id});
  if(!x.compatible){note(x.reason);return out}
  const by=new Map(x.audits.map(y=>[y.id,auditLink(y)]));
  note('Сопоставление описательное. Шкала самооценки и бинарный аудит не преобразуются. Разные редакции СОП разделены; отрицательное наблюдение — повод обсудить, не снижение квалификации.');
  fact('Сотрудник',requiredName(s.person_id));fact('Начало сравнения',s.date);fact('Следующая самооценка',x.nextDate);fact('Несопоставимых критериев',x.unmapped);
  tab('Исходная самооценка',['Дата','Методика'],[row([s.date,s.version_no],sr)]);
  const status={unmapped:'Не проверяется L1',no_evidence:'Нет наблюдений',no_self:'Нет самооценки',discuss:'Требуется обсуждение',development:'Основание для развития',observed:'Положительные наблюдения'};
  for(const g of x.groups){const rev=revision(g.revisionId);tab(rev+' · сопоставление',['Критерий','Уровень','Критерии L1','Да','Нет','Без оценки','Интерпретация','Основание'],g.rows.map(q=>row([q.criterion.question,q.level,q.criteria.map(c=>c.position).join(', '),q.kind==='unmapped'?null:q.yes,q.kind==='unmapped'?null:q.no,q.kind==='unmapped'?null:q.unrated,status[q.status],q.basis])));tab(rev+' · отрицательные наблюдения',['Дата','Критерий','Интерпретация'],g.rows.flatMap(q=>q.negative.map(n=>row([n.date,n.criterion.question,status[q.status]],by.get(n.auditId)))));tab(rev+' · фактические аудиты',['Дата','ВТ'],g.audits.map(y=>row([y.observed_at,requiredName(y.auditor_id)],by.get(y.id))))}
 }else if(f.kind==='preparation'){
  const x=preparationControl(db,a.day,{...scope,role:'trainee',filter:f.state}),z=preparationStats(x),by=new Map(x.map(y=>[y.id,link('preparation',y.id)]));note('Когорта по началу адаптации; состояние и просрочка на дату предприятия.');
  for(const [k,l] of [['total','Комплектов'],['people','Обучаемых'],['complete','Завершено'],['overdue','Просрочено'],['review','Повторная проверка'],['shifts','Фактических смен']])fact(l,z[k]);
  chart('Этапы подготовки',['ОТ','Стажировка','Вопросы','Комиссия','Комплект'],[{name:'Подтверждено',data:[z.safety,z.internship,z.questions,z.commission,z.complete]},{name:'Всего',data:Array(5).fill(z.total)}]);
  tab('Комплекты',['Сотрудник','Подразделение','Начало','Срок','Смен факт','Смен план','ОТ','Стажировка','Вопросы','Комиссия','Состояние','Просрочен'],x.map(y=>row([requiredName(y.personId),labelRef('org.read',y.unitId),y.start,y.due,y.doneShifts.length,y.plannedShifts,y.stages[0].current?y.stages[0].pass?'Пройдено':'Не пройдено':null,y.stages[1].current?y.stages[1].pass?'Пройдено':'Не пройдено':null,y.questions?'Выданы':'Нет',y.stages[2].current?'Есть':'Нет',prepLabels[y.status],y.overdue?'Да':'Нет'],by.get(y.id))));
  tab('По подразделениям',['Подразделение','Комплектов','Завершено','Просрочено','Повторная проверка','Отрицательные решения','Смен факт'],[...new Set(x.map(y=>y.unitId))].map(id=>{const z=preparationStats(x.filter(y=>y.unitId===id));return row([labelRef('org.read',id),z.total,z.complete,z.overdue,z.review,z.negative,z.shifts])}));
 }else if(f.kind==='sop'){
  const weighted=f.sop_kind==='weighted_sop',raw=(weighted?weightedHistory(db):corporateEvaluations(db)).filter(e=>(weighted?weightedKey(e):e.method_id)===f.method_id&&between(e.date)&&(!f.unit_id||e.unit_id===f.unit_id)&&(!f.person_id||e.actor_id===f.person_id));
  for(const e of raw)must(evaluationAccess(db,a,f.sop_kind,e.id),403,'Не все оценки СОП доступны');note(weighted?'Взвешенные снимки с одинаковым набором требований и весов; только ручные отрицательные оценки служат основанием.':'Одна версия бинарной оценки СОП. Не смешивается со взвешенной.');
  fact('Записей',raw.length);chart('Результаты выбранной методики',raw.slice(0,50).map(e=>e.date+' · '+e.code),[{name:'Результат, %',type:'line',data:raw.slice(0,50).map(e=>e.score.fraction===null?null:100*e.score.fraction)}]);
  tab('Оценки СОП',['Дата','СОП','Редакция','Оценщик','Результат, %'],raw.map(e=>row([e.date,e.code+' · '+e.title,e.revision_no,requiredName(e.actor_id),e.score.fraction===null?null:100*e.score.fraction],{type:f.sop_kind,id:e.id})));
  const groups=new Map();for(const e of raw)for(const q of weighted?e.questions:corporateAnswers(db,e.id)){const k=weighted?q.id:q.position;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(q)}
  tab('Критерии и замечания',['№','Требование','Ответов','Отклонений','Не подтверждено вручную'],[...groups].sort((a,b)=>a[0]-b[0]).map(([k,q])=>row([k,q[0].req||q[0].question,q.length,q.filter(v=>weighted?v.scoreSource==='manual'&&v.score<1:v.value===0).length,weighted?q.filter(v=>v.scoreSource!=='manual').length:null])));
  const ids=new Set(raw.map(e=>e.id)),linked=actionRows(db).filter(e=>ids.has(weighted?e.source_weighted_event_id:e.source_evaluation_id));if(TASK.every(k=>site(db,a,k))&&linked.every(y=>recordAccess(db,a,'task',y.id)))tasks(linked);else note('Мероприятия не раскрыты: отдельные права.');
 }else if(f.kind==='frv'){
  const x=frvRegistry(db).filter(y=>between(y.observed_at)&&(!f.unit_id||y.unit_id===f.unit_id)&&(!f.person_id||y.author_id===f.person_id)&&(!f.operation_id||y.operation_id===f.operation_id));
  for(const y of x)must(a.read('frv.read',y.id)&&a.scope('frv.read_summary',y.id,{data:{},self:null,assigned:[],units:[y.unit_id]}),403,'Не все ФРВ доступны');
  fact('Исследований',x.length);fact('Завершено',x.filter(y=>y.state==='final').length);note('Измеренные секунды не являются экономией. Парето причин и сравнение полных циклов доступны из проверенного исходника.');
  tab('Исследования ФРВ',['Дата','Операция','Подразделение','Состояние','Измерено, сек','Потери, сек'],x.map(y=>row([y.observed_at,labelRef('operation.read',y.operation_id),labelRef('org.read',y.unit_id),y.state,y.seconds,y.loss],{type:'frv_report',id:y.id})));
 }else if(f.kind==='effect'){
  const x=effectOverview(db,scope);must(x.effects.every(y=>financialRecordAllowed(db,a,y.id)),403,'Не все карточки эффекта доступны');note('Только действующие подтверждённые денежные факты в закрытых периодах; валюты не складываются. План не равен факту.');
  fact('Карточек',x.effects.length);fact('Ожидает проверки',x.pending);fact('Просрочено',x.overdue);fact('Черновых денежных фактов',x.drafts);
  tab('Деньги по валютам',['Валюта','Фактов','Валовой эффект','Затраты','Инвестиции','Чистый эффект'],x.currencies.map(y=>row([y.currency,y.count,y.gross/100,y.recurring/100,y.investment/100,y.net/100])));
  tab('Карточки эффекта',['Название','Ответственный','Срок','Валюта','Состояние'],x.effects.map(y=>row([y.title,requiredName(y.owner_id),y.review_due,y.currency,effectStatus(db,y)],{type:'roi',id:y.id})));
  tab('Денежные факты',['Период с','Период по','Валюта','Валовой','Затраты','Инвестиции','Чистый','Учитывается'],x.facts.map(y=>row([y.period_from,y.period_to,y.effect.currency,y.gross_minor/100,y.recurring_minor/100,y.investment_minor/100,(y.gross_minor-y.recurring_minor-y.investment_minor)/100,y.eligible?'Да':'Нет'],{type:'roi',id:y.effect.id})));
  tab('Цели периода',['Карточка','С','По','Цель','Факт при полноте','Отклонение','Состояние'],x.targets.map(y=>row([y.record.title,y.from,y.to,y.target/100,y.complete?y.actual/100:null,y.delta===null?null:y.delta/100,y.status],{type:'roi',id:y.record.id})));
 }else if(f.kind==='actions'){
  const x=actionRows(db).filter(y=>(!f.person_id||y.owner_id===f.person_id||y.subject_id===f.person_id)&&(!f.unit_id||personUnit(db,y.owner_id,a.day)===f.unit_id)).map(y=>({...y,display:actionStatus(db,y)}));
  const active=new Set(['open','in_progress','implemented','ineffective']),group=x.filter(y=>f.state==='all'?active.has(y.display)||between(y.due_on):f.state==='open'?active.has(y.display):f.state==='overdue'?active.has(y.display)&&y.due_on<a.day:y.display===f.state);
  note('Открытые обязательства — на текущую дату; закрытые записи в этой таблице отобраны по сроку. Фактическое выполнение и подтверждение эффекта за период — в общем дереве показателей.');
  tab('Мероприятия',['Задача','Исполнитель','Срок','Вид','Состояние'],group.map(y=>row([y.title,requiredName(y.owner_id),y.due_on,y.kind,ACTION_STATES[y.display]||y.display],link('task',y.id))));
  const keys=[...new Set(group.map(y=>y.display))];chart('Распределение по состояниям',keys.map(k=>ACTION_STATES[k]||k),[{name:'Количество',data:keys.map(k=>group.filter(y=>y.display===k).length)}]);
 }else if(f.kind==='competence'){
  const p=centerProjection(db,scope,{withEvidence:true}),m=p.metrics.find(y=>y.id==='skill_coverage');must(m,503,'Нет определения покрытия');
  const matrix=matrixData(db,a.day),people=matrix.people.filter(y=>(!f.unit_id||y.unit_id===f.unit_id)&&(!f.person_id||y.id===f.person_id)&&(!f.shift_id||y.shift_id===f.shift_id));
  const cells=people.flatMap(p=>matrix.skills.map(s=>({p,s,c:matrix.cells.get(p.id+':'+s.id)})).filter(x=>x.c?.goal));
  for(const x of cells){requiredName(x.p.id);must(a.read('skill.read',x.s.id),403,'Навык недоступен')}
  // Reuse the authoritative metric's source checks before disclosing coverage.
  const all=centerWorkspace(db,a,'analytics.read',{unit_id:f.unit_id,from:f.from,to:f.to});must(all.metrics.find(y=>y.id==='skill_coverage')?.availability!=='restricted',403,'Не все источники компетенций доступны');
  const shiftCode=f.shift_id?one(db,'SELECT code FROM work_shift WHERE id=?',[f.shift_id])?.code:null;
  const gaps=coverageData(db,a.day,matrix).filter(y=>!f.person_id&&(!f.unit_id||y.unit_id===f.unit_id)&&(!f.shift_id||!y.shift_code||y.shift_code===shiftCode));
  for(const y of gaps)must(a.read('coverage.read',y.id),403,'Не все требования смен доступны');
  note('Требования на текущую дату. Нормы смен не применяются к отдельному сотруднику. Нет оценки — не нулевой уровень.');
  tab('Требования смен',['Подразделение','Навык','Смена','Требуется','Подтверждено','Дефицит'],gaps.map(y=>row([labelRef('org.read',y.unit_id),labelRef('skill.read',y.skill_id),y.shift_code||null,y.min_people,y.actual,y.deficit])));
  if(!f.shift_id&&!f.person_id){const groups=m.dimensions.includes('unitId')?splitEvidence(m,'unitId'):[];tab('Покрытие по подразделениям',['Подразделение','Покрыто','Требуется'],groups.map(y=>row([labelRef('org.read',y.key),y.value,y.denominator])))}
  tab('Сотрудники и требования',['Сотрудник','Навык','Подразделение','Требуется','Оценка','Основание'],cells.map(y=>{const c=y.c;must(a.read('requirement.read',c.goal.id),403,'Требование недоступно');if(c.fact)link('assessment',c.fact.session_id);return row([requiredName(y.p.id),labelRef('skill.read',y.s.id),labelRef('org.read',y.p.unit_id),c.goal.required_level,c.fact?.level??null,!c.fact?'Нет оценки':!c.valid?'Нет действующей числовой оценки':!c.same?'Другая шкала':!c.revisionCurrent?'Неактуальная редакция':c.gap?'Уровень ниже требования':'Требование покрыто'],{type:'person',id:y.p.id})}));
 }else if(f.kind==='twi_effect'){
  const x=twiOverview(db,{...scope,operationId:f.operation_id,revisionId:f.revision_id,programId:f.program_id,role:f.role}),z=x.stats;
  // The cohort, repeated practices and admissions depend on other revisions
  // and later records. Require every contributing source, not a filtered average.
  for(const y of x.cohort){link('training',y.id);requiredName(y.trainee_id);requiredName(y.mentor_id);revision(y.sop_revision_id);for(const p of y.practices||[])link('assessment',p.id)}
  for(const y of x.sessions){link('training',y.assignment_id);requiredName(y.mentor_id);const r=trainingAssignmentResource(db,y.assignment_id,a.day,[y.mentor_id,y.witness_id].filter(Boolean),y.held_at.slice(0,10));must(r&&a.scope('training.detail',y.assignment_id,r),403,'Не все факты инструктажа доступны')}
  for(const y of x.audits)auditLink(y);
  for(const y of x.self)link('self',y.id);
  for(const y of x.enrollments)link('enrollment',y.id);
  for(const y of x.retraining){link('task',y.action.id);link('assessment',y.source.id);if(y.next)link('training',y.next.id)}
  for(const y of x.changes){link('assessment',y.first.session_id);link('assessment',y.last.session_id)}
  const cv=centerWorkspace(db,a,'analytics.read',{unit_id:f.unit_id,from:f.from,to:f.to});must(cv.metrics.filter(m=>m.id.startsWith('twi_')||m.id==='skill_coverage').every(m=>m.availability!=='restricted'),403,'Не все источники эффективности TWI доступны');
  note('Когорта по дате назначения. Первая положительная практика не равна допуску; актуальность допуска на текущую дату. Полное время только для подтверждённых вводных этапов.');
  for(const [key,label] of [['assignments','Назначений'],['people','Обучаемых'],['completed','Завершено'],['granted','Первый допуск'],['current','Актуальный допуск'],['assessed','Практически оценено'],['firstPass','Первая положительная практика'],['repeat','Повторная практика'],['recovered','Положительная после отрицательной'],['medianDays','Медиана до допуска, дней'],['durationN','Полных длительностей'],['meanMinutes','Среднее вводное время, мин']])fact(label,z[key]);
  const stat=y=>[y.assignments,y.people,y.completed,y.granted,y.current,y.firstPass,y.assessed,y.repeat,y.medianDays,y.durationN,y.meanMinutes];
  const h=['Назначений','Людей','Завершено','Допуск','Актуален','Первая положительная','Оценено','Повтор','Медиана, дн.','Полных длительностей','Среднее, мин'];
  tab('Назначения',['Обучаемый','Инструктор','СОП','Начало','Состояние','Первая практика','Первый допуск','Дней','Актуальность'],x.cohort.map(y=>row([requiredName(y.trainee_id),requiredName(y.mentor_id),revision(y.sop_revision_id),y.assigned_on,y.state,y.first?.conclusion,y.grant?.decided_on,y.elapsed,y.currentLabel],link('training',y.id))));
  for(const [title,group,label] of [['По инструкторам',x.mentors,requiredName],['По подразделениям',x.units,k=>labelRef('org.read',k)],['По месяцам когорты',x.months,k=>k]])tab(title,['Группа',...h],group.map(y=>row([label(y.id),...stat(y)])));
  chart('Назначения и первый допуск',x.months.map(y=>y.id),[{name:'Назначено',data:x.months.map(y=>y.assignments)},{name:'Первый допуск',data:x.months.map(y=>y.granted)}]);
  fact('Фактических минут',x.minutes);fact('Без длительности',x.missingMinutes);
  tab('Фактические инструктажи',['Дата','Инструктор','Обучаемый','Минут','Результат'],x.sessions.map(y=>row([y.held_at,requiredName(y.mentor_id),requiredName(y.assignment.trainee_id),y.duration_minutes,y.result],link('training',y.assignment_id))));
  tab('Качество инструктажа по версиям',['Методика','Версия','Аудитов','Да','Наблюдалось'],x.auditGroups.map(y=>row([y.methodCode,y.version,y.count,y.passed,y.observed])));
  tab('Персональные программы',['Программа','Обучаемый','Начало','Состояние'],x.enrollments.map(y=>row([y.program_title,requiredName(y.trainee_id),y.start_on,y.state],link('enrollment',y.id))));
  tab('Повторное обучение',['Мероприятие','Сотрудник','Состояние'],x.retraining.map(y=>row([y.action.title,requiredName(y.source.person_id),ACTION_STATES[y.status]||y.status],link('task',y.action.id))));
  tab('Изменения уровня в одной шкале',['Сотрудник','Навык','Первая дата','Последняя дата','Первый уровень','Последний уровень','Изменение'],x.changes.map(y=>row([requiredName(y.first.person_id),labelRef('skill.read',y.first.skill_id),y.first.assessed_at,y.last.assessed_at,y.first.level,y.last.level,y.delta],link('assessment',y.last.session_id))));
 }
 const n=out.tables.reduce((sum,t)=>sum+t.items.length,0);must(out.tables.length<=200&&n<=30000&&out.tables.every(t=>t.headers.length<=110),413,'Слишком большой отчёт. Уточните фильтры.');
 return out;
}
export const subjectReport=(db,a,f)=>build(db,a,f);
export function subjectWorkbook(db,a,f){
 const d=build(db,a,f);must(d.can_export,403,'Выгрузка отчёта недоступна');
 const X=excelJS(),book=new X.Workbook(),info=book.addWorksheet('Основания');
 info.addRows([[d.title],['Дата предприятия',d.day],['Период',f.from,f.to],...Object.entries(f).map(([k,v])=>[k,v]),...d.notes.map(n=>[n]),...d.facts.map(x=>[x.label,x.value??''])]);info.getColumn(1).width=58;info.getColumn(2).width=48;
 for(const [i,t] of d.tables.entries()){
  const s=book.addWorksheet((i+1)+' '+t.title.replace(/[\\\/:*?\[\]]/g,' ').slice(0,26));s.addRow(t.headers);
  for(const x of t.items)s.addRow(x.cells.map(v=>v??''));
  s.columns.forEach(c=>{c.width=22});s.getRow(1).font={bold:true};s.views=[{state:'frozen',ySplit:1}];s.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
 }
 a.audit('analytics.export',programResource(db).units[0]);return {book,filename:'TWI-03-REPORT-'+f.kind.replaceAll('_','-')+'.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
}
export function frvReportDetail(raw,id){
 const d=frvLosses(raw),s=d.summary,row=cells=>({cells,route:null}),charts=[];
 for(const phase of [...new Set(d.byLoss.map(x=>x.phase))]){const items=d.byLoss.filter(x=>x.phase===phase),sum=items.reduce((n,x)=>n+x.seconds,0);let acc=0;if(sum>0)charts.push({title:'Парето потерь · '+phase,labels:items.slice(0,50).map(x=>x.label),series:[{name:'Секунды',data:items.slice(0,50).map(x=>x.seconds)},{name:'Накопительная доля, %',type:'line',yAxisIndex:1,data:items.slice(0,50).map(x=>100*(acc+=x.seconds)/sum)}]})}
 if(s.baselineCount||s.improvedCount)charts.push({title:'Среднее время полных циклов',labels:['До','После'],series:[{name:'Секунды',data:[s.before,s.after]}]});
 return {title:'Фактические измерения ФРВ',notes:['Сопоставимость полных циклов проверяется исходным механизмом. Потери и их причины — зарегистрированные наблюдения, не денежная экономия.'],facts:[{label:'Полных циклов до',value:s.baselineCount},{label:'Полных циклов после',value:s.improvedCount},{label:'Среднее до, сек',value:s.before},{label:'Среднее после, сек',value:s.after},{label:'Сопоставимое изменение, сек',value:s.comparable?s.delta:null},{label:'Неполных строк',value:s.missing}],tables:[{title:'Категории времени',headers:['Этап','Категория','Секунды'],items:d.groups.map(x=>row([x.phase,x.category,x.seconds]))},{title:'Парето потерь',headers:['Этап','Потеря','Секунды'],items:d.byLoss.map(x=>row([x.phase,x.label,x.seconds]))},{title:'Причины потерь',headers:['Этап','Причина','Секунды'],items:d.byCause.map(x=>row([x.phase,x.label,x.seconds]))},{title:'Наблюдения',headers:['Цикл','Этап','Действие','Потеря','Причина','Секунды'],items:d.details.map(x=>row([x.cycle,x.phase,x.action,x.loss,x.cause,x.seconds]))}],charts,can_export:false,id};
}
