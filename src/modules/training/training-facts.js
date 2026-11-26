// Shared read-only facts and progress: no imports from command handlers.
import {invariant,one,rows} from '../../core/primitives.js';
import {REVISION_TITLE_SQL} from '../library/revision-title.js';
import {ji2Stages,jiConfig} from './ji-v03.js';
export const within=(x,a,b)=>a<=x&&(!b||b>=x);
export const beforeRevocation=(x,d)=>!x||x.slice(0,10)>d;
export const variants={classic:'Классический',special:'Специальные навыки',smed:'Сложность повтора / SMED',hazardous:'По опасным операциям',fractional:'Дробный инструктаж'};
const prepare=[['prepare','Подготовка']];
const show=[['show1','Показ: действия'],['show2','Показ: действия и ключевые моменты'],['show3','Показ: действия, ключевые моменты и причины']];
const practice=[['try1','Проба: выполнение'],['try2','Проба: объяснение действий'],['try3','Проба: действия и ключевые моменты'],['try4','Проба: действия, ключевые моменты и причины']];
const support=[['support','Самостоятельное задание и последующая поддержка'],...Array.from({length:5},(_,i)=>['follow'+(i+1),'Контрольная проверка '+(i+1)])];
export function jiStages(variant,config=null){
 if(config)return ji2Stages(variant,config);
 // JI-1 remains read/replay only for published historical packages and regression fixtures.
 invariant(Object.hasOwn(variants,variant),'Выберите вид инструктажа');
 let middle;
 if(variant==='classic')middle=[...show,...practice];
 if(variant==='special')middle=[...show.map(([k,v])=>[k,v+' · демонстратор и инструктор']),...practice];
 if(variant==='smed')middle=[...Array.from({length:3},(_,i)=>['show_sim'+(i+1),'Показ: имитация '+(i+1)]),['show_real','Показ: реальное выполнение'],...Array.from({length:3},(_,i)=>['try_sim'+(i+1),'Проба: имитация '+(i+1)]),['try_real','Проба: реальное выполнение']];
 if(variant==='hazardous')middle=[['show_explanation','Показ / видеоматериал с объяснением'],['try_preparatory','Подготовительные работы / тренажёр'],['try_individual','Практика: самостоятельное выполнение по разрешённым условиям'],['try_team','Практика в команде']];
 return [...prepare,...middle,...support].map(([code,label])=>({code,label,phase:code.startsWith('follow')?'followup':code==='support'?'support':code.startsWith('try')?'practice':code.startsWith('show')?'presentation':'prepare'}))
}
export function progressFor(db,a){
 const stages=jiStages(a.method_variant,jiConfig(a)),facts=rows(db,'SELECT * FROM training_session WHERE assignment_id=? AND stage_code IS NOT NULL ORDER BY held_at,recorded_at,id',[a.id]);
 const done=new Set(facts.filter(x=>x.result==='completed').map(x=>x.stage_code)),next=stages.find(x=>!done.has(x.code))||null;
 const intro=stages.filter(x=>!['support','followup'].includes(x.phase)).every(x=>done.has(x.code));
 const followup=stages.filter(x=>x.phase==='followup'&&done.has(x.code)).length;
 const supportOn=facts.find(x=>x.stage_code==='support'&&x.result==='completed')?.held_at.slice(0,10)||null;
 let followupDue=null;if(supportOn){const [y,m,d]=supportOn.split('-').map(Number);const end=new Date(Date.UTC(y,m,Math.min(d,new Date(Date.UTC(y,m+1,0)).getUTCDate())));followupDue=end.toISOString().slice(0,10)}
 return {stages,facts,done,next,intro,followup,followupRequired:stages.filter(x=>x.phase==='followup').length,followupDue,complete:!next,completed:stages.filter(x=>done.has(x.code)).length}
}
export function currentStandard(db,revisionId){
 const r=one(db,`SELECT r.*,d.operation_id,d.code,${REVISION_TITLE_SQL} title,d.archived FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.kind=?`,[revisionId,'sop']);
 if(!r)return null;return {...r,source:JSON.parse(r.payload_json).source}
}
export function isCurrentStandard(db,revisionId){const r=currentStandard(db,revisionId);return !!(r&&r.state==='effective'&&!r.archived)}
export function certificateValid(db,id,day){const x=one(db,'SELECT * FROM mentor_credential WHERE id=?',[id]);return x&&x.kind==='certificate'&&within(day,x.issued_on,x.valid_until)&&beforeRevocation(x.revoked_at,day)?x:null}
export function latest(db,table,where,args,dayColumn){
 return one(db,'SELECT * FROM '+table+' WHERE '+where+' ORDER BY '+dayColumn+' DESC,recorded_at DESC,id DESC LIMIT 1',args)
}
export function latestVerification(db,id,kind){return latest(db,'training_verification','assignment_id=? AND kind=?',[id,kind],'evaluated_on')}
export function latestAssessment(db,id,kind){return latest(db,'assessment_session',"assignment_id=? AND assessment_kind=? AND state='confirmed'",[id,kind],'assessed_at')}
export function enrollmentTasks(db,enrollment){
 return rows(db,'SELECT * FROM training_program_task WHERE program_id=? ORDER BY position',[enrollment.program_id]).map(task=>{
  const shared=sharedTrainingTask(db,enrollment.id,task.id),a=latestTaskAssignment(db,shared?.enrollmentId||enrollment.id,shared?.taskId||task.id),result=latest(db,'training_task_result','enrollment_id=? AND task_id=?',[enrollment.id,task.id],'held_on');
  return {...task,assignment:a,result,shared,done:task.sop_revision_id?(preparationForEnrollment(db,enrollment.id)?preparationTrainingDone(db,a):a?.state==='completed'):result?.result==='completed'}
 })
}
export function latestTaskAssignment(db,enrollmentId,taskId){return one(db,"SELECT * FROM training_assignment WHERE enrollment_id=? AND program_task_id=? AND state<>'cancelled' ORDER BY assigned_on DESC,id DESC LIMIT 1",[enrollmentId,taskId])}
export function sharedTrainingTask(db,enrollmentId,taskId){
 const x=one(db,'SELECT p.internship_id enrollmentId,s.internship_task_id taskId FROM twi_preparation_shared s JOIN twi_preparation p ON p.id=s.preparation_id WHERE p.adaptation_id=? AND s.adaptation_task_id=?',[enrollmentId,taskId]);return x||null
}
export function preparationForEnrollment(db,id){return one(db,'SELECT * FROM twi_preparation WHERE adaptation_id=? OR safety_id=? OR internship_id=?',[id,id,id])}
export function preparationTrainingDone(db,a){
 if(!a||a.state==='cancelled')return false;const p=progressFor(db,a);return p.intro&&p.done.has('support')
}
