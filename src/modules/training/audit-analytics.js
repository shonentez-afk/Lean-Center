import {REVISION_TITLE_SQL} from '../library/revision-title.js';
import {rows} from '../../core/db.js';
import {scoreQuestions,actionRows,actionStatus} from './audit-domain.js';
export const pctText=v=>v===null?'—':(Math.round(v*10)/10).toLocaleString('ru-RU')+'%';
export function auditRegistry(db){
 return rows(db,`SELECT a.*,v.version_no,c.code method_code,s.passed,s.observed,s.recorded,s.expected,s.critical_failures,s.score_pct,d.code sop_code,${REVISION_TITLE_SQL} sop_title,o.unit_id,t.shift_id FROM audit_session a JOIN checklist_version v ON v.id=a.version_id JOIN checklist c ON c.id=v.checklist_id LEFT JOIN v_audit_scores s ON s.id=a.id LEFT JOIN document_revision r ON r.id=a.standard_revision_id LEFT JOIN document d ON d.id=r.document_id LEFT JOIN operation o ON o.id=a.operation_id LEFT JOIN training_assignment t ON t.id=a.assignment_id WHERE c.code='TWI_L1_RC1' ORDER BY a.observed_at DESC,a.id`);
}
export function summarizeAudits(db,{versionId,from='',to='',mentorId='',unitId='',shiftId=''}={}){
 const all=auditRegistry(db).filter(a=>a.state==='final'&&a.version_id===versionId&&(!from||a.observed_at.slice(0,10)>=from)&&(!to||a.observed_at.slice(0,10)<=to)&&(!mentorId||a.mentor_id===mentorId)&&(!unitId||a.unit_id===unitId)&&(!shiftId||a.shift_id===shiftId));
 const ids=new Map(all.map(a=>[a.id,a])),criteria=versionId?rows(db,'SELECT * FROM checklist_criterion WHERE version_id=? ORDER BY position',[versionId]):[];
 const selected=versionId?rows(db,`SELECT a.id audit_id,c.id criterion_id,c.position,c.question,c.section_code,c.critical,r.response,r.legacy_score FROM audit_session a JOIN checklist_criterion c ON c.version_id=a.version_id LEFT JOIN audit_response r ON r.audit_id=a.id AND r.criterion_id=c.id WHERE a.state='final' AND a.version_id=?`,[versionId]).filter(q=>ids.has(q.audit_id)):[];
 const aggregate=(key,keys=[])=>{const m=new Map(keys.map(k=>[k,[]]));for(const q of selected){const k=key(q,ids.get(q.audit_id));if(!m.has(k))m.set(k,[]);m.get(k).push(q)}return [...m].map(([key,qs])=>({key,audits:new Set(qs.map(q=>q.audit_id)).size,...scoreQuestions(qs)}))};
 const groups=aggregate(q=>q.section_code,[...new Set(criteria.map(c=>c.section_code))]);
 const byCriterion=aggregate(q=>q.criterion_id,criteria.map(c=>c.id)).map(x=>({...x,criterion:criteria.find(c=>c.id===x.key)}));
 // Reports by different trainers are separate observations, not different instruction facts.
 const recurrence=new Map();
 for(const q of selected.filter(q=>q.response==='no')){const a=ids.get(q.audit_id),key=JSON.stringify([a.mentor_id,a.operation_id,a.standard_revision_id,q.criterion_id]),x=recurrence.get(key)||{key,context:JSON.parse(key),facts:new Set(),reports:new Set(),historical:new Set(),no:0};x.no++;x.reports.add(a.id);if(a.training_session_id)x.facts.add(a.training_session_id);else x.historical.add(a.id);recurrence.set(key,x)}
 const contexts=[...recurrence.values()].map(x=>({key:x.key,context:x.context,factCount:x.facts.size,negativeReports:x.reports.size,negativeAnswers:x.no,unlinked:x.historical.size}));
 const repeated=contexts.filter(x=>x.factCount>=2).sort((a,b)=>b.factCount-a.factCount||b.negativeAnswers-a.negativeAnswers),unlinked=contexts.filter(x=>x.unlinked>0);
 const heat=aggregate((q,a)=>JSON.stringify([a.mentor_id,q.criterion_id])),heatmap=new Map(heat.map(x=>[x.key,x]));
 return {audits:all,criteria,stats:scoreQuestions(selected),groups,byCriterion,byMonth:aggregate((q,a)=>a.observed_at.slice(0,7)).sort((a,b)=>a.key.localeCompare(b.key)),byMentor:aggregate((q,a)=>a.mentor_id),byUnit:aggregate((q,a)=>a.unit_id||''),byShift:aggregate((q,a)=>a.shift_id||''),repeated,unlinked,heatmap};
}
export function centerAuditIndicators(db,day){
 const audits=auditRegistry(db).filter(a=>a.state==='final'&&a.observed_at.slice(0,7)===day.slice(0,7)&&a.observed_at.slice(0,10)<=day),actions=actionRows(db).map(a=>({...a,displayState:actionStatus(db,a)})),open=actions.filter(a=>['open','in_progress','ineffective','implemented'].includes(a.displayState)),versions=[...new Set(audits.map(a=>a.version_id))];
 const month=versions.length===1?summarizeAudits(db,{versionId:versions[0],from:day.slice(0,7)+'-01',to:day}):null;
 return {auditCount:audits.length,month,versionId:versions.length===1?versions[0]:null,methodCount:versions.length,overdue:open.filter(a=>a.due_on&&a.due_on<day).length,verification:open.filter(a=>a.displayState==='implemented').length,retraining:open.filter(a=>['instructor_training','trainee_training'].includes(a.kind)).length,scheduled:rows(db,"SELECT id FROM schedule_event WHERE kind='audit' AND state='planned'").length,repeated:month?.repeated.length??null};
}
