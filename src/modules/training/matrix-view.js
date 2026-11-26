import {REVISION_TITLE_SQL} from '../library/revision-title.js';
// Corporate appendix 6: roster rows, ordered SOP columns and dated totals.
// Blank/unconfirmed is not a zero. Planning never grants a qualification.
import {rows,one,canonical,invariant} from '../../core/db.js';
import {matrixData} from './domain.js';
import {directoryPeople} from '../master-data/people-directory.js';
import {personalTargets} from './corporate-forms.js';
export const LEVEL_COLORS={1:'D9E2F3',2:'FFFF00',3:'FFD966',4:'FF7C80'};
export const LEVEL_TEXT={1:'Обучен',2:'Выполняет работу самостоятельно',3:'Выполняет работу мастерски',4:'Инструктор-наставник'};
export const matrixKey=(p,s)=>p+':'+s;
export function matrixRoster(db,day,unit='',shift='',profession=''){
 const units=new Set(unit?rows(db,'WITH RECURSIVE scope(id) AS (SELECT ? UNION SELECT u.id FROM org_unit u JOIN scope s ON u.parent_id=s.id) SELECT id FROM scope',[unit]).map(x=>x.id):[]);
 const assigned=rows(db,"SELECT a.* FROM person_assignment a WHERE a.id=(SELECT id FROM person_assignment b WHERE b.person_id=a.person_id AND b.valid_from<=? AND coalesce(b.valid_to,'9999-12-31')>=? ORDER BY b.valid_from DESC,b.id LIMIT 1)",[day,day]);
 const assignments=new Map(assigned.map(a=>[a.person_id,a]));
 return directoryPeople(db,day).filter(p=>{const a=assignments.get(p.id);return a&&(!unit||units.has(a.unit_id))&&(!shift||a.shift_id===shift)&&(!profession||a.profession_id===profession)}).map(p=>({person_id:p.id,name:p.display_name,position:p.position,instructor:p.roles.some(x=>['instructor','mentor'].includes(x.kind)||[x.code,x.name].some(v=>['internal_trainer','internal trainer','внутренний тренер','вт'].includes(String(v).toLocaleLowerCase('ru-RU').trim().replaceAll('-','_'))))}));
}
export function columnChoices(db,unit='',workplace='',category=''){
 const units=new Set(unit?rows(db,'WITH RECURSIVE scope(id) AS (SELECT ? UNION SELECT u.id FROM org_unit u JOIN scope s ON u.parent_id=s.id) SELECT id FROM scope',[unit]).map(x=>x.id):[]);
 const ops=new Map(rows(db,'SELECT * FROM operation WHERE archived=0').filter(o=>(!unit||units.has(o.unit_id))&&(!workplace||o.workplace_id===workplace)).map(o=>[o.id,o]));
 const docs=rows(db,`SELECT d.id,d.code,${REVISION_TITLE_SQL} title,d.operation_id FROM document d JOIN document_revision r ON r.document_id=d.id WHERE d.kind='sop' AND d.archived=0 AND r.state='effective' ORDER BY d.code,title`).filter(d=>ops.has(d.operation_id));
 const skills=rows(db,'SELECT s.*,c.name category FROM skill s JOIN skill_category c ON c.id=s.category_id WHERE s.archived=0 AND c.archived=0 ORDER BY c.name,s.name');
 const out=[];
 for(const d of docs){
  const all=skills.filter(s=>s.operation_id===d.operation_id),matching=all.filter(s=>!category||s.category_id===category);
  for(const s of matching)out.push({key:s.id+':'+d.id,skill_id:s.id,document_id:d.id,title:d.code+' · '+d.title,skill:s.name,operation_id:d.operation_id});
  if(!all.length&&!category)out.push({key:'new:'+d.id,skill_id:null,document_id:d.id,title:d.code+' · '+d.title,skill:'Будет создан навык из СОП',operation_id:d.operation_id});
 }
 if(!workplace)for(const s of skills.filter(s=>!s.operation_id&&(!category||s.category_id===category)))out.push({key:s.id,skill_id:s.id,document_id:null,title:s.name,skill:s.category,operation_id:null});
 return out
}
function factValue(db,m,p,c,scaleId){
 const x=m.cells.get(matrixKey(p,c.skill_id)),fact=x?.fact;
 const doc=fact?.standard_revision_id?one(db,'SELECT document_id FROM document_revision WHERE id=?',[fact.standard_revision_id]):null;
 const matches=!c.document_id||doc?.document_id===c.document_id;
 const value=x?.valid&&x.revisionCurrent&&fact.scale_id===scaleId&&matches&&[1,2,3,4].includes(fact.level)?fact.level:null;
 let reason=!fact?'Не оценено':fact.observation_state==='not_applicable'?'Неприменимо':fact.observation_state==='not_observed'?'Не наблюдалось':fact.scale_id!==scaleId?'Другая шкала':!matches?'Другой СОП':!x.valid?'Истёк срок оценки':!x.revisionCurrent?'Прежняя редакция СОП':value===null?'Уровень вне шкалы':'';
 return {value,reason,fact,x}
}
export function matrixBaseline(db,roster,columns,scaleId,day){
 const m=matrixData(db,day);
 return roster.flatMap(r=>columns.map(c=>{const x=factValue(db,m,r.person_id,c,scaleId);return {person_id:r.person_id,skill_id:c.skill_id,value:x.value,assessment_id:x.value===null?null:x.fact.session_id}}))
}
const empty=()=>({base:0,baseCount:0,actual:0,actualCount:0,target:0,targetCount:0,need:0,needCount:0,unknown:0,planned:0});
function aggregate(a,x){
 for(const [k,count] of [['base','baseCount'],['actual','actualCount'],['target','targetCount'],['need','needCount']])if(x[k]!==null){a[k]+=x[k];a[count]++}
 if(x.targetLevel!==null&&x.actual===null)a.unknown++;
 if(x.explicit!==null)a.planned++;
}
export function matrixProjection(db,config,day){
 const {roster,columns,scale_id,target_on,baseline=[]}=config,m=matrixData(db,day),base=new Map(baseline.map(x=>[matrixKey(x.person_id,x.skill_id),x.value])),goals=new Map();
 for(const g of personalTargets(db,day,target_on))if(g.scale_id===scale_id&&[1,2,3,4].includes(g.target_level)){const k=matrixKey(g.person_id,g.skill_id);goals.set(k,Math.max(goals.get(k)||0,g.target_level))}
 const cells=new Map(),byPerson=new Map(roster.map(r=>[r.person_id,empty()])),bySkill=new Map(columns.map(c=>[c.skill_id,empty()])),total=empty();
 for(const r of roster)for(const c of columns){
  const k=matrixKey(r.person_id,c.skill_id),v=factValue(db,m,r.person_id,c,scale_id),actual=v.value;
  const explicit=goals.get(k)??null,required=v.x?.goal?.scale_id===scale_id&&[1,2,3,4].includes(v.x.goal.required_level)?v.x.goal.required_level:null;
  const targetLevel=explicit===null?required:required===null?explicit:Math.max(explicit,required);
  const target=actual===null?targetLevel:targetLevel===null?actual:Math.max(actual,targetLevel),need=actual===null?null:Math.max(0,(targetLevel??actual)-actual);
  const x={base:base.get(k)??null,actual,target,need,explicit,required,targetLevel,reason:v.reason,admission:v.x?.admission?.status||'',fact:v.fact};
  cells.set(k,x);aggregate(byPerson.get(r.person_id),x);aggregate(bySkill.get(c.skill_id),x);aggregate(total,x)
 }
 return {cells,byPerson,bySkill,total}
}
export function matrixFromRecord(row){return {...row,roster:JSON.parse(row.roster_json),columns:JSON.parse(row.columns_json),baseline:JSON.parse(row.baseline_json)}}
export function matrixWorkbook(ExcelJS,config,projection,day){
 const {roster,columns}=config,n=columns.length,right=n+4,last=right+3;
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('Матрица компетенций',{pageSetup:{paperSize:8,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 s.columns=[{width:6},{width:30},{width:26},...columns.map(()=>({width:8})),...Array.from({length:4},()=>({width:14}))];
 const set=(sheet,r,c,value,fill=null,bold=false)=>{const x=sheet.getCell(r,c);x.value=value??null;x.font={name:'Arial',size:10,bold};x.alignment={vertical:'middle',horizontal:'center',wrapText:true};const b={style:'thin',color:{argb:'FFB4B4B4'}};x.border={top:b,bottom:b,left:b,right:b};if(fill)x.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+fill}};return x};
 const merge=(r,a,b,v)=>{s.mergeCells(r,a,r,b);set(s,r,a,v,'E7E9EC',true)};
 merge(1,1,last,config.title||'Матрица компетенций');merge(2,1,last,'Версия '+(config.version_no||'предпросмотр')+' · Исходный срез '+config.base_on+' · Факт '+day+' · Цель '+config.target_on);
 merge(3,1,last,'Утверждаю: ____________________     Разработал: '+(config.author_name||'____________________')+'     Подписи: ____________________');
 merge(4,1,last,'Оценки только подтверждённые, пустая ячейка — нет сопоставимого факта. Потребность — известный прирост баллов, отдельно отмечены цели без факта.');
 for(const [i,h] of ['№','ФИО','Должность'].entries()){s.mergeCells(5,i+1,6,i+1);set(s,5,i+1,h,'E7E9EC',true)}
 columns.forEach((c,i)=>{s.mergeCells(5,i+4,6,i+4);const x=set(s,5,i+4,c.title,'F2F2F2',true);x.alignment={vertical:'middle',horizontal:'center',textRotation:90,wrapText:true}});
 merge(5,right,right+2,'Компетенции сотрудника');s.mergeCells(5,last,6,last);set(s,5,last,'Потребности сотрудника','FFCCFF',true);
 [config.base_on,day,config.target_on].forEach((d,i)=>set(s,6,right+i,d,'FFCCCC',true));
 s.getRow(5).height=125;s.getRow(6).height=27;
 const sheets={base:w.addWorksheet('Исходный срез'),target:w.addWorksheet('Целевые уровни'),need:w.addWorksheet('Потребности'),details:w.addWorksheet('Расшифровка')};
 for(const [k,a] of Object.entries(sheets).filter(([k])=>k!=='details')){a.columns=[{width:30},...columns.map(()=>({width:18}))];a.addRow(['Сотрудник',...columns.map(c=>c.title)]);a.views=[{state:'frozen',xSplit:1,ySplit:1}]}
 sheets.details.columns=[{width:28},{width:45},{width:14},{width:14},{width:14},{width:18},{width:28},{width:30}];sheets.details.addRow(['Сотрудник','СОП / навык','Исходный','Факт','Цель','Известный прирост','Причина отсутствия факта','Допуск']);
 function sumCell(row,col,range,summary,k,fill=null){const count=summary[k==='base'?'baseCount':k==='actual'?'actualCount':k==='target'?'targetCount':'needCount'];return set(s,row,col,{formula:'IF(COUNT('+range+')=0,"",SUM('+range+'))',result:count?summary[k]:''},fill,true)}
 const start=7,end=start+roster.length-1;
 roster.forEach((r,i)=>{
  const rr=start+i,aux=i+2,a=projection.byPerson.get(r.person_id);set(s,rr,1,i+1);set(s,rr,2,r.name,null,r.instructor).alignment={vertical:'middle',horizontal:'left',wrapText:true};set(s,rr,3,r.position).alignment={vertical:'middle',horizontal:'left',wrapText:true};
  for(const sh of [sheets.base,sheets.target,sheets.need])set(sh,aux,1,r.name);
  columns.forEach((c,j)=>{const x=projection.cells.get(matrixKey(r.person_id,c.skill_id));const cell=set(s,rr,j+4,x.actual,x.actual===null?null:LEVEL_COLORS[x.actual]);if(x.targetLevel!==null&&(x.need>0||x.actual===null)){cell.border={top:{style:'medium',color:{argb:'FFD02020'}},bottom:{style:'medium',color:{argb:'FFD02020'}},left:{style:'medium',color:{argb:'FFD02020'}},right:{style:'medium',color:{argb:'FFD02020'}}};cell.note='Целевой уровень: '+x.targetLevel}set(sheets.base,aux,j+2,x.base);set(sheets.target,aux,j+2,x.target);set(sheets.need,aux,j+2,x.need);sheets.details.addRow([r.name,c.title,x.base,x.actual,x.targetLevel,x.need,x.reason,x.admission])});
  const aa=sh=>"'"+sh.name+"'!"+sh.getCell(aux,2).address+':'+sh.getCell(aux,n+1).address;
  sumCell(rr,right,aa(sheets.base),a,'base');sumCell(rr,right+1,s.getCell(rr,4).address+':'+s.getCell(rr,n+3).address,a,'actual');sumCell(rr,right+2,aa(sheets.target),a,'target');const c=sumCell(rr,last,aa(sheets.need),a,'need','FFCCFF');if(a.unknown)c.note='Целей без подтверждённого факта: '+a.unknown;
  s.getRow(rr).height=32
 });
 const footer=[['Состояние подразделения · '+config.base_on,'base',sheets.base],['Состояние подразделения · '+day,'actual',null],['Целевое состояние · '+config.target_on,'target',sheets.target],['Потребности процесса (баллы)','need',sheets.need]];
 footer.forEach(([label,k,sh],i)=>{const rr=end+i+1;s.mergeCells(rr,1,rr,3);set(s,rr,1,label,i===3?'FFCCFF':'E7E9EC',true);columns.forEach((c,j)=>{const a=projection.bySkill.get(c.skill_id),range=sh?"'"+sh.name+"'!"+sh.getCell(2,j+2).address+':'+sh.getCell(roster.length+1,j+2).address:s.getCell(start,j+4).address+':'+s.getCell(end,j+4).address;const cell=sumCell(rr,j+4,range,a,k,i===3?'FFCCFF':'E7E9EC');if(i===3&&a.unknown)cell.note='Целей без подтверждённого факта: '+a.unknown});sumCell(rr,right+Math.min(i,3),s.getCell(rr,4).address+':'+s.getCell(rr,n+3).address,projection.total,k,i===3?'FFCCFF':'E7E9EC')});
 const legend=end+6;Object.entries(LEVEL_TEXT).forEach(([v,label],i)=>{set(s,legend+i,1,Number(v),LEVEL_COLORS[v]);s.mergeCells(legend+i,2,legend+i,Math.min(last,8));set(s,legend+i,2,label)});
 merge(legend+4,1,last,'Красная рамка — требуется обучение. Целей без факта: '+projection.total.unknown+'. Баллы не равны числу допущенных сотрудников.');
 s.views=[{state:'frozen',xSplit:3,ySplit:6}];s.pageSetup.printTitlesRow='5:6';s.pageSetup.printArea='A1:'+s.getCell(legend+4,last).address;
 return w
}
