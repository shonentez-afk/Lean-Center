// Final v03 printable projections. Source appendix layouts; all examples and signatures remain blank.
import {invariant} from '../../core/db.js';
const font={name:'Arial',size:10,color:{argb:'FF243746'}};
const clean=x=>x===undefined||x===null?'':x;
const sheet=(w,name,widths,orientation='landscape')=>{const s=w.addWorksheet(name,{pageSetup:{paperSize:9,orientation,fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.25,right:.25,top:.35,bottom:.35,header:.1,footer:.1}}});s.columns=widths.map(width=>({width}));return s};
const cell=(c,{header=false,center=false}={})=>{c.font={...font,bold:header};c.alignment={wrapText:true,vertical:'middle',horizontal:center?'center':'left'};c.border={bottom:{style:'thin',color:{argb:'FFCBD5DB'}},right:{style:'thin',color:{argb:'FFCBD5DB'}}};if(header)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE2ECF0'}}};
const row=(s,r,values,header=false)=>{const a=s.getRow(r);a.values=values.map(clean);let lines=1;for(let i=1;i<=s.columns.length;i++){const c=a.getCell(i);cell(c,{header,center:header||i===1});const v=typeof c.value==='string'?c.value:'';lines=Math.max(lines,v.split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil(t.length/Math.max(8,s.getColumn(i).width-2))),0))}a.height=Math.max(header?28:24,Math.min(340,lines*13+8));return a};
const merge=(s,r,a,b,text,{header=false,center=false,height=27}={})=>{if(b>a)s.mergeCells(r,a,r,b);const c=s.getCell(r,a);c.value=clean(text);cell(c,{header,center});s.getRow(r).height=Math.max(s.getRow(r).height||0,height);return c};
const band=(s,r,t,height=30)=>merge(s,r,1,s.columns.length,t,{header:true,center:true,height});
const head=(s,title,fields={})=>{const last=s.columns.length;band(s,1,title,34);band(s,2,'TWI 03 · редактируемая форма / выписка · без подписей',25);let r=3;for(const [k,v] of Object.entries(fields)){const a=Math.min(2,last-1);merge(s,r,1,a,k,{header:true,height:26});merge(s,r++,a+1,last,v,{height:26})}return r};
const finish=(s,last,header)=>{s.views=[{state:'frozen',ySplit:header}];s.pageSetup.printTitlesRow=header+':'+header;s.pageSetup.printArea='A1:'+s.getCell(last,s.columns.length).address;return s};
const blank=(n=8)=>Array.from({length:n},()=>({}));
const sign=(s,r,label)=>merge(s,r,1,s.columns.length,label+'   ______________________________  / __________________ /     Дата __________',{height:30});
const programTitles={2:'ПЛАН АДАПТАЦИИ ПО ПРОФЕССИИ',3:'ПРОГРАММА ОБУЧЕНИЯ БЕЗОПАСНЫМ МЕТОДАМ И ПРИЁМАМ ВЫПОЛНЕНИЯ РАБОТ',4:'ПРОГРАММА СТАЖИРОВКИ'};
const parts={general:'Общая часть',individual:'Индивидуальная часть',practice:'Практические навыки',knowledge:'Проверка знаний'};
export function preparationPrintWorkbook(ExcelJS,id,{fields={},tasks=[],results=[],assessments=[],outcome=null}={}){
 invariant([2,3,4].includes(id),'Неизвестный документ подготовки');
 const w=new ExcelJS.Workbook(),s=sheet(w,id===2?'План адаптации':id===3?'Программа ОТ':'Программа стажировки',id===2?[7,60,11,15,26,19,20,16]:id===3?[7,66,11,28,19,20,28]:[7,66,11,30,24,20]);
 const last=s.columns.length;band(s,1,'ПРИЛОЖЕНИЕ '+id+'. '+programTitles[id],45);
 const split=Math.floor(last/2);merge(s,2,1,split,'СОГЛАСОВАНО: мнение представительного органа работников (при наличии)',{height:44});merge(s,2,split+1,last,'УТВЕРЖДАЮ: ____________________\nДата __________   Подпись __________',{height:44});
 let r=3;const labels=['Ф.И.О. сотрудника','Должность','Ф.И.О. и должность наставника','Ф.И.О. и должность руководителя','Подразделение','Период '+(id===2?'адаптации по профессии':id===3?'обучения по ОТ':'стажировки')];
 if(id===4)labels.push('План / факт смен (не менее двух смен)');
 for(const k of labels){merge(s,r,1,2,k,{header:true,height:28});merge(s,r++,3,last,fields[k],{height:28})}
 const header=r;
 row(s,r++,id===2?['№ п.п.','Задание, проект, мероприятие','Время изучения, ч','Плановая дата','ФИО наставника','Подпись наставника','Подпись обучаемого','Отметка / факт']:id===3?['№ п.п.','Задание, проект, мероприятие','Время изучения, ч','ФИО руководителя обучения','Подпись руководителя','Подпись обучаемого','Примечание']:['№ п.п.','Задание, проект, мероприятие','Время, ч','Ф.И.О. ответственного / наставника','Отметка о выполнении','Факт, ч'],true);
 const data=tasks.length?tasks:blank(8),timeRows=[];let prev=null;
 data.forEach((t,i)=>{if(id===2&&t.part&&t.part!==prev){merge(s,r++,1,last,parts[t.part]||t.part,{header:true});prev=t.part}const title=[t.title,t.sop].filter(Boolean).join(' · ');row(s,r,id===2?[i+1,title,t.hours,t.planDate,t.responsible,'','',t.status]:id===3?[i+1,title,t.hours,t.responsible,'','',t.status]:[i+1,title,t.hours,t.responsible,t.status,t.actual]);timeRows.push(r++)});
 row(s,r,['','Итого часов']);const refs=timeRows.map(x=>'C'+x).join(',');s.getCell(r,3).value={formula:'SUM('+refs+')',result:tasks.reduce((n,t)=>n+(Number(t.hours)||0),0)};s.getCell(r++,3).numFmt='0.##';
 if(id===2){
  band(s,++r,'ОЦЕНОЧНЫЕ МЕРОПРИЯТИЯ');r++;row(s,r++,['№','Оценочное мероприятие','Дата','Формат оценки','Итоговая оценка','Ответственный','Подпись','Основание'],true);
  const src=assessments.length?assessments:[{title:'Проверка знаний требований ОТ',format:'Протокол'},{title:'Овладение практическими навыками',format:'Чек-лист TWI / матрица'},{title:'Теоретическая часть: технология, оборудование, качество, бережливое производство',format:'Проверка знаний'},{title:'ИТОГОВОЕ заключение',format:'Комиссия'}];
  src.forEach((x,i)=>row(s,r++,[i+1,x.title,x.date,x.format,x.result,x.actor,'',x.reference]));
  sign(s,++r,'Наставник');sign(s,++r,'Руководитель');sign(s,++r,'Сотрудник')
 }else if(id===4){
  band(s,++r,'Заключение сотрудника');merge(s,++r,1,last,'Прошёл стажировку на рабочем месте. Освоил / не освоил безопасные методы и приёмы труда на рабочем месте (нужное отметить).',{height:40});sign(s,++r,'Сотрудник');
  band(s,++r,'Заключение наставника');merge(s,++r,1,last,outcome?outcome.result+' · '+outcome.reference+' · '+outcome.feedback:'Сотрудник освоил / не освоил безопасные методы и приёмы труда на рабочем месте (нужное отметить).',{height:52});sign(s,++r,'Наставник')
 }else{
  band(s,++r,'Протокол проверки знаний требований ОТ');merge(s,++r,1,last,outcome?outcome.result+' · '+outcome.date+' · '+outcome.reference+' · '+outcome.feedback:'Реквизиты протокола: ____________________   Результат: ____________________',{height:52});sign(s,++r,'Ответственный за проверку')
 }
 finish(s,r,header);if(results.length){const e=sheet(w,'Результаты и основания',[18,28,30,85]);row(e,1,['Дата','Этап','Ответственный','Результат / основание'],true);results.forEach((x,i)=>row(e,i+2,[x.date,x.label,x.actor,x.text]));finish(e,results.length+1,1)}return w
}
function entryBlank(ExcelJS){
 const w=new ExcelJS.Workbook(),s=sheet(w,'План ввода',[7,28,18,32,...Array(24).fill(5.5),12]);
 // Preserve all 24 shifts and formulas; print the blank grid on A3 landscape.
 s.pageSetup.paperSize=8;s.pageSetup.fitToHeight=1;
 const r=head(s,'ПРИЛОЖЕНИЕ 1. План ввода в профессию',{'Предприятие / подразделение':'','Профессия':'','ФИО':'','Инструктор-наставник':'','Руководитель':'','Дата начала':''});
 row(s,r,['№ п/п','Должностные функции','Тип рабочей операции','Название СОП',...Array.from({length:24},(_,i)=>'Смена '+(i+1)),'Итого, ч'],true);row(s,r+1,['','','','Дата'],true);
 for(let i=0;i<12;i++){const rr=r+2+i;row(s,rr,[i+1]);s.getCell(rr,3).dataValidation={type:'list',allowBlank:true,formulae:['"Базовая,Основная,Уникальная"']};s.getCell(rr,29).value={formula:'IF(COUNT(E'+rr+':AB'+rr+')=0,"",SUM(E'+rr+':AB'+rr+'))',result:''}}
 finish(s,r+13,r+1);s.views=[{state:'frozen',xSplit:4,ySplit:r+1}];return w
}
function sopBlank(ExcelJS){
 const w=new ExcelJS.Workbook(),s=sheet(w,'СОП',[27,35,35,35,35]);
 // One complete A3 landscape form: never isolate the reason row on page 2.
 s.pageSetup.paperSize=8;s.pageSetup.fitToHeight=1;
 let r=head(s,'ПРИЛОЖЕНИЕ 5. СТАНДАРТНАЯ ОПЕРАЦИОННАЯ ПРОЦЕДУРА',{'Предприятие / подразделение':'','Рабочее место':'','Исполнитель / должность':'','Наименование операции':'','Номер СОП / версия / дата':'','Время СОП':'','Требования к безопасности':'','Инструмент, оснастка':'','Материал':'','QR':'','Ответственные':'','Утверждаю / согласовано':''});
 // Four steps per print sheet, 12 editable slots as in appendix 5.
 const block=(target,at,start)=>{const h=at;row(target,at++,['',...Array.from({length:4},(_,i)=>'Шаг '+(start+i))],true);for(const [name,height] of [['Визуализация / фото / схема',90],['Действие — что делать',58],['Время, сек',23],['Ключевой момент — как делать',58],['Причина — почему именно так',58]]){row(target,at,[name]);target.getRow(at++).height=height}finish(target,at-1,h)};
 block(s,r,1);
 for(const start of [5,9]){const next=sheet(w,'СОП · шаги '+start+'–'+(start+3),[27,35,35,35,35]);next.pageSetup.paperSize=8;next.pageSetup.fitToHeight=1;const h=head(next,'ПРИЛОЖЕНИЕ 5. СОП · ПРОДОЛЖЕНИЕ',{'Номер СОП / версия / дата':'','Наименование операции':''});block(next,h,start)}
 return w
}
function matrixBlank(ExcelJS){
 const w=new ExcelJS.Workbook(),s=sheet(w,'Матрица компетенций',[6,28,22,...Array(10).fill(10),14,11,13]);
 // Ten SOP columns + fifteen employees + totals/legend on one readable A3 page.
 s.pageSetup.paperSize=8;s.pageSetup.fitToHeight=1;
 let r=head(s,'ПРИЛОЖЕНИЕ 7. Матрица компетенций',{'Предприятие / подразделение':'','Смена':'','Утверждаю / дата':'','Разработал / дата':''});
 band(s,r++,'СОП от простых к сложным · инструкторы выделяются жирным · потребности обучения отмечаются красным',36);const h=r;row(s,r++,['№','ФИО','Должность',...Array.from({length:10},(_,i)=>'СОП '+(i+1)),'Компетенции сотрудника','Цель','Потребность'],true);
 for(let i=0;i<15;i++){const rr=r++;row(s,rr,[i+1]);for(let col=4;col<=13;col++)s.getCell(rr,col).dataValidation={type:'list',allowBlank:true,formulae:['"1,2,3,4,x"']};s.getCell(rr,14).value={formula:'IF(COUNT(D'+rr+':M'+rr+')=0,"",SUM(D'+rr+':M'+rr+'))',result:''};s.getCell(rr,16).value={formula:'IF(OR(N'+rr+'="",O'+rr+'=""),"",MAX(0,O'+rr+'-N'+rr+'))',result:''}}
 row(s,r++,['','Состояние компетенций подразделения']);row(s,r++,['','Потребности процесса']);for(const [v,label] of [[1,'Обучен'],[2,'Выполняет работу самостоятельно'],[3,'Мастерски выполняет работу'],[4,'Инструктор-наставник, обучает других']])merge(s,r++,1,s.columns.length,v+' — '+label,{height:24});finish(s,r-1,h);s.views=[{state:'frozen',xSplit:3,ySplit:h}];return w
}
function frvBlank(ExcelJS){
 const w=new ExcelJS.Workbook(),s=sheet(w,'Фотография рабочего времени',[16,58,14,14,14,14,38,16]);
 let r=head(s,'ПРИЛОЖЕНИЕ 11. Фотография рабочего времени',{'Рабочее место / операция':'','Дата и время':'','Наблюдал':'','Исполнитель':'','Требования к безопасности':'','Инструмент, приспособления':'','Материалы':'','Качество':'','Прочие условия':''});
 const h=r;row(s,r++,['Время, ч:м:с','Действие, ключевой момент','Длительность, сек','ВДЦ, сек','М2, сек','М1, сек','Комментарий','Перемещения, м'],true);
 const start=r;for(let i=0;i<24;i++){row(s,r,[]);s.getCell(r,1).numFmt='[h]:mm:ss';s.getCell(r,3).value={formula:'IF(COUNT(D'+r+':F'+r+')=0,"",SUM(D'+r+':F'+r+'))',result:''};if(i>0)s.getCell(r,1).value={formula:'IF(C'+(r-1)+'="","",SUM($C$'+start+':C'+(r-1)+')/86400)',result:''};r++}
 row(s,r++,['','Новый цикл']);row(s,r++,['','Итоговый показатель','Текущее','Целевое','Эффект'],true);for(const label of ['Время операции, мин','ВДЦ, мин','М2, мин','М1, мин','Длина перемещений, м','Площадь, м²','Входные запасы (от-до), шт.'])row(s,r++,['',label]);finish(s,r-1,h);return w
}
export const CERTIFICATE_TEXT={
 instructor:{program:'Развёртывание системы обучения (TWI)',skills:'Подготовка рабочих процедур СОП, проведение инструктажа и планирование обучения',status:'ИНСТРУКТОР TWI'},
 internal_trainer:{program:'Внутренний тренер TWI: сборка системы производственного обучения',skills:'Проведение обучения по программе «Инструктор TWI/OPM»; организация работы инструкторов',status:'Внутренний тренер TWI'}
};
export function certificateWorkbook(ExcelJS){
 const w=new ExcelJS.Workbook();for(const [role,x] of Object.entries(CERTIFICATE_TEXT)){const s=sheet(w,role==='instructor'?'Инструктор':'Внутренний тренер',Array(6).fill(16),'portrait');band(s,1,'ПРИЛОЖЕНИЕ 12 · ПРОЕКТ / БЕЗ ПОДПИСИ',30);const c=band(s,3,'СЕРТИФИКАТ',56);c.font={name:'Arial',bold:true,size:28,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD94B50'}};merge(s,5,1,6,'ФИО: __________________________________',{height:38});merge(s,6,1,6,'Должность: ______________________________',{height:30});merge(s,8,1,6,'Прошёл(ла) обучение по программе:',{height:28});merge(s,9,1,6,x.program,{header:true,height:45});merge(s,11,1,6,'В процессе практической работы подтвердил(а) навыки:',{height:31});merge(s,12,1,6,x.skills,{height:72});merge(s,14,1,6,'По итогам присвоен статус (после утверждения):',{height:30});merge(s,15,1,6,x.status,{header:true,height:42});sign(s,18,'Директор филиала');merge(s,20,1,6,'Город, год: ______________________   Номер: ______________________',{height:30});s.pageSetup.printArea='A1:F20'}return w
}
export function finalBlankWorkbook(ExcelJS,id){
 if(id===1)return entryBlank(ExcelJS);
 if([2,3,4].includes(id))return preparationPrintWorkbook(ExcelJS,id);
 if(id===5)return sopBlank(ExcelJS);
 if(id===7)return matrixBlank(ExcelJS);
 if(id===11)return frvBlank(ExcelJS);
 if(id===12)return certificateWorkbook(ExcelJS);
 return null
}
