// v03 print layouts derived from appendices 9, 13, 14, 16, 17.
// Editable copies, never original signed corporate documents.
import {one,invariant} from '../../core/db.js';
import {PRACTICAL_V03,AUDIT_V03,SELF_V03} from './standard-v03.js';
import {SUPPLEMENT_TASKS,supplementStatus} from './standard-workflows.js';
const name=(db,id)=>one(db,'SELECT display_name FROM person WHERE id=?',[id])?.display_name||'';
const titles={9:'Чек-лист оценки выполнения операций Стажером',13:'Аудит 1-го уровня: Действия Инструктора и Внутреннего тренера',14:'Самооценка Инструктора-наставника и Внутреннего тренера'};
const methods={9:PRACTICAL_V03,13:AUDIT_V03,14:SELF_V03};
const style=(c,bold=false,fill=null)=>{c.font={name:'Calibri',size:11,bold,color:{argb:'FF203747'}};if(fill)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};c.alignment={vertical:'middle',wrapText:true};c.border={bottom:{style:'thin',color:{argb:'FFD3DCE1'}},right:{style:'thin',color:{argb:'FFD3DCE1'}}}};
const sheet=(w,title,widths)=>{const s=w.addWorksheet(title,{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});s.columns=widths.map(width=>({width}));return s};
const cells=(s,r,a,header=false)=>{const row=s.getRow(r);row.values=a;row.height=header?38:30;for(let i=1;i<=s.columns.length;i++)style(row.getCell(i),header,header?'FFE1EBF0':null);return row};
const band=(s,r,last,text,height=32)=>{s.mergeCells(r,1,r,last);const c=s.getCell(r,1);c.value=text;style(c,true,'FFE1EBF0');s.getRow(r).height=height};
export function originalChecklistMatch(method,id){
 const m=methods[id];return !!m&&method?.format===m.format&&JSON.stringify(method.criteria?.map(q=>[q.code,q.section,q.question]))===JSON.stringify(m.criteria.map(q=>[q.code,q.section,q.question]))
}
export function assessmentMatrixWorkbook(ExcelJS,id,records=[],{method=methods[id],place='',date='',trainee=''}={}){
 invariant(originalChecklistMatch(method,id),'Для корпоративской ведомости нужна исходная методика приложения '+id);
 invariant(records.length<=100,'Выберите не более 100 наблюдений одной методики');
 const blank=!records.length,cols=blank?Array.from({length:id===14?4:6},()=>({})):records,last=cols.length+1,w=new ExcelJS.Workbook(),s=sheet(w,'Сводная ведомость',[86,...cols.map(()=>24)]);
 band(s,1,last,'ПРИЛОЖЕНИЕ '+id+'. '+titles[id],36);
 band(s,2,last,'TWI 03 · '+(blank?'редактируемый бланк':'выписка из центра')+' · без подписей',23);
 band(s,3,last,(id===9?'ФИО Стажера: '+trainee+'   ':'Место: '+place+'   ')+'Дата: '+date,23);
 cells(s,4,[id===9?'Наименование операции':'ФИО / рабочая группа',...cols.map(x=>x.label||'')],true);
 cells(s,5,['Дата / оценщик',...cols.map(x=>[x.date,x.evaluator].filter(Boolean).join(' · '))]);
 cells(s,6,[id===14?'Сумма уровней':id===9?'Готовность стажера':'Доля по оценённым критериям']);
 cells(s,7,['Оценено / всего',...cols.map(x=>x.responses?x.responses.filter(q=>q.value!==null&&q.value!==undefined).length+' / '+method.criteria.length:'')]);
 let r=8,prev=null;const rr=[];
 for(const [i,q] of method.criteria.entries()){
  if(q.section!==prev){band(s,r++,last,q.section);prev=q.section}
  rr.push(r);cells(s,r,[String(q.code)+'. '+q.question,...cols.map(x=>x.responses?.[i]?.value??null)]);s.getRow(r).height=38;
  for(let j=2;j<=last;j++){const c=s.getCell(r,j);c.alignment={horizontal:'center',vertical:'middle'};c.dataValidation={type:'list',allowBlank:true,formulae:['"'+(id===14?'0,1,2,3':'0,1')+'"'],showErrorMessage:true};if(c.value!==null&&c.value!==undefined)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:c.value===0?'FFF6DFD9':id===14&&c.value===1?'FFFFEFCF':'FFE0EEE4'}}}r++
 }
 cols.forEach((x,i)=>{const refs=rr.map(r=>s.getCell(r,i+2).address).join(','),values=(x.responses||[]).map(q=>q.value).filter(v=>v!==null&&v!==undefined),sum=values.reduce((n,v)=>n+v,0),target=s.getCell(6,i+2);target.value={formula:id===14?'IF(COUNT('+refs+')='+rr.length+',SUM('+refs+'),"")':id===9?'IF(COUNT('+refs+')='+rr.length+',SUM('+refs+')/'+rr.length+',"")':'IF(COUNT('+refs+')=0,"",SUM('+refs+')/COUNT('+refs+'))',result:(id===13?values.length>0:values.length===rr.length)?id===14?sum:sum/values.length:''};if(id!==14)target.numFmt='0.0%';});
 cells(s,r++,[id===9?'Над чем Стажеру работать?':id===13?'Над чем Инструктору работать?':'Анализ',...cols.map(x=>x.feedback||'')]);
 cells(s,r++,['Заключение / состояние',...cols.map(x=>x.conclusion||'')]);
 band(s,r++,last,id===14?'Цветовая шкала: 1 — Знает, понимает; 2 — Умеет; 3 — Делает постоянно. 0 — отметка без расшифровки в образце.':'0 — не выполнено; 1 — выполнено; пусто — нет бинарной оценки. Не является допуском.',35);
 if(id===13)band(s,r++,last,'Нормативный порог 0,8 проверяется отдельно по полным 17 критериям. RC1 (20) в эту ведомость не включается.',35);
 s.views=[{state:'frozen',xSplit:1,ySplit:7}];s.pageSetup.printArea='A1:'+s.getCell(r-1,last).address;
 const details=sheet(w,'Основания',[30,26,9,74,45,25]);cells(details,1,['Наблюдение','Дата','№','Критерий','Комментарий','Исходная отметка'],true);
 let z=2;for(const x of records)method.criteria.forEach((q,i)=>cells(details,z++,[x.label,x.date,q.code,q.question,x.responses?.[i]?.note||'',x.responses?.[i]?.state??x.responses?.[i]?.value??'']));
 return w
}
export function supplementMatrixWorkbook(ExcelJS,db,records=[],month=''){
 const w=new ExcelJS.Workbook(),state={draft:'Черновик',approved:'Согласовано',declined:'Отклонено'};
 for(const role of ['internal_trainer','instructor']){
  const task=SUPPLEMENT_TASKS[role],data=records.filter(x=>x.role===role),s=sheet(w,role==='internal_trainer'?'Внутренние тренеры':'Инструкторы',[28,24,...task.map(()=>24),14,14,22,36]),last=s.columns.length;
  band(s,1,last,'ПРИЛОЖЕНИЕ 16. Чек-лист (ходатайство) о доплате',35);band(s,2,last,'О назначении доплаты Внутренним тренерам и Инструкторам TWI · '+month+' · проект / выписка без подписи');
  band(s,3,last,role==='internal_trainer'?'Внутренние тренеры':'Инструкторы');
  const header=cells(s,4,['ФИО','Должность',...task.map(t=>t[1]),'Задач','Минимум','Решение','Руководитель'],true);header.height=120;
  const list=data.length?data:Array.from({length:5},()=>null);let row=5;
  for(const x of list){if(!x){cells(s,row++,[]);continue}const q=supplementStatus(role,x.tasks),codes=new Set(x.tasks.map(t=>t.code)),position=one(db,"SELECT po.name FROM person_assignment a LEFT JOIN position po ON po.id=a.position_id WHERE a.person_id=? AND a.valid_from<=? AND coalesce(a.valid_to,'9999-12-31')>=? ORDER BY a.valid_from DESC,a.id LIMIT 1",[x.person_id,x.month+'-28',x.month+'-01'])?.name||'';cells(s,row++,[name(db,x.person_id),position,...task.map(t=>codes.has(t[0])?'V':''),q.count,q.minimum,state[x.state],name(db,x.manager_id)])}
  band(s,row+1,last,role==='internal_trainer'?'По основному стандарту 03 планирование обучения и актуализация матрицы — отдельные категории. 7000 руб. / 3 задачи.':'По стандарту 03: 5000 руб. / 2 задачи. Не документ начисления зарплаты.');
  s.views=[{state:'frozen',xSplit:2,ySplit:4}]
 }
 const e=sheet(w,'Основания',[27,23,16,54,18,65,24,45]);cells(e,1,['ФИО','Роль','Месяц','Выполненная задача','Дата','Основание','Решение','Основание решения'],true);let r=2;for(const x of records)for(const t of x.tasks)cells(e,r++,[name(db,x.person_id),x.role==='instructor'?'Инструктор':'ВТ',x.month,new Map(SUPPLEMENT_TASKS[x.role]).get(t.code),t.done_on,t.evidence,state[x.state],x.decision_note||'']);return w
}
export function preparationStructureWorkbook(ExcelJS,b=null,{trainee='',manager=''}={}){
 const w=new ExcelJS.Workbook(),s=sheet(w,'Структура программы',Array(9).fill(13));
 band(s,1,9,'ПРИЛОЖЕНИЕ 17. Структура Программы подготовки',32);band(s,2,9,'Программа подготовки · '+trainee,34);band(s,3,9,'На протяжении всего периода адаптации реализуются все три программы. '+(b?b.documents[0].start_on+' — '+b.documents[0].due_on:'1–3 месяца с даты приёма / 1 месяц при переводе'),44);
 const blocks=[{title:'Программа обучения безопасным методам и приёмам выполнения работ',note:'Количество часов согласно программе ОТ',idx:1},{title:'Программа стажировки',note:'Не менее 2 смен согласно программе стажировки',idx:2},{title:'План адаптации по профессии',note:'Весь период адаптации: 1–3 месяца / перевод 1 месяц',idx:0}];
 for(const [i,x] of blocks.entries()){const a=1+i*3,z=a+2,d=b?.documents[x.idx];for(const [r,v,h] of [[5,x.title,74],[6,x.note,52],[7,d?d.start_on+' — '+d.due_on:'Начало / окончание: ______',38],[8,d?d.title+' · v'+d.version_no:'Ответственный: ______',50]]){s.mergeCells(r,a,r,z);const c=s.getCell(r,a);c.value=v;style(c,r===5,r===5?'FFE1EBF0':null);c.alignment={horizontal:'center',vertical:'middle',wrapText:true};s.getRow(r).height=h}}
 band(s,10,9,'Руководитель: '+manager+' · '+(b?b.progress.status:'Проект без подписей'),38);if(b)band(s,11,9,'Плановых смен '+b.shifts.length+'; фактически завершено '+b.progress.shifts.filter(x=>x.data.result==='completed').length+'. Завершение подготовки не означает автоматического допуска.',38);
 return w
}
