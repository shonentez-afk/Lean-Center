// Preparation results workspace, standard 03 §3.4. All writes use the center event log.
import {one,rows} from '../../core/db.js';
import {THEORY_BLOCKS,COMMISSION_ROLES,RESULT_LABELS} from './preparation-results.js';
import {bankRows} from './standard-workflows.js';
import {STANDARD_FORMS,standardWorkbook} from './standard-v03.js';
import {enrollmentTasks,parts} from './domain.js';
const blockNames={technology:'Технология производства',quality:'Качество продукции',equipment:'Оборудование',lean:'Бережливое производство'};
const resultOptions={pass:'Пройдено',fail:'Не пройдено'};
const conclusionOptions={not_meet:RESULT_LABELS.not_meet,basic:RESULT_LABELS.basic,exceeds:RESULT_LABELS.exceeds};
const labels={shift:'Факт смены стажировки',safety:'Протокол ОТ',internship:'Итог стажировки',questions:'Выдача вопросов',commission:'Решение комиссии'};
const taskLabel=t=>t.title;
export function preparationResultPanels(c,h,b){
 const {ws,el,pane,btn,tableOf,go,run,fieldInput}=c,db=ws.working;
 const {day,n,row,grid,msg,select,simple,ref,date,num,note,f,person,save,table,saveWorkbook}=h;
 const q=b.progress,[a,s,j]=b.documents,name=id=>n('person',id),closed=b.documents.some(x=>x.state==='cancelled');
 const event=(kind,actor,when,data)=>({preparation_id:b.id,kind,actor_id:actor.value,fact_on:when.value,data:data()});
 const record=(label,kind,actor,when,data)=>save(label,'twi_preparation_fact',()=>event(kind,actor,when,data));
 const section=(title,children)=>{const d=el('details');d.append(el('summary',title),...children);return d};
 const stageStatus=x=>!x.fact?'Не зарегистрирован':!x.current?'Требуется повторная проверка':RESULT_LABELS[x.fact.data.result]+' · '+x.fact.fact_on;
 const evidence=(x)=>tableOf(['Операция / СОП','Практика (прил. 9)','Уровень МК','Состояние',''],x.operations.map(o=>[taskLabel(o.task),o.practical?(o.exact?'Прил. 9 · ':'Другая методика · ')+RESULT_LABELS[o.practical.conclusion]:'Нет оценки',o.level??'—',o.observed?(o.ok?'Подтверждено':'Не соответствует'):'Нет полного основания',o.assignment?btn('Открыть инструктаж',()=>go('twi',{id:o.assignment.id})):'—']));
 const latestShift=new Map(q.shifts.map(x=>[x.fact_on+':'+x.data.shift_id,x]));
 const allShifts=new Map(b.shifts.map(x=>[x.date+':'+x.shift_id,{...x,planned:true}]));
 for(const x of q.shifts){const k=x.fact_on+':'+x.data.shift_id;if(!allShifts.has(k))allShifts.set(k,{date:x.fact_on,shift_id:x.data.shift_id,planned:false})}
 const shifts=pane('Стажировка · фактические смены',msg('Завершено смен: '+q.shifts.filter(x=>x.data.result==='completed').length+' / минимум 2. Плановые даты не являются фактом. Уточнение той же смены не увеличивает количество.'),tableOf(['Дата','Смена','План','Факт','Минут','Подтвердил','Основание'],[...allShifts].sort((x,y)=>x[0].localeCompare(y[0])).map(([k,x])=>{const fact=latestShift.get(k);return [x.date,n('work_shift',x.shift_id),x.planned?'Да':'Вне исходного плана',fact?(fact.data.result==='completed'?'Завершена':'Не завершена'):'Не зарегистрирована',fact?.data.minutes??'—',fact?name(fact.actor_id):'—',fact?.data.note||'—']})));
 if(!closed){
  const first=b.shifts.find(x=>!latestShift.has(x.date+':'+x.shift_id)),when=date('prep_fact_shift_date',first?.date||day),shift=ref('work_shift','prep_fact_shift_id',first?.shift_id||''),actor=person('prep_fact_shift_actor','Наставник или руководитель',j.mentor_id,{filter:p=>[j.mentor_id,j.manager_id,b.manager_id].includes(p.id)}),result=simple('prep_fact_shift_result',{completed:'Завершена',incomplete:'Не завершена'},'completed'),minutes=num('prep_fact_shift_minutes','',1,1440),why=note('prep_fact_shift_note');
  shifts.append(section('Зарегистрировать / уточнить смену',[grid(f('Дата факта',when),f('Смена',shift),actor.element,f('Минут',minutes),f('Результат',result)),f('Основание',why),record('Сохранить факт смены','shift',actor,when,()=>({shift_id:shift.value,result:result.value,minutes:Number(minutes.value),note:why.value}))]))
 }
 function stagePanel(kind,title,stage,doc){
  const panel=pane(title,msg(stageStatus(stage)),...(stage.evidence?[evidence(stage.evidence)]:[]),btn('Открыть задания программы',()=>go(kind==='internship'?'internship':'programs',{enrollmentId:doc.id})));
  if(stage.fact)panel.append(tableOf(['Реквизиты','Значение'],[['Результат',RESULT_LABELS[stage.fact.data.result]],['Дата',stage.fact.fact_on],['Ответственный',name(stage.fact.actor_id)],['Документ / отметка',stage.fact.data.reference],['Обратная связь',stage.fact.data.feedback]]));
  if(!closed){const actor=person('prep_'+kind+'_actor','Ответственный',doc.manager_id),when=date('prep_'+kind+'_date'),result=simple('prep_'+kind+'_result',resultOptions,'pass'),reference=note('prep_'+kind+'_reference'),feedback=note('prep_'+kind+'_feedback');
   panel.append(section('Зарегистрировать результат проверки',[grid(actor.element,f('Дата проверки',when),f('Результат',result)),f('Реквизиты протокола / отметки',reference),f('Обратная связь',feedback),record(kind==='safety'?'Зарегистрировать протокол ОТ':'Зарегистрировать итог стажировки',kind,actor,when,()=>({result:result.value,reference:reference.value,feedback:feedback.value}))]))}
  return panel
 }
 const safety=stagePanel('safety','Этап 1 · проверка знаний по ОТ',q.safety,s);
 const internship=stagePanel('internship','Этап 2 · базовые операции и итог стажировки',q.internship,j);
 const issue=pane('Этап 3 · заранее выданные вопросы',msg(q.questions?'Выданы '+q.questions.fact.fact_on+' · банк v'+q.questions.bank.version_no+' · '+q.questions.fact.data.note:'Вопросы ещё не выданы. Выберите зарегистрированную редакцию банка по профессии или общий перечень.'),btn('Открыть банк вопросов',()=>go('knowledge_bank')));
 if(q.questions)issue.append(...q.questions.issued.map(b=>section(blockNames[b.id],[tableOf(['№','Вопрос'],b.questions.map(x=>[x.number,x.text]))])));
 if(!closed){
  const banks=bankRows(db),bank=select('prep_issue_bank',banks.map(x=>[x.id,(x.profession_id?n('profession',x.profession_id):'Общий перечень')+' · v'+x.version_no+' · '+x.reviewed_on])),actor=person('prep_issue_actor','Выдал вопросы',a.mentor_id),when=date('prep_issue_date'),why=note('prep_issue_note'),box=el('div');let controls=[];
  function draw(){const x=banks.find(y=>y.id===bank.value);controls=[];box.replaceChildren();if(!x)return;for(const id of THEORY_BLOCKS){const block=x.blocks.find(b=>b.id===id),sel=el('select');sel.name='prep_issue_'+id;sel.multiple=true;sel.size=5;for(const v of block.questions){const op=el('option',v.number+'. '+v.text);op.value=v.id;sel.append(op)}controls.push({id,sel});box.append(f(blockNames[id],sel))}}
  bank.onchange=draw;draw();issue.append(section('Выдать / обновить перечень вопросов',[grid(f('Редакция банка',bank),actor.element,f('Дата выдачи',when)),msg('Выберите один или несколько вопросов в каждом блоке (Ctrl / Shift для нескольких). Вопросы ОТ проверяются отдельным протоколом.'),box,f('Основание',why),record('Зарегистрировать выдачу вопросов','questions',actor,when,()=>({bank_id:bank.value,blocks:controls.map(x=>({block:x.id,question_ids:[...x.sel.selectedOptions].map(v=>v.value)})),note:why.value}))]))
 }
 const commission=pane('Этап 3 · основные операции и комиссия',msg('Результаты основных операций по приложению 9 и матрице компетенций. Общие базовые операции не оцениваются повторно в этом разделе.'),evidence(q.main),msg(q.commission?(q.current?'Действующее решение: ':'Решение требует повторной проверки: ')+RESULT_LABELS[q.commission.data.conclusion]+' · '+q.commission.fact_on:'Решение комиссии отсутствует.'));
 if(q.commission)commission.append(tableOf(['Член комиссии','Сотрудник'],Object.entries(COMMISSION_ROLES).map(([k,v])=>[v,name(q.commission.data.members[k])])),tableOf(['Блок','Результат','Основание'],q.commission.data.theory.map(x=>[blockNames[x.block],RESULT_LABELS[x.result],x.note])),msg('Реквизиты: '+q.commission.data.reference),msg('Рекомендации: '+q.commission.data.feedback));
 if(!closed){
  const members=Object.entries(COMMISSION_ROLES).map(([k,label])=>({k,p:person('prep_commission_'+k,label,k==='manager'?b.manager_id:k==='mentor'?a.mentor_id:'',{...(k==='trainer'?{allowed:['internal_trainer']}:{}),...(k==='manager'?{filter:p=>p.id===b.manager_id}:k==='mentor'?{filter:p=>p.id===a.mentor_id}:{})})})),actor=members[0].p,when=date('prep_commission_date'),reference=note('prep_commission_reference'),feedback=note('prep_commission_feedback'),conclusion=simple('prep_commission_conclusion',conclusionOptions,'','— Выберите —'),theory=THEORY_BLOCKS.map(k=>({k,result:simple('prep_theory_'+k,resultOptions,'','— Выберите —'),why:note('prep_theory_note_'+k)}));
  commission.append(section('Зарегистрировать решение комиссии',[grid(...members.map(x=>x.p.element),f('Дата проверки',when)),...theory.map(x=>grid(f(blockNames[x.k],x.result),f('Основание результата',x.why))),f('Итоговое заключение',conclusion),f('Реквизиты решения',reference),f('Рекомендации по развитию',feedback),record('Зарегистрировать решение комиссии','commission',actor,when,()=>({members:Object.fromEntries(members.map(x=>[x.k,x.p.value])),theory:theory.map(x=>({block:x.k,result:x.result.value,note:x.why.value})),conclusion:conclusion.value,reference:reference.value,feedback:feedback.value}))]))
 }
 const history=pane('История фактов подготовки',table(['Дата','Этап','Ответственный','Результат / основание'],q.facts.map(x=>[x.fact_on,labels[x.kind],name(x.actor_id),[RESULT_LABELS[x.data.result]||x.data.result,RESULT_LABELS[x.data.conclusion],x.data.reference,x.data.note].filter(Boolean).join(' · ')]),'Пока фактов нет.'));
 const getForm=id=>STANDARD_FORMS.find(x=>x.id===id);
 const project=(id,doc)=>{const tasks=enrollmentTasks(db,doc),base={'Сотрудник':name(b.trainee_id),'Обучаемый':name(b.trainee_id),'Руководитель':name(b.manager_id),'Наставник':name(doc.mentor_id),'Преподаватель':name(doc.mentor_id),'Начало':doc.start_on,'Окончание':doc.due_on,'Количество смен':q.shifts.filter(x=>x.data.result==='completed').length,'Протокол':q.safety.fact?.data.reference||''};
  const facts=t=>t.assignment?rows(db,'SELECT duration_minutes FROM training_session WHERE assignment_id=? AND stage_code IS NOT NULL',[t.assignment.id]).reduce((n,x)=>n+x.duration_minutes,0)/60:(t.result?.minutes||0)/60;
  const lines=tasks.map((t,i)=>id===2?[i+1,parts[t.part],t.title,t.hours,t.day_offset,facts(t),t.done?'Выполнено':'Не завершено',name(t.assignment?.mentor_id||t.result?.actor_id||doc.mentor_id)]:id===3?[i+1,t.title,t.part==='practice'?'':t.hours,t.part==='practice'?t.hours:'',facts(t),t.done?'Выполнено':'Не завершено',name(t.result?.actor_id||doc.mentor_id)]:[i+1,'',t.title,t.hours,facts(t),t.done?'Выполнено':'Не завершено',name(t.assignment?.mentor_id||doc.mentor_id),'']);
  const w=standardWorkbook(ExcelJS,getForm(id),{fields:base,rows:lines}),sheet=w.addWorksheet('Результаты и основания');sheet.columns=[{width:25},{width:26},{width:32},{width:70}];sheet.addRow(['Дата','Этап','Ответственный','Результат / основание']);for(const x of q.facts.filter(x=>id===2||id===3&&x.kind==='safety'||id===4&&['shift','internship'].includes(x.kind)))sheet.addRow([x.fact_on,labels[x.kind],name(x.actor_id),JSON.stringify(x.data,(k,v)=>k==='snapshot'?undefined:v)]);sheet.eachRow(r=>r.eachCell(c=>{c.alignment={wrapText:true,vertical:'top'}}));return w
 };
 const exports=pane('Печатные документы подготовки',msg('Редактируемые формы по приложениям 2, 3 и 4 с фактическими данными и листом оснований. Это проект / выписка без подписей, не оригинал утверждённого протокола.'),row(...[[2,a],[3,s],[4,j]].map(([id,doc])=>btn('Приложение '+id+' XLSX',()=>run(async()=>saveWorkbook('TWI-03-'+id+'-'+b.id.slice(0,8),project(id,doc)),{save:false})))));
 return [shifts,safety,internship,issue,commission,history,exports]
}
