// Every section is independently authorized using existing projections.
import {rows,one,isId} from '../../src/core/db.js';
import {trainingAssignmentResource,matrixResource} from './read-policy.mjs';
import {personnelView} from './personnel-commands.mjs';
import {scheduleView} from './center-commands.mjs';
import {roiView} from './roi-commands.mjs';
import {competencyView} from './competency-commands.mjs';
import {developmentView} from './development-commands.mjs';
import {qualityView} from './quality-commands.mjs';
import {workflowView} from './mentor-workflows.mjs';
import {mentorView} from './mentor-commands.mjs';
import {programView} from './program-commands.mjs';
import {canReadRetraining} from './training-registers.mjs';
import {evaluationAccess} from './sop-evaluation-commands.mjs';
import {PilotError} from '../lc74-store.mjs';
const sections=[
 ['employment.read','person_assignment','person_id','Кадровые назначения'],
 ['role_assignment.read','role_assignment','person_id','История бизнес-ролей'],
 ['training.read','training_assignment','trainee_id','Назначения обучения'],
 ['training.read','training_assignment','mentor_id','Проведение обучения'],
 ['training.enrollment.read','training_enrollment','trainee_id','Персональные программы'],
 ['training.enrollment.read','training_enrollment','mentor_id','Наставничество в персональных программах'],
 ['training.enrollment.read','training_enrollment','manager_id','Программы под руководством сотрудника'],
 ['preparation.read','twi_preparation','trainee_id','Комплекты подготовки'],
 ['credential.read','mentor_credential','person_id','Подготовка наставника'],
 ['appointment.read','mentor_appointment','person_id','Приказы'],
 ['authorization.read','mentor_authorization','person_id','Полномочия по операциям'],
 ['development.read','development_plan','person_id','Планы развития'],
 ['assessment.read','assessment_session','person_id','Оценки компетенций и практики'],
 ['assessment.read','assessment_session','evaluator_id','Проведённые оценки'],
 ['supplement.read','twi_supplement','person_id','Доплаты'],
 ['task.read','action_item','owner_id','Задачи и мероприятия'],
 ['task.read','action_item','subject_id','Мероприятия по развитию сотрудника'],
 ['audit.read','audit_session','mentor_id','Аудиты'],
 ['audit.read','audit_session','auditor_id','Проведённые аудиты'],
 ['self.read','mentor_self_evaluation','person_id','Самооценки наставника'],
 ['calendar.read','schedule_event','owner_id','Плановые аудиты и оценки'],
 ['roi.read','economic_effect','owner_id','Карточки экономического эффекта']
];
export function personCard(db,a,id,canRead,{libraryRead=(action,id)=>a.read(action,id),canTwiReport=false,canPlan=false}={}){
 const person=isId(id)&&canRead(id)&&(a.read('person.read_directory',id)||a.read('person.read_basic',id));
 if(!person)throw new PilotError(404,'Карточка сотрудника недоступна');
 const result=[];
 const relatedRevisions=new Set();
 for(const [action,table,key,title] of sections){
  if(!a.permissions.includes(action))continue;
  const items=rows(db,'SELECT id FROM '+table+' WHERE '+key+'=? ORDER BY id',[id]).flatMap(({id})=>{const v=a.read(action,id);if(!v)return [];
   if(action==='training.read'){
    const row=one(db,'SELECT mentor_id,operation_id,sop_revision_id,assigned_on FROM training_assignment WHERE id=?',[id]),resource=trainingAssignmentResource(db,id,a.day);
    const can_detail=!!resource&&a.allows('training.detail',id,resource),mentor=row&&(a.read('person.read_directory',row.mentor_id)||a.read('person.read_basic',row.mentor_id))?.data.display_name;
    const sop=row&&(libraryRead('sop.read_history',row.sop_revision_id)||libraryRead('sop.read_effective',row.sop_revision_id))?.data;
    if(sop)relatedRevisions.add(sop.revision_id);
    return [{...v.data,assigned_on:row?.assigned_on,operation_name:a.read('operation.read',v.data.operation_id)?.data.name??(can_detail?one(db,'SELECT name FROM operation WHERE id=?',[v.data.operation_id])?.name:null),mentor_name:mentor??(can_detail?one(db,'SELECT display_name FROM person WHERE id=?',[row?.mentor_id])?.display_name:null),sop_label:sop?sop.code+' · '+sop.title+' · v'+sop.version_no:null,can_detail,can_sop:!!sop}];
   }
   return [['training.enrollment.read','preparation.read'].includes(action)?programView(db,a,action,v.data):['employment.read','role_assignment.read'].includes(action)?personnelView(db,a,action,v.data):action==='calendar.read'?scheduleView(db,a,v.data):action==='roi.read'?roiView(db,a,v.data):action==='assessment.read'?competencyView(db,a,action,v.data):action==='development.read'?developmentView(db,a,action,v.data):['audit.read','self.read','task.read'].includes(action)?qualityView(db,a,action,v.data):action==='supplement.read'?workflowView(db,a,action,v.data):['credential.read','appointment.read','authorization.read'].includes(action)?mentorView(db,a,action.split('.')[0],v.data):v.data]});
  result.push({action,title,items});
 }
 if(a.permissions.includes('matrix.read')){
  const matrices=rows(db,'SELECT id,roster_json,columns_json,unit_id,base_on FROM competency_matrix ORDER BY code,version_no DESC').filter(x=>JSON.parse(x.roster_json).some(r=>r.person_id===id)).flatMap(x=>{const v=a.read('matrix.read',x.id);return v?[{...v.data,can_detail:a.allows('matrix.detail',x.id,matrixResource(db,x.unit_id,JSON.parse(x.roster_json),JSON.parse(x.columns_json),a.day,x.base_on))}]:[]});
  result.push({action:'matrix.read',title:'Матрицы компетенций',items:matrices});
 }
 if(a.permissions.includes('sop.evaluation.read')){
  const items=rows(db,'SELECT id,evaluated_on FROM sop_evaluation WHERE actor_id=? ORDER BY evaluated_on DESC,id',[id]).filter(x=>evaluationAccess(db,a,'sop_evaluation',x.id)).map(x=>({...x,kind:'sop_evaluation'}));
  const weighted=rows(db,"SELECT id,substr(occurred_at,1,10) evaluated_on FROM change_event WHERE entity_type='sop_stage43_checklist' AND json_extract(payload_json,'$.actor_id')=? ORDER BY occurred_at DESC,id",[id]).filter(x=>evaluationAccess(db,a,'weighted_sop',x.id)).map(x=>({...x,kind:'weighted_sop'}));
  result.push({action:'sop.evaluation.read',title:'Проведённые оценки СОП',items:[...items,...weighted]});
 }
 // Author links and training-source links use the same individually
 // authorized library projection; no hidden revision IDs or counts.
 for(const x of rows(db,'SELECT id FROM document_revision WHERE author_id=?',[id]))relatedRevisions.add(x.id);
 const sopItems=[...relatedRevisions].flatMap(rid=>{const s=libraryRead('sop.read_history',rid)||libraryRead('sop.read_effective',rid);return s?[s.data]:[]});
 const frvItems=rows(db,'SELECT id FROM frv_study WHERE author_id=? ORDER BY observed_at DESC,id',[id]).flatMap(x=>{const f=libraryRead('frv.read',x.id);return f?[f.data]:[]});
 if(sopItems.length)result.push({action:'sop.read_history',title:'Связанные редакции СОП',items:sopItems});
 if(frvItems.length)result.push({action:'frv.read',title:'Исследования ФРВ сотрудника',items:frvItems});
 const current=result.find(s=>s.action==='employment.read')?.items.find(x=>x.state==='Действует'),roles=(result.find(s=>s.action==='role_assignment.read')?.items||[]).filter(x=>x.state==='Действует'&&x.role).map(x=>x.role);
 return {person:{...person.data,...(current?.shift?{shift:current.shift}:{}),roles:[...new Set(roles)]},sections:result,day:a.day,can_create_training:!!a.personId&&a.personId!==id&&a.permissions.includes('training.create'),can_calendar:a.permissions.includes('calendar.read'),can_plan:canPlan,can_twi_report:canTwiReport,can_journal:['training.read','training.detail','sop.read_history','operation.read','org.read'].every(k=>a.permissions.includes(k)),can_retraining:canReadRetraining(db,a)};
}
