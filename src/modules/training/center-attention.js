import {one,rows} from '../../core/db.js';
import {standardControls} from './standard-overview.js';
import {centerAuditIndicators} from './audit-analytics.js';
import {assessmentIndicators} from './assessment-review.js';
import {comparisonIndicators,retrainingQueue} from './center-overview.js';
import {scheduleKind,schedulePending} from './center-planning.js';
import {effectOverview} from '../effect/domain.js';

export const ATTENTION_GROUPS=Object.freeze({all:'Все направления',docs:'СОП и стандарты',training:'Обучение и компетенции',audit:'Наставники и аудиты',actions:'Задачи и мероприятия',preparation:'Подготовка сотрудников',roi:'Экономический эффект'});
// Rules contain only authored, generic descriptions; not employee data or database values.
const rule=(group,priority,label,basis,advice,page,options={})=>Object.freeze({group,priority,label,basis,advice,page,options:Object.freeze(options)});
export const ATTENTION_RULES=Object.freeze({
 sop_overdue:rule('docs','urgent','Просроченный пересмотр действующих СОП','Действующие редакции СОП с датой пересмотра раньше текущего дня.','Откройте действующие редакции. Проверьте актуальность операций, назначьте пересмотр; не изменяйте утверждённый документ без новой редакции.','sop',{filter:'overdue'}),
 sop_passport:rule('docs','review','Черновики без подтверждённого паспорта','Черновые редакции с отсутствующим форматом печати или рабочим местом.','Заполните и проверьте паспорт перед согласованием. Не публикуйте неподтверждённый черновик.','sop',{filter:'missing_passport'}),
 training_overdue:rule('training','urgent','Просроченные назначения обучения','Запланированные или выполняемые назначения с истёкшим сроком.','Проверьте фактический прогресс, доступность наставника и основания изменения срока. Не регистрируйте фиктивные факты.','twi',{filter:'overdue'}),
 training_revision:rule('training','review','Обучение по прежним редакциям СОП','Неотменённые назначения, связанные с недействующей редакцией или архивным СОП.','Сравните редакции, оцените необходимость нового инструктажа. Историю старого назначения сохраните.','retraining'),
 annual_l1:rule('audit','plan','Инструкторы: осталось выполнить годовую норму L1','Инструкторы с непокрытой годовой нормой по действующему правилу зачёта L1; это не просрочка до окончания года.','Сверьте уникальные наблюдавшиеся факты и запланируйте недостающие аудиты. Не учитывайте повторные отчёты как новые факты.','audit',{mode:'annual'}),
 action_overdue:rule('actions','urgent','Просрочено мероприятий','Открытые мероприятия с истёкшим сроком, по существующему статусу CAPA.','Уточните причину задержки, ответственного и план завершения. Сохраните фактическую историю.','actions',{filter:'overdue'}),
 action_verify:rule('actions','review','Ожидают проверки эффективности','Мероприятия с фактом выполнения без действующей проверки эффективности.','Проведите отдельную проверку результата по согласованным основаниям. Не закрывайте автоматически.','actions',{filter:'implemented'}),
 retraining_need:rule('training','review','Потребности в переобучении и развитии (требуется решение)','Строки очереди переобучения со статусом «требуется решение»; не число уникальных людей.','Разберите источник каждой потребности: редакцию СОП, практику, аудит или разрыв навыка. Проверьте существующие назначения и задачи до создания новых.','retraining',{filter:'needs'}),
 audit_planned:rule('audit','plan','Незакрытые планы аудитов','Планы аудитов, ожидающие выполнения или перепланирования по действующему состоянию.','Сверьте календарь и доступность инструктора. План не является фактом аудита.','calendar',{month:'',plannedOnly:true}),
 practical_need:rule('training','review','Практические оценки: требуется решение','Последняя подтверждённая отрицательная практика без связанного активного мероприятия.','Изучите конкретную оценку и обратную связь; организуйте повторную практику и отдельную оценку.','practical',{filter:'needs'}),
 practical_planned:rule('training','plan','Запланировано практических оценок','Незакрытые планы практических оценок.','Сверьте сроки и отдельного оценщика. Подтверждайте только фактическую оценку.','calendar',{month:'',scheduleType:'practical'}),
 self_planned:rule('audit','plan','Запланировано самооценок','Незакрытые планы самооценок наставников.','Напомните о самооценке и подготовьте обсуждение с наставником; не подменяйте наблюдение.','calendar',{month:'',scheduleType:'self_eval'}),
 mentor_discussion:rule('audit','review','Инструкторы: самооценка и наблюдения требуют обсуждения','Инструкторы, выделенные действующим сравнением самооценки и наблюдений.','Обсудите расхождения и конкретные наблюдения. Не используйте их как автоматический рейтинг личности.','analytics',{assessmentType:'comparison',discussionOnly:true}),
 roi_pending:rule('roi','review','Проверки экономического эффекта','Карточки эффекта, ожидающие проверки или повторной проверки расчёта.','Сверьте исходные измерения, факты и мероприятие. Плановый сценарий не является подтверждённой экономией.','roi',{filter:'pending'}),
 roi_overdue:rule('roi','urgent','Просрочены проверки экономического эффекта','Карточки ожидаемой проверки эффекта со сроком до текущей даты.','Проверьте сроки и доступность документированных оснований. Не подтверждайте эффект по одному плану.','roi',{filter:'overdue'}),
 roi_drafts:rule('roi','review','Черновики денежных фактов','Денежные факты в черновике по активным карточкам.','Сверьте закрытый период и первичные документы, затем передайте на независимую проверку.','roi',{filter:'drafts'}),
 roi_targets:rule('roi','review','Цели эффекта требуют внимания','Цели, отобранные существующей проекцией контроля периода.','Проверьте границы периода и покрытие фактами. Не считать отсутствие факта нулевым результатом.','roi',{filter:'targets'}),
 roi_deviations:rule('roi','review','Неразобранные отклонения эффекта','Подтверждённое недостижение цели с полным покрытием без действующего разбора.','Зафиксируйте доказанную причину и решение. Не выдумывайте финансовое основание.','roi',{filter:'deviations'}),
 prep_overdue:rule('preparation','urgent','Подготовка: просроченные этапы / смены','Открытые комплекты с просроченными этапами или нехваткой запланированных смен.','Откройте комплект и проверьте недостающие фактические смены, протоколы и сроки.','preparation',{filter:'overdue'}),
 prep_review:rule('preparation','urgent','Подготовка: решения требуют повторной проверки','Комплекты, в которых решение комиссии утратило актуальность после изменения основания.','Сверьте изменённые основания и зарегистрируйте повторную проверку комиссии. Допуск автоматически не выдавать.','preparation',{filter:'review'}),
 prep_finish:rule('preparation','review','Подготовка: положительное решение, документы не закрыты','Комплекты с актуальным положительным решением, но не всеми закрытыми документами.','Проверьте завершение каждого документа и фактические основания. Не считать комплект автоматически закрытым.','preparation',{filter:'finish'}),
 bank_unregistered:rule('preparation','plan','Банк вопросов: исходная редакция не зарегистрирована','В реестре отсутствует зарегистрированная исходная редакция банка вопросов.','Зарегистрируйте исходную редакцию корпоративского банка; не заменяйте утверждённые вопросы сгенерированными.','knowledge_bank'),
 bank_stale:rule('preparation','plan','Банк вопросов: требуется годовая актуализация','Банки, требующие ежегодной актуализации по существующему правилу.','Сверьте фактические изменения и нормативный минимум по каждому блоку.','knowledge_bank'),
 supplements_draft:rule('preparation','review','Ходатайства: ожидают решения руководителя','Черновики ходатайств по действующему периоду.','Проверьте зарегистрированные основания и передайте решение уполномоченному руководителю.','supplements',{month:'',filter:'draft'})
});
export const PRIORITY_LABELS=Object.freeze({urgent:'Сначала проверить',review:'Требуется решение',plan:'Запланировать / настроить'});
export function centerAttention(db,day){
 const overdue=one(db,"SELECT count(*) n FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='effective' AND d.archived=0 AND r.review_due<?",[day]).n;
 const without=one(db,"SELECT count(*) n FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='draft' AND d.archived=0 AND (r.print_format IS NULL OR r.workplace_id IS NULL)").n;
 const overdueTraining=one(db,"SELECT count(*) n FROM training_assignment WHERE source_sha256 IS NOT NULL AND state IN('planned','in_progress') AND due_on<?",[day]).n;
 const revisedTraining=one(db,"SELECT count(*) n FROM training_assignment a JOIN document_revision r ON r.id=a.sop_revision_id JOIN document d ON d.id=r.document_id WHERE a.source_sha256 IS NOT NULL AND a.state<>'cancelled' AND (r.state<>'effective' OR d.archived=1)").n;
 const standard=standardControls(db,day),prep=standard.stats,ai=centerAuditIndicators(db,day),ass=assessmentIndicators(db,day),cmp=comparisonIndicators(db,day),plans=rows(db,"SELECT * FROM schedule_event WHERE state IN('planned','done')").filter(x=>schedulePending(db,x));
 const economic=effectOverview(db,{day,from:day.slice(0,7)+'-01',to:day});
 const values={
  sop_overdue:overdue,sop_passport:without,training_overdue:overdueTraining,training_revision:revisedTraining,annual_l1:standard.annual.filter(x=>x.remaining).length,
  action_overdue:ai.overdue,action_verify:ai.verification,retraining_need:retrainingQueue(db,day).filter(x=>x.status==='needs').length,audit_planned:plans.filter(x=>scheduleKind(x)==='audit').length,
  practical_need:ass.needs,practical_planned:plans.filter(x=>scheduleKind(x)==='practical').length,self_planned:plans.filter(x=>scheduleKind(x)==='self_eval').length,mentor_discussion:cmp.people,
  roi_pending:economic.pending,roi_overdue:economic.overdue,roi_drafts:economic.drafts,roi_targets:economic.targetAttention.length,roi_deviations:economic.allTargets.filter(t=>t.shortfall&&!t.currentReview).length,
  prep_overdue:prep.overdue,prep_review:prep.review,prep_finish:prep.finish,[standard.bankUnregistered?'bank_unregistered':'bank_stale']:standard.bankUnregistered?1:standard.bankStale,supplements_draft:standard.supplementDrafts
 };
 const items=Object.entries(values).map(([id,count])=>({id,count,...ATTENTION_RULES[id]}));
 const people=one(db,'SELECT count(*) n FROM person WHERE archived=0').n,docs=one(db,"SELECT count(*) n FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='effective' AND d.archived=0").n;
 return {day,items,people,docs,standard,prep,ai,ass,economic}
}
export function recommendedChecks(snapshot,group='all'){
 const order={urgent:0,review:1,plan:2};
 return snapshot.items.filter(x=>x.count>0&&(group==='all'||x.group===group)).sort((a,b)=>order[a.priority]-order[b.priority])
}
