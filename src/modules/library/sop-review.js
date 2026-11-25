import {invariant,one,rows,canonical,isId,foldKey} from '../../core/db.js';
const text=(x,n=500)=>typeof x==='string'&&x.trim()&&x.length<=n;
const sha=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const exact=(p,ks)=>invariant(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===ks.length&&ks.every(k=>Object.hasOwn(p,k)),'Неверные поля оценки СОП');
export const SOP_CHECKLIST_CODE='SOP_APP4';
export function validDate(x){return typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x}
export function reviewDue(changed){invariant(validDate(changed),'Укажите фактическую дату изменения СОП');const [y,m,d]=changed.split('-').map(Number);const day=Math.min(d,new Date(Date.UTC(y+1,m,0)).getUTCDate());return String(y+1).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(day).padStart(2,'0')}
export function validateChecklist(p){
 exact(p,['format','title','source_sha256','criteria']);invariant(['lean-sop-checklist-v1','lean-sop-checklist-v2'].includes(p.format)&&text(p.title,200)&&sha(p.source_sha256)&&Array.isArray(p.criteria)&&(p.format==='lean-sop-checklist-v1'?p.criteria.length===20:p.criteria.length>=1&&p.criteria.length<=100),'Нужна методика оценки СОП: 20 критериев v1 либо 1–100 критериев v2');
 p.criteria.forEach((q,i)=>{exact(q,['code','question']);invariant(q.code===i+1&&text(q.question,2500),'Неверная нумерация или текст критерия '+(i+1))});
 return p
}
export function sopMethods(db){return rows(db,"SELECT v.*,c.name FROM checklist_version v JOIN checklist c ON c.id=v.checklist_id WHERE c.code=? ORDER BY version_no DESC",[SOP_CHECKLIST_CODE])}
export function sopCriteria(db,id){return rows(db,'SELECT * FROM checklist_criterion WHERE version_id=? ORDER BY position',[id])}
export function evaluationResult(responses,total=20){const rated=responses.filter(r=>r.value===0||r.value===1);const yes=rated.filter(r=>r.value===1).length;return {rated:rated.length,yes,no:rated.length-yes,total,fraction:total>0&&responses.length===total&&rated.length===total?yes/total:null}}
export function applySopMethod(db,e,old){
 invariant(e.operation==='create'&&!old,'Версия методики неизменяема');const p=validateChecklist(e.payload);
 const methods=sopMethods(db);
 invariant(!methods.some(m=>{const d=JSON.parse(m.methodology_json);return canonical(d.criteria)===canonical(p.criteria)&&d.source_sha256===p.source_sha256}),'Такая методика уже загружена');
 let c=one(db,'SELECT * FROM checklist WHERE code=?',[SOP_CHECKLIST_CODE]);if(!c){db.run('INSERT INTO checklist(id,code,name) VALUES(?,?,?)',[e.id,SOP_CHECKLIST_CODE,'Оценка СОП']);c={id:e.id}}
 const n=methods.length?methods[0].version_no+1:1;
 db.run("INSERT INTO checklist_version(id,checklist_id,version_no,state,methodology_json,rev) VALUES(?,?,?,'draft',?,1)",[e.entity_id,c.id,n,canonical(p)]);
 for(const q of p.criteria)db.run('INSERT INTO checklist_criterion(id,version_id,code,section_code,position,question) VALUES(?,?,?,?,?,?)',[e.entity_id+':'+q.code,e.entity_id,String(q.code),'SOP',q.code,q.question]);
 // Only one active revision per method; prior criteria and assessments remain intact.
 db.run("UPDATE checklist_version SET state='retired',rev=rev+1 WHERE checklist_id=? AND state='active'",[c.id]);
 db.run("UPDATE checklist_version SET state='active' WHERE id=?",[e.entity_id])
}
export function applySopEvaluation(db,e,old){
 invariant(e.operation==='create'&&!old,'Завершённая оценка неизменяема; создайте новую');const p=e.payload;
 exact(p,['revision_id','method_id','actor_id','evaluated_on','place','source_sha256','responses']);
 invariant(isId(p.revision_id)&&isId(p.method_id)&&isId(p.actor_id)&&validDate(p.evaluated_on)&&text(p.place,500)&&sha(p.source_sha256),'Заполните дату, место, оцениваемую версию и оценщика');
 const rev=one(db,'SELECT * FROM document_revision WHERE id=?',[p.revision_id]);invariant(rev&&JSON.parse(rev.payload_json).source.sha256===p.source_sha256,'Версия СОП или исходник изменились');
 const person=one(db,'SELECT display_name FROM person WHERE id=? AND archived=0',[p.actor_id]);invariant(person,'Оценщик отсутствует');
 invariant(sopMethods(db).some(m=>m.id===p.method_id&&m.state==='active'),'Выберите загруженную методику оценки СОП');
 const criteria=sopCriteria(db,p.method_id);
 invariant(criteria.length>0&&Array.isArray(p.responses)&&p.responses.length===criteria.length,'Необходимо ответить на все '+criteria.length+' критериев');
 p.responses.forEach((q,i)=>{exact(q,['criterion_id','value','note']);invariant(q.criterion_id===criteria[i].id&&(q.value===0||q.value===1)&&typeof q.note==='string'&&q.note.length<=2000,'Некорректный ответ '+(i+1))});
 db.run('INSERT INTO sop_evaluation(id,revision_id,method_id,actor_id,evaluated_on,place,actor_name,source_sha256,recorded_at,rev) VALUES(?,?,?,?,?,?,?,?,?,1)',[e.entity_id,p.revision_id,p.method_id,p.actor_id,p.evaluated_on,p.place.trim(),person.display_name,p.source_sha256,e.occurred_at]);
 for(const q of p.responses)db.run('INSERT INTO sop_evaluation_response(evaluation_id,method_id,criterion_id,value,note) VALUES(?,?,?,?,?)',[e.entity_id,p.method_id,q.criterion_id,q.value,q.note])
}
