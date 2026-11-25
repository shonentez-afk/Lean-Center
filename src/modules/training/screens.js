import {matrixRoster,columnChoices,matrixBaseline,matrixProjection,matrixFromRecord,matrixWorkbook,matrixKey,LEVEL_COLORS,LEVEL_TEXT} from './matrix-view.js';
import {BUILTIN_PRACTICAL,BUILTIN_SOP,BUILTIN_SELF,SELF_LEVELS,RC1_CRITERIA,FORM_CATALOG,INITIAL_PROGRAM_TASKS,previewCriteria} from './builtin-forms.js';
import {SCALE_NAME,CORPORATE_LEVELS,practicalCriteriaFromSheet,calendarData,calendarFacts,matrixPoints,personalTargets,productionHeaders,productionRows,productionWorkbook,entryWorkbook,practicalWorkbook,criteriaFromTabularSheet} from './corporate-forms.js';
import {fillOrderTemplate,draftDocx,orderPayment,builtinOrderDocx} from './local-docx.js';
// LC4 uses the same workspace, event log, directory and corporate UI as LC3.
import {rows,one,list,uuid,invariant,sha256,canonical} from '../../core/db.js';
import {directoryPeople} from '../master-data/people-directory.js';
import {openPeopleDropdown} from '../../ui/people-picker.js';
import {linkedTwi} from '../library/linked-materials.js';
import {TRAINING_TYPES,programKinds,parts,variants,conclusions,jiStages,progressFor,currentStandard,isCurrentStandard,activeAuthorizations,authorizationValid,certificateValid,orderPosition,practicalMethods,practicalCriteria,practicalResult,validatePracticalMethod,validateMentorMethod,trainingMethods,AUDIT_CODE,SELF_CODE,latestAssessment,latestVerification,admissionStatus,enrollmentTasks,matrixData,coverageData} from './domain.js';
export const TRAINING_PAGES=['twi','programs','internship','instruction','retraining','journal','skills','practical','development','mentoring','certification','appointments','my_plan','forms','audit','self_eval'];
let route={};
export function resetTrainingRoute(){route={}}
export function setTrainingRoute(page,options={}){route={page,...options}}
const statuses={planned:'Запланировано',in_progress:'В процессе',completed:'Завершено',cancelled:'Отменено',active:'Действует',retired:'Предыдущая версия'};
const credentialRoles={instructor:'Инструктор',mentor:'Наставник',internal_trainer:'Внутренний тренер'};
const observationLabels={rated:'Подтверждён',not_observed:'Не наблюдалось',not_applicable:'Неприменимо'};
const decisionLabels={granted:'Допуск зарегистрирован',denied:'Не допущен'};
const resultLabels={completed:'Выполнено',incomplete:'Требует повторения',pass:'Пройдено',fail:'Не пройдено'};
const safe=x=>String(x??'');
const nullable=x=>x||null;
const dateTime=()=>{const d=new Date(),local=new Date(d.getTime()-d.getTimezoneOffset()*60000);return local.toISOString().slice(0,16)};
export function trainingScreen(main,page,c){
 if(route.page!==page)route={page};
 const {ws,el,add,btn,pane,tableOf,inputField,fieldInput,refName,refOption,today,run,render,go,goDocument,readContent,pick,downloadBytes}=c,db=ws.working;
 const blocked=!!ws.conflicts.length,day=today(),n=(type,id)=>refName(type,id),stack=(...x)=>add(el('div',undefined,'stack'),...x),row=(...x)=>add(el('div',undefined,'row'),...x),grid=(...x)=>add(el('div',undefined,'formgrid'),...x);
 const msg=(s,cls='muted')=>el('p',s,cls);
 const action=(label,fn,kind='primary',disabled=false)=>btn(label,fn,kind,disabled||blocked);
 const goLocal=(options={})=>{route={page,...options};render()};
 const back=()=>btn('К списку',()=>goLocal());
 const select=(name,options,value='',emptyLabel='— Выберите —')=>{
  const s=el('select');s.name=name;if(emptyLabel!==null){const o=el('option',emptyLabel);o.value='';s.append(o)}
  for(const [id,label] of options){const o=el('option',safe(label));o.value=safe(id);s.append(o)}
  s.value=safe(value);if(s.selectedIndex<0&&emptyLabel===null)s.selectedIndex=0;return s
 };
 const simple=(name,values,value='',empty=null)=>select(name,Object.entries(values),value,empty);
 const ref=(type,name,value='',emptyLabel='— Выберите —',filter=()=>true)=>select(name,list(db,type).filter(x=>!x.archived&&filter(x)).map(x=>[x.id,refOption(type,x)]),value,emptyLabel);
 const date=(name,value=day)=>fieldInput(name,value,'date');
 const num=(name,value='',min=0,max=10000,step=1)=>{const i=fieldInput(name,value,'number');i.min=String(min);i.max=String(max);i.step=String(step);return i};
 const note=(name,value='',placeholder='')=>{const i=el('textarea');i.name=name;i.rows=2;i.maxLength=2000;i.value=value;i.placeholder=placeholder;return i};
 const check=(name,label)=>{const i=el('input');i.type='checkbox';i.name=name;return {input:i,element:add(el('label',undefined,'row lc4-check'),i,el('span',label))}};
 const f=(label,input)=>inputField(label,input);
 function person(name,label,initial='',{allowed=null,optional=false,filter=()=>true,onChange=()=>{},at=()=>day}={}){
  let id=initial;
  const button=btn('',()=>openPeopleDropdown(button,{people:()=>directoryPeople(db,at()||day).filter(filter),allowed,optional,label,selectedId:id,onChoose:p=>{id=p?.id||'';refresh();onChange(id)}}),'lc-directory-trigger');
  button.name=name;button.setAttribute('aria-label','Выбрать: '+label);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
  function refresh(){button.textContent=(id?n('person',id):'Выбрать сотрудника')+' ▾'}
  refresh();return {get value(){return id},element:add(el('div',undefined,'field'),el('span',label),button),button,set(v){id=v;refresh()}}
 }
 function event(type,payload,old=null){return {id:uuid(),entity_type:type,entity_id:old?.id||uuid(),operation:old?'update':'create',expected_revision:old?.rev||0,payload,occurred_at:new Date().toISOString()}}
 async function write(type,payload,old=null){const e=event(type,payload,old);await ws.applyContentEvents([e],readContent);return e.entity_id}
 function save(label,type,payload,old=null,done=()=>{},disabled=false){
  return action(label,()=>run(async()=>{const id=await write(type,typeof payload==='function'?payload():payload,old);done(id);return 'Запись сохранена. Ожидает публикации базы.'}),'primary',disabled)
 }
 const reasonInput=()=>note('reason','','Основание изменения');
 function closeRecord(label,type,old,command){
  const reason=reasonInput(),d=el('details');d.append(el('summary',label),f('Причина',reason),save(label,type,()=>({command,reason:reason.value}),old));return d
 }
 const revs=()=>rows(db,"SELECT r.id,r.version_no,r.payload_json,d.id document_id,d.code,d.title,d.operation_id FROM document_revision r JOIN document d ON d.id=r.document_id JOIN operation o ON o.id=d.operation_id WHERE d.kind='sop' AND d.archived=0 AND r.state='effective' AND o.archived=0 ORDER BY d.code");
 const revLabel=id=>{const x=currentStandard(db,id);return x?x.code+' · '+x.title+' · v'+x.version_no:'—'};
 const revPicker=(name,id='')=>select(name,revs().map(x=>[x.id,x.code+' · '+x.title+' · v'+x.version_no]),id);
 const scalePicker=(name,id='')=>ref('rating_scale',name,id);
 function levelPicker(name,scaleId,initial=''){return select(name,rows(db,'SELECT value,label FROM rating_level WHERE scale_id=? ORDER BY value',[scaleId]).map(x=>[x.value,x.value+' — '+x.label]),initial)}
 // Moving options empties the source select, so capture its selection first.
 function replaceOptions(dest,source){const value=source.value;dest.replaceChildren(...Array.from(source.children));dest.value=value}
 function scaleFields(prefix,scaleId='',target=null){
  const scale=scalePicker(prefix+'_scale',scaleId),level=levelPicker(prefix+'_level',scale.value,target??'');
  scale.onchange=()=>replaceOptions(level,levelPicker(level.name,scale.value));
  return {scale,level,element:grid(f('Шкала',scale),f('Целевой / подтверждаемый уровень',level)),set(s,l){scale.value=s||'';replaceOptions(level,levelPicker(level.name,scale.value,l??''))}}
 }
 function currentAuths(op,at=day){return activeAuthorizations(db,op,at)}
 function asgns(){return rows(db,'SELECT * FROM training_assignment WHERE source_sha256 IS NOT NULL ORDER BY due_on,assigned_on,id')}
 function enrollmentList(){return rows(db,'SELECT * FROM training_enrollment ORDER BY due_on,start_on,id')}
 const assignmentName=a=>(JSON.parse(a.recorded_names_json||'{}').trainee||n('person',a.trainee_id))+' · '+revLabel(a.sop_revision_id);
 const enrollmentPage=id=>one(db,'SELECT p.kind FROM training_enrollment e JOIN training_program p ON p.id=e.program_id WHERE e.id=?',[id])?.kind==='internship'?'internship':'programs';
 const stateLabel=a=>a.state==='planned'?(a.approval_json?'Согласовано':'Ожидает согласования'):statuses[a.state]||a.state;
 const sameRevision=a=>isCurrentStandard(db,a.sop_revision_id);
 const activePlan=a=>['planned','in_progress'].includes(a.state);
 const expired=(a)=>activePlan(a)&&a.due_on<day;
 const table=(headers,data,empty='Нет записей.')=>data.length?tableOf(headers,data):msg(empty);
 async function exportTable(name,headers,data){
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('Отчёт',{pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,paperSize:9}});
  s.columns=headers.map(h=>({width:Math.max(14,Math.min(52,safe(h).length+14))}));
  s.addRow(headers);s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF242E40'}};
  for(const line of data){const r=s.addRow(line.map(x=>x??''));r.alignment={vertical:'top',wrapText:true};r.height=Math.max(22,Math.min(90,15*Math.ceil(Math.max(1,...line.map(x=>safe(x).length/38)))))}
  s.views=[{state:'frozen',ySplit:1}];s.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}};downloadBytes(name+'.xlsx',await w.xlsx.writeBuffer())
 }
 const saveWorkbook=async(name,w)=>{downloadBytes(name+'.xlsx',await w.xlsx.writeBuffer());return 'Отчёт сформирован'};
 // Printing a draft must not rerender the screen or discard the form.
 const localDocx=(label,handler)=>{
  const trigger=btn(label,()=>{
   const input=el('input');input.type='file';input.accept='.docx';input.hidden=true;
   input.addEventListener('cancel',()=>input.remove(),{once:true});
   input.onchange=async()=>{
    const file=input.files?.[0];input.remove();if(!file)return;
    trigger.disabled=true;c.notify('Проверка и заполнение шаблона DOCX…');
    try{invariant(file.size<=32*1024*1024,'Файл слишком большой');c.notify(await handler(new Uint8Array(await file.arrayBuffer())))}
    catch(e){c.notify(e.message||String(e),true)}
    finally{trigger.disabled=false}
   };
   document.body.append(input);input.click()
  });
  return trigger
 };
 const exportButton=(name,headers,items)=>btn('Скачать XLSX',()=>run(async()=>{await exportTable(name,headers,items);return 'Отчёт сформирован'},{save:false}));
 function filterList(out,input,items,searchText,draw){const update=()=>{const q=input.value.trim().toLocaleLowerCase('ru-RU');out.replaceChildren(draw(items.filter(x=>searchText(x).toLocaleLowerCase('ru-RU').includes(q))))};input.oninput=update;update()}
 function searchInput(name='lc4_search'){const i=fieldInput(name,'','search');i.placeholder='Поиск по сотруднику, операции, номеру';return i}
 function evidenceSummary(a){
  const p=latestAssessment(db,a.id,'practical'),q=latestAssessment(db,a.id,'qualification'),s=latestVerification(db,a.id,'safety'),t=latestVerification(db,a.id,'theory');
  return {p,q,s,t,ad:admissionStatus(db,a.trainee_id,a.operation_id,day)}
 }
 function assignmentRows(items){
  return table(['Обучаемый','СОП / редакция','Инструктор','Цель','Срок','Состояние','Инструктаж',''],items.map(a=>{
   const p=progressFor(db,a),e=el('span',stateLabel(a)+(expired(a)?' · просрочено':'')+(!sameRevision(a)?' · СОП изменён':''),expired(a)||!sameRevision(a)?'warn':'');
   return [n('person',a.trainee_id),revLabel(a.sop_revision_id),n('person',a.mentor_id),a.target_level+' · '+n('skill',a.skill_id),a.due_on,e,p.completed+'/'+p.stages.length,btn('Открыть',()=>go(page==='instruction'?'instruction':'twi',{id:a.id,tab:page==='instruction'?'instruction':'overview'}),'primary')]
  }))
 }
 function productionData(items){
  const ids=new Set(items.map(a=>a.id)),facts=rows(db,'SELECT * FROM training_session WHERE stage_code IS NOT NULL ORDER BY held_at,recorded_at,id').filter(x=>ids.has(x.assignment_id));
  return productionRows(items,facts,{unit:a=>one(db,"SELECT u.name FROM person_assignment p JOIN org_unit u ON u.id=p.unit_id WHERE p.person_id=? AND p.valid_from<=? AND coalesce(p.valid_to,'9999-12-31')>=? ORDER BY p.valid_from DESC LIMIT 1",[a.trainee_id,a.assigned_on,a.assigned_on])?.name||'',person:id=>n('person',id),revision:revLabel})
 }
 function productionExport(items,title){
  return btn('Скачать план / факт XLSX',()=>run(async()=>saveWorkbook(title,productionWorkbook(ExcelJS,productionData(items()),{title,date:day})),{save:false}))
 }
 function assignmentList(){
  const items=asgns(),q=searchInput(),out=el('div'),filter=select('training_filter',[['all','Все'],['open','Открытые'],['overdue','Просроченные'],['completed','Завершённые'],['changed','Изменилась редакция СОП']],route.filter||'all',null);
  let filtered=[];const display=()=>{const text=q.value.toLocaleLowerCase('ru-RU').trim();filtered=items.filter(a=>(filter.value==='all'||filter.value==='open'&&activePlan(a)||filter.value==='overdue'&&expired(a)||filter.value==='completed'&&a.state==='completed'||filter.value==='changed'&&!sameRevision(a))&&assignmentName(a).toLocaleLowerCase('ru-RU').includes(text));out.replaceChildren(assignmentRows(filtered));route.filter=filter.value};
  q.oninput=display;filter.onchange=display;display();
  const controls=row(action('Назначить обучение',()=>go('twi',{mode:'new'})),btn('Программы подготовки',()=>go('programs')),btn('Инструктажи TWI',()=>go('instruction')),q,filter);
  return pane(page==='instruction'?'Реестр инструктажей TWI':'План производственного обучения',msg('Один список назначений. Факт инструктажа, практическая проверка, компетенция и допуск учитываются независимо.'),controls,out,productionExport(()=>filtered,'План производственного обучения сотрудников'),exportButton('План-обучения',['Сотрудник','СОП','Инструктор','Навык','Цель','Начало','Срок','Статус'],items.map(a=>[n('person',a.trainee_id),revLabel(a.sop_revision_id),n('person',a.mentor_id),n('skill',a.skill_id),a.target_level,a.assigned_on,a.due_on,stateLabel(a)])))
 }
 function assignmentForm(){
  const preset=route,rev=revPicker('training_revision',preset.revisionId||''),assigned=date('assigned_on',preset.startOn||day),due=date('due_on',preset.dueOn||day);
  const trainee=person('training_trainee','Обучаемый',preset.traineeId||'',{allowed:['trainee'],at:()=>assigned.value});
  const instructor=person('training_instructor','Инструктор',preset.instructorId||'',{allowed:['instructor','mentor'],at:()=>assigned.value,filter:p=>currentAuths(currentStandard(db,rev.value)?.operation_id,assigned.value).some(a=>a.person_id===p.id)});
  const supervisor=person('training_supervisor','Наставник программы',preset.supervisorId||'',{allowed:['mentor','instructor'],optional:true,at:()=>assigned.value});
  const actor=person('training_assigner','Ответственный за назначение'),skill=ref('skill','training_skill',preset.skillId||'','— Выберите —',s=>s.operation_id===currentStandard(db,rev.value)?.operation_id);
  const target=scaleFields('training_target',preset.scaleId||'',preset.targetLevel??null),shift=ref('work_shift','training_shift',preset.shiftId||'','— Не указана —');
  const reason=note('training_reason',preset.reason||''),variant=simple('training_variant',variants,preset.variant||'classic'),review=check('plan_reviewed','Проверил план TWI выбранной версии СОП и возможность обучения');
  const sourceInfo=el('div');let epoch=0;
  async function refreshSource(){
   const seq=++epoch,r=currentStandard(db,rev.value);sourceInfo.replaceChildren(msg(r?'Проверка плана TWI…':'Выберите действующий СОП с планом TWI.'));
   review.input.checked=false;review.input.disabled=true;
   if(!r)return;try{
    const raw=JSON.parse(await readContent(r.source)),x=linkedTwi(raw.constructor);if(seq!==epoch||!sourceInfo.isConnected)return;
    sourceInfo.replaceChildren(msg('План TWI: '+x.status+' · '+x.filled+'/15 полей',x.outdated||!x.exists?'warn':'muted'),btn('Открыть карточку СОП',()=>goDocument(r.document_id,r.id)));
    review.input.disabled=!x.exists||x.outdated
   }catch(e){if(seq===epoch)sourceInfo.replaceChildren(msg(e.message,'bad'))}
  }
  rev.onchange=()=>{replaceOptions(skill,ref('skill','training_skill','','— Выберите —',s=>s.operation_id===currentStandard(db,rev.value)?.operation_id));instructor.set('');void refreshSource()};
  assigned.onchange=()=>{instructor.set('');if(!preset.programTaskId){trainee.set('');supervisor.set('')}};
  if(preset.programTaskId){rev.disabled=true;skill.disabled=true;target.scale.disabled=true;target.level.disabled=true;trainee.button.disabled=true}
  const form=pane('Новое назначение обучения',row(back()),msg('Для назначения требуется действующий СОП, проверенный TWI, цель по навыку и действующее право инструктора обучать этой операции.'),f('СОП и редакция',rev),sourceInfo,review.element,grid(trainee.element,instructor.element,supervisor.element,actor.element),grid(f('Навык',skill),f('Смена',shift),f('Вид инструктажа',variant),f('Начало',assigned),f('Срок',due)),target.element,f('Основание обучения',reason),save('Сохранить назначение','training_assignment',()=>{
   const r=currentStandard(db,rev.value),auth=currentAuths(r?.operation_id,assigned.value).find(x=>x.person_id===instructor.value);
   invariant(r&&auth,'Выберите действующий СОП и инструктора с полномочием');
   return {trainee_id:trainee.value,mentor_id:instructor.value,supervisor_id:nullable(supervisor.value),authorization_id:auth.id,revision_id:r.id,source:r.source,skill_id:skill.value,scale_id:target.scale.value,target_level:target.level.value===''?null:Number(target.level.value),assigned_by:actor.value,assigned_on:assigned.value,due_on:due.value,reason:reason.value,variant:variant.value,shift_id:nullable(shift.value),enrollment_id:preset.enrollmentId||null,program_task_id:preset.programTaskId||null,plan_reviewed:review.input.checked}
  },null,id=>{route={page,id,tab:'overview'}}));
  void Promise.resolve().then(refreshSource);return form
 }
 function overview(a){
  const s=currentStandard(db,a.sop_revision_id),p=progressFor(db,a),e=evidenceSummary(a),name=JSON.parse(a.recorded_names_json||'{}');
  const panel=pane('Назначение',tableOf(['Реквизит','Значение'],[['Обучаемый',name.trainee||n('person',a.trainee_id)],['Инструктор',name.instructor||n('person',a.mentor_id)],['Наставник программы',name.supervisor||n('person',a.supervisor_id)],['СОП',revLabel(a.sop_revision_id)],['Навык и цель',n('skill',a.skill_id)+' · '+a.target_level+' · '+n('rating_scale',a.scale_id)],['Вид инструктажа',variants[a.method_variant]],['Смена',n('work_shift',a.shift_id)],['Период',a.assigned_on+' — '+a.due_on],['Причина',a.reason],['Состояние',stateLabel(a)],['Инструктаж',p.completed+' / '+p.stages.length],['Допуск',e.ad.status]]),row(btn('Карточка СОП',()=>goDocument(s.document_id,s.id)),...(a.enrollment_id?[btn('Персональная программа',()=>go(enrollmentPage(a.enrollment_id),{enrollmentId:a.enrollment_id}))]:[])));
  if(!sameRevision(a))panel.append(msg('Редакция СОП больше не действует. История сохранена; требуется решение о переобучении.','warn'),btn('Переобучение',()=>go('retraining')));
  if(a.approval_json){const x=JSON.parse(a.approval_json);panel.append(msg('Согласовано '+x.approved_on+' · НР: '+x.names.responsible+' · руководитель: '+x.names.head+(x.note?' · '+x.note:'')))}
  if(activePlan(a)&&sameRevision(a)&&!a.approval_json){
   const responsible=person('plan_responsible','Ответственный за СОП (НР)'),head=person('plan_head','Руководитель подразделения'),approved=date('approved_on'),comment=note('approval_note');
   panel.append(pane('Согласование плана',msg('Регистрация фактического согласования, не электронная подпись.'),grid(responsible.element,head.element,f('Дата',approved)),f('Примечание',comment),save('Зафиксировать согласование','training_assignment',()=>({command:'approve',responsible_id:responsible.value,head_id:head.value,approved_on:approved.value,note:comment.value}),a)))
  }
  if(activePlan(a)){
   const due=date('reschedule_due',a.due_on),why=reasonInput(),d=el('details');d.append(el('summary','Изменить срок'),grid(f('Новый срок',due),f('Основание',why)),msg('Изменение срока требует повторного согласования; прежние факты сохраняются.'),save('Сохранить новый срок','training_assignment',()=>({command:'reschedule',due_on:due.value,reason:why.value}),a));
   panel.append(d,closeRecord('Отменить назначение','training_assignment',a,'cancel'))
  }
  if(a.change_reason)panel.append(msg('Последнее изменение: '+a.change_reason));return panel
 }
 function planMaterial(a){
  const out=el('div'),button=btn('Показать план TWI и шаги СОП',async()=>{
   button.disabled=true;try{const r=currentStandard(db,a.sop_revision_id);const raw=JSON.parse(await readContent(r.source));const t=linkedTwi(raw.constructor);
    out.replaceChildren(msg('Исходная редакция: '+revLabel(a.sop_revision_id)+' · '+t.status),tableOf(['Раздел','Поле','Содержание'],t.fields.map(x=>[x.section,x.label,x.value||'—'])),tableOf(['№','Действие','Ключевые моменты','Причины'],raw.constructor.steps.map((x,i)=>[i+1,x.action,(x.keyMoments||[]).join('\n'),x.reason])))
   }catch(e){out.replaceChildren(msg(e.message,'bad'));button.disabled=false}
  });return pane('Материалы инструктажа',button,out)
 }
 function instruction(a){
  const pr=progressFor(db,a),can=a.state!=='cancelled'&&a.approval_json&&sameRevision(a);
  const panel=pane('Выполнение инструктажа',msg('Вводная часть: '+(pr.intro?'завершена':'в процессе')+' · контрольные проверки: '+pr.followup+'/5'+(pr.followupDue?' · срок поддержки '+pr.followupDue:''),pr.followupDue&&day>pr.followupDue&&pr.followup<5?'warn':'muted'));
  const bar=el('progress');bar.max=pr.stages.length;bar.value=pr.completed;bar.setAttribute('aria-label','Прогресс инструктажа');panel.append(bar,tableOf(['Этап','Состояние','Попыток'],pr.stages.map(s=>[s.label,pr.done.has(s.code)?'Выполнен':s.code===pr.next?.code?'Следующий':'Ожидает',pr.facts.filter(x=>x.stage_code===s.code).length])));
  if(can){
   const stage=select('session_stage',pr.stages.filter(x=>pr.done.has(x.code)||x.code===pr.next?.code).map(x=>[x.code,x.label+(pr.done.has(x.code)?' · повтор':'')]),pr.next?.code||pr.stages[0].code,null);
   const when=fieldInput('session_when',dateTime(),'datetime-local'),duration=num('session_minutes',15,1,1440),result=simple('session_result',{completed:'Выполнено',incomplete:'Не выполнено, повторить'},'completed');
   const witness=person('session_witness','Демонстратор / свидетель','',{optional:true}),notes=note('session_notes','','Наблюдение, задание, условия, ошибки или результат');
   const ack1=check('mentor_ack','Факт подтверждён инструктором'),ack2=check('trainee_ack','Факт подтверждён обучаемым');
   panel.append(pane('Записать факт',grid(f('Этап / повторение',stage),f('Фактические дата и время',when),f('Минут',duration),f('Результат',result),witness.element),f('Наблюдение и результат',notes),ack1.element,ack2.element,msg('Отметки подтверждают зарегистрированный факт, не заменяют подписи в утверждённых документах.'),save('Записать этап','training_session',()=>({assignment_id:a.id,assignment_rev:a.rev,stage_code:stage.value,held_at:when.value,duration_minutes:Number(duration.value),result:result.value,notes:notes.value,witness_id:nullable(witness.value),mentor_ack:ack1.input.checked,trainee_ack:ack2.input.checked}))))
  }else panel.append(msg('Запись новых этапов доступна после согласования актуального назначения.','warn'));
  const facts=pr.facts.map(x=>[x.held_at,JSON.parse(x.steps_json).label,resultLabels[x.result]||x.result,x.duration_minutes,x.notes,x.witness_name||'—']);
  panel.append(pane('Журнал фактов',table(['Дата / время','Этап','Результат','Минут','Запись','Свидетель'],facts),exportButton('Инструктаж-'+a.id.slice(0,8),['Дата / время','Этап','Результат','Минут','Запись','Свидетель'],facts)));
  return stack(planMaterial(a),panel)
 }
 function methodsPanel(){
  const methods=practicalMethods(db),out=pane('Методика практической оценки',msg('Приложение 8 встроено. Новая редакция: оригинальный XLSX, JSON v2 или лист «Критерии» (№, Раздел, Критерий; 1–100 строк). Порог допуска не устанавливается.'),row(action('Загрузить методику практики JSON',()=>pick('.json',async p=>{validatePracticalMethod(p);await write('checklist_version',p);return 'Методика практики зарегистрирована'} ,128000)),action('Импорт оригинального XLSX',()=>{
   const input=el('input');input.type='file';input.accept='.xlsx';
   input.onchange=()=>{if(!input.files?.[0])return;const file=input.files[0];run(async()=>{
    invariant(file.size<=12*1024*1024,'Файл методики слишком большой');const bytes=new Uint8Array(await file.arrayBuffer()),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
    const generic=book.getWorksheet('Критерии'),sheet=book.worksheets.find(s=>s.name.trim().toLocaleLowerCase('ru-RU')==='чек лист');
    const criteria=generic?criteriaFromTabularSheet(generic):practicalCriteriaFromSheet(sheet);
    const p=validatePracticalMethod({format:criteria.length===11?'lean-practical-checklist-v1':'lean-practical-checklist-v2',title:'Практическая оценка · '+file.name.slice(0,150),source_sha256:await sha256(bytes),criteria});
    invariant(new Set(criteria.map(x=>x.question)).size===criteria.length,'Проверьте строки критериев оригинальной формы');
    if(!confirm('Зарегистрировать новую неизменяемую методику из '+criteria.length+' критериев?\n\n'+criteria.map(x=>x.code+'. '+x.question).join('\n')))return 'Импорт отменён';
    await write('checklist_version',p);return 'Методика практики зарегистрирована'
   })};input.click()
  })));
  if(!methods.length)out.append(tableOf(['№','Раздел','Критерий'],BUILTIN_PRACTICAL.criteria.map(q=>[q.code,q.section,q.question])));
  for(const m of methods){const d=el('details'),p=JSON.parse(m.methodology_json);d.append(el('summary','v'+m.version_no+' · '+p.title+' · '+(m.state==='active'?'Действует':'История')),tableOf(['№','Раздел','Критерий'],practicalCriteria(db,m.id).map(q=>[q.position,q.section_code,q.question])));out.append(d)}
  return out
 }
 function verificationForm(a,kind){
  const who=person('verify_'+kind+'_actor','Оценщик', '',{filter:x=>x.id!==a.trainee_id}),when=date('verify_'+kind+'_date'),result=simple('verify_'+kind+'_result',{pass:'Пройдено',fail:'Не пройдено'},'pass'),evidence=note('verify_'+kind+'_evidence'),feedback=note('verify_'+kind+'_feedback');
  const d=el('details');d.append(el('summary',kind==='safety'?'Зарегистрировать проверку ОТ':'Зарегистрировать проверку теории'),grid(who.element,f('Дата',when),f('Результат',result)),f('Документ / основание проверки',evidence),f('Обратная связь',feedback),save('Сохранить проверку '+(kind==='safety'?'ОТ':'теории'),'training_verification',()=>({assignment_id:a.id,assignment_rev:a.rev,kind,evaluator_id:who.value,evaluated_on:when.value,result:result.value,evidence:evidence.value,feedback:feedback.value})));return d
 }
 function practicalForm(a){
  const methods=practicalMethods(db).filter(x=>x.state==='active'),builtin=methods.length?null:event('checklist_version',BUILTIN_PRACTICAL);
  const m=methods[0]||{id:builtin.entity_id,version_no:1},criteria=builtin?previewCriteria(BUILTIN_PRACTICAL,m.id):practicalCriteria(db,m.id),total=criteria.length,who=person('practical_actor','Оценщик','',{filter:x=>x.id!==a.trainee_id}),when=date('practical_date'),conclusion=simple('practical_conclusion',conclusions,'','— Выберите заключение —'),feedback=note('practical_feedback');
  const controls=criteria.map(x=>({x,value:select('practical_value_'+x.position,[[0,'0 — не выполнено'],[1,'1 — выполнено']],'','Не оценено'),note:fieldInput('practical_note_'+x.position)}));
  const result=msg('Оценено 0/'+total),value=()=>controls.map(q=>({criterion_id:q.x.id,value:q.value.value===''?null:Number(q.value.value),note:q.note.value}));
  function refresh(){const x=practicalResult(value(),total);result.textContent='Оценено '+x.rated+'/'+total+' · '+(x.fraction===null?'итог не рассчитан':x.yes+'/'+total+' · '+(x.fraction*100).toFixed(1)+'%')}
  controls.forEach(q=>q.value.onchange=refresh);
  const d=el('details');d.append(el('summary','Новая практическая оценка'),grid(who.element,f('Дата',when),f('Заключение по наблюдению',conclusion)),msg((builtin?'Встроенная форма · Приложение 8':'Методика v'+m.version_no)+' · процент после всех '+total+' ответов; заключение выбирается отдельно.'),tableOf(['№','Раздел','Критерий','Оценка','Комментарий'],controls.map(q=>[q.x.position,q.x.section_code,q.x.question,q.value,q.note])),result,f('Обратная связь обучаемому / инструктору',feedback),action('Зафиксировать практическую оценку',()=>run(async()=>{await ws.applyContentEvents([...(builtin?[builtin]:[]),event('assessment_session',{command:'practical',assignment_id:a.id,assignment_rev:a.rev,evaluator_id:who.value,assessed_on:when.value,method_id:m.id,responses:value(),conclusion:conclusion.value,feedback:feedback.value})],readContent);return 'Запись сохранена. Ожидает публикации базы.'})));return d
 }
 function qualificationForm(a,p){
  const actor=person('qualification_actor','Подтверждающий уровень','',{filter:x=>x.id!==a.trainee_id}),when=date('qualification_date'),state=simple('qualification_state',observationLabels,'rated'),level=levelPicker('qualification_level',a.scale_id),until=date('qualification_until',''),evidence=note('qualification_evidence'),feedback=note('qualification_feedback');
  state.onchange=()=>{level.disabled=state.value!=='rated';until.disabled=level.disabled;if(level.disabled){level.value='';until.value=''}};
  const d=el('details');d.append(el('summary','Подтвердить компетенцию'),msg('Навык: '+n('skill',a.skill_id)+' · шкала '+n('rating_scale',a.scale_id)+' · цель '+a.target_level+'. Уровень выбирается по факту, не из процента.'),grid(actor.element,f('Дата',when),f('Наблюдение',state),f('Фактический уровень',level),f('Действителен до (если установлено)',until)),f('Доказательство и обоснование',evidence),f('Обратная связь',feedback),save('Сохранить подтверждение уровня','assessment_session',()=>({command:'qualification',assignment_id:a.id,assignment_rev:a.rev,evaluator_id:actor.value,assessed_on:when.value,practical_id:p.id,observation_state:state.value,level:state.value==='rated'&&level.value!==''?Number(level.value):null,valid_until:nullable(until.value),evidence:evidence.value,feedback:feedback.value})));return d
 }
 function admissionForm(a){
  const actor=person('admission_actor','Ответственный за решение о допуске','',{filter:x=>x.id!==a.trainee_id}),when=date('admission_date'),decision=simple('admission_decision',decisionLabels,'','— Выберите решение —'),until=date('admission_until',''),evidence=note('admission_evidence'),feedback=note('admission_feedback');
  decision.onchange=()=>{until.disabled=decision.value!=='granted';if(until.disabled)until.value=''};
  const d=el('details');d.append(el('summary','Зарегистрировать решение о допуске'),msg('Регистрация решения уполномоченного сотрудника. Обязательные внешние процедуры, наряды и разрешения приложение не заменяет.'),grid(actor.element,f('Дата решения',when),f('Решение',decision),f('Срок (если установлен)',until)),f('Основание / реквизиты документа',evidence),f('Обратная связь',feedback),save('Сохранить решение о допуске','admission_decision',()=>({assignment_id:a.id,assignment_rev:a.rev,actor_id:actor.value,decided_on:when.value,valid_until:nullable(until.value),decision:decision.value,evidence:evidence.value,feedback:feedback.value})));return d
 }
 function practice(a){
  const pr=progressFor(db,a),x=evidenceSummary(a),can=a.state!=='cancelled'&&a.approval_json&&sameRevision(a);
  const panel=pane('Практика, знания и допуск',tableOf(['Проверка','Состояние'],[['Вводная часть инструктажа',pr.intro?'Завершена':'Не завершена'],['ОТ',x.s?resultLabels[x.s.result]:'Нет результата'],['Теория',x.t?resultLabels[x.t.result]:'Нет результата'],['Практика',x.p?conclusions[x.p.conclusion]:'Нет оценки'],['Компетенция',x.q?'Подтверждение зарегистрировано':'Нет подтверждения'],['Допуск',x.ad.status]]),msg('Положительные результаты и квалификационный уровень не выдают допуск автоматически.'));
  if(can){panel.append(verificationForm(a,'safety'),verificationForm(a,'theory'));if(pr.intro)panel.append(practicalForm(a));else panel.append(msg('Практическая оценка доступна после завершения вводных проб.','muted'));if(x.p)panel.append(qualificationForm(a,x.p));panel.append(admissionForm(a))}
  const verifications=rows(db,'SELECT * FROM training_verification WHERE assignment_id=? ORDER BY evaluated_on DESC,recorded_at DESC',[a.id]);
  panel.append(pane('История проверок знаний',table(['Дата','Вид','Результат','Оценщик','Основание','Обратная связь'],verifications.map(v=>[v.evaluated_on,v.kind==='safety'?'ОТ':'Теория',resultLabels[v.result],n('person',v.evaluator_id),v.evidence,v.feedback]))));
  const history=rows(db,"SELECT * FROM assessment_session WHERE assignment_id=? AND state='confirmed' ORDER BY assessed_at DESC,recorded_at DESC",[a.id]);
  const assessed=pane('История практики и компетенции');
  for(const h of history){
   const detail=el('details');
   if(h.assessment_kind==='practical'){
    const values=JSON.parse(h.responses_json),criteria=practicalCriteria(db,h.method_id),result=practicalResult(values,criteria.length),lines=values.map((v,i)=>[i+1,criteria[i]?.section_code,criteria[i]?.question,v.value,v.note]);
    detail.append(el('summary',h.assessed_at+' · Практика · '+result.yes+'/'+result.total+' · '+(result.fraction*100).toFixed(1)+'% · '+conclusions[h.conclusion]),msg('Оценщик: '+n('person',h.evaluator_id)+' · '+h.feedback),tableOf(['№','Раздел','Критерий','Оценка','Комментарий'],lines),btn('Скачать чек-лист стажёра XLSX',()=>run(async()=>{const method=JSON.parse(one(db,'SELECT methodology_json FROM checklist_version WHERE id=?',[h.method_id]).methodology_json);return saveWorkbook('Практическая-оценка-'+h.id.slice(0,8),practicalWorkbook(ExcelJS,method,[{operation:revLabel(a.sop_revision_id),responses:values,feedback:h.feedback,conclusion:conclusions[h.conclusion],date:h.assessed_at,evaluator:n('person',h.evaluator_id)}],{trainee:n('person',a.trainee_id)}))},{save:false})))
   }else{const i=one(db,'SELECT * FROM assessment_item WHERE session_id=?',[h.id]);detail.append(el('summary',h.assessed_at+' · Компетенция · '+(i?.observation_state==='rated'?'уровень '+i.level:observationLabels[i?.observation_state]||'—')),msg('Шкала: '+n('rating_scale',i?.scale_id)+' · до '+(i?.valid_until||'не установлено')+' · '+n('person',h.evaluator_id)),msg(i?.evidence_note||''),msg(h.feedback))}
   assessed.append(detail)
  }
  if(!history.length)assessed.append(msg('Оценок пока нет.'));panel.append(assessed);
  const ads=rows(db,'SELECT * FROM admission_decision WHERE assignment_id=? ORDER BY decided_on DESC,recorded_at DESC',[a.id]);
  const decisions=pane('История решений о допуске');
  for(const d of ads){decisions.append(pane(d.decided_on+' · '+decisionLabels[d.decision]+(d.revoked_at?' · Отозван':''),msg('Решение: '+n('person',d.actor_id)+' · срок: '+(d.valid_until||'не установлен')),msg(d.evidence),msg(d.feedback),...(d.revoked_at?[msg('Причина отзыва: '+d.revoke_reason)]:d.decision==='granted'?[closeRecord('Отозвать допуск','admission_decision',d,'revoke')]:[])))}
  if(!ads.length)decisions.append(msg('Нет решений.'));panel.append(decisions);return panel
 }
 function assignmentCard(a){
  const root=pane('Обучение · '+assignmentName(a),row(back(),btn('К плану обучения',()=>go('twi')),btn('К журналу',()=>go('journal')),btn('Аудит 1-го уровня',()=>go('audit',{mode:'new',assignmentId:a.id})))),tabs=el('div',undefined,'library-tabs');
  const selected=route.tab||(page==='instruction'?'instruction':page==='practical'?'practice':'overview'),content=el('div');
  for(const [id,label,fn] of [['overview','Назначение',()=>overview(a)],['instruction','Инструктаж',()=>instruction(a)],['practice','Практика и допуск',()=>practice(a)]]){
   const button=btn(label,()=>{route.tab=id;for(const x of tabs.children)x.classList.remove('selected');button.classList.add('selected');content.replaceChildren(fn())},'library-tab'+(selected===id?' selected':''));tabs.append(button);if(selected===id)content.append(fn())
  }
  root.append(tabs,content);return root
 }
 function registryPrograms(){
  const items=rows(db,'SELECT * FROM training_program ORDER BY code,version_no DESC').filter(p=>page==='internship'?p.kind==='internship':p.kind!=='internship'),enrollments=enrollmentList().filter(x=>items.some(p=>p.id===x.program_id));
  return stack(pane(page==='internship'?'Программы стажировки':'Шаблоны подготовки и ввода в профессию',msg('Версии шаблонов неизменяемы. Персональная программа хранит свою версию, назначенные задания и результаты.'),action('Создать программу',()=>goLocal({mode:'program'})),table(['Код','Программа','Вид','Версия','Профессия / должность','Статус',''],items.map(p=>[p.code,p.title,programKinds[p.kind],p.version_no,n('profession',p.profession_id)+' / '+n('position',p.position_id),statuses[p.state],btn('Открыть',()=>goLocal({programId:p.id}),'primary')]))),
   pane('Персональные программы',table(['Обучаемый','Программа','Наставник','Срок','Задания','Статус',''],enrollments.map(x=>{const p=items.find(v=>v.id===x.program_id),t=enrollmentTasks(db,x);return [n('person',x.trainee_id),p.title+' · v'+p.version_no,n('person',x.mentor_id),x.due_on,t.filter(y=>y.done).length+'/'+t.length,statuses[x.state],btn('Открыть',()=>goLocal({enrollmentId:x.id}),'primary')]}))))
 }
 function programForm(){
  const prev=route.copyId?one(db,'SELECT * FROM training_program WHERE id=?',[route.copyId]):null;
  const code=fieldInput('program_code',prev?.code||''),title=fieldInput('program_title',prev?.title||''),kind=select('program_kind',Object.entries(programKinds).filter(([k])=>page==='internship'?k==='internship':k!=='internship'),prev?.kind||(page==='internship'?'internship':'entry'),null);
  const profession=ref('profession','program_profession',prev?.profession_id||'','— Любая —'),position=ref('position','program_position',prev?.position_id||'','— Любая —'),author=person('program_author','Составитель программы'),tasks=el('div',undefined,'stack'),controls=[];
  function taskLine(x={}){
   const part=simple('task_part',parts,x.part||'general'),name=fieldInput('task_title',x.title||''),hours=num('task_hours',x.hours??0,0,1000,.25),offset=num('task_day',x.day_offset??0,0,3660),rev=revPicker('task_revision',x.sop_revision_id||'');
   const skill=ref('skill','task_skill',x.skill_id||'','— Выберите —',v=>v.operation_id===currentStandard(db,rev.value)?.operation_id),target=scaleFields('task_target',x.scale_id||'',x.target_level??null),line=el('div',undefined,'lc4-task');
   const item={part,name,hours,offset,rev,skill,target,line};controls.push(item);
   function sync(){const on=!!rev.value;skill.disabled=!on;target.scale.disabled=!on;target.level.disabled=!on;if(!on){skill.value='';target.set('',null)}}
   rev.onchange=()=>{replaceOptions(skill,ref('skill','task_skill','','— Выберите —',v=>v.operation_id===currentStandard(db,rev.value)?.operation_id));sync()};
   line.append(row(el('strong','Задание'),btn('Удалить',()=>{const i=controls.indexOf(item);if(i>=0)controls.splice(i,1);line.remove()})),grid(f('Часть программы',part),f('Задание / функция',name),f('Часы',hours),f('День от начала (0 = первый)',offset)),f('СОП (если обучаем операции)',rev),f('Навык',skill),target.element);
   tasks.append(line);sync()
  }
  if(prev)rows(db,'SELECT * FROM training_program_task WHERE program_id=? ORDER BY position',[prev.id]).forEach(taskLine);else if(page==='internship')Object.keys(parts).forEach(part=>taskLine({part}));else taskLine();
  return pane(prev?'Новая версия программы':'Новая программа',row(back()),grid(f('Код',code),f('Название',title),f('Вид',kind),f('Профессия',profession),f('Должность',position),author.element),msg('Задания с СОП выполняются через назначения обучения; остальные отмечаются отдельным фактом. При сохранении того же кода создаётся новая версия.'),tasks,...(page==='internship'?[btn('Заполнить задания из приложения 2',()=>{if(!confirm('Заменить незаписанные задания образцом программы? Часы, даты и СОП затем заполните вручную.'))return;controls.splice(0);tasks.replaceChildren();INITIAL_PROGRAM_TASKS.forEach(taskLine)})]:[]),btn('Добавить задание',()=>taskLine()),save('Сохранить версию программы','training_program',()=>({code:code.value,kind:kind.value,title:title.value,profession_id:nullable(profession.value),position_id:nullable(position.value),created_by:author.value,tasks:controls.map(v=>({part:v.part.value,title:v.name.value,hours:Number(v.hours.value),day_offset:Number(v.offset.value),sop_revision_id:nullable(v.rev.value),skill_id:v.rev.value?nullable(v.skill.value):null,scale_id:v.rev.value?nullable(v.target.scale.value):null,target_level:v.rev.value&&v.target.level.value!==''?Number(v.target.level.value):null}))}),null,id=>{route={page,programId:id}}))
 }
 function programCard(p){
  const tasks=rows(db,'SELECT * FROM training_program_task WHERE program_id=? ORDER BY position',[p.id]),lines=tasks.map(x=>[x.position,parts[x.part],x.title,x.day_offset,x.hours,x.sop_revision_id?revLabel(x.sop_revision_id):'—',x.target_level??'—']);
  const root=pane(p.code+' · '+p.title+' · v'+p.version_no,row(back(),action('Создать новую версию',()=>goLocal({mode:'program',copyId:p.id}))),msg(programKinds[p.kind]+' · '+statuses[p.state]+' · часов '+tasks.reduce((s,x)=>s+x.hours,0)),tableOf(['№','Часть','Задание','День','Часы','СОП','Цель'],lines),exportButton('Программа-'+p.code,['№','Часть','Задание','День','Часы','СОП','Цель'],lines));
  if(p.state==='active'){
   const start=date('enroll_start'),due=date('enroll_due'),internStart=date('internship_start',''),internEnd=date('internship_end',''),entryStart=date('entry_start',''),entryEnd=date('entry_end',''),learner=person('enroll_trainee','Обучаемый','',{allowed:['trainee'],at:()=>start.value}),mentor=person('enroll_mentor','Наставник','',{allowed:['mentor','instructor'],at:()=>start.value}),manager=person('enroll_manager','Руководитель'),reason=note('enroll_reason');
   const d=el('details');d.append(el('summary','Создать персональную программу'),grid(learner.element,mentor.element,manager.element,f('Начало',start),f('Срок завершения',due)),...(p.kind==='internship'?[grid(f('Стажировка с',internStart),f('Стажировка по',internEnd),f('Ввод в профессию с',entryStart),f('Ввод в профессию по',entryEnd))]:[]),f('Причина / основание',reason),save('Назначить программу','training_enrollment',()=>({program_id:p.id,trainee_id:learner.value,mentor_id:mentor.value,manager_id:manager.value,start_on:start.value,due_on:due.value,reason:reason.value,...(p.kind==='internship'?{internship_start:nullable(internStart.value),internship_end:nullable(internEnd.value),entry_start:nullable(entryStart.value),entry_end:nullable(entryEnd.value)}:{})}),null,id=>{route={page,enrollmentId:id}}));root.append(d,closeRecord('Завершить действие шаблона','training_program',p,'retire'))
  }return root
 }
 function plusDays(d,days){const v=new Date(d+'T00:00:00Z');v.setUTCDate(v.getUTCDate()+days);return v.toISOString().slice(0,10)}
 function enrollmentCard(x){
  const p=one(db,'SELECT * FROM training_program WHERE id=?',[x.program_id]),tasks=enrollmentTasks(db,x),panel=pane('Персональная программа · '+n('person',x.trainee_id),row(back(),btn('Шаблон программы',()=>goLocal({programId:p.id}))),msg(p.title+' · v'+p.version_no+' · '+statuses[x.state]+' · '+x.start_on+' — '+x.due_on),msg('Наставник: '+n('person',x.mentor_id)+' · руководитель: '+n('person',x.manager_id)+' · '+x.reason),tableOf(['Часть','Задание','Срок','Часы','Факт',''],tasks.map(t=>{
   const due=plusDays(x.start_on,t.day_offset),controls=row();
   if(t.assignment)controls.append(btn('Открыть назначение',()=>go('twi',{id:t.assignment.id})));
   else if(x.state==='active'&&t.sop_revision_id)controls.append(action('Назначить инструктаж',()=>go('twi',{mode:'new',revisionId:t.sop_revision_id,skillId:t.skill_id,scaleId:t.scale_id,targetLevel:t.target_level,traineeId:x.trainee_id,supervisorId:x.mentor_id,enrollmentId:x.id,programTaskId:t.id,startOn:x.start_on,dueOn:due,reason:'Задание персональной программы: '+t.title})));
   else if(x.state==='active')controls.append(action('Записать результат',()=>goLocal({enrollmentId:x.id,taskId:t.id})));
   return [parts[t.part],t.title,due,t.hours,t.done?'Выполнено':t.assignment?stateLabel(t.assignment):t.result?resultLabels[t.result.result]:'Не выполнено',controls]
  })));
  const facts=tasks.flatMap(t=>t.sop_revision_id?rows(db,'SELECT s.held_at,s.duration_minutes FROM training_session s JOIN training_assignment a ON a.id=s.assignment_id WHERE a.enrollment_id=? AND a.program_task_id=? AND s.stage_code IS NOT NULL',[x.id,t.id]).map(v=>({date:v.held_at.slice(0,10),minutes:v.duration_minutes,title:t.title})):rows(db,'SELECT held_on,minutes FROM training_task_result WHERE enrollment_id=? AND task_id=?',[x.id,t.id]).map(v=>({date:v.held_on,minutes:v.minutes,title:t.title})));
  const cal=calendarData(x.start_on,tasks),dates=calendarFacts(x.start_on,tasks,facts),calendar=pane('Календарный план',msg('Плановые даты берутся из версии программы, факты — из фактических дат записей. Повторения учитываются отдельно.'),tableOf(['Дата','Плановые задания','План, ч','Фактические задания','Факт, ч'],dates.map(d=>[d.date,d.plannedTasks.join(' · '),d.planned,d.actualTasks.join(' · '),Math.round(d.actual*100)/100])),msg('Всего плановых часов: '+cal.total));
  if(p.kind==='internship')calendar.append(msg(x.internship_start?'Стажировка: '+x.internship_start+' — '+x.internship_end+' · Ввод: '+x.entry_start+' — '+x.entry_end:'Периоды стажировки и ввода в старой записи не указаны.'));
  const scope=directoryPeople(db,x.start_on).find(v=>v.id===x.trainee_id);
  calendar.append(btn('Скачать календарный план XLSX',()=>run(async()=>saveWorkbook('План-ввода-'+p.code,entryWorkbook(ExcelJS,p,x,tasks,{scope:scope?.unit||'',trainee:n('person',x.trainee_id),mentor:n('person',x.mentor_id),manager:n('person',x.manager_id),revision:revLabel,facts,responsible:t=>t.assignment?n('person',t.assignment.mentor_id):t.result?n('person',t.result.actor_id):''})),{save:false})));
  panel.append(calendar);
  const t=tasks.find(q=>q.id===route.taskId);
  if(t&&!t.sop_revision_id&&x.state==='active'){
   const actor=person('task_actor','Ответственный'),when=date('task_held'),minutes=num('task_minutes',0,0,1440),result=simple('task_result',{completed:'Выполнено',incomplete:'Не выполнено'},'completed'),evidence=note('task_evidence');
   panel.append(pane('Результат · '+t.title,grid(actor.element,f('Дата',when),f('Минут',minutes),f('Результат',result)),f('Факт и основание',evidence),save('Сохранить результат задания','training_task_result',()=>({enrollment_id:x.id,task_id:t.id,actor_id:actor.value,held_on:when.value,result:result.value,minutes:Number(minutes.value),evidence:evidence.value,enrollment_rev:x.rev}),null,()=>{route={page,enrollmentId:x.id}})))
  }
  if(x.state==='active'){
   const actor=person('enroll_finish_actor','Ответственный за итог'),conclusion=simple('enroll_conclusion',conclusions,'','— Выберите —'),feedback=note('enroll_feedback'),d=el('details');
   d.append(el('summary','Итог программы'),grid(actor.element,f('Заключение',conclusion)),f('Обратная связь / основание',feedback),save('Завершить программу','training_enrollment',()=>({command:'finish',actor_id:actor.value,conclusion:conclusion.value,feedback:feedback.value}),x,()=>{},!tasks.every(t=>t.done)),save('Отменить программу','training_enrollment',()=>({command:'cancel',actor_id:actor.value,conclusion:null,feedback:feedback.value}),x));panel.append(d)
  }else panel.append(msg('Заключение: '+(conclusions[x.conclusion]||'—')+' · '+(x.feedback||'')));
  return panel
 }
 function certificatePage(){
  const items=rows(db,'SELECT * FROM mentor_credential ORDER BY issued_on DESC,id'),out=pane('Сертификаты и свидетельства',msg('Регистрируются выданные документы. Свидетельство о прослушивании не даёт права обучать. Автоматическая сертификация по баллам не выполняется.'),action('Зарегистрировать документ',()=>goLocal({mode:'new'})),table(['Сотрудник','Вид','Роль','Номер','Выдан','Действует до','Статус',''],items.map(x=>[n('person',x.person_id),x.kind==='certificate'?'Сертификат':'Свидетельство',credentialRoles[x.role],x.number,x.issued_on,x.valid_until||'Не установлен',x.revoked_at?'Отозван':x.valid_until&&x.valid_until<day?'Истёк':'Зарегистрирован',btn('Открыть',()=>goLocal({id:x.id}),'primary')])));
  if(route.mode==='new'){
   const who=person('credential_person','Сотрудник'),actor=person('credential_actor','Зарегистрировал'),role=simple('credential_role',credentialRoles,'instructor'),kind=simple('credential_kind',{certificate:'Сертификат',attendance:'Свидетельство о прослушивании'},'certificate'),number=fieldInput('credential_number'),issuer=fieldInput('credential_issuer'),issued=date('credential_issued'),valid=date('credential_valid',''),evidence=note('credential_evidence');
   return pane('Документ о подготовке',back(),grid(who.element,actor.element,f('Вид',kind),f('Роль',role),f('Номер',number),f('Кем выдан',issuer),f('Выдан',issued),f('Срок (если установлен)',valid)),f('Реквизиты / подтверждающий документ',evidence),save('Зарегистрировать документ','mentor_credential',()=>({person_id:who.value,registered_by:actor.value,kind:kind.value,role:role.value,number:number.value,issuer:issuer.value,issued_on:issued.value,valid_until:nullable(valid.value),evidence:evidence.value}),null,id=>{route={page,id}}))
  }
  const x=items.find(v=>v.id===route.id);if(x)return pane(n('person',x.person_id)+' · '+x.number,back(),msg(credentialRoles[x.role]+' · '+x.issuer+' · '+x.issued_on+' · '+(x.revoked_at?'Отозван':'Зарегистрирован')),msg(x.evidence),...(x.kind==='certificate'?[btn('Реквизиты сертификата DOCX',()=>run(async()=>{const info=directoryPeople(db,x.issued_on).find(v=>v.id===x.person_id);const label=x.role==='internal_trainer'?'Внутренний тренер инструкторов-наставников TWI':'Инструктор-наставник TWI';downloadBytes('Реквизиты-сертификата-'+x.id.slice(0,8)+'.docx',draftDocx([{text:'РЕКВИЗИТЫ СЕРТИФИКАТА',bold:true,size:32,center:true},{text:'Не оригинал сертификата · без подписи',center:true},n('person',x.person_id),info?.position||'',label,'Номер: '+x.number,'Выдан: '+x.issued_on,'Организация: '+x.issuer,'Основание: '+x.evidence,'Подпись: __________________']));return 'Реквизиты сформированы; используйте утверждённый бланк'},{save:false}))]:[]),...(!x.revoked_at?[closeRecord('Отозвать документ','mentor_credential',x,'revoke')]:[]));return out
 }
 function groupOrderForm(){
  const organization=fieldInput('order_organization'),city=fieldInput('order_city'),number=fieldInput('order_number'),order=date('order_on'),start=date('order_start'),end=date('order_end',''),payFrom=date('order_pay_from',''),payI=num('order_pay_instructor','',0,10000000),payT=num('order_pay_trainer','',0,10000000),actor=person('group_order_actor','Директор / утверждающий'),evidence=note('group_order_evidence'),confirmed=check('group_order_confirm','Подписанный приказ получен, ознакомление сотрудников подтверждено'),members=[],listEl=el('div',undefined,'stack');
  const roleLabel=x=>x.role==='internal_trainer'?'Внутренний тренер':'Инструктор-наставник';
  function candidates(){return rows(db,"SELECT * FROM mentor_credential WHERE kind='certificate' ORDER BY issued_on DESC").filter(x=>certificateValid(db,x.id,start.value))}
  function addMember(){
   const role=select('group_member_role',[['','Все сертифицированные'],['instructor','Инструкторы-наставники'],['internal_trainer','Внутренние тренеры']],'',null),cert=select('group_member_cert',[]),ack=date('group_member_ack',day),description=msg('Выберите действующий сертификат'),block=el('div',undefined,'lc4-task');
   const matching=()=>candidates().filter(x=>!role.value||(role.value==='internal_trainer'?x.role==='internal_trainer':x.role!=='internal_trainer'));
   const who=person('group_member_person','Сертифицированный сотрудник','',{at:()=>start.value,filter:p=>matching().some(x=>x.person_id===p.id),onChange:refresh});
   const selected=()=>matching().find(x=>x.id===cert.value&&x.person_id===who.value);
   function show(){const x=selected(),p=x&&directoryPeople(db,start.value).find(y=>y.id===x.person_id);description.textContent=x?n('person',x.person_id)+' · '+(orderPosition(db,x.person_id,start.value)||'Должность не назначена')+' · '+roleLabel(x):'Выберите действующий сертификат'}
   function refresh(){if(who.value&&!matching().some(x=>x.person_id===who.value))who.set('');const before=cert.value,available=matching().filter(x=>x.person_id===who.value);replaceOptions(cert,select(cert.name,available.map(x=>[x.id,roleLabel(x)+' · '+x.number]),available.some(x=>x.id===before)?before:available.length===1?available[0].id:''));show()}
   role.onchange=refresh;cert.onchange=show;const item={cert,ack,block,selected,refresh};members.push(item);block.append(grid(f('Группа приказа',role),who.element,f('Сертификат',cert),f('Ознакомлен',ack)),description,btn('Удалить сотрудника',()=>{members.splice(members.indexOf(item),1);block.remove()}));listEl.append(block);refresh()
  }
  start.onchange=()=>members.forEach(m=>m.refresh());addMember();
  function collect(registered){
   const header={order_number:number.value.trim(),order_on:order.value,organization:organization.value.trim(),city:city.value.trim(),approved_by:actor.value,valid_from:start.value,valid_to:nullable(end.value),supplement_from:nullable(payFrom.value),instructor_amount:payI.value===''?null:Number(payI.value),trainer_amount:payT.value===''?null:Number(payT.value),evidence:evidence.value,members:[]};
   invariant(header.order_number&&header.organization&&header.city&&actor.value&&members.length&&header.order_on&&header.valid_from,'Заполните шапку приказа и выберите сотрудников');
   if(registered)invariant(confirmed.input.checked,'Подтвердите регистрацию подписанного приказа и ознакомлений');
   const snapshots=[],seen=new Set();
   for(const m of members){const cert=m.selected(),p=cert&&directoryPeople(db,start.value).find(x=>x.id===cert.person_id);const position=p?orderPosition(db,p.id,start.value):'';invariant(cert&&p&&position,'Нужны сертификат и должность сотрудника');const k=p.id+':'+(cert.role==='internal_trainer'?'vt':'instructor');invariant(!seen.has(k),'Повтор сотрудника в группе');seen.add(k);header.members.push({id:uuid(),credential_id:cert.id,acknowledged_on:m.ack.value});snapshots.push({role:cert.role,person_name:p.display_name,position_name:position})}
   invariant([header.instructor_amount,header.trainer_amount].every(x=>x===null||Number.isInteger(x)&&x>=0),'Введите неотрицательные целые суммы');invariant((header.instructor_amount===null&&header.trainer_amount===null)?!header.supplement_from:!!header.supplement_from,'Укажите дату доплаты или оставьте все поля доплат пустыми');
   return {header,snapshots,order:{...header,approved_name:n('person',actor.value)}}
  }
  return pane('Групповой приказ о назначении',back(),msg('Проект формируется из встроенного бланка; можно также выбрать свой оригинальный DOCX. Для регистрации нужны фактический подписанный приказ, сертификаты и ознакомление каждого сотрудника. Суммы вводятся по утверждённому решению, расчёт зарплаты не выполняется.'),grid(f('Организация',organization),f('Город',city),f('Номер приказа',number),f('Дата приказа',order),f('Начало полномочий',start),f('Окончание (если есть)',end),actor.element),grid(f('Доплата инструкторам, руб. на руки',payI),f('Доплата ВТ, руб. на руки',payT),f('Дата начала доплаты',payFrom)),listEl,btn('Добавить сотрудника',addMember),f('Основание / реквизиты подписанного приказа',evidence),confirmed.element,row(btn('Сформировать проект DOCX',()=>{try{const x=collect(false);downloadBytes('Проект-приказа.docx',builtinOrderDocx(x.order,x.snapshots));c.notify('Проект приказа сформирован без подписи')}catch(e){c.notify(e.message,true)}}),localDocx('Сформировать проект по оригиналу DOCX',async bytes=>{const x=collect(false);downloadBytes('Проект-приказа.docx',await fillOrderTemplate(bytes,x.order,x.snapshots));return 'Проект приказа сформирован без подписи'}),save('Зарегистрировать групповой приказ','mentor_order',()=>collect(true).header,null,id=>{route={page,groupId:id}})))
 }
 function appointmentPage(){
  const items=rows(db,'SELECT * FROM mentor_appointment ORDER BY valid_from DESC,id'),groups=rows(db,'SELECT * FROM mentor_order ORDER BY order_on DESC,id');
  if(route.mode==='group')return groupOrderForm();
  const group=groups.find(g=>g.id===route.groupId);if(group){const members=items.filter(x=>x.order_id===group.id);return pane('Групповой приказ '+group.order_number,back(),msg(group.organization+' · '+group.city+' · '+group.order_on),msg('Утвердил: '+group.approved_name+' · '+group.valid_from+' — '+(group.valid_to||'—')),msg(orderPayment(group)),msg(group.evidence),tableOf(['Сотрудник','Должность','Роль','Ознакомлен','Состояние',''],members.map(x=>[x.person_name,x.position_name,credentialRoles[x.role],x.acknowledged_on,x.revoked_at?'Прекращено':'Зарегистрировано',btn('Открыть',()=>goLocal({id:x.id}))])),btn('Скачать приказ DOCX',()=>{try{downloadBytes('Приказ-'+group.id.slice(0,8)+'.docx',builtinOrderDocx(group,members,{registered:true}));c.notify('Копия реквизитов сформирована без подписи')}catch(e){c.notify(e.message,true)}}),localDocx('Скачать копию по оригиналу DOCX',async bytes=>{downloadBytes('Приказ-'+group.id.slice(0,8)+'.docx',await fillOrderTemplate(bytes,group,members,{registered:true}));return 'Копия реквизитов сформирована без подписи'}))}
  if(route.mode==='new'){
   const cert=select('appointment_certificate',rows(db,"SELECT * FROM mentor_credential WHERE kind='certificate' AND revoked_at IS NULL ORDER BY issued_on DESC").map(x=>[x.id,n('person',x.person_id)+' · '+credentialRoles[x.role]+' · '+x.number])),actor=person('appointment_actor','Утвердивший назначение'),number=fieldInput('appointment_number'),order=date('appointment_order_date'),start=date('appointment_start'),end=date('appointment_end',''),ack=date('appointment_ack'),evidence=note('appointment_evidence');
   return pane('Регистрация приказа',back(),f('Сертификат сотрудника и роль',cert),grid(actor.element,f('Номер приказа',number),f('Дата приказа',order),f('Начало полномочий',start),f('Окончание (если установлено)',end),f('Дата ознакомления',ack)),f('Основание / реквизиты подписанного приказа',evidence),save('Зарегистрировать приказ','mentor_appointment',()=>{const c=one(db,'SELECT * FROM mentor_credential WHERE id=?',[cert.value]);invariant(c,'Выберите сертификат');return {person_id:c.person_id,credential_id:c.id,role:c.role,order_number:number.value,order_on:order.value,approved_by:actor.value,valid_from:start.value,valid_to:nullable(end.value),acknowledged_on:ack.value,evidence:evidence.value}},null,id=>{route={page,id}}))
  }
  const x=items.find(v=>v.id===route.id);if(x)return pane('Приказ '+x.order_number,back(),msg(n('person',x.person_id)+' · '+credentialRoles[x.role]+' · '+x.valid_from+' — '+(x.valid_to||'без установленного окончания')),msg(x.evidence),...(!x.revoked_at?[closeRecord('Прекратить действие приказа','mentor_appointment',x,'revoke')]:[msg('Прекращено: '+x.revoked_at)]));
  return pane('Назначения по приказам',msg('Роли в справочнике, сертификат и подписанный приказ — разные основания. Право обучать отдельной операции регистрируется в карточке наставника.'),row(action('Групповой приказ',()=>goLocal({mode:'group'})),action('Зарегистрировать приказ',()=>goLocal({mode:'new'})),btn('Сертификаты',()=>go('certification'))),pane('Групповые приказы',table(['Номер','Дата','Организация','Сотрудников',''],groups.map(g=>[g.order_number,g.order_on,g.organization,items.filter(x=>x.order_id===g.id).length,btn('Открыть',()=>goLocal({groupId:g.id}),'primary')]))),table(['Сотрудник','Роль','Приказ','Начало','Окончание','Ознакомление',''],items.filter(x=>!x.order_id).map(x=>[n('person',x.person_id),credentialRoles[x.role],x.order_number,x.valid_from,x.valid_to||'—',x.acknowledged_on+(x.revoked_at?' · прекращён':''),btn('Открыть',()=>goLocal({id:x.id}),'primary')])))
 }
 function mentorPage(){
  const persons=directoryPeople(db,day).filter(p=>p.roles.some(x=>['mentor','instructor'].includes(x.kind))),auths=rows(db,'SELECT * FROM mentor_authorization WHERE credential_id IS NOT NULL ORDER BY valid_from DESC,id');
  if(route.mode==='auth'){
   const who=person('auth_person','Инструктор / наставник',route.personId||'',{allowed:['mentor','instructor'],onChange:refresh}),actor=person('auth_actor','Утвердивший право обучать'),op=ref('operation','auth_operation'),start=date('auth_start'),end=date('auth_end',''),appointment=select('auth_appointment',[]);
   function refresh(){replaceOptions(appointment,select('auth_appointment',rows(db,'SELECT * FROM mentor_appointment WHERE person_id=? AND revoked_at IS NULL ORDER BY valid_from DESC',[who.value]).map(x=>[x.id,x.order_number+' · '+credentialRoles[x.role]+' · '+x.valid_from])))}
   refresh();
   return pane('Право обучать операции',back(),grid(who.element,actor.element,f('Операция',op),f('Приказ',appointment),f('Начало',start),f('Окончание (если установлено)',end)),msg('Требуется действующее назначение роли, сертификат и приказ. Все условия проверяются ядром на дату полномочия.'),save('Сохранить полномочие','mentor_authorization',()=>{const o=one(db,'SELECT * FROM mentor_appointment WHERE id=?',[appointment.value]);invariant(o,'Выберите приказ сотрудника');return {person_id:who.value,operation_id:op.value,approved_by:actor.value,valid_from:start.value,valid_to:nullable(end.value),credential_id:o.credential_id,appointment_id:o.id}},null,()=>{route={page,personId:who.value}}))
  }
  const selected=persons.find(p=>p.id===route.personId);
  if(selected){
   const rowsAuth=auths.filter(x=>x.person_id===selected.id),root=pane('Наставник · '+selected.display_name,back(),msg(selected.roles.map(x=>x.name).join(' · ')),row(action('Добавить право обучать',()=>goLocal({mode:'auth',personId:selected.id})),btn('Сертификаты',()=>go('certification')),btn('Приказы',()=>go('appointments'))),table(['Операция','Начало','Окончание','Состояние',''],rowsAuth.map(a=>[n('operation',a.operation_id),a.valid_from,a.valid_to||'—',authorizationValid(db,a.id,day)?'Действует':'Не действует',a.revoked_at?'Отозван':closeRecord('Отозвать','mentor_authorization',a,'revoke')])),pane('Назначения и история',assignmentRows(asgns().filter(a=>a.mentor_id===selected.id||a.supervisor_id===selected.id))));return root
  }
  const search=searchInput('mentor_search'),out=el('div');filterList(out,search,persons,p=>p.display_name+' '+p.employee_code+' '+p.unit,items=>table(['Сотрудник','Подразделение','Действующие роли','Прав на операции','Открытых обучений',''],items.map(p=>[p.display_name,p.unit||'—',p.roles.map(x=>x.name).join(', '),auths.filter(x=>x.person_id===p.id&&authorizationValid(db,x.id,day)).length,asgns().filter(a=>a.mentor_id===p.id&&activePlan(a)).length,btn('Открыть',()=>goLocal({personId:p.id}),'primary')])));
  return pane('Наставники и внутренние тренеры',msg('Настройте роли сотрудников, затем зарегистрируйте сертификаты, приказы и права обучать операциям.'),row(action('Добавить право обучать',()=>goLocal({mode:'auth'})),btn('Роли сотрудников',()=>go('business_role')),btn('Назначения ролей',()=>go('role_assignment')),btn('Сертификаты',()=>go('certification')),btn('Приказы',()=>go('appointments'))),search,out)
 }
 function requirementsPanel(){
  const profession=ref('profession','requirement_profession'),skill=ref('skill','requirement_skill'),target=scaleFields('requirement_target'),critical=simple('requirement_critical',{normal:'Обычная',important:'Важная',critical:'Критическая'},'normal'),start=date('requirement_start'),end=date('requirement_end','');
  const existing=rows(db,'SELECT * FROM role_requirement ORDER BY valid_from DESC'),d=el('details');
  d.append(el('summary','Требования к навыкам по профессиям'),grid(f('Профессия',profession),f('Навык',skill),f('Критичность',critical),f('Начало',start),f('Окончание (необязательно)',end)),target.element,save('Добавить требование','role_requirement',()=>({profession_id:profession.value,skill_id:skill.value,scale_id:target.scale.value,required_level:target.level.value===''?null:Number(target.level.value),criticality:critical.value,valid_from:start.value,valid_to:nullable(end.value)})),table(['Профессия','Навык','Шкала','Цель','Период',''],existing.map(v=>{const end=date('close_requirement');const closure=el('details');closure.append(el('summary','Закрыть'),f('Последний день',end),save('Закрыть требование','role_requirement',()=>({command:'close',valid_to:end.value}),v));return [n('profession',v.profession_id),n('skill',v.skill_id),n('rating_scale',v.scale_id),v.required_level,v.valid_from+' — '+(v.valid_to||'—'),v.valid_to?'Закрыто':closure]})));return d
 }
 function coveragePanel(matrix){
  const unit=ref('org_unit','coverage_unit'),skill=ref('skill','coverage_skill'),shift=select('coverage_shift',list(db,'work_shift').filter(x=>!x.archived).map(x=>[x.code,x.name]),'','Все смены'),target=scaleFields('coverage_target'),minimum=num('coverage_min',1,0,100000),data=coverageData(db,day,matrix);
  const d=el('details');d.append(el('summary','Покрытие по участкам и сменам'),msg('Покрытие — число работников с подтверждённым совместимым уровнем и, для операции, зарегистрированным актуальным допуском. Нулевое требование не даёт процента.'),grid(f('Подразделение',unit),f('Навык',skill),f('Смена',shift),f('Требуемое число',minimum)),target.element,action('Сохранить потребность',()=>run(async()=>{const payload={unit_id:unit.value,skill_id:skill.value,shift_code:shift.value,min_people:Number(minimum.value),scale_id:target.scale.value,required_level:target.level.value===''?null:Number(target.level.value)},old=one(db,'SELECT * FROM coverage_requirement WHERE unit_id=? AND skill_id=? AND shift_code=?',[payload.unit_id,payload.skill_id,payload.shift_code]);await write('coverage_requirement',payload,old);return 'Потребность сохранена'})),table(['Подразделение','Навык','Смена','Нужно','Есть','Дефицит'],data.map(x=>[n('org_unit',x.unit_id),n('skill',x.skill_id),x.shift_code||'Все',x.min_people,x.actual,x.deficit])));return d
 }
 // Saved, versioned corporate matrix. Existing unfiltered overview remains available.
 function matrixBuilder(previous=null){
  const name=fieldInput('matrix_title',previous?.title||''),code=fieldInput('matrix_code',previous?.code||''),author=person('matrix_author','Разработал',previous?.author_id||''),scope=ref('org_unit','matrix_scope',previous?.unit_id||'','Все подразделения'),shift=ref('work_shift','matrix_roster_shift',previous?.shift_id||'','Все смены'),profession=ref('profession','matrix_roster_profession','','Все профессии'),workplace=ref('workplace','matrix_column_workplace','','Все рабочие места'),category=ref('skill_category','matrix_column_category','','Все категории'),horizon=date('matrix_target_date',previous?.target_on>=day?previous.target_on:plusDays(day,30));
  const scales=list(db,'rating_scale').filter(x=>!x.archived&&x.name===SCALE_NAME&&x.levels===CORPORATE_LEVELS),scale=select('matrix_scale',scales.map(x=>[x.id,x.name+' · v'+x.version_no]),previous?.scale_id||scales[0]?.id||'','Создать корпоративскую шкалу');
  const chosenPeople=new Set(previous?.roster.map(x=>x.person_id)|| (route.personId?[route.personId]:[])),chosenColumns=previous?.columns.map(x=>x.document_id?x.skill_id+':'+x.document_id:x.skill_id)||[];
  const pSearch=searchInput('matrix_roster_search'),sSearch=searchInput('matrix_column_search'),pBox=el('div'),sBox=el('div'),ordered=el('div'),preview=el('div'),counts=msg(''),targets=new Map();
  pSearch.placeholder='Фамилия, должность';sSearch.placeholder='Код или название СОП / навыка';
  const match=(q,...values)=>values.join(' ').toLocaleLowerCase('ru-RU').includes(q.value.trim().toLocaleLowerCase('ru-RU'));
  let people=[],options=[];
  const find=k=>options.find(x=>x.key===k),selection=()=>({roster:people.filter(x=>chosenPeople.has(x.person_id)),columns:chosenColumns.map(find).filter(Boolean)});
  function count(){const x=selection();counts.textContent='Сотрудников: '+x.roster.length+' · столбцов: '+x.columns.length+' · ячеек: '+x.roster.length*x.columns.length;preview.replaceChildren()}
  function drawPeople(){const shown=people.filter(x=>match(pSearch,x.name,x.position));pBox.replaceChildren(...shown.map(p=>{const v=check('matrix_person_'+p.person_id,p.name+(p.position?' · '+p.position:''));v.input.checked=chosenPeople.has(p.person_id);v.input.onchange=()=>{if(v.input.checked)chosenPeople.add(p.person_id);else chosenPeople.delete(p.person_id);count()};return v.element}));if(!shown.length)pBox.append(msg('Нет сотрудников по фильтру'))}
  function chooseColumn(x){if(chosenColumns.includes(x.key)||x.skill_id&&chosenColumns.some(k=>find(k)?.skill_id===x.skill_id))return;chosenColumns.push(x.key)}
  function drawColumns(){const shown=options.filter(x=>match(sSearch,x.title,x.skill));sBox.replaceChildren(...shown.map(s=>{const v=check('matrix_column_'+s.key,s.title+' · '+s.skill);v.input.checked=chosenColumns.includes(s.key);v.input.onchange=()=>{if(v.input.checked){chooseColumn(s);v.input.checked=chosenColumns.includes(s.key)}else{chosenColumns.splice(chosenColumns.indexOf(s.key),1);targets.delete(s.key)}drawOrder();count()};return v.element}));if(!shown.length)sBox.append(msg('Нет действующих СОП или навыков'))}
  function drawOrder(){ordered.replaceChildren(...chosenColumns.map((k,i)=>{const x=find(k),target=select('matrix_target_'+i,Object.entries(LEVEL_TEXT).map(([v,t])=>[v,v+' — '+t]),targets.get(k)||'','Без новой цели');target.onchange=()=>{targets.set(k,target.value);count()};return row(el('span',(i+1)+'. '+x.title),target,btn('↑',()=>{[chosenColumns[i-1],chosenColumns[i]]=[chosenColumns[i],chosenColumns[i-1]];drawOrder();count()},'',i===0),btn('↓',()=>{[chosenColumns[i],chosenColumns[i+1]]=[chosenColumns[i+1],chosenColumns[i]];drawOrder();count()},'',i===chosenColumns.length-1),btn('Убрать',()=>{chosenColumns.splice(i,1);targets.delete(k);drawColumns();drawOrder();count()}))}));if(!chosenColumns.length)ordered.append(msg('Выберите СОП, затем задайте порядок от простых к сложным.'))}
  function refresh(){people=matrixRoster(db,day,scope.value,shift.value,profession.value);options=columnChoices(db,scope.value,workplace.value,category.value);for(const p of [...chosenPeople])if(!people.some(x=>x.person_id===p))chosenPeople.delete(p);for(let i=chosenColumns.length-1;i>=0;i--)if(!find(chosenColumns[i])){targets.delete(chosenColumns[i]);chosenColumns.splice(i,1)}drawPeople();drawColumns();drawOrder();count()}
  for(const ctl of [scope,shift,profession,workplace,category])ctl.onchange=refresh;for(const ctl of [horizon,scale])ctl.onchange=count;pSearch.oninput=drawPeople;sSearch.oninput=drawColumns;refresh();
  const pAll=btn('Выбрать всех по поиску',()=>{for(const p of people.filter(x=>match(pSearch,x.name,x.position)))chosenPeople.add(p.person_id);drawPeople();count()}),pClear=btn('Очистить сотрудников',()=>{chosenPeople.clear();drawPeople();count()}),sAll=btn('Выбрать СОП по поиску',()=>{for(const x of options.filter(x=>match(sSearch,x.title,x.skill)))chooseColumn(x);drawColumns();drawOrder();count()}),sClear=btn('Очистить столбцы',()=>{chosenColumns.splice(0);targets.clear();drawColumns();drawOrder();count()});
  function checked(){const x=selection();invariant(x.roster.length&&x.columns.length&&x.roster.length<=300&&x.columns.length<=150&&x.roster.length*x.columns.length<=12000,'Выберите 1–300 сотрудников, 1–150 навыков и до 12000 ячеек');invariant(horizon.value&&horizon.value>=day,'Цель не может быть раньше исходного среза');return x}
  function showPreview(){try{const x=checked(),base=matrixBaseline(db,x.roster,x.columns,scale.value,day),map=new Map(base.map(v=>[matrixKey(v.person_id,v.skill_id),v.value]));preview.replaceChildren(msg('Предпросмотр (до 12 строк). Пустые и несопоставимые факты не превращаются в нули.'),tableOf(['ФИО','Должность',...x.columns.map(v=>v.title)],x.roster.slice(0,12).map(p=>[p.name,p.position,...x.columns.map(v=>{const actual=v.skill_id?map.get(matrixKey(p.person_id,v.skill_id)):null;return (actual??'—')+(targets.get(v.key)?' → '+targets.get(v.key):'')})])),msg('Всего '+x.roster.length+' сотрудников. Указанные цели создадут планы развития только при дефиците.'))}catch(e){c.notify(e.message,true)}}
  async function saveMatrix(){
   const x=checked();invariant(name.value.trim()&&code.value.trim()&&author.value,'Заполните код, название и разработчика');const existing=one(db,"SELECT id FROM competency_matrix WHERE code=? AND state='active'",[code.value.trim()]);
   if(existing&&!confirm('Создать новую версию матрицы '+code.value.trim()+'? Старый состав и срез сохранятся.'))return 'Отменено';
   const events=[];let scaleId=scale.value;
   if(!scaleId){const version=Math.max(0,...list(db,'rating_scale').filter(x=>x.name===SCALE_NAME).map(x=>Number(x.version_no)))+1;const e=event('rating_scale',{name:SCALE_NAME,version_no:String(version),levels:CORPORATE_LEVELS});scaleId=e.entity_id;events.push(e)}
   let cat=one(db,"SELECT id FROM skill_category WHERE name=? AND archived=0",['Операции по СОП'])?.id;
   const columns=x.columns.map(v=>{let id=v.skill_id;if(!id){if(!cat){const e=event('skill_category',{name:'Операции по СОП'});cat=e.entity_id;events.push(e)}const doc=one(db,'SELECT title FROM document WHERE id=?',[v.document_id]),e=event('skill',{category_id:cat,operation_id:v.operation_id,name:doc.title});events.push(e);id=e.entity_id}return {skill_id:id,document_id:v.document_id,title:v.title}});
   const baseline=matrixBaseline(db,x.roster,columns,scaleId,day),e=event('competency_matrix',{code:code.value.trim(),title:name.value.trim(),author_id:author.value,unit_id:nullable(scope.value),shift_id:nullable(shift.value),scale_id:scaleId,base_on:day,target_on:horizon.value,roster:x.roster,columns,baseline});events.push(e);
   const projection=matrixProjection(db,{roster:x.roster,columns,scale_id:scaleId,target_on:horizon.value,baseline},day);let goalCount=0;
   for(const p of x.roster){const planned=columns.map((v,i)=>({v,level:Number(targets.get(x.columns[i].key)),cell:projection.cells.get(matrixKey(p.person_id,v.skill_id))})).filter(g=>g.level>0&&(g.cell.actual??0)<g.level&&(g.cell.explicit??0)<g.level);if(!planned.length)continue;
    const plan=event('development_plan',{person_id:p.person_id,title:'Развитие по матрице '+name.value.trim(),start_on:day,due_on:horizon.value});events.push(plan);
    for(const g of planned){events.push(event('development_goal',{plan_id:plan.entity_id,skill_id:g.v.skill_id,scale_id:scaleId,target_level:g.level,title:'Освоить: '+g.v.title,due_on:horizon.value}));goalCount++}
   }
   invariant(events.length+ws.pending.length<=2000,'Слишком много изменений за один раз. Уменьшите выборку или сначала опубликуйте очередь.');
   if(goalCount&&!confirm('Создать матрицу и '+goalCount+' целей развития? Фактические оценки не изменятся.'))return 'Отменено';
   await ws.applyContentEvents(events,readContent);route={page,matrixId:e.entity_id};return 'Матрица сохранена. Целей развития создано: '+goalCount+'. Ожидает публикации.'
  }
  const base=date('matrix_base_date',day);base.readOnly=true;
  return stack(pane(previous?'Новая версия матрицы':'Конструктор матрицы компетенций',back(),msg('Выберите подразделение, сотрудников и СОП. Если у действующего СОП нет навыка, он создаётся при сохранении. Укажите порядок сложности и, при необходимости, целевые уровни.'),grid(f('Код матрицы',code),f('Название',name),author.element,f('Подразделение',scope),f('Смена',shift),f('Профессия',profession),f('Шкала',scale),f('Исходный срез',base),f('Целевое состояние',horizon)),row(...[[30,'Месяц'],[90,'Квартал'],[180,'Полгода'],[365,'Год']].map(([d,label])=>btn(label,()=>{horizon.value=plusDays(day,d);count()})))),pane('2. Сотрудники',pSearch,row(pAll,pClear),add(el('div',undefined,'matrix-choice-list'),pBox)),pane('3. СОП и навыки',grid(f('Рабочее место',workplace),f('Категория навыков',category)),sSearch,row(sAll,sClear),add(el('div',undefined,'matrix-choice-list'),sBox)),pane('4. Порядок и цели',msg('Цель в строке применяется к выбранным сотрудникам, только если ещё не достигнута и нет равной или более высокой открытой цели.'),ordered),pane('5. Предпросмотр и сохранение',counts,row(btn('Предпросмотр',showPreview),action('Сохранить матрицу',()=>run(saveMatrix))),preview))
 }
 function matrixDetail(record){
  const cfg=matrixFromRecord(record),projection=matrixProjection(db,cfg,day),filter=check('matrix_only_employee','Только выбранный сотрудник'),focus=route.personId||'',search=searchInput('matrix_saved_search'),out=el('div');filter.input.checked=!!focus;
  const col=route.skillId&&cfg.columns.find(x=>x.skill_id===route.skillId),who=cfg.roster.find(x=>x.person_id===focus);
  const total=(a,k)=>a[k+'Count']?String(a[k]):'—';
  const personLink=r=>btn(r.name,()=>c.openEmployee(r.person_id),'matrix-person-link');
  const backMatrix=()=>goLocal({matrixId:record.id,personId:focus});
  if(col&&who){
   const x=projection.cells.get(matrixKey(who.person_id,col.skill_id)),goal=select('matrix_cell_target',Object.entries(LEVEL_TEXT).map(([v,t])=>[v,v+' — '+t]),String(x.targetLevel||'')),due=date('matrix_cell_due',cfg.target_on>=day?cfg.target_on:plusDays(day,30));
   const root=pane(who.name+' · '+col.title,row(btn('К матрице',backMatrix),personLink(who)),msg('Исходный: '+(x.base??'—')+' · Текущий: '+(x.actual??'—')+' · Цель: '+(x.targetLevel??'—')+' · '+x.reason+' · '+x.admission));
   if(col.document_id)root.append(btn('Открыть СОП',()=>goDocument(col.document_id)));
   const rev=col.document_id&&one(db,"SELECT id FROM document_revision WHERE document_id=? AND state='effective'",[col.document_id]);
   if(record.state==='active'&&!one(db,'SELECT archived FROM person WHERE id=?',[who.person_id])?.archived)root.append(row(btn('Назначить обучение',()=>go('twi',{mode:'new',traineeId:who.person_id,skillId:col.skill_id,scaleId:cfg.scale_id,targetLevel:x.targetLevel??2,revisionId:rev?.id,reason:'Развитие компетенции по матрице '+cfg.code}),'primary',!rev),btn('История компетенции',()=>goLocal({mode:'overview',personId:who.person_id,skillId:col.skill_id})),btn('Планы развития',()=>go('development',{mode:'new',personId:who.person_id}))),grid(f('Целевой уровень',goal),f('Срок',due)),action('Поставить цель развития',()=>run(async()=>{const level=Number(goal.value);invariant(level>=1&&level<=4&&due.value>=day,'Укажите уровень и срок');invariant((x.actual??0)<level,'Уровень уже достигнут');invariant(!personalTargets(db,day,due.value).some(g=>g.person_id===who.person_id&&g.skill_id===col.skill_id&&g.scale_id===cfg.scale_id&&g.target_level>=level),'Есть открытая цель не ниже выбранной');const p=event('development_plan',{person_id:who.person_id,title:'Развитие по матрице '+cfg.title,start_on:day,due_on:due.value}),g=event('development_goal',{plan_id:p.entity_id,skill_id:col.skill_id,scale_id:cfg.scale_id,target_level:level,title:'Освоить: '+col.title,due_on:due.value});await ws.applyContentEvents([p,g],readContent);return 'Цель добавлена в план развития.'})));
   return root
  }
  function draw(){
   const selected=cfg.roster.filter(r=>(!filter.input.checked||!focus||r.person_id===focus)&&(r.name+' '+r.position).toLocaleLowerCase('ru-RU').includes(search.value.trim().toLocaleLowerCase('ru-RU')));
   const t=el('table',undefined,'corporate-matrix'),head=el('thead'),tr=el('tr');
   for(const [i,label] of ['№','ФИО','Должность'].entries()){const th=el('th',label,'matrix-fixed matrix-fixed-'+i);th.rowSpan=2;tr.append(th)}
   for(const v of cfg.columns){const th=add(el('th',undefined,'matrix-skill-head'),el('span',v.title));th.rowSpan=2;th.title=v.title;tr.append(th)}
   const grouped=el('th','Компетенции сотрудника');grouped.colSpan=3;const need=el('th','Потребность','matrix-need');need.rowSpan=2;tr.append(grouped,need);
   const dates=el('tr');for(const d of [cfg.base_on,day,cfg.target_on])dates.append(el('th',d));head.append(tr,dates);t.append(head);
   const body=el('tbody');for(const [i,r] of selected.entries()){
    const line=el('tr'),a=projection.byPerson.get(r.person_id);line.append(el('td',String(i+1),'matrix-fixed matrix-fixed-0'),add(el('td',undefined,'matrix-fixed matrix-fixed-1'+(r.instructor?' matrix-instructor':'')),personLink(r)),el('td',r.position||'—','matrix-fixed matrix-fixed-2'));
    for(const v of cfg.columns){const x=projection.cells.get(matrixKey(r.person_id,v.skill_id)),b=btn(x.actual===null?'—':String(x.actual),()=>goLocal({matrixId:record.id,personId:r.person_id,skillId:v.skill_id}),'matrix-value'+(x.actual!==null?' matrix-level-'+x.actual:'')+((x.targetLevel!==null&&(x.actual===null||x.need>0))?' matrix-deficit':''));b.title=[v.title,'Факт: '+(x.actual??'не подтверждён'),'Цель: '+(x.targetLevel??'—'),x.reason,x.admission].filter(Boolean).join(' · ');b.setAttribute('aria-label',r.name+' · '+v.title+' · '+b.title);line.append(add(el('td',undefined,'matrix-value-cell'),b))}
    for(const k of ['base','actual','target'])line.append(el('td',total(a,k),'matrix-total'));line.append(el('td',total(a,'need')+(a.unknown?' + ?'+a.unknown:''),'matrix-need'));body.append(line)
   }t.append(body);
   const footer=el('tfoot');for(const [label,k] of [['Состояние на '+cfg.base_on,'base'],['Текущее состояние '+day,'actual'],['Целевое состояние '+cfg.target_on,'target'],['Потребности процесса','need']]){const tr=el('tr',undefined,k==='need'?'matrix-need':'');const labelCell=el('th',label);labelCell.colSpan=3;tr.append(labelCell);for(const v of cfg.columns){const a=projection.bySkill.get(v.skill_id);tr.append(el('td',total(a,k)+(k==='need'&&a.unknown?' + ?'+a.unknown:'')))}const sum=el('td',total(projection.total,k));sum.colSpan=4;tr.append(sum);footer.append(tr)}t.append(footer);
   out.replaceChildren(msg('Показано '+selected.length+' из '+cfg.roster.length+' сотрудников. Нижние итоги относятся ко всей матрице.'),add(el('div',undefined,'tablewrap corporate-matrix-wrap'),t))
  }
  search.oninput=draw;filter.input.onchange=draw;draw();
  const legend=row(...Object.entries(LEVEL_TEXT).map(([v,label])=>add(el('span',undefined,'matrix-legend'),el('span',v,'matrix-level-'+v),el('span',label))),el('span','Красная рамка — потребность; ? — цель без подтверждённого факта','muted'));
  return stack(pane(cfg.title,row(btn('К списку матриц',()=>goLocal()),action('Новая версия',()=>goLocal({mode:'builder',copyId:record.id})),btn('Скачать матрицу XLSX',()=>run(async()=>saveWorkbook('Матрица-'+cfg.code,matrixWorkbook(ExcelJS,{...cfg,author_name:n('person',cfg.author_id)},projection,day)),{save:false}))),msg(cfg.code+' · v'+cfg.version_no+' · '+statuses[cfg.state]+' · '+n('org_unit',cfg.unit_id)+' · '+n('work_shift',cfg.shift_id)+' · разработал: '+n('person',cfg.author_id)),legend,row(search,...(focus?[filter.element]:[])),out,msg('Оценки — подтверждённые факты в корпоративской шкале. Для исходного среза используются сохранённые значения. Текущая квалификация не равна допуску.')),pane('Требования и покрытие',requirementsPanel(),coveragePanel(matrixData(db,day))))
 }
 function matrixPage(){
  const records=rows(db,'SELECT * FROM competency_matrix ORDER BY code,version_no DESC');
  if(route.mode==='overview')return legacyMatrixPage();
  if(route.mode==='builder')return matrixBuilder(records.find(x=>x.id===route.copyId)?matrixFromRecord(records.find(x=>x.id===route.copyId)):null);
  const record=records.find(x=>x.id===route.matrixId);if(record)return matrixDetail(record);
  const items=route.personId?records.filter(x=>matrixFromRecord(x).roster.some(r=>r.person_id===route.personId)):records;
  const root=pane('Матрицы компетенций',msg('Форма приложения 6. Состав и порядок СОП сохраняются по версиям, фактические уровни и потребности обновляются из общей базы.'),row(action('Создать матрицу',()=>goLocal({mode:'builder',personId:route.personId})),btn('Общая матрица всех навыков',()=>goLocal({mode:'overview'}))),tableOf(['Код','Матрица','Подразделение','Смена','Сотрудников','СОП / навыков','Целевая дата','Версия / состояние',''],items.map(v=>{const x=matrixFromRecord(v);return [v.code,v.title,n('org_unit',v.unit_id),n('work_shift',v.shift_id),x.roster.length,x.columns.length,v.target_on,'v'+v.version_no+' · '+statuses[v.state],btn('Открыть матрицу',()=>goLocal({matrixId:v.id,personId:route.personId}),'primary')]})));
  if(!items.length)root.append(msg('Нет сохранённых матриц. Создайте первую или откройте общий обзор существующих оценок.'));
  return root
 }
 function legacyMatrixPage(){
  const m=matrixData(db,day),q=searchInput('matrix_search'),unit=ref('org_unit','matrix_unit','','Все подразделения'),profession=ref('profession','matrix_profession','','Все профессии'),shift=ref('work_shift','matrix_shift','','Все смены'),workplace=ref('workplace','matrix_workplace','','Все рабочие места'),category=ref('skill_category','matrix_category','','Все категории'),transpose=check('matrix_transpose','Навыки строками'),gaps=check('matrix_gaps','Только сотрудники с разрывами'),out=el('div');
  const operations=new Map(rows(db,'SELECT id,workplace_id FROM operation').map(o=>[o.id,o.workplace_id]));let personPage=0,skillPage=0;
  const scales=list(db,'rating_scale').filter(x=>!x.archived&&x.name===SCALE_NAME&&x.levels===CORPORATE_LEVELS),pointScale=select('matrix_points_scale',scales.map(x=>[x.id,x.name+' · v'+x.version_no]),scales[0]?.id||'','Выберите корпоративскую шкалу'),horizon=date('matrix_horizon',plusDays(day,30)),totals=el('div');
  function cell(p,s,forExport=false){
   const x=m.cells.get(p.id+':'+s.id),fact=x.fact,actual=!fact?'Не оценено':fact.observation_state==='rated'?String(fact.level):observationLabels[fact.observation_state],target=x.goal?' / цель '+x.goal.required_level:'';
   const label=actual+target+(fact?.observation_state==='rated'&&!x.valid?' · срок истёк':'')+(!x.same&&fact?' · другая шкала':'')+(fact&&!x.revisionCurrent?' · прежняя редакция':'')+(x.admission?' · '+x.admission.status:'');
   if(forExport)return label;
   const b=btn(label,()=>goLocal({personId:p.id,skillId:s.id}),'lc4-matrix-cell'+(x.gap?' lc4-gap':x.qualified?' lc4-met':''));b.title=label;return b
  }
  function subset(){let people=m.people.filter(p=>(!unit.value||p.unit_id===unit.value)&&(!profession.value||p.profession_id===profession.value)&&(!shift.value||p.shift_id===shift.value)&&[p.display_name,p.employee_code].join(' ').toLocaleLowerCase('ru-RU').includes(q.value.trim().toLocaleLowerCase('ru-RU'))),skills=m.skills.filter(s=>(!category.value||s.category_id===category.value)&&(!workplace.value||operations.get(s.operation_id)===workplace.value));if(gaps.input.checked)people=people.filter(p=>skills.some(s=>m.cells.get(p.id+':'+s.id).gap));return {people,skills}}
  function draw(){const all=subset();if(!all.people.length||!all.skills.length){out.replaceChildren(msg('Нет сотрудников или навыков по выбранным фильтрам. Создайте записи в справочниках.'));totals.replaceChildren(msg('Нет данных для выбранных фильтров.'));return}
   personPage=Math.min(personPage,Math.floor((all.people.length-1)/40));skillPage=Math.min(skillPage,Math.floor((all.skills.length-1)/20));
   const people=all.people.slice(personPage*40,personPage*40+40),skills=all.skills.slice(skillPage*20,skillPage*20+20);
   const transposeOn=transpose.input.checked,heads=transposeOn?['Навык',...people.map(p=>p.display_name)]:['Сотрудник',...skills.map(s=>s.name)],data=transposeOn?skills.map(s=>[s.name,...people.map(p=>cell(p,s))]):people.map(p=>[p.display_name,...skills.map(s=>cell(p,s))]);
   const table=tableOf(heads,data);table.classList.add('lc4-matrix');
   const pager=row(msg('Сотрудники '+(personPage*40+1)+'–'+(personPage*40+people.length)+' из '+all.people.length),btn('‹',()=>{personPage--;draw()},'',personPage===0),btn('›',()=>{personPage++;draw()},'',personPage*40+people.length>=all.people.length),msg('Навыки '+(skillPage*20+1)+'–'+(skillPage*20+skills.length)+' из '+all.skills.length),btn('‹',()=>{skillPage--;draw()},'',skillPage===0),btn('›',()=>{skillPage++;draw()},'',skillPage*20+skills.length>=all.skills.length));
   const download=btn('Скачать всю выборку XLSX',()=>run(async()=>{invariant(all.people.length*all.skills.length<=200000,'Уточните фильтры для экспорта');const headers=transposeOn?['Навык',...all.people.map(p=>p.display_name)]:['Сотрудник',...all.skills.map(s=>s.name)];await exportTable('Матрица-компетенций',headers,transposeOn?all.skills.map(s=>[s.name,...all.people.map(p=>cell(p,s,true))]):all.people.map(p=>[p.display_name,...all.skills.map(s=>cell(p,s,true))]));return 'Отчёт сформирован'},{save:false}));
   out.replaceChildren(pager,table,download);drawTotals(all)
  }
  function drawTotals(all){if(!pointScale.value){totals.replaceChildren(msg('Выберите или создайте точную корпоративскую шкалу 1–4 для суммирования. Другие шкалы не смешиваются.'));return}if(!horizon.value||horizon.value<day){totals.replaceChildren(msg('Целевая дата должна быть не раньше текущей.','warn'));return}const p=matrixPoints(m,all.people,all.skills,pointScale.value,personalTargets(db,day,horizon.value)),labels=['Объект','Факт, баллы','Оценено','Цель, баллы','Целей','Известный разрыв','Целей без факта'];const line=(name,x)=>[name,x.rated?x.actual:'—',x.rated,x.targeted?x.target:'—',x.targeted,x.targeted?x.need:'—',x.unknown];const persons=all.people.map(x=>line(x.display_name,p.byPerson.get(x.id))),skills=all.skills.map(x=>line(x.name,p.bySkill.get(x.id)||{actual:0,rated:0,target:0,targeted:0,need:0,unknown:0}));totals.replaceChildren(msg('Суммы по всей отфильтрованной выборке. Цель включает действующие требования и открытые персональные цели до '+horizon.value+'. Неподтверждённое/неоценённое не равно нулю. Сумма не заменяет число допущенных работников.'),pane('Компетенции и потребности сотрудников',tableOf(labels,persons),exportButton('Потребности-сотрудников',labels,persons)),pane('Состояние компетенций и потребности процесса',tableOf(labels,skills),exportButton('Потребности-процесса',labels,skills)))}
  pointScale.onchange=horizon.onchange=()=>drawTotals(subset());
  const reset=()=>{personPage=0;skillPage=0;draw()};for(const control of [unit,profession,shift,workplace,category,transpose.input,gaps.input])control.onchange=reset;q.oninput=reset;draw();
  if(route.personId&&route.skillId){
   const p=m.people.find(x=>x.id===route.personId),s=m.skills.find(x=>x.id===route.skillId);if(p&&s){const x=m.cells.get(p.id+':'+s.id),history=rows(db,"SELECT i.*,a.assessed_at,a.evaluator_id,a.standard_revision_id,a.assignment_id FROM assessment_item i JOIN assessment_session a ON a.id=i.session_id WHERE a.person_id=? AND i.skill_id=? AND a.state='confirmed' ORDER BY a.assessed_at DESC,a.recorded_at DESC",[p.id,s.id]);return pane(p.display_name+' · '+s.name,back(),msg(cell(p,s,true)),table(['Дата','Шкала','Уровень / состояние','Оценщик','СОП',''],history.map(h=>[h.assessed_at,n('rating_scale',h.scale_id),h.observation_state==='rated'?h.level:observationLabels[h.observation_state],n('person',h.evaluator_id),revLabel(h.standard_revision_id),h.assignment_id?btn('Открыть обучение',()=>go('twi',{id:h.assignment_id,tab:'practice'})):'—'])),row(btn('Назначить обучение',()=>go('twi',{mode:'new',traineeId:p.id,skillId:s.id,scaleId:x.goal?.scale_id,targetLevel:x.goal?.required_level,revisionId:revs().find(r=>r.operation_id===s.operation_id)?.id,reason:'Развитие компетенции'})),btn('План развития',()=>go('development',{mode:'new',personId:p.id}))))}
  }
  const scaleSetup=action('Создать шкалу 1–4',()=>run(async()=>{
   invariant(!scales.length,'Точная корпоративская шкала уже создана');const previous=list(db,'rating_scale').filter(x=>x.name===SCALE_NAME);const version=Math.max(0,...previous.map(x=>Number(x.version_no)))+1;
   ws.edit('rating_scale',null,{name:SCALE_NAME,version_no:String(version),levels:CORPORATE_LEVELS});return 'Корпоративская шкала 1–4 создана отдельной версией. Прежние оценки не преобразованы.'
  }),'',scales.length>0);
  return stack(pane('Матрица компетенций',msg('Текущий подтверждённый уровень и целевой уровень показаны отдельно. Не оценено, неприменимо, другая шкала, срок и допуск не смешиваются.'),row(btn('Навыки',()=>go('skill')),btn('Шкалы',()=>go('rating_scale')),scaleSetup),grid(f('Подразделение',unit),f('Профессия',profession),f('Смена',shift),f('Рабочее место',workplace),f('Категория навыков',category),f('Поиск сотрудника',q)),row(transpose.element,gaps.element),out),pane('Суммарные компетенции',grid(f('Версия корпоративской шкалы',pointScale),f('Целевое состояние на дату',horizon)),totals),pane('Требования и покрытие',requirementsPanel(),coveragePanel(m)))
 }
 function journalPage(){
  const a=asgns(),facts=rows(db,'SELECT * FROM training_session WHERE stage_code IS NOT NULL ORDER BY held_at DESC,recorded_at DESC'),q=searchInput('journal_search'),out=el('div'),heads=['Дата / время','Инструктор','Обучаемый','СОП','Этап','Минут','Результат'];
  const line=(x)=>{const t=a.find(y=>y.id===x.assignment_id),names=JSON.parse(t?.recorded_names_json||'{}');return [x.held_at,names.instructor||n('person',x.mentor_id),names.trainee||n('person',t?.trainee_id),revLabel(t?.sop_revision_id),JSON.parse(x.steps_json).label,x.duration_minutes,resultLabels[x.result]]};
  filterList(out,q,facts,x=>line(x).join(' '),items=>table([...heads,''],items.map(x=>[...line(x),btn('Открыть',()=>go('instruction',{id:x.assignment_id,tab:'instruction'}),'primary')])));
  return pane('Журнал заданий и проведённых инструктажей',msg('Это факты из назначений, отдельный ввод не требуется. Повторения являются самостоятельными записями.'),q,out,productionExport(()=>a.filter(x=>{const text=q.value.trim().toLocaleLowerCase('ru-RU');return !text||assignmentName(x).toLocaleLowerCase('ru-RU').includes(text)||facts.some(y=>y.assignment_id===x.id&&line(y).join(' ').toLocaleLowerCase('ru-RU').includes(text))}),'Журнал-задание работы инструкторов TWI'),exportButton('Журнал-инструктажей',heads,facts.map(line)))
 }
 function retrainingPage(){
  const old=asgns().filter(a=>a.state!=='cancelled'&&!sameRevision(a)),m=matrixData(db,day);
  const gaps=[];for(const p of m.people)for(const s of m.skills){const x=m.cells.get(p.id+':'+s.id);if(x.gap)gaps.push({p,s,x})}
  return stack(pane('Изменения СОП — требуется анализ влияния',msg('Прежние факты, уровни и решения сохраняются. Новое назначение создаётся по явному решению, автоматически старый допуск не аннулируется.'),table(['Обучаемый','Прежний СОП','Состояние обучения','Действующая редакция',''],old.map(a=>{const r=revs().find(x=>x.document_id===currentStandard(db,a.sop_revision_id)?.document_id);return [n('person',a.trainee_id),revLabel(a.sop_revision_id),stateLabel(a),r?revLabel(r.id):'Нет действующего СОП',row(btn('История',()=>go('twi',{id:a.id})),...(r?[action('Назначить переобучение',()=>go('twi',{mode:'new',traineeId:a.trainee_id,revisionId:r.id,skillId:a.skill_id,scaleId:a.scale_id,targetLevel:a.target_level,reason:'Изменение редакции СОП: '+revLabel(a.sop_revision_id)}))]:[]))]}))),
   pane('Разрывы компетенций',table(['Сотрудник','Навык','Цель','Факт',''],gaps.map(({p,s,x})=>[p.display_name,s.name,x.goal.required_level,x.fact?.level??'Не оценено',action('Запланировать развитие',()=>go('development',{mode:'new',personId:p.id}))]))))
 }
 function developmentPage(){
  const items=rows(db,'SELECT * FROM development_plan ORDER BY due_on,id');
  if(route.mode==='new'){
   const who=person('development_person','Сотрудник',route.personId||''),title=fieldInput('development_title'),start=date('development_start'),due=date('development_due');
   return pane('Новый план развития',back(),grid(who.element,f('Название / цель',title),f('Начало',start),f('Срок',due)),save('Создать план развития','development_plan',()=>({person_id:who.value,title:title.value,start_on:start.value,due_on:due.value}),null,id=>{route={page,id}}))
  }
  const plan=items.find(x=>x.id===route.id);if(plan){
   const goals=rows(db,'SELECT * FROM development_goal WHERE plan_id=? ORDER BY due_on,id',[plan.id]),root=pane(plan.title+' · '+n('person',plan.person_id),back(),msg(statuses[plan.state]+' · '+plan.start_on+' — '+plan.due_on),table(['Цель','Навык','Уровень','Срок','Состояние',''],goals.map(g=>{const t=JSON.parse(g.target_json);return [g.title,n('skill',g.skill_id),t.target_level??'—',g.due_on,g.state==='open'?'Открыта':statuses[g.state]||g.state,g.state==='open'?row(closeRecord('Завершить','development_goal',g,'finish'),closeRecord('Отменить','development_goal',g,'cancel')):'—']})));
   if(plan.state==='active'){const title=fieldInput('goal_title'),skill=ref('skill','goal_skill','','— Без навыка —'),target=scaleFields('goal_target'),due=date('goal_due',plan.due_on);root.append(pane('Новая цель',grid(f('Цель',title),f('Навык',skill),f('Срок',due)),target.element,save('Добавить цель','development_goal',()=>({plan_id:plan.id,skill_id:nullable(skill.value),scale_id:skill.value?nullable(target.scale.value):null,target_level:skill.value&&target.level.value!==''?Number(target.level.value):null,title:title.value,due_on:due.value}))),closeRecord('Завершить план','development_plan',plan,'finish'),closeRecord('Отменить план','development_plan',plan,'cancel'))}return root
  }
  return pane('Планы развития',action('Создать план развития',()=>goLocal({mode:'new'})),table(['Сотрудник','Цель','Срок','Статус',''],items.map(x=>[n('person',x.person_id),x.title,x.due_on,statuses[x.state],btn('Открыть',()=>goLocal({id:x.id}),'primary')])))
 }
 function myPlan(){
  const actor=person('my_plan_person','Сотрудник',route.personId||'',{onChange:id=>{route.personId=id;render()}}),id=actor.value,items=id?asgns().filter(a=>[a.trainee_id,a.mentor_id,a.supervisor_id,a.assigned_by].includes(id)):[],programs=id?enrollmentList().filter(x=>[x.trainee_id,x.mentor_id,x.manager_id].includes(id)):[];
  return stack(pane('Мой план',msg('Выберите сотрудника. Это фильтр рабочих записей, не вход в систему и не ограничение прав доступа.'),actor.element,id?assignmentRows(items):msg('Выберите сотрудника для просмотра назначений.')),pane('Программы',table(['Программа','Обучаемый','Срок','Статус',''],programs.map(x=>[one(db,'SELECT title FROM training_program WHERE id=?',[x.program_id])?.title,n('person',x.trainee_id),x.due_on,statuses[x.state],btn('Открыть',()=>go(enrollmentPage(x.id),{enrollmentId:x.id}),'primary')]))))
 }
 function methodView(code,method){
  const existing=trainingMethods(db,code),out=pane('Версии методики',msg('Встроенная форма используется до первого сохранения. Импорт новой версии не изменяет старые оценки. Допустимо 1–100 критериев. Шкала определяется видом методики.'));
  const sample=existing.find(m=>m.state==='active');const data=sample?JSON.parse(sample.methodology_json):method;
  out.append(tableOf(['№','Раздел','Критерий'],data.criteria.map(q=>[q.code,q.section,q.question])));
  const importMethod=async p=>{validateMentorMethod(p,method.format);if(!confirm(p.title+' · '+p.criteria.length+' критериев. Активировать новую версию?\n\n'+p.criteria.map(q=>q.code+'. '+q.question).join('\n')))return 'Импорт отменён';await write('checklist_version',p);return 'Методика зарегистрирована'};
  out.append(row(action('Загрузить новую методику JSON',()=>pick('.json',importMethod,128000)),action('Загрузить методику XLSX',()=>{
   const input=el('input');input.type='file';input.accept='.xlsx';input.onchange=()=>{const file=input.files?.[0];if(file)run(async()=>{invariant(file.size<=12*1024*1024,'Файл слишком большой');const bytes=new Uint8Array(await file.arrayBuffer()),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
    const generic=book.getWorksheet('Критерии'),original=code===SELF_CODE?book.getWorksheet('Самооценка'):null;
    let criteria;if(generic)criteria=criteriaFromTabularSheet(generic);else if(original){criteria=Array.from({length:20},(_,i)=>({code:Number(original.getCell(i+5,1).text),section:'Самооценка',question:original.getCell(i+5,2).text.trim()}))}else throw Error('Нужен лист «Критерии»: №, Раздел, Критерий');
    return importMethod({format:method.format,title:file.name.slice(0,200),source_sha256:await sha256(bytes),criteria})
   })};input.click()
  }),btn('Скачать JSON действующей методики',()=>run(async()=>{const payload={...data};if(!sample&&code===AUDIT_CODE)payload.source_sha256=await sha256(canonical(payload.criteria));downloadBytes('Методика-'+code+'.json',new TextEncoder().encode(JSON.stringify(payload,null,2)));return 'Методика сформирована'},{save:false}))));
  for(const m of existing){const p=JSON.parse(m.methodology_json);const d=el('details');d.append(el('summary','v'+m.version_no+' · '+p.title+' · '+p.criteria.length+' критериев · '+(m.state==='active'?'Действует':'История')),tableOf(['№','Раздел','Критерий'],p.criteria.map(q=>[q.code,q.section,q.question])));out.append(d)}return out
 }
 function answerControls(criteria,levels,prefix){
  const values=criteria.map(q=>({q,input:select(prefix+'_'+q.position,Object.entries(levels).map(([k,v])=>[k,k+' — '+v]),'','Не оценено'),note:fieldInput(prefix+'_note_'+q.position)}));
  const progress=msg('Оценено 0 / '+criteria.length);for(const x of values)x.input.onchange=()=>{progress.textContent='Оценено '+values.filter(v=>v.input.value!=='').length+' / '+criteria.length};
  return {values,table:stack(tableOf(['№','Раздел','Критерий','Оценка','Комментарий'],values.map(x=>[x.q.position,x.q.section_code,x.q.question,x.input,x.note])),progress),responses:()=>values.map(x=>({criterion_id:x.q.id,value:x.input.value===''?null:Number(x.input.value),note:x.note.value}))}
 }
 function methodDraft(code,builtin){
  const m=trainingMethods(db,code).find(x=>x.state==='active'),created=m?null:event('checklist_version',builtin),id=m?.id||created.entity_id;
  return {id,created,criteria:m?practicalCriteria(db,id):previewCriteria(builtin,id),label:m?'v'+m.version_no:'Встроенная форма'}
 }
 function saveWithMethod(label,draft,type,payload,done){
  return action(label,()=>run(async()=>{const e=event(type,payload());await ws.applyContentEvents([...(draft.created?[draft.created]:[]),e],readContent);done?.(e.entity_id);return 'Запись сохранена. Ожидает публикации базы.'}))
 }
 function selfPage(){
  const items=rows(db,'SELECT * FROM mentor_self_evaluation ORDER BY evaluated_on DESC,recorded_at DESC');
  const detail=items.find(x=>x.id===route.id);
  if(detail){const criteria=practicalCriteria(db,detail.method_id),answers=JSON.parse(detail.responses_json),lines=criteria.map((q,i)=>[q.position,q.question,answers[i]?.value??'—',answers[i]?.note||'']);return pane('Самооценка · '+detail.person_name,back(),msg(detail.evaluated_on+' · '+detail.place),tableOf(['№','Критерий','Уровень','Комментарий'],lines),msg(detail.feedback),exportButton('Самооценка-'+detail.id.slice(0,8),['№','Критерий','Уровень','Комментарий'],lines))}
  if(route.mode==='new'){
   const draft=methodDraft(SELF_CODE,BUILTIN_SELF),when=date('self_date'),who=person('self_person','Инструктор / наставник','',{allowed:['instructor','mentor'],at:()=>when.value}),place=fieldInput('self_place'),feedback=note('self_feedback'),answers=answerControls(draft.criteria,SELF_LEVELS,'self_value');
   return pane('Самооценка наставника',back(),msg(draft.label+' · '+draft.criteria.length+' критериев. Шкала 1–5; не смешивается с матрицей 1–4.'),grid(who.element,f('Дата',when),f('Место',place)),answers.table,f('Анализ и обратная связь',feedback),saveWithMethod('Сохранить самооценку',draft,'mentor_self_evaluation',()=>({person_id:who.value,method_id:draft.id,evaluated_on:when.value,place:place.value,responses:answers.responses(),feedback:feedback.value}),id=>{route={page,id}}))
  }
  return stack(pane('Самооценка инструкторов и ВТ',action('Новая самооценка',()=>goLocal({mode:'new'})),table(['Сотрудник','Дата','Место','Итого',''],items.map(x=>{const v=JSON.parse(x.responses_json);return [x.person_name,x.evaluated_on,x.place,v.reduce((n,q)=>n+q.value,0)+' / '+(v.length*5),btn('Открыть',()=>goLocal({id:x.id}),'primary')]}))),methodView(SELF_CODE,BUILTIN_SELF))
 }
 // RC1 criteria come from the pinned baseline. Their fingerprint is calculated
 // from exact criterion content rather than the old 17-point DOCX.
 function auditPayload(){return {format:'lean-audit-checklist-v1',title:'Аудит 1-го уровня · RC1',source_sha256:'0'.repeat(64),criteria:RC1_CRITERIA.map(({rc1_id,...q})=>q)}}
 function auditPage(){
  const method=auditPayload(),items=rows(db,"SELECT * FROM audit_session WHERE assignment_id IS NOT NULL ORDER BY observed_at DESC,recorded_at DESC"),detail=items.find(x=>x.id===route.auditId);
  if(detail){
   const criteria=practicalCriteria(db,detail.version_id),answers=rows(db,'SELECT * FROM audit_response WHERE audit_id=?',[detail.id]),byId=new Map(answers.map(x=>[x.criterion_id,x])),lines=criteria.map(q=>[q.position,q.section_code,q.question,byId.get(q.id)?.response==='yes'?1:0,byId.get(q.id)?.note||'']);
   const source=JSON.parse(one(db,'SELECT methodology_json FROM checklist_version WHERE id=?',[detail.version_id]).methodology_json),recommendations=source.criteria.filter((q,i)=>lines[i][3]===0&&q.recommendation).map(q=>q.recommendation);
   const names=JSON.parse(detail.recorded_names_json);
   return pane('Аудит 1-го уровня · '+(names.mentor||n('person',detail.mentor_id)),back(),msg(detail.observed_at+' · '+revLabel(detail.standard_revision_id)+' · '+(detail.state==='void'?'Аннулирован':'Зафиксирован')),msg('Внутренний тренер: '+names.auditor+' · Обучаемый: '+names.trainee),msg('Результат: '+lines.reduce((n,x)=>n+x[3],0)+' / '+lines.length),tableOf(['№','Раздел','Критерий','Оценка','Комментарий'],lines),msg(detail.summary||''),...recommendations.map(x=>msg(x)),btn('Открыть назначение',()=>go('twi',{id:detail.assignment_id})),exportButton('Аудит-L1-'+detail.id.slice(0,8),['№','Раздел','Критерий','Оценка','Комментарий'],lines),...(detail.state==='final'?[closeRecord('Аннулировать аудит','audit_session',detail,'void')]:[msg(detail.void_reason||'')]))
  }
  if(route.mode==='new'){
   const available=asgns().filter(a=>a.state!=='cancelled'&&a.approval_json&&progressFor(db,a).facts.length),as=select('audit_assignment',available.map(a=>[a.id,assignmentName(a)]),route.assignmentId||''),session=select('audit_fact',[]),when=date('audit_date');
   const auditor=person('audit_actor','Внутренний тренер','',{at:()=>when.value,allowed:['instructor'],filter:p=>{const a=available.find(x=>x.id===as.value);return p.id!==a?.mentor_id&&p.id!==a?.trainee_id&&p.roles.some(r=>[r.name,r.code].some(v=>['internal_trainer','internal trainer','внутренний тренер','вт'].includes(String(v).toLocaleLowerCase('ru-RU').trim().replaceAll('-','_'))))}});
   const feedback=note('audit_feedback'),draft=methodDraft(AUDIT_CODE,method),answers=answerControls(draft.criteria,{0:'Нет',1:'Да'},'audit_value');
   const info=msg('Выберите назначение'),refresh=()=>{const a=available.find(x=>x.id===as.value);replaceOptions(session,select('audit_fact',a?progressFor(db,a).facts.map(v=>[v.id,v.held_at+' · '+JSON.parse(v.steps_json).label]):[]));info.textContent=a?'Инструктор: '+n('person',a.mentor_id)+' · Обучаемый: '+n('person',a.trainee_id)+' · '+revLabel(a.sop_revision_id):'Выберите назначение'};as.onchange=()=>{auditor.set('');refresh()};refresh();
   return pane('Аудит первого уровня',back(),msg('Оценка инструктора. Практическая оценка стажёра остаётся отдельным результатом.'),f('Назначение обучения',as),info,grid(f('Наблюдавшийся факт',session),auditor.element,f('Дата наблюдения',when)),answers.table,f('Обратная связь инструктору',feedback),action('Сохранить аудит',()=>run(async()=>{const a=available.find(x=>x.id===as.value);invariant(a,'Выберите назначение');if(draft.created)draft.created.payload={...method,source_sha256:await sha256(canonical(method.criteria))};const e=event('audit_session',{assignment_id:a.id,assignment_rev:a.rev,method_id:draft.id,auditor_id:auditor.value,session_id:session.value,observed_on:when.value,responses:answers.responses(),feedback:feedback.value});await ws.applyContentEvents([...(draft.created?[draft.created]:[]),e],readContent);route={page,auditId:e.entity_id};return 'Запись сохранена. Ожидает публикации базы.'})))
  }
  return stack(pane('Аудиты 1-го уровня',msg('Встроенная RC1: 7+4+4+5 критериев. Запись привязана к назначению и факту инструктажа. Расширенная аналитика и мобильный обмен RC1 — отдельная задача LC5.'),action('Новый аудит',()=>goLocal({mode:'new'})),table(['Дата','Инструктор','Обучаемый','СОП','Состояние',''],items.map(x=>[x.observed_at,n('person',x.mentor_id),n('person',x.trainee_id),revLabel(x.standard_revision_id),x.state==='void'?'Аннулирован':'Зафиксирован',btn('Открыть',()=>goLocal({auditId:x.id}),'primary')]))),methodView(AUDIT_CODE,method))
 }
 function formsPage(){
  const routes=FORM_CATALOG.map(([i,name,p,notes])=>[i,name,notes,btn('Открыть',()=>go(p),'primary')]);
  return stack(pane('Бланки и методики',msg('13 приложений стандарта связаны с рабочими разделами. Оценки и данные из примеров не перенесены. Новые редакции чек-листов загружайте в соответствующих разделах.'),tableOf(['№ приложения','Форма','Применение',''],routes)),pane('Встроенные чек-листы',...[['Оценка СОП',BUILTIN_SOP],['Практика стажёра',BUILTIN_PRACTICAL],['Самооценка',BUILTIN_SELF],['Аудит 1-го уровня',auditPayload()]].map(([label,p])=>{const d=el('details');d.append(el('summary',label+' · '+p.criteria.length+' критериев'),tableOf(['№','Раздел','Критерий'],p.criteria.map(q=>[q.code,q.section||'—',q.question])),btn('Скачать исходную методику JSON',()=>run(async()=>{const payload={...p};if(p.format==='lean-audit-checklist-v1')payload.source_sha256=await sha256(canonical(payload.criteria));downloadBytes('Методика-'+p.format+'.json',new TextEncoder().encode(JSON.stringify(payload,null,2)));return 'Методика сформирована'},{save:false})));return d})))
 }
 let content;
 if(page==='twi'||page==='instruction'||page==='practical'){
  const a=route.id?asgns().find(x=>x.id===route.id):null;
  if(a)content=assignmentCard(a);
  else if(route.mode==='new'&&page==='twi')content=assignmentForm();
  else if(page==='practical')content=stack(pane('Практические оценки и допуски',msg('Откройте назначение для регистрации практической проверки, уровня, ОТ, теории и решения.'),table(['Сотрудник','СОП','Практика','Компетенция','Допуск',''],asgns().map(a=>{const x=evidenceSummary(a);return [n('person',a.trainee_id),revLabel(a.sop_revision_id),x.p?conclusions[x.p.conclusion]:'Не оценено',x.q?'Зарегистрирована':'Нет',x.ad.status,btn('Открыть',()=>goLocal({id:a.id,tab:'practice'}),'primary')]}))),methodsPanel());
  else content=assignmentList()
 }else if(page==='programs'||page==='internship'){
  const n=route.enrollmentId&&one(db,'SELECT * FROM training_enrollment WHERE id=?',[route.enrollmentId]),p=route.programId&&one(db,'SELECT * FROM training_program WHERE id=?',[route.programId]);content=n?enrollmentCard(n):p?programCard(p):route.mode==='program'?programForm():registryPrograms()
 }else if(page==='mentoring')content=mentorPage();
 else if(page==='certification')content=certificatePage();
 else if(page==='appointments')content=appointmentPage();
 else if(page==='skills')content=matrixPage();
 else if(page==='journal')content=journalPage();
 else if(page==='retraining')content=retrainingPage();
 else if(page==='development')content=developmentPage();
 else if(page==='my_plan')content=myPlan();
 else if(page==='forms')content=formsPage();
 else if(page==='self_eval')content=selfPage();
 else if(page==='audit')content=auditPage();
 if(content){main.append(content);main.dataset.lc4Page=page}
}
