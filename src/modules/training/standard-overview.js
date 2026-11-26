// Read-only v03 control projections. No additional schedule or assessment facts.
import {one} from '../../core/db.js';
import {preparationRows,bankControl,supplementRows,supplementStatus} from './standard-workflows.js';
import {annualAuditCoverage} from './audit-analytics.js';

const unitAt=(db,id,day)=>one(db,"SELECT unit_id FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[id,day,day])?.unit_id||null;
const personName=(db,id)=>one(db,'SELECT display_name FROM person WHERE id=?',[id])?.display_name||'—';
const professionName=(db,id)=>one(db,'SELECT name FROM profession WHERE id=?',[id])?.name||'Общий перечень';
const shiftName=(db,id)=>one(db,'SELECT name FROM work_shift WHERE id=?',[id])?.name||'Смена';
const participants=b=>[...new Set([b.trainee_id,b.manager_id,...b.documents.flatMap(d=>[d?.mentor_id,d?.manager_id]),...b.progress.facts.flatMap(f=>[f.actor_id,...Object.values(f.data.members||{})])].filter(Boolean))];
const between=(d,from,to)=>!!d&&(!from||d>=from)&&(!to||d<=to);
export const prepLabels={active:'В процессе подготовки',finish:'Готов к завершению',complete:'Комплект завершён',negative:'Отрицательное решение',review:'Требуется повторная проверка',cancelled:'Отменён документ'};
export const prepStageLabels={safety:'Протокол ОТ',internship:'Итог стажировки',commission:'Решение комиссии'};
const stage=(q,k)=>k==='commission'?{fact:q.commission,current:q.current,pass:q.positive}:q[k];
function stateOf(b){
 const q=b.progress;
 if(b.documents.some(x=>x?.state==='cancelled'))return 'cancelled';
 if(q.commission&&!q.current)return 'review';
 if(q.current&&!q.positive)return 'negative';
 if(q.positive)return b.documents.every(x=>x.state==='completed')?'complete':'finish';
 return 'active'
}
export function preparationControl(db,day,{unitId='',personId='',from='',to='',role='participant',filter='all'}={}){
 const list=preparationRows(db).map(b=>{
  const q=b.progress,[a,s,j]=b.documents,people=participants(b),status=stateOf(b),unitId=unitAt(db,b.trainee_id,day),doneShifts=q.shifts.filter(x=>x.data.result==='completed'),expected=new Map(b.shifts.map(x=>[x.date+':'+x.shift_id,x])),actual=new Map(q.shifts.map(x=>[x.fact_on+':'+x.data.shift_id,x])),missingShifts=[...expected].filter(([key])=>actual.get(key)?.data.result!=='completed').map(([,x])=>x);
  const stages=[['safety',s],['internship',j],['commission',a]].map(([key,d])=>{const v=stage(q,key);return {key,label:prepStageLabels[key],due:d.due_on,ownerId:d.manager_id||b.manager_id,done:v.current&&d.state==='completed',fact:v.fact,current:v.current,pass:v.pass,documentId:d.id}});
  const open=!['complete','cancelled','negative'].includes(status),overdue=open&&(stages.some(s=>!s.done&&s.due<day)||missingShifts.some(s=>s.date<day)&&doneShifts.length<2),ready=stages.filter(s=>s.current).length;
  return {id:b.id,b,people,unitId,personId:b.trainee_id,name:personName(db,b.trainee_id),start:a.start_on,due:a.due_on,status,open,overdue,ready,stages,doneShifts,missingShifts,plannedShifts:b.shifts.length,questions:!!q.questions}
 });
 return list.filter(x=>(!unitId||unitId===x.unitId)&&(!personId||(role==='trainee'?x.personId===personId:x.people.includes(personId)))&&between(x.start,from,to)&&(filter==='all'||filter==='open'&&x.open||filter==='overdue'&&x.overdue||filter===x.status))
}
export function preparationStats(items){
 return {total:items.length,people:new Set(items.map(x=>x.personId)).size,open:items.filter(x=>x.open).length,overdue:items.filter(x=>x.overdue).length,complete:items.filter(x=>x.status==='complete').length,finish:items.filter(x=>x.status==='finish').length,review:items.filter(x=>x.status==='review').length,negative:items.filter(x=>x.status==='negative').length,cancelled:items.filter(x=>x.status==='cancelled').length,shifts:items.reduce((n,x)=>n+x.doneShifts.length,0),safety:items.filter(x=>x.stages[0].current&&x.stages[0].pass).length,internship:items.filter(x=>x.stages[1].current&&x.stages[1].pass).length,commission:items.filter(x=>x.stages[2].current).length,questions:items.filter(x=>x.questions).length}
}
export function standardControls(db,day){
 const items=preparationControl(db,day),stats=preparationStats(items),banks=bankControl(db,day),supplements=supplementRows(db).filter(x=>x.month<=day.slice(0,7)),annual=annualAuditCoverage(db,day.slice(0,4),day);
 return {items,stats,banks,supplements,annual,bankStale:banks.filter(x=>x.stale).length,bankUnregistered:!banks.length,supplementDrafts:supplements.filter(x=>x.state==='draft').length}
}
// Keep calendar events as projections. The same planned shift and its latest fact occupy one row.
// Year-end checks are annual control milestones, not fictitious appointments.
export function standardCalendar(db,day,{personId='',unitId='',kind='all'}={}){
 const events=[],add=e=>{if((kind==='all'||kind===e.group)&&(!personId||e.people.includes(personId))&&(!unitId||e.unitId===unitId))events.push(e)};
 if(['all','preparation'].includes(kind))for(const x of preparationControl(db,day)){
  if(x.status==='cancelled')continue;
  const b=x.b,q=b.progress,j=b.documents[2],by=new Map(b.shifts.map(s=>[s.date+':'+s.shift_id,{date:s.date,shiftId:s.shift_id,planned:true}]));
  for(const f of q.shifts){const k=f.fact_on+':'+f.data.shift_id;by.set(k,{...(by.get(k)||{date:f.fact_on,shiftId:f.data.shift_id,planned:false}),fact:f})}
  for(const [k,s] of by){const done=s.fact?.data.result==='completed',f=s.fact;add({key:'shift:'+b.id+':'+k,group:'preparation',date:s.date,type:'Смена стажировки',title:x.name+' · '+shiftName(db,s.shiftId),ownerId:f?.actor_id||j.mentor_id,people:x.people,unitId:unitAt(db,x.personId,f?s.date:day),state:done?'Завершена':f?'Не завершена':s.date<day?'Нет факта · срок прошёл':'Запланирована',page:'preparation',options:{id:b.id}})}
  for(const s of x.stages){const fact=s.fact,done=s.current;const date=done&&fact?fact.fact_on:s.due;add({key:'stage:'+b.id+':'+s.key,group:'preparation',date,type:s.label,title:x.name,ownerId:done&&fact?fact.actor_id:s.ownerId,people:x.people,unitId:unitAt(db,x.personId,done&&fact?date:day),state:s.current?(s.pass?(s.done?'Завершено':'Результат зарегистрирован · закрыть документ'):'Отрицательный результат'):fact?'Требуется повторная проверка':date<day?'Срок прошёл':'Предстоит',page:'preparation',options:{id:b.id}})}
 }
 const year=day.slice(0,4),end=year+'-12-31';
 if(['all','normative'].includes(kind)){
  for(const x of annualAuditCoverage(db,year,day).filter(x=>x.remaining>0))add({key:'l1:'+x.personId+':'+year,group:'normative',date:end,type:'Годовой контроль L1',title:x.name,ownerId:x.personId,people:[x.personId],unitId:unitAt(db,x.personId,day),state:'Осталось '+x.remaining+' / '+x.required,page:'audit',options:{mode:'annual',year,personId:x.personId}});
  for(const x of bankControl(db,day).filter(x=>x.stale))add({key:'bank:'+(x.profession_id||'all')+':'+year,group:'normative',date:end,type:'Годовая актуализация вопросов',title:professionName(db,x.profession_id),ownerId:x.author_id,people:[x.author_id],unitId:unitAt(db,x.author_id,day),state:x.status,page:'knowledge_bank',options:{id:x.id}})
 }
 return events.sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key))
}
