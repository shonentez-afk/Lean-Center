// LC4.1: corporate-compatible print layouts. No private files or example employees.
import {invariant,rows,one} from '../../core/db.js';
export const SCALE_NAME='Производственная компетенция (1–4)';
export const CORPORATE_LEVELS='1: Обучен\n2: Выполняет работу самостоятельно\n3: Выполняет работу мастерски\n4: Инструктор-наставник';
export const PRACTICAL_ROWS=[8,9,11,12,13,14,15,16,17,18,19];
const dt=x=>new Date(x+'T00:00:00Z');
export function plusDays(day,n){const d=dt(day);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function practicalCriteriaFromSheet(sheet){
 invariant(sheet&&sheet.name.trim().toLocaleLowerCase('ru-RU')==='чек лист','Выберите лист «Чек лист» оригинального XLSX');
 const sections=[sheet.getCell('A7').text.trim(),sheet.getCell('A10').text.trim()];
 invariant(sections.every(Boolean),'В оригинале отсутствуют заголовки двух разделов');
 const criteria=PRACTICAL_ROWS.map((r,i)=>({code:i+1,section:sections[r<=9?0:1],question:sheet.getCell('A'+r).text.trim()}));
 invariant(criteria.every(x=>x.question)&&new Set(criteria.map(x=>x.question)).size===11,'Нужно 11 разных заполненных критериев оригинала');
 return criteria
}
export function calendarData(start,tasks){
 const days=[...new Set(tasks.map(t=>t.day_offset))].sort((a,b)=>a-b).map(i=>({offset:i,date:plusDays(start,i),hours:tasks.filter(t=>t.day_offset===i).reduce((n,t)=>n+t.hours,0)}));
 return {days,total:tasks.reduce((n,t)=>n+t.hours,0)}
}
export function matrixPoints(matrix,people,skills,scaleId,personalGoals=[]){
 const goals=new Map();
 for(const g of personalGoals){if(g.scale_id!==scaleId)continue;const k=g.person_id+':'+g.skill_id;goals.set(k,Math.max(goals.get(k)??0,g.target_level))}
 const cells=new Map(),byPerson=new Map(),bySkill=new Map();
 const empty=()=>({actual:0,rated:0,target:0,targeted:0,need:0,unknown:0,other:0});
 function add(a,x){a.actual+=x.actual??0;a.rated+=x.actual===null?0:1;a.target+=x.target??0;a.targeted+=x.target===null?0:1;a.need+=x.need??0;a.unknown+=x.target!==null&&x.actual===null?1:0;a.other+=x.other?1:0}
 for(const p of people){byPerson.set(p.id,empty());for(const s of skills){
  if(!bySkill.has(s.id))bySkill.set(s.id,empty());
  const c=matrix.cells.get(p.id+':'+s.id),fact=c?.fact;
  const actual=c?.valid&&c.revisionCurrent&&fact.scale_id===scaleId&&[1,2,3,4].includes(fact.level)?fact.level:null;
  const required=c?.goal?.scale_id===scaleId&&[1,2,3,4].includes(c.goal.required_level)?c.goal.required_level:null;
  const personal=goals.get(p.id+':'+s.id)??null;
  const target=personal===null?required:required===null?personal:Math.max(personal,required);
  const x={actual,target,need:actual===null||target===null?null:Math.max(0,target-actual),other:!!(fact&&fact.scale_id!==scaleId)};
  cells.set(p.id+':'+s.id,x);add(byPerson.get(p.id),x);add(bySkill.get(s.id),x)
 }}
 return {cells,byPerson,bySkill}
}
export function personalTargets(db,day,horizon){
 return rows(db,"SELECT p.person_id,g.skill_id,g.target_json FROM development_goal g JOIN development_plan p ON p.id=g.plan_id WHERE p.state='active' AND g.state='open' AND p.start_on<=? AND g.due_on>=? AND g.due_on<=? AND g.skill_id IS NOT NULL",[day,day,horizon]).map(x=>({person_id:x.person_id,skill_id:x.skill_id,...JSON.parse(x.target_json)}))
}
export const productionHeaders=['№ п/п','Подразделение','Ф.И.О. инструктора','Название СОП','Ф.И.О. обучаемого','Дата обучения','Время обучения','Продолжительность, ч:мм','Инструктор','Обучаемый'];
// Plan and facts are two projections. Each fact is emitted once; empty plan rows
// remain visible. Acknowledgement flags are NOT signatures.
export function productionRows(assignments,facts,label){
 const map=new Map();for(const fact of facts){if(!map.has(fact.assignment_id))map.set(fact.assignment_id,[]);map.get(fact.assignment_id).push(fact)}
 const out=[];
 for(const a of assignments){
  const names=JSON.parse(a.recorded_names_json||'{}'),base=[label.unit(a),names.instructor||label.person(a.mentor_id),label.revision(a.sop_revision_id),names.trainee||label.person(a.trainee_id)];
  const events=map.get(a.id)||[];
  if(!events.length)out.push({assignment:a,fact:null,values:[...base,null,null,null,'','']});
  else for(const e of events.slice().sort((x,y)=>x.held_at.localeCompare(y.held_at)))out.push({assignment:a,fact:e,values:[...base,e.held_at.slice(0,10),e.held_at.slice(11,16),e.duration_minutes/1440,'','']})
 }
 return out
}
const thin={style:'thin',color:{argb:'FFB4B4B4'}};
const border={top:thin,bottom:thin,left:thin,right:thin};
function sheet(book,name,widths,paperSize=9){
 const s=book.addWorksheet(name,{pageSetup:{orientation:'landscape',paperSize,fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.3,right:.3,top:.35,bottom:.35,header:.15,footer:.15}}});s.columns=widths.map(width=>({width}));return s
}
function merge(s,r,c1,c2,value,bold=false){if(c2>c1)s.mergeCells(r,c1,r,c2);const c=s.getCell(r,c1);c.value=value;c.font={name:'Arial',size:11,bold};c.alignment={vertical:'middle',wrapText:true,horizontal:'left'}}
function header(s,r,last){for(let c=1;c<=last;c++){const x=s.getCell(r,c);x.font={name:'Arial',size:10,bold:true};x.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7E9EC'}};x.border=border;x.alignment={vertical:'middle',horizontal:'center',wrapText:true}}s.getRow(r).height=32}
function cells(s,r,values){values.forEach((v,i)=>{const x=s.getCell(r,i+1);x.value=v??null;x.font={name:'Arial',size:10};x.border=border;x.alignment={vertical:'middle',wrapText:true,horizontal:i===0?'center':'left'}});s.getRow(r).height=Math.max(23,Math.min(90,15*Math.ceil(Math.max(1,...values.map(x=>typeof x==='string'?x.length/35:1)))))}
export function productionWorkbook(ExcelJS,records,{title='План производственного обучения сотрудников',organization='',scope='',date='',approver=''}={}){
 const w=new ExcelJS.Workbook(),s=sheet(w,'План и реализация',[7,25,25,43,25,15,12,15,17,17]);
 merge(s,1,1,10,title,true);merge(s,2,1,10,organization);merge(s,3,1,6,scope);merge(s,3,7,10,'Дата: '+date);
 merge(s,4,1,6,'Утверждающий: '+(approver||'________________'));merge(s,4,7,10,'Подпись: ________________');
 merge(s,5,1,5,'План',true);merge(s,5,6,10,'Реализация',true);header(s,5,10);
 productionHeaders.forEach((x,i)=>s.getCell(6,i+1).value=i>=8?'Подпись '+x.toLocaleLowerCase('ru-RU'):x);header(s,6,10);
 records.forEach((x,i)=>{cells(s,i+7,[i+1,...x.values]);s.getCell(i+7,8).numFmt='[h]:mm'});
 s.pageSetup.printTitlesRow='5:6';s.pageSetup.printArea='A1:J'+Math.max(7,records.length+7);s.views=[{state:'frozen',ySplit:6}];
 merge(s,records.length+8,1,10,'Подписи оставлены пустыми. Отметки подтверждения и фактические этапы находятся в журнале центра.');
 const detail=sheet(w,'Назначения и факты',[25,25,42,15,15,23,23,15,15,45,16,16]);cells(detail,1,['Инструктор','Обучаемый','СОП и версия','Начало плана','Срок плана','Статус','Фактический этап','Дата и время','Минут','Наблюдение','Подтверждение инструктора','Подтверждение обучаемого']);header(detail,1,12);
 records.forEach((x,i)=>cells(detail,i+2,[x.values[1],x.values[3],x.values[2],x.assignment.assigned_on,x.assignment.due_on,x.assignment.state,x.fact?JSON.parse(x.fact.steps_json).label:'',x.fact?.held_at||'',x.fact?.duration_minutes??null,x.fact?.notes||'',x.fact?.mentor_ack?'Да':'',x.fact?.trainee_ack?'Да':'']));
 return w
}
export function entryWorkbook(ExcelJS,program,enrollment,tasks,{organization='',scope='',trainee='',mentor='',manager='',revision=()=>'',responsible=()=>''}={}){
 const cal=calendarData(enrollment.start_on,tasks),w=new ExcelJS.Workbook(),dayCount=Math.max(1,cal.days.length),last=3+dayCount+1;
 const s=sheet(w,'План ввода',[7,45,40,...Array(dayCount).fill(13),16],8);
 merge(s,1,1,last,'План ввода в профессию · '+program.title,true);merge(s,2,1,last,organization+' · '+scope);merge(s,3,1,last,'ФИО: '+trainee+' · Инструктор-наставник: '+mentor+' · Руководитель: '+manager);
 merge(s,4,1,last,'Период: '+enrollment.start_on+' — '+enrollment.due_on+' · Версия программы '+program.version_no);
 if(enrollment.internship_start)merge(s,5,1,last,'Стажировка: '+enrollment.internship_start+' — '+enrollment.internship_end+' · Ввод: '+enrollment.entry_start+' — '+enrollment.entry_end);
 const dates=cal.days.length?cal.days:[{offset:0,date:enrollment.start_on,hours:0}];
 cells(s,6,['№','Должностные функции','Название СОП',...dates.map(d=>d.offset+1), 'Итого часов']);header(s,6,last);
 cells(s,7,['','','Дата',...dates.map(d=>dt(d.date)), '']);for(let j=4;j<last;j++)s.getCell(7,j).numFmt='dd.mm.yyyy';
 tasks.forEach((t,i)=>{const row=i+8,values=[i+1,t.title,t.sop_revision_id?revision(t.sop_revision_id):'',...dates.map(d=>d.offset===t.day_offset?t.hours:null)];cells(s,row,[...values,0]);s.getCell(row,last).value={formula:'SUM('+s.getCell(row,4).address+':'+s.getCell(row,last-1).address+')',result:t.hours};s.getCell(row,last).numFmt='0.##'});
 const total=tasks.length+8;cells(s,total,['','Итого часов','',...dates.map(d=>d.hours),cal.total]);for(let col=4;col<=last;col++){const result=col===last?cal.total:dates[col-4].hours;s.getCell(total,col).value=tasks.length?{formula:'SUM('+s.getCell(8,col).address+':'+s.getCell(total-1,col).address+')',result}:0}header(s,total,last);
 s.pageSetup.printTitlesRow='6:7';s.views=[{state:'frozen',xSplit:3,ySplit:7}];
 const detail=sheet(w,'Задания и результаты',[22,47,38,16,15,25,22,43,20,20]);cells(detail,1,['Часть программы','Задание','СОП','Срок','Часы','Ответственный (факт)','Результат','Основание / обратная связь','Подпись ответственного','Подпись обучаемого']);header(detail,1,10);
 tasks.forEach((t,i)=>cells(detail,i+2,[t.part,t.title,t.sop_revision_id?revision(t.sop_revision_id):'',plusDays(enrollment.start_on,t.day_offset),t.hours,responsible(t),t.done?'Выполнено':'Не завершено',t.result?.evidence||'','','']));
 return w
}
export function practicalWorkbook(ExcelJS,method,assessments,{trainee='',title='Чек-лист оценки выполнения операций стажёром'}={}){
 invariant(assessments.length>0&&assessments.length<=100&&method.criteria.length===11,'Выберите от 1 до 100 оценок одной методики');
 const w=new ExcelJS.Workbook(),s=sheet(w,'Чек лист',[83,...assessments.map(()=>23)],8),last=assessments.length+1;
 merge(s,1,1,last,title,true);merge(s,2,1,last,'Стажёр: '+trainee);merge(s,3,1,last,'Методика: '+method.title+' · SHA-256 '+method.source_sha256);
 cells(s,4,['Операция / редакция',...assessments.map(x=>x.operation)]);header(s,4,last);
 cells(s,5,['Готовность стажёра',...assessments.map(()=>null)]);cells(s,6,['Баллы',...assessments.map(()=>null)]);
 merge(s,7,1,last,method.criteria[0].section,true);header(s,7,last);merge(s,10,1,last,method.criteria[2].section,true);header(s,10,last);
 method.criteria.forEach((q,i)=>cells(s,PRACTICAL_ROWS[i],[q.question,...assessments.map(x=>x.responses[i]?.value??null)]));
 assessments.forEach((a,i)=>{const col=i+2,refs=PRACTICAL_ROWS.map(r=>s.getCell(r,col).address).join(','),values=a.responses.map(x=>x.value),sum=values.reduce((n,v)=>n+(v===1?1:0),0),valid=values.length===11&&values.every(v=>v===0||v===1);s.getCell(6,col).value={formula:'IF(COUNT('+refs+')=11,SUM('+refs+'),"")',result:valid?sum:''};s.getCell(5,col).value={formula:'IF(COUNT('+refs+')=11,'+s.getCell(6,col).address+'/11,"")',result:valid?sum/11:''};s.getCell(5,col).numFmt='0.0%'});
 cells(s,20,['Обратная связь',...assessments.map(x=>x.feedback)]);cells(s,21,['Заключение (отдельное решение)',...assessments.map(x=>x.conclusion)]);cells(s,22,['Дата / оценщик',...assessments.map(x=>x.date+' · '+x.evaluator)]);
 const notes=sheet(w,'Комментарии',[35,8,70,50]);cells(notes,1,['Операция','№','Критерий','Комментарий']);header(notes,1,4);let i=2;for(const a of assessments)for(let j=0;j<11;j++)cells(notes,i++,[a.operation,j+1,method.criteria[j].question,a.responses[j]?.note||'']);
 s.pageSetup.printArea='A1:'+s.getCell(22,last).address;s.views=[{state:'frozen',xSplit:1,ySplit:6}];return w
}
