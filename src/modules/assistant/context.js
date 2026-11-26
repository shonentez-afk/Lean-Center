// Read-only contextual explanations. All writes remain in existing validated forms.
import {one,rows} from '../../core/db.js';
import {matrixData,isCurrentStandard,progressFor,admissionStatus,authorizationValid,certificateValid,enrollmentTasks,latestAssessment} from '../training/domain.js';
import {matrixFromRecord,matrixProjection} from '../training/matrix-view.js';
import {actionRows,actionStatus,actionPeople,auditDetails,actionSource} from '../training/audit-domain.js';
import {annualAuditCoverage,summarizeAudits} from '../training/audit-analytics.js';
import {assessmentRegistry,assessmentAnswers,assessmentScore} from '../training/assessment-review.js';
import {preparationControl,prepLabels} from '../training/standard-overview.js';
import {retrainingQueue,centerMetrics,comparisonIndicators} from '../training/center-overview.js';
import {centerAttention,recommendedChecks} from '../training/center-attention.js';
import {employeeRelations} from '../master-data/employee-records.js';
import {effectRows,effectPending,effectStatus,effectFacts,factCurrent,periodTargets,targetNeedsAttention,effectForSource} from '../effect/domain.js';
import {frvRegistry} from '../library/frv-effect.js';
import {documentTitle} from '../library/revision-title.js';
import {ASSISTANT_RULES} from './context-rules.js';

const openAction=s=>['open','in_progress','implemented','ineffective'].includes(s);
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const byId=(db,table,id)=>id?one(db,'SELECT * FROM '+table+' WHERE id=?',[id]):null; // table names below are static
const text=(db,t,id)=>{const x=byId(db,t,id);return x?.display_name||x?.name||x?.title||'—'};
const link=(label,page,options={})=>({label,page,options});
const allowedPages=new Set(['person','skills','twi','instruction','practical','programs','internship','preparation','audit','mentoring','certification','appointments','actions','development','sop','frv','roi','analytics','metrics','retraining','knowledge_bank','supplements','calendar','self_eval','sop_evaluation','sop_review','twi_plans']);
export const CONTEXT_PAGES=new Set(['person','skills','twi','instruction','practical','programs','internship','preparation','audit','mentoring','certification','appointments','actions','development','sop','frv','roi','analytics','metrics','retraining','self_eval','sop_evaluation','sop_review','twi_plans','my_plan','journal','calendar','knowledge_bank','supplements']);
const groups={person:'training',skills:'training',twi:'training',instruction:'training',practical:'training',programs:'preparation',internship:'preparation',preparation:'preparation',audit:'audit',mentoring:'audit',certification:'audit',appointments:'audit',actions:'actions',development:'training',sop:'docs',frv:'docs',roi:'roi',retraining:'training',self_eval:'audit',sop_evaluation:'docs',sop_review:'docs',twi_plans:'docs',journal:'training',knowledge_bank:'preparation',supplements:'preparation'};
const sections={person:'Сотрудники',skills:'Компетенции',twi:'Производственное обучение',instruction:'Инструктажи TWI',practical:'Практические оценки',programs:'Ввод в профессию',internship:'Стажировка',preparation:'Подготовка сотрудников',audit:'Аудит L1',mentoring:'Наставники и ВТ',certification:'Сертификация',appointments:'Назначения',actions:'Мероприятия',development:'Планы развития',sop:'Каталог СОП',frv:'ФРВ',roi:'Экономический эффект',analytics:'Аналитика',metrics:'Дерево метрик',self_eval:'Самооценка'};
export function contextSelection(page,{route={},employeeId=null,documentId=null,revisionId=null}={}){
 let kind='section',id=null;
 if(page==='person'&&employeeId){kind='person';id=employeeId}
 else if((page==='mentoring'||page==='my_plan')&&route.personId){kind='person';id=route.personId}
 else if(page==='skills'&&route.matrixId){kind='matrix';id=route.matrixId}
 else if(['twi','instruction','practical'].includes(page)&&route.id){kind='training';id=route.id}
 else if(page==='practical'&&route.assessmentId){kind='practical';id=route.assessmentId}
 else if(['programs','internship'].includes(page)&&(route.enrollmentId||route.programId)){kind='program';id=route.enrollmentId||route.programId}
 else if(page==='preparation'&&route.id){kind='preparation';id=route.id}
 else if(page==='audit'&&route.auditId){kind='audit';id=route.auditId}
 else if(['certification','appointments','self_eval'].includes(page)&&route.id){kind='mentor';id=route.id}
 else if(page==='actions'&&route.id){kind='action';id=route.id}
 else if(page==='development'&&route.id){kind='development';id=route.id}
 else if(['sop','frv','sop_evaluation'].includes(page)&&documentId){kind=page==='sop_evaluation'?'sop':page;id=documentId}
 else if(page==='roi'&&(route.id||route.studyId||route.actionId)){kind='roi';id=route.id||null}
 else if(['analytics','metrics'].includes(page))kind='analytics';
 return {page,kind,id,revisionId:revisionId||null,route:{...route}}
}
export function analyzeContext(db,day,ctx){
 const out={kind:ctx.kind,title:sections[ctx.page]||'Рабочий раздел',day,scope:'Сохранённые записи текущей рабочей копии',facts:[],checks:[],notices:[],available:true};
 const r=ctx.route||{},id=ctx.id;
 const fact=(label,value)=>out.facts.push({label,value:String(value??'—')});
 const notice=s=>out.notices.push(s);
 const check=(key,count,detail='',links=[])=>{if(!Number.isSafeInteger(count)||count<=0)return;const rule=ASSISTANT_RULES[key];if(!rule)throw Error('Неизвестная проверка помощника');out.checks.push({id:key,count,...rule,detail,links:links.filter(x=>allowedPages.has(x.page)).slice(0,12)})};
 const missing=()=>{out.available=false;notice('Выбранная запись недоступна. Откройте актуальную запись. Анализ всего центра вместо неё не выполняется.');return out};
 const actions=()=>actionRows(db).map(x=>({...x,display:actionStatus(db,x)}));
 const trainingLink=a=>link('Открыть назначение · '+(a.due_on||'—'),'twi',{id:a.id});
 const actionLink=a=>link(a.title,'actions',{id:a.id});
 const profileLinks=personId=>{
  const plans=rows(db,"SELECT * FROM development_plan WHERE person_id=? AND state='active' ORDER BY due_on,id",[personId]);
  return plans.length?plans.map(p=>link('Действующий план · '+p.title,'development',{id:p.id})): [link('Подготовить проект плана развития','development',{mode:'new',personId,draftTitle:'Устранение подтверждённых разрывов компетенций'})]
 };
 const relatedDraft=(kind,sourceId,title,existing,extra={})=>existing.length?existing.map(actionLink):[link('Подготовить проект мероприятия','actions',{mode:'new',sourceKind:kind,sourceId,draftTitle:title,...extra})];
 if(ctx.kind==='section'){
  notice('Конкретная запись не выбрана. Показаны общие сигналы направления, а не результат фильтрации открытого реестра.');
  const data=centerAttention(db,day);for(const q of recommendedChecks(data,groups[ctx.page]||'all'))check(q.id,q.count,'По всему центру.',[link('Открыть источник',q.page,q.options)]);
 }else if(ctx.kind==='person'){
  const p=byId(db,'person',id);if(!p)return missing();out.title=p.display_name;fact('Состояние',p.archived?'Архив':'Активен');
  const groups=employeeRelations(db,id);fact('Связанные записи обучения',groups.training.length);fact('Связанные оценки и допуски',groups.assessments.length);fact('Связанные записи наставничества',groups.mentoring.length);
  if(p.archived){notice('Архивный сотрудник: исторические связи доступны, новые планы не предлагаются.');return out}
  const matrix=matrixData(db,day),cells=matrix.skills.map(s=>({s,c:matrix.cells.get(id+':'+s.id)})),req=cells.filter(x=>x.c?.goal),gaps=req.filter(x=>x.c.gap);
  fact('Действующие требования к навыкам',req.length);fact('Разрывы по требованиям',gaps.length);
  if(!req.length)check('ctx_profile',1,'',[link('Открыть профили требований','skills',{mode:'profiles'})]);
  check('ctx_gap',gaps.length,gaps.slice(0,8).map(x=>x.s.name).join(' · '),[link('Матрицы сотрудника','skills',{personId:id}),...profileLinks(id)]);
  const as=rows(db,"SELECT * FROM training_assignment WHERE source_sha256 IS NOT NULL AND trainee_id=? AND state<>'cancelled' ORDER BY due_on,id",[id]),late=as.filter(a=>['planned','in_progress'].includes(a.state)&&a.due_on<day),old=as.filter(a=>!isCurrentStandard(db,a.sop_revision_id));
  check('training_overdue',late.length,'Обучаемый.',late.map(trainingLink));check('training_revision',old.length,'Назначения по прежним редакциям.',old.map(trainingLink));
  const needs=retrainingQueue(db,day).filter(x=>x.personId===id&&x.status==='needs');check('retraining_need',needs.length,'Сигналы, не число уникальных людей.',[link('Очередь сотрудника','retraining',{personId:id,filter:'needs'})]);
  const aa=actions().filter(x=>actionPeople(x).includes(id)),over=aa.filter(x=>openAction(x.display)&&x.due_on&&x.due_on<day),ver=aa.filter(x=>x.display==='implemented');
  check('action_overdue',over.length,'Сотрудник связан с мероприятием; не обязательно исполнитель.',over.map(actionLink));check('action_verify',ver.length,'',ver.map(actionLink));
  const prep=preparationControl(db,day,{personId:id,role:'trainee'});for(const [key,filter] of [['prep_overdue',x=>x.overdue],['prep_review',x=>x.status==='review'],['prep_finish',x=>x.status==='finish']]){const found=prep.filter(filter);check(key,found.length,'',found.map(x=>link('Комплект · '+x.start,'preparation',{id:x.id})))}
  const annual=annualAuditCoverage(db,day.slice(0,4),day).find(x=>x.personId===id);if(annual){fact('Годовой зачёт L1',annual.audits.length+' / '+annual.required);check('annual_l1',annual.remaining,'Осталось наблюдений, а не число инструкторов.',[link('Годовой контроль L1','audit',{mode:'annual',year:day.slice(0,4),personId:id})])}
  if(comparisonIndicators(db,day).personIds.includes(id))check('mentor_discussion',1,'',[link('Сопоставление наблюдений','analytics',{assessmentType:'comparison',personId:id,discussionOnly:true})]);
 }else if(ctx.kind==='matrix'){
  const rec=byId(db,'competency_matrix',id);if(!rec)return missing();const cfg=matrixFromRecord(rec),m=matrixProjection(db,cfg,day);out.title=rec.code+' · '+rec.title+' · v'+rec.version_no;
  fact('Строки сотрудников',cfg.roster.length);fact('Колонки навыков',cfg.columns.length);fact('Подтверждённые ячейки',m.total.actualCount);fact('Неизвестные ячейки',m.total.unknown);
  const cells=[...m.cells.values()];check('ctx_matrix_unknown',cells.filter(x=>x.targetLevel!==null&&x.actual===null).length,'',[link('Открыть матрицу','skills',{matrixId:id})]);check('ctx_matrix_need',cells.filter(x=>x.need>0).length,'',[link('Открыть матрицу','skills',{matrixId:id})]);
 }else if(ctx.kind==='training'){
  const a=byId(db,'training_assignment',id);if(!a||!a.source_sha256)return missing();out.title='Назначение · '+text(db,'person',a.trainee_id);fact('Состояние',a.state);fact('Срок',a.due_on);
  if(a.state==='cancelled'){notice('Отменённое назначение: только история.');return out}
  const p=progressFor(db,a);fact('Этапы JI',p.completed+' / '+p.stages.length);fact('Последующие проверки',p.followup+' / '+p.followupRequired);fact('Следующий этап',p.next?.label||p.next?.code||'Нет');
  if(['planned','in_progress'].includes(a.state)&&a.due_on<day)check('training_overdue',1,'',[trainingLink(a)]);
  if(!isCurrentStandard(db,a.sop_revision_id))check('training_revision',1,'',[link('Переобучение','retraining',{personId:a.trainee_id,sourceType:'revision'})]);
  if(!authorizationValid(db,a.authorization_id,day))check('ctx_training_auth',1,'',[link('Право инструктора обучать','mentoring',{personId:a.mentor_id})]);
  check('ctx_ji',p.stages.length-p.completed,'',[link('Инструктаж','twi',{id,tab:'instruction'})]);
  const ad=admissionStatus(db,a.trainee_id,a.operation_id,day);fact('Допуск по операции',ad.status);
  if(!ad.current||ad.record?.revision_id!==a.sop_revision_id)check('ctx_admission',1,'Не является автоматическим запретом на выполнение действий по программе обучения.',[link('Практика и допуск','twi',{id,tab:'practice'})]);
  const prac=latestAssessment(db,id,'practical');if(prac?.conclusion==='not_meet')check('ctx_practice',1,'',[link('Практическая оценка','practical',{assessmentId:prac.id}),...relatedDraft('practical',prac.id,'Повторная практика и оценка',actions().filter(x=>x.source_assessment_id===prac.id&&openAction(x.display)))]);
 }else if(ctx.kind==='preparation'){
  const x=preparationControl(db,day).find(x=>x.id===id);if(!x)return missing();out.title='Подготовка · '+x.name;fact('Состояние',prepLabels[x.status]);fact('Завершено смен',x.doneShifts.length+' / '+x.plannedShifts);fact('Актуальные основания этапов',x.ready+' / 3');
  if(x.status==='cancelled'){notice('Комплект содержит отменённый документ.');return out}
  const dest=[link('Открыть комплект','preparation',{id})];
  if(x.overdue)check('prep_overdue',1,'',dest);if(x.status==='review')check('prep_review',1,'',dest);if(x.status==='finish')check('prep_finish',1,'',dest);
  check('ctx_prep_stage',x.stages.filter(s=>!s.done).length,x.stages.filter(s=>!s.done).map(s=>s.label).join(' · '),dest);check('ctx_prep_shifts',x.missingShifts.length,'',dest);
 }else if(ctx.kind==='program'){
  if(r.enrollmentId){const x=byId(db,'training_enrollment',id);if(!x)return missing();const tasks=enrollmentTasks(db,x);out.title='Персональная программа · '+text(db,'person',x.trainee_id);fact('Завершено заданий',tasks.filter(t=>t.done).length+' / '+tasks.length);fact('Срок',x.due_on);if(x.state!=='cancelled')check('ctx_program',tasks.filter(t=>!t.done).length,'',[link('Открыть программу',ctx.page,{enrollmentId:id})])}
  else{const p=byId(db,'training_program',id);if(!p)return missing();out.title=p.title;const tasks=rows(db,'SELECT * FROM training_program_task WHERE program_id=?',[id]);fact('Версия',p.version_no);fact('Заданий',tasks.length);check('ctx_program_revision',tasks.filter(t=>t.sop_revision_id&&!isCurrentStandard(db,t.sop_revision_id)).length,'',[link('Открыть шаблон',ctx.page,{programId:id})])}
 }else if(ctx.kind==='audit'){
  const a=auditDetails(db,id);if(!a)return missing();out.title='Аудит L1 · '+text(db,'person',a.mentor_id);fact('Методика',a.method_code+' · v'+a.version_no);fact('Дата',a.observed_at);fact('Да / наблюдалось',a.stats.yes+' / '+a.stats.observed);fact('Не применимо',a.stats.not_applicable);
  if(a.state!=='final'){notice('Аудит не является действующим зафиксированным наблюдением.');return out}
  const aa=actions(),no=a.questions.filter(q=>q.response==='no');
  const links=no.map(q=>{const existing=aa.find(x=>x.audit_response_id===q.response_id&&openAction(x.display));return existing?actionLink(existing):link('Проект мероприятия · '+q.position,'actions',{mode:'new',responseId:q.response_id})});
  check('ctx_audit_critical',a.stats.critical,no.filter(q=>q.critical===1).map(q=>q.position).join(', '),[link('Исходный аудит','audit',{auditId:id})]);
  check('ctx_audit_no',no.length,no.slice(0,6).map(q=>q.position+'. '+q.question).join(' · '),links);check('ctx_audit_missing',a.stats.missing+a.stats.not_observed+a.stats.legacy,'',[link('Исходный аудит','audit',{auditId:id})]);
 }else if(ctx.kind==='practical'){
  const a=assessmentRegistry(db,'practical').find(x=>x.id===id);if(!a)return missing();out.title='Практическая оценка · '+text(db,'person',a.person_id);const s=assessmentScore(assessmentAnswers(db,a,'practical'),'practical');fact('Методика','v'+a.version_no);fact('Результат',s.sum+' / '+s.count);fact('Заключение',a.conclusion);
  if(a.state==='confirmed'&&a.conclusion==='not_meet')check('ctx_practice',1,'',relatedDraft('practical',id,'Повторная практика по результату оценки',actions().filter(x=>x.source_assessment_id===id&&openAction(x.display))));
  if(a.standard_revision_id&&!isCurrentStandard(db,a.standard_revision_id))notice('Оценка относится к прежней редакции; не является подтверждением нового стандарта.');
 }else if(ctx.kind==='mentor'){
  if(ctx.page==='self_eval'){const a=assessmentRegistry(db,'self_eval').find(x=>x.id===id);if(!a)return missing();out.title='Самооценка · '+text(db,'person',a.person_id);fact('Методика','v'+a.version_no);check('ctx_self',1,'',[link('Сопоставление','analytics',{assessmentType:'comparison',personId:a.person_id,selfId:id})])}
  else if(ctx.page==='certification'){const x=byId(db,'mentor_credential',id);if(!x)return missing();out.title='Документ · '+text(db,'person',x.person_id);fact('Вид',x.kind==='certificate'?'Сертификат':'Свидетельство');fact('Срок',x.valid_until||'Не установлен');if(!certificateValid(db,id,day))check('ctx_cert',1,'',[link('Открыть документ','certification',{id})])}
  else{const x=byId(db,'mentor_appointment',id);if(!x)return missing();out.title='Назначение · '+text(db,'person',x.person_id);fact('Период',x.valid_from+' — '+(x.valid_to||'бессрочно'));if(x.revoked_at||x.valid_from>day||x.valid_to&&x.valid_to<day||!certificateValid(db,x.credential_id,day))check('ctx_cert',1,'',[link('Открыть назначение','appointments',{id})])}
 }else if(ctx.kind==='sop'){
  const d=byId(db,'document',id);if(!d)return missing();const revisions=rows(db,"SELECT * FROM document_revision WHERE document_id=? ORDER BY CASE WHEN state='effective' THEN 0 ELSE 1 END,version_no DESC",[id]),v=ctx.revisionId?revisions.find(x=>x.id===ctx.revisionId):revisions[0];if(!v)return missing();out.title=d.code+' · '+documentTitle(db,id,v.id)+' · v'+v.version_no;fact('Редакция',v.version_no);fact('Статус',d.archived?'Архив':v.state);fact('Пересмотр',v.review_due||'Не назначен');const p=JSON.parse(v.payload_json),dest=[link('Открыть редакцию','sop',{documentId:id,revisionId:v.id})];fact('Шаги в исходнике',p.projection?.steps?.length??'—');
  if(d.archived||v.state!=='effective')check('ctx_sop_state',1,'',dest);
  if(!d.archived&&v.state==='effective'&&v.review_due&&v.review_due<day)check('sop_overdue',1,'',dest);
  if(!d.archived&&v.state==='draft'&&(!v.print_format||!v.workplace_id))check('sop_passport',1,'',dest);
  if(!d.archived){const steps=p.projection?.steps||[];check('ctx_sop_steps',steps.filter(s=>Array.isArray(s.key_points)?!s.key_points.length||!String(s.reason||'').trim():false).length,'Только сохранённая проекция; полная проверка в конструкторе.',dest);if(!p.projection?.twi)check('ctx_sop_twi',1,'',dest)}
 }else if(ctx.kind==='frv'){
  const x=frvRegistry(db).find(x=>x.id===id);if(!x)return missing();out.title=x.title;fact('Состояние',x.state);fact('Время наблюдений, с',x.seconds);fact('М1 и ожидание, с',x.loss);if(x.state==='archived'){notice('Архивное исследование: только история.');return out}
  const dest=[link('Открыть исследование','frv',{studyId:id})];if(x.state!=='final')check('ctx_frv_draft',1,'',dest);
  const loss=(x.projection?.measurements||[]).filter(o=>o.seconds>0&&['NVA_Waste','WAIT'].includes(o.category));
  check('ctx_frv_loss',loss.length,'Число наблюдений, не секунды или рубли.',[...dest,...(x.state==='final'?relatedDraft('frv_study',id,'Разбор наблюдавшихся потерь ФРВ',actions().filter(a=>a.study_id===id&&openAction(a.display))):[])]);
 }else if(ctx.kind==='action'){
  const a=actions().find(x=>x.id===id);if(!a)return missing();out.title=a.title;fact('Состояние',a.display);fact('Срок',a.due_on);fact('Ответственный',text(db,'person',a.owner_id));const dest=[link('Открыть мероприятие','actions',{id})];
  if(openAction(a.display)){if(a.due_on&&a.due_on<day)check('action_overdue',1,'',dest);if(a.display==='implemented')check('action_verify',1,'',dest);else check('ctx_action',1,'',dest)}
 }else if(ctx.kind==='development'){
  const p=byId(db,'development_plan',id);if(!p)return missing();out.title=p.title;const goals=rows(db,'SELECT * FROM development_goal WHERE plan_id=?',[id]),active=goals.filter(x=>x.state==='open');fact('Цели',goals.length);fact('Открытые',active.length);if(p.state==='active')check('ctx_goal',active.length,'',active.map(g=>link(g.title,'development',{id})).slice(0,1));
 }else if(ctx.kind==='roi'){
  const x=id?effectRows(db).find(x=>x.id===id):effectForSource(db,r.studyId||null,r.actionId||null);if(!x){notice('Карточка эффекта ещё не зарегистрирована. План и суммы не придумываются.');return out}
  out.title=x.title;fact('Состояние',effectStatus(db,x));fact('Контрольная дата',x.review_due);const dest=[link('Карточка эффекта','roi',{id:x.id})];if(x.state!=='active')return out;
  if(effectPending(db,x)){check('roi_pending',1,'',dest);if(x.review_due<day)check('roi_overdue',1,'',dest)}
  check('roi_drafts',effectFacts(db,x.id).filter(f=>f.state==='draft').length,'',dest);
  const targets=periodTargets(db,x,day);check('ctx_roi_period',targets.filter(targetNeedsAttention).length,'',targets.filter(targetNeedsAttention).map(t=>link(t.from+' — '+t.to,'roi',{id:x.id,targetId:t.id})));check('roi_deviations',targets.filter(t=>!t.cancel&&t.shortfall&&!t.currentReview).length,'',dest);
 }else if(ctx.kind==='analytics'){
  const from=r.from||'',to=r.to||day;if(from&&!validDate(from)||!validDate(to)||from&&from>to){notice('Некорректный период анализа.');return out}
  const scope={day,from,to,unitId:r.unitId||'',personId:r.personId||''};
  out.scope='Период '+(from||'с начала данных')+' — '+to+'; '+(scope.unitId?text(db,'org_unit',scope.unitId):'все подразделения')+'; '+(scope.personId?text(db,'person',scope.personId):'все сотрудники');
  if(ctx.page==='analytics'&&(r.assessmentType||'audit')==='audit'&&r.versionId){
   const a=summarizeAudits(db,{versionId:r.versionId,from,to,mentorId:scope.personId,unitId:scope.unitId,shiftId:r.shiftId||''});out.title='Аналитика L1 · выбранная методика';fact('Аудиты',a.audits.length);fact('Да / наблюдалось',a.stats.yes+' / '+a.stats.observed);fact('Повторяющиеся контексты',a.repeated.length);check('ctx_audit_repeat',a.repeated.length,'',[link('Исходная аналитика','analytics',{assessmentType:'audit',...r})]);if(!a.stats.observed)check('ctx_metric_missing',1,'Нет бинарных наблюдений.',[link('Исходная аналитика','analytics',{assessmentType:'audit',...r})])
  }else{
   out.title='Сводка дерева метрик';notice('Сводка по общим метрикам в указанном периоде; не интерпретация всех настроек конкретной диаграммы.');
   const ms=centerMetrics(db,scope);out.metrics=ms.map(m=>({label:m.label,value:m.denominator===null?String(m.value):m.denominator?m.value+' / '+m.denominator:'— (нет знаменателя)',definition:m.definition,target:link('Источник',m.page,m.options)}));
   check('ctx_metric_missing',ms.filter(m=>m.denominator===0).length,'',[link('Дерево метрик','metrics',{from,to,unitId:scope.unitId,personId:scope.personId})]);check('ctx_metric_review',ms.length,'',[link('Дерево метрик','metrics',{from,to,unitId:scope.unitId,personId:scope.personId})]);
  }
 }
 const order={urgent:0,review:1,plan:2};out.checks.sort((a,b)=>order[a.priority]-order[b.priority]);return out
}
export function contextLinks(data){return [...data.checks.flatMap(q=>q.links),...(data.metrics||[]).map(m=>m.target)].filter(x=>allowedPages.has(x.page))}
export function sameContextLink(a,b){return a.page===b.page&&JSON.stringify(a.options)===JSON.stringify(b.options)}
