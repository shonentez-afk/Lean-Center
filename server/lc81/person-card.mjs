// Every section is independently authorized using existing projections.
import {rows,one,isId} from '../../src/core/db.js';
import {trainingAssignmentResource,matrixResource} from './read-policy.mjs';
import {PilotError} from '../lc74-store.mjs';
const sections=[
 ['training.read','training_assignment','trainee_id','Назначения обучения'],
 ['training.read','training_assignment','mentor_id','Проведение обучения'],
 ['training.enrollment.read','training_enrollment','trainee_id','Персональные программы'],
 ['preparation.read','twi_preparation','trainee_id','Комплекты подготовки'],
 ['credential.read','mentor_credential','person_id','Подготовка наставника'],
 ['appointment.read','mentor_appointment','person_id','Приказы'],
 ['development.read','development_plan','person_id','Планы развития'],
 ['supplement.read','twi_supplement','person_id','Доплаты'],
 ['task.read','action_item','owner_id','Задачи и мероприятия'],
 ['audit.read','audit_session','mentor_id','Аудиты']
];
export function personCard(db,a,id,canRead){
 const person=isId(id)&&canRead(id)&&(a.read('person.read_directory',id)||a.read('person.read_basic',id));
 if(!person)throw new PilotError(404,'Карточка сотрудника недоступна');
 const result=[];
 for(const [action,table,key,title] of sections){
  if(!a.permissions.includes(action))continue;
  const items=rows(db,'SELECT id FROM '+table+' WHERE '+key+'=? ORDER BY id',[id]).flatMap(({id})=>{const v=a.read(action,id);return v?[action==='training.read'?{...v.data,can_detail:a.allows('training.detail',id,trainingAssignmentResource(db,id,a.day))}:v.data]:[]});
  if(items.length)result.push({action,title,items});
 }
 if(a.permissions.includes('matrix.read')){
  const matrices=rows(db,'SELECT id,roster_json,columns_json,unit_id,base_on FROM competency_matrix ORDER BY code,version_no DESC').filter(x=>JSON.parse(x.roster_json).some(r=>r.person_id===id)).flatMap(x=>{const v=a.read('matrix.read',x.id);return v?[{...v.data,can_detail:a.allows('matrix.detail',x.id,matrixResource(db,x.unit_id,JSON.parse(x.roster_json),JSON.parse(x.columns_json),a.day,x.base_on))}]:[]});
  if(matrices.length)result.push({action:'matrix.read',title:'Матрицы компетенций',items:matrices});
 }
 return {person:person.data,sections:result};
}
