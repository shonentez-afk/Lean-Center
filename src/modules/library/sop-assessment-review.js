import {REVISION_TITLE_SQL} from './revision-title.js';
// Independent corporate binary evaluations and historical weighted snapshots.
import {rows,one,canonical} from '../../core/primitives.js';
import {weightedResult} from './stage43-checklist.js';
import {evaluationResult,sopCriteria} from './sop-review.js';
const query=`SELECT e.*,d.id document_id,d.code,${REVISION_TITLE_SQL} title,d.operation_id,r.version_no revision_no,r.state revision_state,v.version_no method_version,o.unit_id FROM sop_evaluation e JOIN document_revision r ON r.id=e.revision_id JOIN document d ON d.id=r.document_id JOIN checklist_version v ON v.id=e.method_id LEFT JOIN operation o ON o.id=d.operation_id`;
export function corporateEvaluations(db){
 return rows(db,query+' ORDER BY e.evaluated_on DESC,e.recorded_at DESC,e.id').map(e=>({...e,date:e.evaluated_on,score:evaluationResult(rows(db,'SELECT value FROM sop_evaluation_response WHERE evaluation_id=?',[e.id]),sopCriteria(db,e.method_id).length)}))
}
export function corporateAnswers(db,id){
 return rows(db,'SELECT c.id,c.position,c.question,r.value,r.note FROM sop_evaluation_response r JOIN checklist_criterion c ON c.id=r.criterion_id WHERE r.evaluation_id=? ORDER BY c.position',[id]);
}
export function weightedHistory(db,revisionId=null){
 const sql=`SELECT e.id event_id,e.entity_id,e.occurred_at,e.payload_json,r.id revision_id,r.version_no revision_no,d.id document_id,d.code,${REVISION_TITLE_SQL} title,d.operation_id,o.unit_id FROM change_event e JOIN sop_stage43_checklist c ON c.id=e.entity_id JOIN document_revision r ON r.id=c.revision_id JOIN document d ON d.id=r.document_id LEFT JOIN operation o ON o.id=d.operation_id WHERE e.entity_type='sop_stage43_checklist'`;
 return rows(db,sql+(revisionId?' AND r.id=?':'')+' ORDER BY e.occurred_at DESC,e.id',revisionId?[revisionId]:[]).map(e=>{const p=JSON.parse(e.payload_json);return {...e,id:e.event_id,date:e.occurred_at.slice(0,10),actor_id:p.actor_id,source_sha256:p.source.sha256,questions:p.rows,score:weightedResult(p.rows),methodKey:canonical(p.rows.map(q=>[q.id,q.req,q.weight]))}});
}
export function sopCriterionSource(db,kind,id,criterionId){
 if(kind==='sop_evaluation'){
  const e=one(db,query+' WHERE e.id=?',[id]);if(!e)return null;const q=criterionId?corporateAnswers(db,id).find(q=>q.id===criterionId&&q.value===0):null;if(criterionId&&!q)return null;
  return {kind,id,revision_id:e.revision_id,evaluation_id:id,criterion_id:q?.id||null,label:'Оценка СОП · '+e.code+' · '+e.evaluated_on+(q?' · '+q.question:''),question:q?.question||'',actor_id:e.actor_id}
 }
 if(kind==='weighted_sop'){
  const e=weightedHistory(db).find(x=>x.id===id),q=e?.questions.find(x=>String(x.id)===String(criterionId)&&x.scoreSource==='manual'&&x.score<1);
  if(!e||!q||!e.actor_id)return null;
  return {kind,id,revision_id:e.revision_id,weighted_event_id:id,weighted_position:q.id,actor_id:e.actor_id,label:'Чек-лист СОП · '+e.code+' · '+e.date+' · '+q.req,question:q.req}
 }
 return null
}
export function sopEvidence(db,a){
 if(!a.implemented_at)return [];
 const after=a.implemented_at.slice(0,10);
 if(a.source_evaluation_id&&a.source_criterion_id){const s=one(db,query+' WHERE e.id=?',[a.source_evaluation_id]);if(!s)return [];
  return corporateEvaluations(db).filter(e=>e.document_id===s.document_id&&e.method_id===s.method_id&&e.revision_no>=s.revision_no&&e.date>after&&e.recorded_at>a.implemented_at).map(e=>({...e,value:corporateAnswers(db,e.id).find(q=>q.id===a.source_criterion_id)?.value??null}))
 }
 if(a.source_weighted_event_id){const history=weightedHistory(db),s=history.find(x=>x.id===a.source_weighted_event_id);if(!s)return [];
  return history.filter(e=>e.document_id===s.document_id&&e.methodKey===s.methodKey&&e.revision_no>=s.revision_no&&e.date>after&&e.occurred_at>a.implemented_at&&e.actor_id).map(e=>{const q=e.questions.find(x=>x.id===a.source_weighted_position);return {...e,value:q?.scoreSource==='manual'?q.score:null}})
 }
 return []
}
export function sopEffect(db,a,id){
 const evidence=sopEvidence(db,a),s=evidence.find(x=>x.id===id);return s?.value===1&&!evidence.some(x=>x.date>=s.date&&x.value!==null&&x.value<1)
}
