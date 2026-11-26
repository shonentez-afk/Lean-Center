import {twiOverview} from './twi-effectiveness.js';
import {effectOverview} from '../effect/domain.js';
// Read-only queues and KPI definitions over authoritative records.
import {rows,one} from '../../core/db.js';
import {matrixData} from './domain.js';
import {auditRegistry} from './audit-analytics.js';
import {assessmentRegistry} from './assessment-review.js';
import {actionRows,actionStatus,actionPeople} from './audit-domain.js';
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
export function centerMetrics(db,{day,from='',to=day,unitId='',personId=''}){
 const inPeriod=d=>!!d&&(!from||d.slice(0,10)>=from)&&(!to||d.slice(0,10)<=to),scope=(u,p)=> (!unitId||u===unitId)&&(!personId||p===personId);
 const a=rows(db,`SELECT a.*,o.unit_id FROM training_assignment a LEFT JOIN operation o ON o.id=a.operation_id WHERE source_sha256 IS NOT NULL`).filter(x=>scope(x.unit_id,x.trainee_id));
 const planned=a.filter(x=>x.state!=='cancelled'&&inPeriod(x.assigned_on)),completed=planned.filter(x=>x.state==='completed');
 const audit=auditRegistry(db).filter(x=>x.state==='final'&&inPeriod(x.observed_at)&&scope(x.unit_id,x.mentor_id)),practice=assessmentRegistry(db,'practical').filter(x=>x.state==='confirmed'&&inPeriod(x.date)&&scope(x.unit_id,x.person_id)),self=assessmentRegistry(db,'self_eval').filter(x=>inPeriod(x.date)&&scope(x.unit_id,x.person_id));
 const actions=actionRows(db).map(x=>({...x,status:actionStatus(db,x)})).filter(x=>(!unitId||personUnit(db,x.owner_id,day)===unitId)&&(!personId||actionPeople(x).includes(personId))),pending=actions.filter(x=>open(x.status)),implemented=actions.filter(x=>x.implemented_at&&inPeriod(x.implemented_at)),verified=implemented.filter(x=>x.status==='verified');
 const sop=corporateEvaluations(db).filter(x=>inPeriod(x.date)&&scope(x.unit_id,x.actor_id)),weighted=weightedHistory(db).filter(x=>inPeriod(x.date)&&scope(x.unit_id,x.actor_id)),docs=rows(db,`SELECT r.*,d.operation_id,o.unit_id FROM document_revision r JOIN document d ON d.id=r.document_id LEFT JOIN operation o ON o.id=d.operation_id WHERE r.state='effective' AND d.archived=0`).filter(x=>scope(x.unit_id,x.author_id));
 const frv=frvRegistry(db).filter(x=>x.state==='final'&&inPeriod(x.observed_at)&&scope(x.unit_id,x.author_id));
 const schedules=rows(db,"SELECT * FROM schedule_event WHERE state IN('planned','done')").filter(x=>schedulePending(db,x)&&(!unitId||personUnit(db,x.owner_id,scheduleScopeDate(db,x,day))===unitId)&&(!personId||schedulePeople(db,x).includes(personId)));
 const requirements=matrixData(db,day),cells=requirements.people.filter(p=>scope(p.unit_id,p.id)).flatMap(p=>requirements.skills.map(s=>requirements.cells.get(p.id+':'+s.id)).filter(c=>c.goal));
 const count=(group,label,value,definition,page,options={})=>({group,label,value,denominator:null,definition,page,options});
 const ratio=(group,label,value,denominator,definition,page,options={})=>({group,label,value,denominator,definition,page,options});
 const f={from,to,personId,unitId},twi=twiOverview(db,{...f,day,role:'trainee'}),ts=twi.stats,economic=effectOverview(db,{day,from,to,unitId,personId});
 return [
 count('Обучение','Назначено обучения',planned.length,'Назначения, созданные в период; без отменённых. Сотрудник — обучаемый.','twi',{}),
 ratio('Обучение','Завершено из назначенных',completed.length,planned.length,'Текущие состояния назначений, созданных в период; не исторический срез закрытий.','twi',{}),
 count('Эффективность TWI','Уникальные обучаемые',ts.people,'Уникальные люди среди назначений, начатых в периоде.','analytics',{...f,assessmentType:'twi_effect',role:'trainee'}),
 ratio('Эффективность TWI','Первое положительное заключение',ts.firstPass,ts.assessed,'Первая действующая подтверждённая практика назначения до конца периода; базовый уровень или выше, не допуск.','analytics',{...f,assessmentType:'twi_effect',role:'trainee',detail:'first'}),
 count('Эффективность TWI','Назначения с первым зарегистрированным допуском',ts.granted,'Первый зарегистрированный допуск до конца периода, независимо от текущего статуса.','analytics',{...f,assessmentType:'twi_effect',role:'trainee',detail:'granted'}),
 count('Эффективность TWI','Действующие допуски по назначениям',ts.current,'Текущее решение по операции и действующие доказательства; исторические решения отдельно.','analytics',{...f,assessmentType:'twi_effect',role:'trainee',detail:'current'}),
 count('Обучение','Просрочено обучений',a.filter(x=>['planned','in_progress'].includes(x.state)&&x.due_on<day).length,'Открытые назначения со сроком до текущей даты.','twi',{filter:'overdue'}),
 count('Наставничество','Аудиты L1',audit.length,'Зафиксированные аудиты инструктора в период; версии не смешиваются в процент.','audit',{...f,role:'mentor',state:'final'}),
 count('Наставничество','Самооценки',self.length,'Факты самооценки наставника в период.','self_eval',f),
 count('Наставничество','Запланировано оценок',schedules.filter(x=>['audit','practical','self_eval'].includes(scheduleKind(x))).length,'Незакрытые планы и планы с аннулированным подтверждением; подразделение ответственного.','calendar',{personId,unitId,month:'',scheduleType:'planned'}),
 count('Компетенции','Практические оценки',practice.length,'Подтверждённые практические оценки обучаемого в период.','practical',f),
 ratio('Компетенции','Заключения «Не соответствует»',practice.filter(x=>x.conclusion==='not_meet').length,practice.length,'Отдельное заключение оценщика, не процент чек-листа.','practical',{...f,filter:'not_meet'}),
 ratio('Компетенции','Требования без разрыва',cells.filter(x=>!x.gap).length,cells.length,'Текущие требования по сотрудникам и навыкам, с той же шкалой и актуальной редакцией. Не означает допуск.','skills',{}),
 count('СОП','Корпоративские оценки',sop.length,'Сохранённые бинарные оценки в период; сотрудник — оценщик.','analytics',{...f,assessmentType:'sop',sopKind:'sop_evaluation'}),
 count('СОП','Снимки взвешенных чек-листов',weighted.length,'Исторические сохранения и правки, не количество уникальных документов.','analytics',{...f,assessmentType:'sop',sopKind:'weighted_sop'}),
 count('СОП','Просрочен пересмотр',docs.filter(x=>x.review_due&&x.review_due<day).length,'Действующие редакции со сроком пересмотра до текущей даты; сотрудник — автор.','sop',{}),
 count('ФРВ','Завершённые исследования',frv.length,'Финальные исследования в период, сотрудник — сохранённый автор. Не денежный эффект.','analytics',{...f,assessmentType:'frv'}),
 count('Мероприятия','Открытые мероприятия',pending.length,'Текущие открытые/в работе/ожидают проверки/неэффективны. Подразделение исполнителя; сотрудник — участник.','actions',{personId,unitId}),
 count('Мероприятия','Просроченные мероприятия',pending.filter(x=>x.due_on&&x.due_on<day).length,'Незакрытые мероприятия со сроком до текущей даты.','actions',{personId,unitId,filter:'overdue'}),
 ratio('Мероприятия','Подтверждён эффект',verified.length,implemented.length,'Из мероприятий с фактом выполнения в период; проверка эффективности учитывает повторные нарушения.','actions',{personId,unitId,filter:'verified'}),
 count('Экономика','Карточки эффекта требуют проверки',economic.pending,'Открытые контрольные сроки или утратившие актуальность доказательства.','roi',{...f,filter:'pending'}),
 count('Экономика','Просроченные проверки эффекта',economic.overdue,'Текущие незакрытые контрольные сроки до сегодняшней даты.','roi',{...f,filter:'overdue'}),
 count('Экономика','Подтверждённые денежные факты',economic.facts.filter(x=>x.eligible).length,'Факты полностью в выбранном периоде с действующими доказательствами; не годовые сценарии.','roi',{...f,filter:'confirmed'}),
 count('Экономика','Черновики денежных фактов',economic.drafts,'Текущие денежные факты, ожидающие независимого подтверждения.','roi',{...f,filter:'drafts'}),
 count('Экономика','Цели эффекта требуют внимания',economic.targetAttention.length,'Текущие открытые, неполные или требующие разбора цели.','roi',{...f,filter:'targets'}),
 count('Экономика','Неразобранные отклонения',economic.allTargets.filter(t=>t.shortfall&&!t.currentReview).length,'Текущие цели с полным фактом ниже плана без актуального разбора.','roi',{...f,filter:'deviations'})
 ];
}
