import {effectRows,effectFacts,effectStatus,factCurrent,periodTargets,twiEffectsFor,twiBasis} from '../effect/domain.js';
import {REVISION_TITLE_SQL} from '../library/revision-title.js';
// Employee dossier: read-only projections of existing authoritative records.
import {auditDetails,actionRows,actionStatus,actionPeople} from '../training/audit-domain.js';
import {weightedHistory} from '../library/sop-assessment-review.js';
import {scheduleKind,scheduleLabels,schedulePeople,scheduleDisplayState} from '../training/center-planning.js';
import {assessmentAnswers,assessmentScore} from '../training/assessment-review.js';
import {rows,one} from '../../core/db.js';
import {checkContent} from '../library/domain.js';
const parse=s=>{try{return JSON.parse(s||'{}')}catch{return {}}};
const names={trainee_id:'Обучаемый',mentor_id:'Инструктор / наставник',supervisor_id:'Руководитель',assigned_by:'Назначил',person_id:'Сотрудник',evaluator_id:'Оценщик',actor_id:'Ответственный',auditor_id:'Аудитор',author_id:'Автор',created_by:'Разработал',approved_by:'Утвердил',registered_by:'Зарегистрировал',manager_id:'Руководитель',finished_by:'Заключение',witness_id:'Свидетель',responsible_id:'Ответственный',head_id:'Согласовал',owner_id:'Исполнитель',verifier_id:'Проверяющий'};
const roles=(r,id,fields)=>fields.filter(k=>r[k]===id).map(k=>names[k]||k).join(' · ');
const link=(page,options)=>({page,options});
const item=(r,title,role,date,state,dest=null,extra='')=>({id:r.id,title,role,date:date||'',state:state||'',dest,extra});
const docLink=(id,rev)=>link('sop',{documentId:id,revisionId:rev});
const goAssignment=(r,tab)=>r.assignment_id?link('twi',{id:r.assignment_id,tab}):null;
export function employeeRelations(db,id){
 const groups={matrices:[],training:[],assessments:[],mentoring:[],documents:[],development:[],history:[],effectiveness:[]};
 const query=sql=>rows(db,sql,[id]);
 const revision=rid=>one(db,`SELECT d.id document_id,d.code,${REVISION_TITLE_SQL} title,r.version_no FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=?`,[rid]);
 const revLabel=rid=>{const r=rid&&revision(rid);return r?r.code+' · '+r.title+' · v'+r.version_no:'—'};
 const ref=(t,id)=>id?one(db,'SELECT * FROM '+t+' WHERE id=?',[id])?.name||'—':'—';
 const person=id=>id?one(db,'SELECT display_name FROM person WHERE id=?',[id])?.display_name||'—':'—';
 for(const r of query("SELECT * FROM competency_matrix WHERE author_id=?1 OR EXISTS(SELECT 1 FROM json_each(roster_json) WHERE json_extract(value,'$.person_id')=?1) ORDER BY code,version_no DESC")){
  const member=parse(r.roster_json).some(x=>x.person_id===id);
  groups.matrices.push(item(r,r.title+' · v'+r.version_no,[member?'Участник':'',r.author_id===id?'Разработал':''].filter(Boolean).join(' · '),r.base_on,r.state,link('skills',{matrixId:r.id,...(member?{personId:id}:{})}),'Цель: '+r.target_on))
 }
 for(const r of query("SELECT * FROM training_assignment WHERE trainee_id=?1 OR mentor_id=?1 OR supervisor_id=?1 OR assigned_by=?1 OR json_extract(approval_json,'$.responsible_id')=?1 OR json_extract(approval_json,'$.head_id')=?1 ORDER BY assigned_on DESC,id")){
  const role=[roles(r,id,['trainee_id','mentor_id','supervisor_id','assigned_by']),roles(parse(r.approval_json),id,['responsible_id','head_id'])].filter(Boolean).join(' · ');
  groups.training.push(item(r,revLabel(r.sop_revision_id),role,r.assigned_on,r.state,r.source_sha256?link('twi',{id:r.id}):null,'Срок: '+(r.due_on||'—')+' · Обучаемый: '+person(r.trainee_id)+' · Инструктор: '+person(r.mentor_id)))
 }
 for(const r of query("SELECT e.*,p.title,p.kind,p.version_no FROM training_enrollment e JOIN training_program p ON p.id=e.program_id WHERE e.trainee_id=?1 OR e.mentor_id=?1 OR e.manager_id=?1 OR e.finished_by=?1 OR EXISTS(SELECT 1 FROM training_task_result t WHERE t.enrollment_id=e.id AND t.actor_id=?1) ORDER BY e.start_on DESC")){
  let role=roles(r,id,['trainee_id','mentor_id','manager_id','finished_by']);if(!role)role='Ответственный за задание';
  groups.training.push(item(r,r.title+' · v'+r.version_no,role,r.start_on,r.state,link(r.kind==='internship'?'internship':'programs',{enrollmentId:r.id}),'Срок: '+r.due_on))
 }
 for(const r of query('SELECT * FROM training_program WHERE created_by=?1 ORDER BY created_at DESC'))groups.training.push(item(r,r.title+' · v'+r.version_no,'Разработал программу',r.created_at,r.state,link(r.kind==='internship'?'internship':'programs',{programId:r.id})));
 for(const r of query('SELECT s.*,a.trainee_id,a.sop_revision_id FROM training_session s JOIN training_assignment a ON a.id=s.assignment_id WHERE s.mentor_id=?1 OR s.witness_id=?1 OR a.trainee_id=?1 ORDER BY s.held_at DESC')){
  const step=parse(r.steps_json).label||r.stage_code||'Инструктаж';
  groups.training.push(item(r,step+' · '+revLabel(r.sop_revision_id),roles(r,id,['trainee_id','mentor_id','witness_id']),r.held_at,r.result,goAssignment(r,'instruction'),r.duration_minutes==null?'':r.duration_minutes+' мин'))
 }
 for(const r of query('SELECT * FROM assessment_session WHERE person_id=?1 OR evaluator_id=?1 ORDER BY assessed_at DESC')){
  const kind=r.assessment_kind==='practical'?'Практическая оценка':r.assessment_kind==='qualification'?'Оценка компетенции':'Оценка';
  const levels=rows(db,'SELECT i.level,i.observation_state,s.name FROM assessment_item i JOIN skill s ON s.id=i.skill_id WHERE i.session_id=?',[r.id]).map(x=>x.name+': '+(x.level??x.observation_state)).join('; ');
  groups.assessments.push(item(r,kind+' · '+revLabel(r.standard_revision_id),roles(r,id,['person_id','evaluator_id']),r.assessed_at,r.state,r.assessment_kind==='practical'?link('practical',{assessmentId:r.id}):goAssignment(r,'practice'),[levels,r.assessment_kind==='practical'?(()=>{const s=assessmentScore(assessmentAnswers(db,r,'practical'),'practical');return s.sum+' / '+s.count})():'',r.conclusion,r.feedback].filter(Boolean).join(' · ')))
 }
 for(const r of query('SELECT v.*,a.trainee_id,a.sop_revision_id FROM training_verification v JOIN training_assignment a ON a.id=v.assignment_id WHERE a.trainee_id=?1 OR v.evaluator_id=?1 ORDER BY v.evaluated_on DESC'))groups.assessments.push(item(r,(r.kind==='safety'?'Проверка ОТ':'Проверка теории')+' · '+revLabel(r.sop_revision_id),roles(r,id,['trainee_id','evaluator_id']),r.evaluated_on,r.result,goAssignment(r,'practice'),r.evidence));
 for(const r of query('SELECT * FROM admission_decision WHERE person_id=?1 OR actor_id=?1 ORDER BY decided_on DESC'))groups.assessments.push(item(r,'Допуск · '+revLabel(r.revision_id),roles(r,id,['person_id','actor_id']),r.decided_on,r.revoked_at?'revoked':r.decision,goAssignment(r,'practice'),'До: '+(r.valid_until||'—')+' · '+r.evidence));
 for(const r of query('SELECT * FROM mentor_credential WHERE person_id=?1 OR registered_by=?1 ORDER BY issued_on DESC'))groups.mentoring.push(item(r,(r.kind==='certificate'?'Сертификат':'Свидетельство')+' № '+r.number,roles(r,id,['person_id','registered_by']),r.issued_on,r.revoked_at?'revoked':'registered',link('certification',{id:r.id}),r.role+' · '+r.issuer));
 for(const r of query('SELECT * FROM mentor_appointment WHERE person_id=?1 OR approved_by=?1 ORDER BY order_on DESC'))groups.mentoring.push(item(r,'Приказ № '+r.order_number,roles(r,id,['person_id','approved_by']),r.order_on,r.revoked_at?'revoked':'registered',link('appointments',{id:r.id}),person(r.person_id)+' · '+r.role));
 for(const r of query('SELECT * FROM mentor_order WHERE approved_by=?1 OR EXISTS(SELECT 1 FROM mentor_appointment a WHERE a.order_id=mentor_order.id AND a.person_id=?1) ORDER BY order_on DESC'))groups.mentoring.push(item(r,'Групповой приказ № '+r.order_number,r.approved_by===id?'Утвердил':'Назначен приказом',r.order_on,'registered',link('appointments',{groupId:r.id}),r.organization));
 for(const r of query('SELECT * FROM mentor_authorization WHERE person_id=?1 OR approved_by=?1 ORDER BY valid_from DESC'))groups.mentoring.push(item(r,'Право обучать · '+ref('operation',r.operation_id),roles(r,id,['person_id','approved_by']),r.valid_from,r.revoked_at?'revoked':'registered',link('mentoring',{personId:r.person_id}),'До: '+(r.valid_to||'—')));
 for(const r of query('SELECT * FROM mentor_self_evaluation WHERE person_id=?1 ORDER BY evaluated_on DESC'))groups.mentoring.push(item(r,'Самооценка наставника','Самооценка',r.evaluated_on,'registered',link('self_eval',{id:r.id}),(()=>{const s=assessmentScore(assessmentAnswers(db,r,'self_eval'),'self_eval');return (s.value===null?'—':s.value.toFixed(2)+' / 5')+' · '+r.feedback})()));
 for(const r of query('SELECT * FROM audit_session WHERE mentor_id=?1 OR auditor_id=?1 OR trainee_id=?1 ORDER BY observed_at DESC')){
  const a=auditDetails(db,r.id),s=a?.stats;
  groups.mentoring.push(item(r,'Аудит 1-го уровня · '+revLabel(r.standard_revision_id),roles(r,id,['mentor_id','auditor_id','trainee_id']),r.observed_at,r.state,link('audit',{auditId:r.id}),s?'Да '+s.yes+' / '+s.observed+'; отклонений '+s.no+' · '+(r.summary||''):r.summary||''));
  if(r.state==='final'&&(r.mentor_id===id||r.auditor_id===id))for(const q of a?.questions||[])if(q.response==='no')groups.mentoring.push(item({id:q.response_id},'Замечание · '+q.question,roles(r,id,['mentor_id','auditor_id']),r.observed_at,'registered',link('audit',{auditId:r.id}),q.recommendation||q.note||''))
 }
 for(const r of query(`SELECT r.*,d.code,${REVISION_TITLE_SQL} title FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.author_id=?1 OR EXISTS(SELECT 1 FROM document_approval a WHERE a.revision_id=r.id AND a.actor_id=?1) ORDER BY d.code,r.version_no DESC`)){
  const role=[r.author_id===id?'Автор':'',one(db,'SELECT id FROM document_approval WHERE revision_id=? AND actor_id=?',[r.id,id])?'Согласование':''].filter(Boolean).join(' · ');
  groups.documents.push(item(r,r.code+' · '+r.title+' · v'+r.version_no,role,r.created_at,r.state,docLink(r.document_id,r.id)))
 }
 for(const r of query('SELECT e.*,r.document_id FROM sop_evaluation e JOIN document_revision r ON r.id=e.revision_id WHERE e.actor_id=?1 ORDER BY e.evaluated_on DESC'))groups.documents.push(item(r,'Корпоративская оценка СОП · '+revLabel(r.revision_id),'Оценщик',r.evaluated_on,'registered',link('sop_review',{kind:'sop_evaluation',id:r.id})));
 for(const r of weightedHistory(db).filter(x=>x.actor_id===id))groups.documents.push(item(r,'Чек-лист конструктора · '+revLabel(r.revision_id),'Оценщик',r.date,'registered',link('sop_review',{kind:'weighted_sop',id:r.id})));
 for(const r of query('SELECT * FROM frv_study WHERE author_id=?1 ORDER BY observed_at DESC'))groups.documents.push(item(r,'ФРВ · '+r.title,'Автор',r.observed_at,r.state,link('frv',{studyId:r.id})));
 for(const r of query('SELECT * FROM development_plan WHERE person_id=?1 ORDER BY start_on DESC'))groups.development.push(item(r,r.title,'План развития',r.start_on,r.state,link('development',{id:r.id}),'Срок: '+r.due_on));
 for(const a of actionRows(db).filter(x=>actionPeople(x).includes(id)))groups.development.push(item(a,a.title,[a.owner_id===id?'Исполнитель':'',a.subject_id===id?'К кому относится':'',a.mentor_id===id?'Инструктор источника':'',a.auditor_id===id?'ВТ источника':'',a.trainee_id===id?'Обучаемый источника':'',a.assessed_person_id===id?'Оцениваемый':'',a.assessment_evaluator_id===id?'Оценщик источника':'',a.self_person_id===id?'Автор самооценки':'',a.assessment_mentor_id===id?'Наставник источника':'',a.sop_evaluator_id===id||a.weighted_evaluator_id===id?'Оценщик СОП':''].filter(Boolean).join(' · '),a.due_on,actionStatus(db,a),link('actions',{id:a.id}),a.result_note||a.question||''));
 for(const r of query('SELECT * FROM action_verification WHERE verifier_id=?1 ORDER BY checked_at DESC'))groups.development.push(item(r,'Проверка мероприятия','Проверяющий',r.checked_at,r.outcome,link('actions',{id:r.action_id}),r.evidence_note));
 for(const r of effectRows(db)){const actual=r.actual_json?JSON.parse(r.actual_json):null;if(r.owner_id===id||actual?.reviewer_id===id)groups.development.push(item(r,'Экономический эффект · '+r.title,[r.owner_id===id?'Ответственный':'',actual?.reviewer_id===id?'Проверяющий расчёта':''].filter(Boolean).join(' · '),r.review_due,effectStatus(db,r),link('roi',{id:r.id})));for(const t of periodTargets(db,r,new Date().toISOString().slice(0,10))){const who=[r.owner_id===id?'Ответственный':'',t.actor_id===id?'Назначил цель':'',t.review?.p.actor_id===id?'Разобрал отклонение':''].filter(Boolean);if(who.length)groups.development.push(item(t,'Цель экономического эффекта · '+r.title,who.join(' · '),t.to,t.status,link('roi',{id:r.id,targetId:t.id})))}for(const f of effectFacts(db,r.id))if([f.registered_by,f.verifier_id,f.void_by].includes(id))groups.development.push(item(f,'Денежный факт · '+r.title,roles(f,id,['registered_by','verifier_id','void_by']),f.period_to,({draft:'Черновик',confirmed:factCurrent(db,r,f)?'Подтверждён':'Требуется повторная проверка',void:'Аннулирован'})[f.state],link('roi',{id:r.id,factId:f.id})))}
 for(const r of twiEffectsFor(db,'person',id)){const b=twiBasis(db,r.id);groups.effectiveness.push(item(r,'Эффект TWI · '+r.title,'Связанная группа обучения',b.occurred_at,effectStatus(db,r),link('roi',{id:r.id}),b.p.note))}
 for(const r of rows(db,'SELECT * FROM schedule_event ORDER BY due_on').filter(s=>schedulePeople(db,s).includes(id)))groups.development.push(item(r,'Календарь · '+scheduleLabels[scheduleKind(r)],r.owner_id===id?'Ответственный':'Участник',r.due_on,scheduleDisplayState(db,r),link('calendar',{id:r.id})));
 for(const r of query('SELECT * FROM person_assignment WHERE person_id=?1 ORDER BY valid_from DESC'))groups.history.push(item(r,ref('org_unit',r.unit_id)+' · '+(r.position_id?ref('position',r.position_id):ref('profession',r.profession_id)),'Должность / подразделение',r.valid_from,r.valid_to?'closed':'registered',link('person_assignment',{personId:id}),'До: '+(r.valid_to||'—')+' · Смена: '+(r.shift_id?ref('work_shift',r.shift_id):r.shift_code||'—')));
 for(const r of query('SELECT * FROM role_assignment WHERE person_id=?1 ORDER BY valid_from DESC'))groups.history.push(item(r,ref('business_role',r.role_id),'Роль',r.valid_from,r.valid_to?'closed':'registered',link('role_assignment',{personId:id}),'До: '+(r.valid_to||'—')));
 return groups
}
// Old Stage43 JSON contains stable IDs inside detached originals, not in the
// stored projection. Read only on request; never guess identities from names.
export async function employeeSourceLinks(db,id,readContent,onProgress=()=>{}){
 const sources=[...rows(db,`SELECT r.id,r.document_id,d.code,${REVISION_TITLE_SQL} title,r.version_no,r.created_at,r.state,r.payload_json data FROM document_revision r JOIN document d ON d.id=r.document_id`).map(x=>({...x,kind:'sop'})),...rows(db,'SELECT id,title,observed_at created_at,state,context_json data FROM frv_study').map(x=>({...x,kind:'frv'}))];
 const result=[],errors=[];let count=0;
 for(const r of sources){try{
  const source=parse(r.data).source;if(!source){errors.push(r.title+' · нет ссылки на оригинал');continue}
  const raw=JSON.parse(await checkContent(source,await readContent(source))),root=r.kind==='sop'?raw.constructor:raw.study,links=(root?.leanCenterPeople||[]).filter(x=>x.person_id===id);
  if(links.length){const label=x=>x.startsWith('workgroup:')?'Рабочая группа':x.startsWith('agree:')?'Согласующий':({approver:'Утверждающий',trainer:'Инструктор TWI',trainee:'Обучаемый TWI',sop_observer:'Наблюдатель ФРВ',operator:'Исполнитель ФРВ',observer:'Наблюдатель ФРВ'})[x]||x;
   result.push(item(r,(r.kind==='sop'?r.code+' · '+r.title+' · v'+r.version_no:'ФРВ · '+r.title),[...new Set(links.map(x=>label(x.slot)))].join(' · '),r.created_at,r.state,r.kind==='sop'?docLink(r.document_id,r.id):link('frv',{studyId:r.id})))}
 }catch(e){errors.push(r.title+' · '+e.message)}finally{onProgress(++count,sources.length)}}
 return {items:result,errors,scanned:count}
}
