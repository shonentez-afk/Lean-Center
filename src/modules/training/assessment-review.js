// Read-only shared projections. Assessment facts remain in their authoritative tables.
import {rows,one} from '../../core/db.js';
import {actionRows,actionStatus,actionPeople} from './audit-domain.js';
const parse=s=>{try{const x=JSON.parse(s||'[]');return Array.isArray(x)?x:[]}catch{return []}};
export const ASSESSMENT_LABELS={practical:'Практическая оценка',self_eval:'Самооценка'};
export function assessmentRegistry(db,type){
 const practical=type==='practical';
 return practical?rows(db,`SELECT a.*,a.assessed_at date,v.version_no,t.mentor_id,t.shift_id,o.unit_id FROM assessment_session a JOIN checklist_version v ON v.id=a.method_id LEFT JOIN training_assignment t ON t.id=a.assignment_id LEFT JOIN operation o ON o.id=a.operation_id WHERE a.assessment_kind='practical' ORDER BY a.assessed_at DESC,a.recorded_at DESC,a.id`):
 rows(db,`SELECT s.*,s.evaluated_on date,v.version_no,'confirmed' state,pa.unit_id,pa.shift_id FROM mentor_self_evaluation s JOIN checklist_version v ON v.id=s.method_id LEFT JOIN person_assignment pa ON pa.id=(SELECT id FROM person_assignment WHERE person_id=s.person_id AND valid_from<=s.evaluated_on AND coalesce(valid_to,'9999-12-31')>=s.evaluated_on ORDER BY valid_from DESC,id LIMIT 1) ORDER BY s.evaluated_on DESC,s.recorded_at DESC,s.id`);
}
export function assessmentAnswers(db,record,type){
 const byId=new Map(parse(record.responses_json).map(x=>[x.criterion_id,x]));
 return rows(db,'SELECT * FROM checklist_criterion WHERE version_id=? ORDER BY position',[record.method_id]).map(q=>{const r=byId.get(q.id),value=r?.value;return {...q,value:type==='practical'?[0,1].includes(value)?value:null:Number.isInteger(value)&&value>=1&&value<=5?value:null,note:r?.note||''}})
}
export function assessmentScore(answers,type){
 const values=answers.map(x=>x.value).filter(x=>type==='practical'?[0,1].includes(x):Number.isInteger(x)&&x>=1&&x<=5),sum=values.reduce((a,b)=>a+b,0);
 const count=values.length,expected=answers.length;
 return {count,expected,sum,missing:expected-count,value:count?(type==='practical'?100*sum/count:sum/count):null,distribution:[1,2,3,4,5].map(x=>values.filter(v=>v===x).length)};
}
export function assessmentSummary(db,type,filters={}){
 const {versionId,from='',to='',personId='',unitId='',shiftId=''}=filters;
 const records=assessmentRegistry(db,type).filter(x=>x.state==='confirmed'&&x.method_id===versionId&&(!from||x.date.slice(0,10)>=from)&&(!to||x.date.slice(0,10)<=to)&&(!personId||x.person_id===personId)&&(!unitId||x.unit_id===unitId)&&(!shiftId||x.shift_id===shiftId));
 const details=records.map(r=>({r,answers:assessmentAnswers(db,r,type)})),aggregate=key=>{const m=new Map();for(const d of details){const k=key(d.r);if(!m.has(k))m.set(k,[]);m.get(k).push(d)}return [...m].map(([key,d])=>({key,records:d.length,...assessmentScore(d.flatMap(x=>x.answers),type)}))};
 const criteria=versionId?rows(db,'SELECT * FROM checklist_criterion WHERE version_id=? ORDER BY position',[versionId]):[];
 const byCriterion=criteria.map(q=>({...q,...assessmentScore(details.flatMap(d=>d.answers.filter(a=>a.id===q.id)),type)}));
 const sections=[...new Set(criteria.map(q=>q.section_code))].map(key=>({key,...assessmentScore(details.flatMap(d=>d.answers.filter(q=>q.section_code===key)),type)}));
 const ids=new Set(records.map(x=>x.id)),actions=actionRows(db).filter(a=>ids.has(type==='practical'?a.source_assessment_id:a.source_self_id));
 const heat=aggregate(r=>r.person_id).map(g=>({personId:g.key,cells:criteria.map(q=>assessmentScore(details.filter(d=>d.r.person_id===g.key).flatMap(d=>d.answers.filter(x=>x.id===q.id)),type))}));
 const repeats=type==='practical'?byCriterion.flatMap(q=>{const m=new Map();for(const d of details){if(!d.r.operation_id||!d.r.standard_revision_id||!d.answers.some(x=>x.id===q.id&&x.value===0))continue;const k=JSON.stringify([d.r.person_id,d.r.operation_id,d.r.standard_revision_id]);m.set(k,(m.get(k)||0)+1)}return [...m].filter(([,count])=>count>=2).map(([k,count])=>({question:q.question,context:JSON.parse(k),count}))}).sort((a,b)=>b.count-a.count):[];
 return {records,stats:assessmentScore(details.flatMap(d=>d.answers),type),byCriterion,sections,byMonth:aggregate(r=>r.date.slice(0,7)).sort((a,b)=>a.key.localeCompare(b.key)),byPerson:aggregate(r=>r.person_id),byUnit:aggregate(r=>r.unit_id||''),byShift:aggregate(r=>r.shift_id||''),conclusions:Object.fromEntries(['not_meet','basic','exceeds'].map(k=>[k,records.filter(x=>x.conclusion===k).length])),actions,heat,criteria,repeats};
}
export function assessmentIndicators(db,day){
 const from=day.slice(0,7)+'-01',recent=type=>assessmentRegistry(db,type).filter(x=>x.state==='confirmed'&&x.date.slice(0,10)>=from&&x.date.slice(0,10)<=day),pr=recent('practical'),self=recent('self_eval');
 const latest=new Map();for(const x of assessmentRegistry(db,'practical').filter(x=>x.state==='confirmed'&&x.date.slice(0,10)<=day)){const k=JSON.stringify([x.person_id,x.operation_id,x.standard_revision_id,x.method_id]);if(!latest.has(k))latest.set(k,x)}
 const pending=actionRows(db).filter(a=>(a.source_assessment_id||a.source_self_id)&&['open','in_progress','implemented','ineffective'].includes(actionStatus(db,a)));
 const key=x=>JSON.stringify([x.person_id,x.operation_id,x.standard_revision_id,x.method_id]),byId=new Map(assessmentRegistry(db,'practical').map(x=>[x.id,x])),pendingContexts=new Set(pending.filter(a=>a.kind==='trainee_training'&&byId.has(a.source_assessment_id)).map(a=>key(byId.get(a.source_assessment_id)))),needs=[...latest.values()].filter(x=>x.conclusion==='not_meet'&&!pendingContexts.has(key(x)));
 return {practical:pr.length,self:self.length,negative:pr.filter(x=>x.conclusion==='not_meet').length,needs:needs.length,needsIds:new Set(needs.map(x=>x.id)),pending:pending.length};
}
