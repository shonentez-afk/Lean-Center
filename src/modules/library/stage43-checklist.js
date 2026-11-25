// Stage43 weighted checklist and corporate SOP_APP4 are separate methodologies.
import {invariant,one,rows,canonical,isId} from '../../core/db.js';
const scores=[0,.3,.7,1],origins=['seed','auto','manual','legacy'];
const text=(v,n)=>typeof v==='string'&&v.length<=n;
const exact=(x,ks)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===ks.length&&ks.every(k=>Object.hasOwn(x,k));
function validateRows(data){
 invariant(Array.isArray(data)&&data.length===13,'Чек-лист Stage43 должен содержать 13 критериев');
 data.forEach((x,i)=>invariant(exact(x,['id','req','weight','score','comment','scoreSource'])&&x.id===i+1&&text(x.req,2500)&&x.req.trim()&&Number.isFinite(x.weight)&&x.weight>0&&x.weight<=100&&scores.includes(x.score)&&text(x.comment,2000)&&origins.includes(x.scoreSource),'Некорректный критерий Stage43 '+(i+1)));
 return data
}
export function stage43Checklist(constructor){
 const raw=constructor?.checklist;
 if(raw==null)return [];
 invariant(Array.isArray(raw),'Некорректный чек-лист исходника');
 if(!raw.length)return [];
 return validateRows(raw.map(x=>({id:x.id,req:x.req,weight:x.weight,score:x.score,comment:x.comment??'',scoreSource:origins.includes(x.scoreSource)?x.scoreSource:'legacy'})))
}
export function weightedResult(data){
 const weight=data.reduce((n,x)=>n+x.weight,0),points=data.reduce((n,x)=>n+x.score*x.weight,0);
 return {weight,points,fraction:weight?points/weight:null,seed:data.filter(x=>x.scoreSource==='seed').length}
}
export function stage43Checks(db,revisionId){return rows(db,'SELECT * FROM sop_stage43_checklist WHERE revision_id=? ORDER BY updated_at DESC',[revisionId])}
export function verifyStage43Checklist(p,original){
 invariant(exact(p,['revision_id','source','rows','actor_id'])&&isId(p.revision_id)&&(p.actor_id===null||isId(p.actor_id)),'Некорректные реквизиты чек-листа');
 const proposed=validateRows(p.rows),base=stage43Checklist(original);
 invariant(base.length===13,'У исходной версии СОП нет чек-листа Stage43');
 proposed.forEach((x,i)=>{const y=base[i];invariant(x.id===y.id&&x.req===y.req&&x.weight===y.weight,'Требования и веса исходной методики неизменяемы');invariant(x.scoreSource==='manual'||canonical(x)===canonical(y),'Изменённая оценка должна быть отмечена как ручная')});
 return proposed
}
export function applyStage43Checklist(db,e,old){
 const p=e.payload;
 invariant(exact(p,['revision_id','source','rows','actor_id'])&&isId(p.revision_id)&&(p.actor_id===null||isId(p.actor_id)),'Некорректные реквизиты чек-листа');
 const data=validateRows(p.rows),v=one(db,'SELECT r.payload_json,d.archived FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.id=? AND d.kind=?',[p.revision_id,'sop']);
 invariant(v&&!v.archived&&p.source?.kind==='sop'&&canonical(JSON.parse(v.payload_json).source)===canonical(p.source),'Исходная версия СОП изменилась или документ архивирован');
 const person=p.actor_id?one(db,'SELECT display_name FROM person WHERE id=? AND archived=0',[p.actor_id]):null;
 invariant(!p.actor_id||person,'Выберите действующего оценщика');
 if(e.operation==='create'){
  invariant(!old&&!one(db,'SELECT id FROM sop_stage43_checklist WHERE revision_id=? AND source_sha256=?',[p.revision_id,p.source.sha256]),'Чек-лист этой версии уже сохранён');
  db.run('INSERT INTO sop_stage43_checklist(id,revision_id,source_sha256,rows_json,actor_id,actor_name,updated_at,rev) VALUES(?,?,?,?,?,?,?,1)',[e.entity_id,p.revision_id,p.source.sha256,canonical(data),p.actor_id,person?.display_name||'',e.occurred_at]);
 }else{
  invariant(e.operation==='update'&&old&&old.revision_id===p.revision_id&&old.source_sha256===p.source.sha256,'Нельзя изменить привязку или удалить чек-лист');
  const prior=validateRows(JSON.parse(old.rows_json));data.forEach((x,i)=>invariant(x.id===prior[i].id&&x.req===prior[i].req&&x.weight===prior[i].weight,'Методика неизменяема'));
  db.run('UPDATE sop_stage43_checklist SET rows_json=?,actor_id=?,actor_name=?,updated_at=?,rev=rev+1 WHERE id=?',[canonical(data),p.actor_id,person?.display_name||'',e.occurred_at,e.entity_id])
 }
}
