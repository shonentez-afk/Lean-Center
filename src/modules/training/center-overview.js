import {preparationControl,preparationStats} from './standard-overview.js';
import {twiOverview} from './twi-effectiveness.js';
import {effectOverview} from '../effect/domain.js';
// Read-only queues and KPI definitions over authoritative records.
import {rows,one} from '../../core/db.js';
import {matrixData} from './domain.js';
import {METRIC_DEFINITIONS,METRIC_CONTRACTS} from './metric-catalog.js';
import {auditRegistry} from './audit-analytics.js';
import {assessmentRegistry} from './assessment-review.js';
import {actionRows,actionStatus,actionPeople,actionCompletionDates,actionCompletionDate} from './audit-domain.js';
import {compareMentor} from './mentor-comparison.js';
import {scheduleKind,schedulePeople,schedulePending,scheduleScopeDate} from './center-planning.js';
import {corporateEvaluations,weightedHistory} from '../library/sop-assessment-review.js';
import {frvRegistry} from '../library/frv-effect.js';
const open=s=>['open','in_progress','implemented','ineffective'].includes(s);
const dedup=(a,key)=>{const m=new Map();for(const x of a){const k=key(x);if(!m.has(k))m.set(k,x)}return [...m.values()]};
export const personUnit=(db,id,day)=>one(db,"SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[id,day,day])?.unit_id||null;
export function retrainingQueue(db,day){
 const actions=actionRows(db).map(a=>({...a,displayState:actionStatus(db,a)})),pending=actions.filter(a=>open(a.displayState)),assignments=rows(db,`SELECT a.*,r.document_id,r.version_no,o.unit_id,r.state revision_state,d.archived doc_archived FROM training_assignment a JOIN document_revision r ON r.id=a.sop_revision_id JOIN document d ON d.id=r.document_id LEFT JOIN operation o ON o.id=a.operation_id WHERE a.source_sha256 IS NOT NULL AND a.state<>'cancelled' ORDER BY a.assigned_on DESC,a.id`);
 const revisionNeeds=dedup(assignments.filter(a=>a.revision_state!=='effective'||a.doc_archived),a=>[a.trainee_id,a.document_id,a.skill_id].join(':')).map(a=>{const current=one(db,"SELECT r.id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.document_id=? AND r.state='effective' AND d.archived=0",[a.document_id]),next=current?assignments.find(x=>x.trainee_id===a.trainee_id&&x.skill_id===a.skill_id&&x.sop_revision_id===current.id):null;return {type:'revision',personId:a.trainee_id,unitId:a.unit_id,id:a.id,revisionId:a.sop_revision_id,currentId:current?.id||null,nextId:next?.id||null,skillId:a.skill_id,scaleId:a.scale_id,targetLevel:a.target_level,due:next?.due_on||null,status:next?(next.state==='completed'?'done':'linked'):current?'needs':'blocked'}});
 const allPractice=assessmentRegistry(db,'practical').filter(a=>a.state==='confirmed'&&a.date.slice(0,10)<=day),context=a=>[a.person_id,a.operation_id,a.standard_revision_id,a.method_id].join(':'),latest=dedup(allPractice,context),byId=new Map(allPractice.map(a=>[a.id,a]));
 const practice=latest.filter(a=>a.conclusion==='not_meet').map(a=>{const task=pending.find(x=>x.source_assessment_id&&byId.has(x.source_assessment_id)&&context(byId.get(x.source_assessment_id))===context(a)&&x.kind==='trainee_training');return {type:'practical',personId:a.person_id,unitId:a.unit_id,id:a.id,revisionId:a.standard_revision_id,due:task?.due_on||null,actionId:task?.id||null,status:task?'linked':'needs'}});
 const auditAnswers=rows(db,`SELECT r.id,r.response,r.criterion_id,c.question,a.id audit_id,a.mentor_id,a.operation_id,a.standard_revision_id,a.version_id,a.observed_at,o.unit_id FROM audit_response r JOIN audit_session a ON a.id=r.audit_id JOIN checklist_criterion c ON c.id=r.criterion_id LEFT JOIN operation o ON o.id=a.operation_id WHERE a.state='final' AND a.assignment_id IS NOT NULL AND substr(a.observed_at,1,10)<=? AND r.response IN('yes','no') ORDER BY a.observed_at DESC,a.recorded_at DESC,a.id`,[day]);
 const l1=dedup(auditAnswers,a=>[a.mentor_id,a.operation_id,a.standard_revision_id,a.version_id,a.criterion_id].join(':')).filter(a=>a.response==='no').map(a=>{const task=pending.find(x=>x.audit_response_id===a.id||x.audit_id&&x.mentor_id===a.mentor_id&&x.operation_id===a.operation_id&&x.standard_revision_id===a.standard_revision_id&&x.version_id===a.version_id&&x.criterion_id===a.criterion_id);return {type:'audit',personId:a.mentor_id,unitId:a.unit_id,id:a.audit_id,responseId:a.id,revisionId:a.standard_revision_id,question:a.question,due:task?.due_on||null,actionId:task?.id||null,status:task?'linked':'needs'}});
 const m=matrixData(db,day),goals=rows(db,"SELECT g.*,p.person_id FROM development_goal g JOIN development_plan p ON p.id=g.plan_id WHERE p.state='active' AND g.state='open'"),gaps=[];
 for(const p of m.people)for(const s of m.skills){const c=m.cells.get(p.id+':'+s.id);if(!c.gap)continue;const g=goals.find(x=>x.person_id===p.id&&x.skill_id===s.id&&JSON.parse(x.target_json).scale_id===c.goal.scale_id);gaps.push({type:'skill',personId:p.id,unitId:p.unit_id,skillId:s.id,required:c.goal.required_level,actual:c.valid&&c.same&&c.revisionCurrent?c.fact.level:null,status:g?'linked':'needs',planId:g?.plan_id||null,due:g?.due_on||null})}
 const seen=new Set([...practice,...l1].map(x=>x.actionId).filter(Boolean)),other=pending.filter(a=>!seen.has(a.id)&&['instructor_training','trainee_training','development'].includes(a.kind)).map(a=>({type:a.source_self_id||a.comparison_self_id?'self_eval':'action',personId:a.subject_id||a.owner_id,unitId:personUnit(db,a.subject_id||a.owner_id,day),id:a.source_self_id||a.comparison_self_id||a.id,actionId:a.id,due:a.due_on,status:'linked',question:a.title}));
 return [...revisionNeeds,...practice,...l1,...gaps,...other];
}
export function comparisonIndicators(db,day){
 const self=dedup(assessmentRegistry(db,'self_eval').filter(x=>x.date<=day),x=>x.person_id),active=one(db,"SELECT v.id FROM checklist_version v JOIN checklist c ON c.id=v.checklist_id WHERE c.code='TWI_L1_RC1' AND v.state='active'");
 if(!active)return {people:0,discuss:0,compared:0,personIds:[]};
 let people=0,discuss=0,compared=0,personIds=[];
 for(const s of self){const x=compareMentor(db,{selfId:s.id,versionId:active.id,to:day});if(!x.compatible||!x.groups.length)continue;compared++;const n=x.groups.reduce((n,g)=>n+g.rows.filter(q=>q.status==='discuss').length,0);if(n){people++;personIds.push(s.person_id)}discuss+=n}
 return {people,discuss,compared,personIds};
}
export function centerMetrics(db,scope,options){return centerProjection(db,scope,options).metrics}
export function centerProjection(db,{day,from='',to=day,unitId='',personId=''},{withEvidence=false}={}){
 const inPeriod=d=>!!d&&(!from||d.slice(0,10)>=from)&&(!to||d.slice(0,10)<=to),scope=(u,p)=> (!unitId||u===unitId)&&(!personId||p===personId);
 const a=rows(db,`SELECT a.*,o.unit_id FROM training_assignment a LEFT JOIN operation o ON o.id=a.operation_id WHERE source_sha256 IS NOT NULL`).filter(x=>scope(x.unit_id,x.trainee_id));
 const planned=a.filter(x=>x.state!=='cancelled'&&inPeriod(x.assigned_on)),completed=planned.filter(x=>x.state==='completed');
 const audit=auditRegistry(db).filter(x=>x.state==='final'&&inPeriod(x.observed_at)&&scope(x.unit_id,x.mentor_id)),practice=assessmentRegistry(db,'practical').filter(x=>x.state==='confirmed'&&inPeriod(x.date)&&scope(x.unit_id,x.person_id)),self=assessmentRegistry(db,'self_eval').filter(x=>inPeriod(x.date)&&scope(x.unit_id,x.person_id));
 const completionDates=actionCompletionDates(db),actions=actionRows(db).filter(x=>!personId||actionPeople(x).includes(personId)).map(x=>({...x,status:actionStatus(db,x),completion:actionCompletionDate(db,x,completionDates)}));
 const pending=actions.filter(x=>open(x.status)&&(!unitId||personUnit(db,x.owner_id,day)===unitId));
 const implemented=actions.filter(x=>x.completion.date&&inPeriod(x.completion.date)&&(!unitId||personUnit(db,x.owner_id,x.completion.date)===unitId)),verified=implemented.filter(x=>x.status==='verified');
 const sop=corporateEvaluations(db).filter(x=>inPeriod(x.date)&&scope(x.unit_id,x.actor_id)),weighted=weightedHistory(db).filter(x=>inPeriod(x.date)&&scope(x.unit_id,x.actor_id)),docs=rows(db,`SELECT r.*,d.operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id LEFT JOIN operation o ON o.id=d.operation_id WHERE r.state='effective' AND d.archived=0`).filter(x=>scope(x.unit_id,x.author_id));
 const frv=frvRegistry(db).filter(x=>x.state==='final'&&inPeriod(x.observed_at)&&scope(x.unit_id,x.author_id));
 const schedules=rows(db,"SELECT * FROM schedule_event WHERE state IN('planned','done')").filter(x=>schedulePending(db,x)&&(!unitId||personUnit(db,x.owner_id,scheduleScopeDate(db,x,day))===unitId)&&(!personId||schedulePeople(db,x).includes(personId)));
 const requirements=matrixData(db,day),cells=requirements.people.filter(p=>scope(p.unit_id,p.id)).flatMap(p=>requirements.skills.map(s=>({...requirements.cells.get(p.id+':'+s.id),person:p,skill:s})).filter(c=>c.goal));
 const count=(id,group,label,value,definition,page,options={})=>({id,group,label,value,denominator:null,definition,page,options});
 const ratio=(id,group,label,value,denominator,definition,page,options={})=>({id,group,label,value,denominator,definition,page,options});
 const f={from,to,personId,unitId},twi=twiOverview(db,{...f,day,role:'trainee'},{matrix:requirements}),ts=twi.stats,economic=effectOverview(db,{day,from,to,unitId,personId});
 const prepRows=preparationControl(db,day,{from,to,unitId,personId,role:'trainee'}),currentPrepRows=preparationControl(db,day,{unitId,personId,role:'trainee'}),prep=preparationStats(prepRows),currentPrep=preparationStats(currentPrepRows),prepRoute={assessmentType:'preparation',...f};
 const metrics=[
 count('prep_started','Подготовка','Начато комплектов',prep.total,'Когорта по началу адаптации, подразделение обучаемого на текущую дату.','analytics',prepRoute),
 ratio('prep_completed','Подготовка','Завершено из начатых',prep.complete,prep.total,'Текущий статус комплектов выбранной когорты; три закрытых документа и актуальное положительное решение.','analytics',prepRoute),
 count('prep_overdue','Подготовка','Просрочено комплектов',currentPrep.overdue,'Текущие открытые комплекты с просроченным этапом или нехваткой запланированных смен.','preparation',{unitId,personId,filter:'overdue',role:'trainee'}),
 count('prep_review','Подготовка','Требуется повторная проверка',currentPrep.review,'Решение комиссии больше не подтверждается актуальными основаниями.','preparation',{unitId,personId,filter:'review',role:'trainee'}),
 count('training_assigned','Обучение','Назначено обучения',planned.length,'Назначения, созданные в период; без отменённых. Сотрудник — обучаемый.','twi',{}),
 ratio('training_completed','Обучение','Завершено из назначенных',completed.length,planned.length,'Текущие состояния назначений, созданных в период; не исторический срез закрытий.','twi',{}),
 count('twi_people','Эффективность TWI','Уникальные обучаемые',ts.people,'Уникальные люди среди назначений, начатых в периоде.','analytics',{...f,assessmentType:'twi_effect',role:'trainee'}),
 ratio('twi_first','Эффективность TWI','Первое положительное заключение',ts.firstPass,ts.assessed,'Первая действующая подтверждённая практика назначения до конца периода; базовый уровень или выше, не допуск.','analytics',{...f,assessmentType:'twi_effect',role:'trainee',detail:'first'}),
 count('twi_granted','Эффективность TWI','Назначения с первым зарегистрированным допуском',ts.granted,'Первый зарегистрированный допуск до конца периода, независимо от текущего статуса.','analytics',{...f,assessmentType:'twi_effect',role:'trainee',detail:'granted'}),
 count('twi_current','Эффективность TWI','Действующие допуски по назначениям',ts.current,'Текущее решение по операции и действующие доказательства; исторические решения отдельно.','analytics',{...f,assessmentType:'twi_effect',role:'trainee',detail:'current'}),
 count('training_overdue','Обучение','Просрочено обучений',a.filter(x=>['planned','in_progress'].includes(x.state)&&x.due_on<day).length,'Открытые назначения со сроком до текущей даты.','twi',{filter:'overdue'}),
 count('audit_count','Наставничество','Аудиты L1',audit.length,'Зафиксированные аудиты инструктора в период; версии не смешиваются в процент.','audit',{...f,role:'mentor',state:'final'}),
 count('self_count','Наставничество','Самооценки',self.length,'Факты самооценки наставника в период.','self_eval',f),
 count('assessment_planned','Наставничество','Запланировано оценок',schedules.filter(x=>['audit','practical','self_eval'].includes(scheduleKind(x))).length,'Незакрытые планы и планы с аннулированным подтверждением; подразделение ответственного.','calendar',{personId,unitId,month:'',scheduleType:'planned'}),
 count('practice_count','Компетенции','Практические оценки',practice.length,'Подтверждённые практические оценки обучаемого в период.','practical',f),
 ratio('practice_negative','Компетенции','Заключения «Не соответствует»',practice.filter(x=>x.conclusion==='not_meet').length,practice.length,'Отдельное заключение оценщика, не процент чек-листа.','practical',{...f,filter:'not_meet'}),
 ratio('skill_coverage','Компетенции','Требования без разрыва',cells.filter(x=>!x.gap).length,cells.length,'Текущие требования по сотрудникам и навыкам, с той же шкалой и актуальной редакцией. Не означает допуск.','skills',{}),
 count('sop_evaluations','СОП','Корпоративские оценки',sop.length,'Сохранённые бинарные оценки в период; сотрудник — оценщик.','analytics',{...f,assessmentType:'sop',sopKind:'sop_evaluation'}),
 count('sop_weighted','СОП','Снимки взвешенных чек-листов',weighted.length,'Исторические сохранения и правки, не количество уникальных документов.','analytics',{...f,assessmentType:'sop',sopKind:'weighted_sop'}),
 count('sop_review','СОП','Просрочен пересмотр',docs.filter(x=>x.review_due&&x.review_due<day).length,'Действующие редакции со сроком пересмотра до текущей даты; сотрудник — автор.','sop',{}),
 count('frv_final','ФРВ','Завершённые исследования',frv.length,'Финальные исследования в период, сотрудник — сохранённый автор. Не денежный эффект.','analytics',{...f,assessmentType:'frv'}),
 count('actions_open','Мероприятия','Открытые мероприятия',pending.length,'Текущие открытые/в работе/ожидают проверки/неэффективны. Подразделение исполнителя; сотрудник — участник.','actions',{personId,unitId}),
 count('actions_overdue','Мероприятия','Просроченные мероприятия',pending.filter(x=>x.due_on&&x.due_on<day).length,'Незакрытые мероприятия со сроком до текущей даты; текущее подразделение исполнителя.','actions',{personId,unitId,filter:'overdue'}),
 ratio('actions_verified','Мероприятия','Подтверждён эффект',verified.length,implemented.length,'Из мероприятий с фактом выполнения в период по сохранённой деловой дате. Участок исполнителя на дату выполнения; актуальность проверки учитывает повторные нарушения. Старые записи без смещения: UTC.','actions',{personId,unitId,actionCohort:{from,to}}),
 count('effect_pending','Экономика','Карточки эффекта требуют проверки',economic.pending,'Открытые контрольные сроки или утратившие актуальность доказательства.','roi',{...f,filter:'pending'}),
 count('effect_overdue','Экономика','Просроченные проверки эффекта',economic.overdue,'Текущие незакрытые контрольные сроки до сегодняшней даты.','roi',{...f,filter:'overdue'}),
 count('effect_facts','Экономика','Подтверждённые денежные факты',economic.facts.filter(x=>x.eligible).length,'Факты полностью в выбранном периоде с действующими доказательствами; не годовые сценарии.','roi',{...f,filter:'confirmed'}),
 count('effect_drafts','Экономика','Черновики денежных фактов',economic.drafts,'Текущие денежные факты, ожидающие независимого подтверждения.','roi',{...f,filter:'drafts'}),
 count('effect_targets','Экономика','Цели эффекта требуют внимания',economic.targetAttention.length,'Текущие открытые, неполные или требующие разбора цели.','roi',{...f,filter:'targets'}),
 count('effect_deviations','Экономика','Неразобранные отклонения',economic.allTargets.filter(t=>t.shortfall&&!t.currentReview).length,'Текущие цели с полным фактом ниже плана без актуального разбора.','roi',{...f,filter:'deviations'})
 ];
 const slice={day,from,to,unitId,personId};
 const row=(x,page,options,extra={})=>({key:x.id,unitId:x.unit_id||'',personId:'',date:'',label:x.title||'',included:true,page,options,...extra});
 if(withEvidence){
  const prepRecord=(x,included=true)=>row(x,'preparation',{id:x.id},{unitId:x.unitId,personId:x.personId,date:x.start,state:x.status,included,label:x.name});
  const assignment=(x,included=true)=>row(x,'twi',{id:x.id},{personId:x.trainee_id,operationId:x.operation_id,date:x.assigned_on,state:x.state,included,label:x.title||'Назначение обучения'});
  const ar=x=>row(x,'audit',{auditId:x.id},{personId:x.mentor_id,operationId:x.operation_id,date:x.observed_at,method:x.version_id,state:x.state,label:x.sop_title||'Аудит L1'});
  const pr=(x,included=true)=>row(x,'practical',{assessmentId:x.id},{personId:x.person_id,operationId:x.operation_id,date:x.date,method:x.method_id,state:x.conclusion,included});
  const sr=x=>row(x,'self_eval',{id:x.id},{personId:x.person_id,date:x.date,method:x.method_id});
  const act=(x,included=true,historical=false)=>row(x,'actions',{id:x.id},{unitId:personUnit(db,x.owner_id,historical?x.completion.date:day),personId:x.owner_id,date:historical?x.completion.date:x.due_on,dueOn:x.due_on||'',implementedOn:x.completion.date,implementedAt:x.implemented_at||'',timeBasis:x.completion.timeBasis,unitBasis:historical?'На дату выполнения':'Текущий исполнитель',state:x.status,included});
  const monetary=x=>row(x,'roi',{id:x.effect.id,factId:x.id},{unitId:x.effect.unit_id,personId:x.effect.owner_id,date:x.period_to,currency:x.effect.currency,period:x.period_from+' — '+x.period_to,state:x.state,label:x.effect.title||''});
  const card=x=>row(x,'roi',{id:x.id},{personId:x.owner_id,date:x.review_due,currency:x.currency,state:x.state});
  const target=x=>row(x,'roi',{id:x.record.id,targetId:x.id},{unitId:x.record.unit_id,personId:x.record.owner_id,date:x.to,currency:x.record.currency,period:x.from+' — '+x.to,state:x.status,label:x.record.title||''});
  const evidence=[
   prepRows.map(x=>prepRecord(x)),prepRows.map(x=>prepRecord(x,x.status==='complete')),currentPrepRows.filter(x=>x.overdue).map(x=>prepRecord(x)),currentPrepRows.filter(x=>x.status==='review').map(x=>prepRecord(x)),
   planned.map(x=>assignment(x)),planned.map(x=>assignment(x,x.state==='completed')),
   dedup(twi.cohort,x=>x.trainee_id).map(x=>row({id:x.trainee_id},'person',{personId:x.trainee_id},{personId:x.trainee_id,label:'Уникальный обучаемый'})),
   twi.cohort.filter(x=>x.first).map(x=>assignment(x,x.first.conclusion!=='not_meet')),twi.cohort.filter(x=>x.grant).map(x=>assignment(x)),twi.cohort.filter(x=>x.current).map(x=>assignment(x)),a.filter(x=>['planned','in_progress'].includes(x.state)&&x.due_on<day).map(x=>assignment(x)),
   audit.map(ar),self.map(sr),schedules.filter(x=>['audit','practical','self_eval'].includes(scheduleKind(x))).map(x=>row(x,'calendar',{id:x.id},{unitId:personUnit(db,x.owner_id,scheduleScopeDate(db,x,day)),personId:x.owner_id,date:x.due_on,state:scheduleKind(x),label:'План '+scheduleKind(x)})),
   practice.map(x=>pr(x)),practice.map(x=>pr(x,x.conclusion==='not_meet')),
   cells.map(c=>row({id:c.person.id+':'+c.skill.id},'person',{personId:c.person.id},{unitId:c.person.unit_id,personId:c.person.id,skillId:c.skill.id,professionId:c.person.profession_id,operationId:c.skill.operation_id,label:c.skill.name,method:c.goal.scale_id,state:c.gap?'Разрыв':'Покрыто',included:!c.gap,wide:true,requirementId:c.goal.id,assessmentId:c.fact?.assessment_kind==='practical'?c.fact.session_id:null,sourceAssessmentId:c.fact?.session_id||null,requiredLevel:c.goal.required_level,observedLevel:c.fact?.level??null,reason:!c.fact?'Нет оценки':!c.valid?'Нет действующей числовой оценки':!c.same?'Другая шкала':!c.revisionCurrent?'Неактуальная редакция':c.gap?'Уровень ниже требования':'Требование покрыто'})),
   sop.map(x=>row(x,'sop_review',{kind:'sop_evaluation',id:x.id},{personId:x.actor_id,operationId:x.operation_id,date:x.date,method:x.method_id})),
   weighted.map(x=>row(x,'sop_review',{kind:'weighted_sop',id:x.id},{personId:x.actor_id,operationId:x.operation_id,date:x.date,method:x.methodKey})),
   docs.filter(x=>x.review_due&&x.review_due<day).map(x=>row(x,'sop',{documentId:x.document_id,revisionId:x.id},{personId:x.author_id,operationId:x.operation_id,date:x.review_due})),
   frv.map(x=>row(x,'frv',{studyId:x.id},{personId:x.author_id,operationId:x.operation_id,date:x.observed_at,state:x.state})),
   pending.map(x=>act(x)),pending.filter(x=>x.due_on&&x.due_on<day).map(x=>act(x)),implemented.map(x=>act(x,x.status==='verified',true)),
   economic.pendingRows.map(card),economic.overdueRows.map(card),economic.facts.filter(x=>x.eligible).map(monetary),economic.draftRows.map(monetary),economic.targetAttention.map(target),economic.allTargets.filter(x=>x.shortfall&&!x.currentReview).map(target)
  ];
  for(let i=0;i<metrics.length;i++){const m=metrics[i],rs=evidence[i];if(m.id!==METRIC_DEFINITIONS[i].id||!rs||rs.filter(x=>x.included).length!==m.value||(m.denominator!==null&&rs.length!==m.denominator))throw Error('Metric evidence mismatch: '+METRIC_DEFINITIONS[i].id);m.evidence=rs}
 }
 for(let i=0;i<metrics.length;i++){const m=metrics[i],d=METRIC_DEFINITIONS[i];if(m.id!==d.id)throw Error('Registry order mismatch '+m.id);const [source,unit,rules]=METRIC_CONTRACTS[m.id];Object.assign(m,d,{scope:slice,availability:m.denominator===0?'no_denominator':'available',comparisonEligible:false,source,unit,rules,aggregation:m.denominator!==null?'ratio_of_sums':m.id==='twi_people'?'distinct_person':'count_rows',target:null});m.dimensions=m.id==='twi_people'?['personId']:['unitId','personId','method','skillId','professionId','operationId','state','currency','period','reason'].filter(k=>m.evidence?.some(r=>r[k]))}
 // Use the same source records as the metric counts, including the monthly trends.
 const monthly=(items,date)=>{const out=new Map();for(const x of items){const id=date(x).slice(0,7),g=out.get(id)||{id,count:0};g.count++;out.set(id,g)}return [...out.values()].sort((a,b)=>a.id.localeCompare(b.id))};
 const cohortMonths=monthly(planned,x=>x.assigned_on).map(x=>({id:x.id,assignments:x.count,completed:completed.filter(a=>a.assigned_on.slice(0,7)===x.id).length}));
 return {metrics,scope:slice,currencies:economic.currencies,cohortMonths,auditMonths:monthly(audit,x=>x.observed_at),auditGroups:twi.auditGroups,coverage:twi.coverage,prep,currentPrep,actionVerification:pending.filter(x=>x.status==='implemented').length};
}
