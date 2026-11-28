// Protected forms and corporate fact tables. All authority, status, scores and
// actor identities are determined by the server.
export function createTrainingUI({api,run,button,panel,table,el,input,select,form,value,note,render,discard,check,openLinked,downloadForm,assistant,mobilePanel,personCalendar,twiReport}){
 const opts=(items,field='name')=>items.map(x=>[x.id,x[field]]);
 const empty=()=>el('p','Нет доступных записей','muted');
 const exportLabels={entry:'Приложение 1 · план ввода XLSX',adaptation:'Приложение 2 · адаптация XLSX',safety_program:'Приложение 3 · ОТ XLSX',internship_program:'Приложение 4 · стажировка XLSX',preparation_pack:'Комплект приложений 2–4, 17 ZIP',training_plan:'План / факт XLSX',journal:'Журнал инструктажа XLSX',matrix:'Матрица XLSX',practical:'Чек-лист практики XLSX',bank:'Банк вопросов XLSX',audit:'Выписка аудита XLSX',self:'Самооценка XLSX',order:'Копия приказа DOCX',supplement:'Ходатайство XLSX',preparation:'Структура подготовки XLSX'};
 function appendExports(n,d){if(d.forms?.length){const row=el('div',undefined,'row');for(const kind of d.forms)row.append(button(exportLabels[kind]||'Скачать документ',()=>downloadForm(kind,d.id)));n.append(row)}}
 const state={planned:'Запланировано',in_progress:'В работе',completed:'Завершено',cancelled:'Отменено',active:'Действует',retired:'Архив',pass:'Пройдено',fail:'Не пройдено'};
 const dt=(name,label,day)=>{const x=input(name,label,'date');x.querySelector('input').value=day||'';return x};
 const optional=(name,label,items)=>{const x=select(name,label,[['','— Не выбрано —'],...items]);x.querySelector('select').required=false;return x};
 const number=(name,label,min,max,def='')=>{const x=input(name,label,'number'),n=x.querySelector('input');n.min=min;n.max=max;n.step=1;n.value=def;return x};
 const checked=(f,k)=>f.elements.namedItem(k).checked;
 function groups(title,fields,submit,fn){
  const det=el('details');det.append(el('summary',title),form(fields,submit,fn));return det;
 }
 function setContent(host,n){host.replaceChildren(n);host.scrollIntoView({block:'nearest'})}
 async function assignmentEditor(host,link=null,retrain=null,personId=null){
  const context=link||retrain;
  const root=await api('training/options'),out=el('div'),op=select('operation_id','Операция',[['','— Выберите операцию —'],...opts(root.operations)]);
  if(context){const field=op.querySelector('select');field.value=context.operation_id;field.disabled=true;if(!field.value)throw Error('Операция задания недоступна')}
  const load=button('Выбрать операцию',async()=>{
   const id=op.querySelector('select').value;if(!id)throw Error('Выберите операцию');
   const d=await api('training/options?operation_id='+encodeURIComponent(id));
   if(personId)d.people=d.people.filter(p=>p.id===personId);
   if(context){
    d.people=d.people.filter(p=>p.id===context.trainee_id);d.revisions=d.revisions.filter(r=>r.id===context.revision_id);d.skills=d.skills.filter(s=>s.id===context.skill_id);d.scales=d.scales.filter(s=>s.id===context.scale_id).map(s=>({...s,levels:s.levels.filter(l=>l.value===context.target_level)}));
   }
   if(!d.people.length||!d.mentors.length||!d.revisions.length||!d.skills.length||!d.scales.length||context&&!d.scales[0]?.levels.length){out.replaceChildren(el('p','Для операции нужны обучаемые, действующий инструктор с полномочием, СОП, навык и шкала.'));return}
   const revision=select('revision_id','Действующая редакция СОП',opts(d.revisions,'title'));
   const scenario=select('scenario','Основание обучения по TWI 03',[['','— Выберите —'],...Object.entries(d.scenarios||{})]);
   const scale=select('scale_id','Шкала',opts(d.scales)),level=select('target_level','Целевой уровень',[]);
   function levels(){level.querySelector('select').replaceChildren(...(d.scales.find(x=>x.id===scale.querySelector('select').value)?.levels||[]).map(x=>{const n=el('option',x.value+' · '+x.label);n.value=x.value;return n}))}
   scale.querySelector('select').addEventListener('change',levels);levels();
   const variant=select('variant','Методика JI-2',Object.entries(d.variants));
   const realShow=number('real_show','SMED · номер реального показа',1,3,1),realTry=number('real_try','SMED · номер реальной пробы',1,4,1);
   const segments=input('segments','Дробный инструктаж · группы шагов (например 1-3,4-6)','text',false),hazard=check('hazardous','Требуется предварительная проверка безопасности');
   function mode(){const v=variant.querySelector('select').value;realShow.hidden=realTry.hidden=v!=='smed';segments.hidden=v!=='fractional';segments.querySelector('input').required=v==='fractional'}
   variant.querySelector('select').addEventListener('change',mode);mode();
   out.replaceChildren(form([select('trainee_id','Обучаемый',opts(d.people)),select('authorization_id','Инструктор с действующим полномочием',opts(d.mentors)),revision,select('skill_id','Навык',opts(d.skills)),scale,level,dt('assigned_on','Начало',link&&link.start_on>d.day?link.start_on:d.day),dt('due_on','Срок',link?.due_on||''),...(!context?[scenario]:[]),fill(input('reason','Причина / производственная задача'),retrain?.reason),variant,number('followups','Контрольные проверки',2,10,2),realShow,realTry,segments,hazard,check('plan_reviewed','План TWI действующей редакции проверен')],'Создать назначение',async f=>{
    const v=value(f,'variant'),parts=v==='fractional'?value(f,'segments').split(',').map(s=>{const m=/^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(s);if(!m)throw Error('Укажите группы шагов, например 1-3,4-6');return {from:Number(m[1]),to:Number(m[2])}}):[];
    await api('training/create',{operation_id:id,trainee_id:value(f,'trainee_id'),authorization_id:value(f,'authorization_id'),revision_id:value(f,'revision_id'),skill_id:value(f,'skill_id'),scale_id:value(f,'scale_id'),target_level:Number(value(f,'target_level')),assigned_on:value(f,'assigned_on'),due_on:value(f,'due_on'),reason:value(f,'reason'),...(!context?{scenario:value(f,'scenario')}:{}),variant:v,method_config:{followups:Number(value(f,'followups')),segments:parts,realShow:v==='smed'?Number(value(f,'real_show')):null,realTry:v==='smed'?Number(value(f,'real_try')):null,hazardous:checked(f,'hazardous')},plan_reviewed:checked(f,'plan_reviewed'),...(link?{enrollment_id:link.enrollment_id,program_task_id:link.program_task_id,enrollment_rev:link.enrollment_rev}:retrain?{retraining_source_id:retrain.retraining_source_id}:{})});
    note('Назначение сохранено. Добавьте его в план производственного обучения для согласования.');await render();
   }));
  },'primary');
  setContent(host,panel(link?'Назначение по заданию программы':retrain?'Повторное обучение по новой редакции СОП':personId?'Назначение обучения выбранному сотруднику':'Новое назначение',op,load,out));
 }
 async function assignment(host,id,focus='overview'){
  if(!discard())return;
  const d=await api('training/detail?id='+encodeURIComponent(id)),n=panel('Карточка обучения · '+d.trainee,
   el('p',d.operation+' · '+d.mentor+' · '+(state[d.state]||d.state)+' · '+d.method_version),
   el('p','Срок '+d.due_on+' · '+d.completed+'/'+d.stages.length+' этапов · '+(d.approved?'Согласовано':'Требуется согласование')),
   table(['Этап','Состояние'],d.stages.map(s=>[s.label,s.done?'Выполнено':s.code===d.next?'Следующий':'Ожидается'])),
   table(['Фактический этап','Дата','Мин.','Результат','Примечание'],d.facts.map(f=>[d.stages.find(s=>s.code===f.stage_code)?.label||f.stage_code,f.held_at,f.duration_minutes,state[f.result]||f.result,f.notes])),
   table(['Проверка','Результат','Дата'],d.verification.map(v=>[v.kind==='safety'?'Безопасность':'Теория',state[v.result]||'Нет',v.day])),
   el('p','Практика: '+(d.practical?d.conclusions[d.practical.conclusion]:'Нет оценки')+' · Квалификация: '+(d.qualification?.level??'Нет уровня')+' · '+d.admission));
  if(d.scenario_label)n.append(el('p','Основание: '+d.scenario_label));
  if(d.plan_pending)n.append(el('p','Назначение входит в общий план. Согласование — в плане производственного обучения.','muted'));
  const command=(cmd,fields)=>async f=>{await api('training/change',{id:d.id,expected_revision:d.rev,command:cmd,fields:fields(f)});note('Действие подтверждено сервером');await render()};
  const cap=d.cap,open=['planned','in_progress'].includes(d.state),valid=d.state!=='cancelled';
  if(open&&!d.approved){
   for(const kind of ['responsible','head']){
    const done=d.pending_approvals.some(v=>v.kind===kind),label=kind==='responsible'?'Ответственный за обучение':'Руководитель';
    n.append(el('p',label+': '+(done?'Подтверждено':'Ожидается')));
    if(cap['approve_'+kind]&&!done)n.append(groups('Подтверждение: '+label,[input('note','Примечание','text',false)],'Подтвердить от своего имени',command('approve_'+kind,f=>({note:value(f,'note')}))));
   }
  }
  if(open&&cap.reschedule)n.append(groups('Изменить срок',[dt('due_on','Новый срок',d.due_on),input('reason','Причина')],'Сохранить срок',command('reschedule',f=>({due_on:value(f,'due_on'),reason:value(f,'reason')}))));
  if(open&&cap.cancel)n.append(groups('Отменить назначение',[input('reason','Причина')],'Отменить',command('cancel',f=>({reason:value(f,'reason')}))));
  if(valid&&d.approved){
   if(cap.stage){
    const stages=d.stages.filter(s=>s.done||s.code===d.next),stage=select('stage_code','Фактический этап',stages.map(s=>[s.code,s.label]));if(d.next)stage.querySelector('select').value=d.next;
    const pending=d.stages.filter(s=>!s.done).slice(0,16);
    if(pending.length){
     const rows=pending.map((s,i)=>[s.label,check('include_'+i,'Записать'),input('time_'+i,'','datetime-local',false),input('minutes_'+i,'','number',false),select('result_'+i,'',[['completed','Выполнен'],['incomplete','Не завершён']]),input('note_'+i,'','text',false),optional('witness_'+i,'',opts(d.witnesses))]);
     const grid=table(['Этап','Факт','Дата и время','Мин.','Результат','Примечание','Демонстратор'],rows);
     const protocol=groups('Протокол инструктажа — несколько фактов за один раз',[el('p','Отметьте фактически выполненные этапы и внесите их реальные время и длительность. Пустые этапы не сохраняются. Порядок и требования безопасности проверяются сервером.','muted'),grid,check('mentor_ack','Инструктор подтвердил отмеченные факты'),check('trainee_ack','Обучаемый подтвердил отмеченные факты')],'Сохранить протокол',async f=>{
      const facts=pending.flatMap((s,i)=>checked(f,'include_'+i)?[{stage_code:s.code,held_at:value(f,'time_'+i),duration_minutes:Number(value(f,'minutes_'+i)),result:value(f,'result_'+i),notes:value(f,'note_'+i),witness_id:value(f,'witness_'+i)||null,mentor_ack:checked(f,'mentor_ack'),trainee_ack:checked(f,'trainee_ack')}]:[]);
      await api('training/protocol',{id:d.id,expected_revision:d.rev,facts});note('Протокол сохранён');await render();
     });
     if(focus==='instruction')protocol.open=true;n.append(protocol);
    }
    const held=input('held_at','Фактические дата и время','datetime-local');
    n.append(groups('Регистрация инструктажа',[stage,held,number('duration','Минуты',1,1440),select('result','Результат',[['completed','Выполнен'],['incomplete','Не завершён']]),input('notes','Что выполнено'),optional('witness_id','Демонстратор (если требуется)',opts(d.witnesses)),check('mentor_ack','Инструктор подтвердил факт'),check('trainee_ack','Обучаемый подтвердил факт')],'Записать факт инструктажа',command('stage',f=>({stage_code:value(f,'stage_code'),held_at:value(f,'held_at'),duration_minutes:Number(value(f,'duration')),result:value(f,'result'),notes:value(f,'notes'),witness_id:value(f,'witness_id')||null,mentor_ack:checked(f,'mentor_ack'),trainee_ack:checked(f,'trainee_ack')}))));
   }
   if(cap.verify)n.append(groups(d.safety_required?'Проверка знаний — безопасность обязательна перед практикой':'Дополнительная проверка знаний',[select('kind','Вид проверки',[['safety','Безопасность'],['theory','Теория']]),dt('evaluated_on','Фактическая дата',d.day),select('result','Результат',[['pass','Пройдено'],['fail','Не пройдено']]),input('evidence','Подтверждающий документ / факт'),input('feedback','Обратная связь')],'Записать проверку',command('verify',f=>({kind:value(f,'kind'),evaluated_on:value(f,'evaluated_on'),result:value(f,'result'),evidence:value(f,'evidence'),feedback:value(f,'feedback')}))));
   if(cap.practical&&cap.qualify&&d.methods.length){
    const m=d.methods[0],answers=m.criteria.flatMap((q,i)=>[select('answer_'+i,q.section+' · '+q.question,[['','— Выберите —'],['1','Да'],['0','Нет']]),input('note_'+i,'Примечание','text',false)]);
    n.append(groups('Практическая оценка и уровень матрицы',[dt('assessed_on','Дата оценки',d.day),...answers,select('conclusion','Заключение',Object.entries(d.conclusions)),select('observation_state','Результат наблюдения',[['rated','Оценено'],['not_observed','Не наблюдалось'],['not_applicable','Неприменимо']]),select('level','Уровень',d.levels.map(x=>[x.value,x.label])),input('valid_until','Срок оценки (если установлен)','date',false),input('evidence','Подтверждающее основание'),input('feedback','Обратная связь и рекомендация')],'Сохранить оценку и уровень',async f=>{
     const obs=value(f,'observation_state');
     await api('training/result',{id:d.id,expected_revision:d.rev,practical:{assessed_on:value(f,'assessed_on'),method_id:m.id,responses:m.criteria.map((q,i)=>({criterion_id:q.id,value:Number(value(f,'answer_'+i)),note:value(f,'note_'+i)})),conclusion:value(f,'conclusion'),feedback:value(f,'feedback')},qualification:{observation_state:obs,level:obs==='rated'?Number(value(f,'level')):null,valid_until:obs==='rated'?value(f,'valid_until')||null:null,evidence:value(f,'evidence')}});
     note('Практическая оценка и уровень матрицы сохранены');await render();
    }));
   }
   if(cap.practical&&d.methods.length){
    const method=d.methods[0],fields=method.criteria.flatMap((q,i)=>[select('answer_'+i,q.section+' · '+q.question,[['','— Выберите —'],['1','Да'],['0','Нет']]),input('note_'+i,'Примечание','text',false)]);
    n.append(groups('Практическая оценка',[dt('assessed_on','Дата',d.day),...fields,select('conclusion','Заключение',Object.entries(d.conclusions)),input('feedback','Обратная связь')],'Сохранить оценку',command('practical',f=>({assessed_on:value(f,'assessed_on'),method_id:method.id,responses:method.criteria.map((q,i)=>({criterion_id:q.id,value:Number(value(f,'answer_'+i)),note:value(f,'note_'+i)})),conclusion:value(f,'conclusion'),feedback:value(f,'feedback')}))));
   }
   if(cap.qualify&&d.practical){
    const until=input('valid_until','Действует до','date',false);
    n.append(groups('Квалификация',[dt('assessed_on','Дата',d.day),select('observation_state','Результат наблюдения',[['rated','Оценено'],['not_observed','Не наблюдалось'],['not_applicable','Неприменимо']]),select('level','Уровень',d.levels.map(x=>[x.value,x.label])),until,input('evidence','Подтверждение'),input('feedback','Обратная связь')],'Подтвердить квалификацию',command('qualify',f=>({assessed_on:value(f,'assessed_on'),practical_id:d.practical.id,observation_state:value(f,'observation_state'),level:value(f,'observation_state')==='rated'?Number(value(f,'level')):null,valid_until:value(f,'observation_state')==='rated'?value(f,'valid_until')||null:null,evidence:value(f,'evidence'),feedback:value(f,'feedback')}))));
   }
   if(cap.admit)n.append(groups('Решение о допуске (если требуется по операции)',[dt('decided_on','Дата решения',d.day),select('decision','Решение',[['granted','Допустить'],['denied','Отказать']]),input('valid_until','Действует до','date',false),input('evidence','Основание'),input('feedback','Обратная связь')],'Зарегистрировать решение',command('admit',f=>({decided_on:value(f,'decided_on'),valid_until:value(f,'decision')==='granted'?value(f,'valid_until')||null:null,decision:value(f,'decision'),evidence:value(f,'evidence'),feedback:value(f,'feedback')}))));
  }
  if(d.practical?.can_task){
   const related=el('div');
   if(d.practical.conclusion==='not_meet')n.append(button('Мероприятие по результату практики',()=>taskEditor(related,{kind:'practical',id:d.practical.id,criterion_id:null})));
   for(const q of d.practical.negative)n.append(button('Мероприятие: '+q.question,()=>taskEditor(related,{kind:'practical',id:d.practical.id,criterion_id:q.id})));
   n.append(related);
  }
  if(focus==='instruction'&&!n.querySelector('details[open]'))for(const detail of n.querySelectorAll('details'))if(detail.querySelector('summary')?.textContent==='Регистрация инструктажа')detail.open=true;
   appendExports(n,d);n.append(assistant({type:'training',id}));setContent(host,n);
 }
 async function sop(host,id){
  if(!discard())return;
  const d=await api('training/sop?id='+encodeURIComponent(id));
  setContent(host,panel(d.code+' · '+d.title+' · v'+d.version_no,table(['Шаг','Действие','Ключевые моменты','Причина','Сек.'],d.steps.map(s=>[s.position,s.action_text,s.key_points.join(' · '),s.reason_text,s.duration_seconds]))));
 }
 async function productionPlanPanel(host){
  if(!discard())return;
  const d=await api('training/plans'),n=panel('Планы производственного обучения',el('p','Согласование всего выбранного состава. При изменении строки требуется новый план; прошлые согласования остаются в истории.','muted'));
  if(d.can_create&&d.candidates.length){
   const fields=d.candidates.map((t,i)=>[check('row_'+i,'Включить'),t.trainee,t.operation,t.instructor,t.assigned_on,t.due_on,d.scenarios[t.scenario]||'Основание ранее не классифицировано']);
   const day=d.day,end=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),0)).toISOString().slice(0,10);
   n.append(groups('Составить план',[input('title','Название плана'),dt('from','Начало периода',day),dt('to','Конец периода',end),table(['Выбор','Сотрудник','Операция','Инструктор','Начало','Срок','Основание'],fields)],'Зафиксировать состав плана',async f=>{
    const rows=d.candidates.flatMap((t,i)=>checked(f,'row_'+i)?[{id:t.id,rev:t.rev}]:[]);
    await api('training/plan-create',{title:value(f,'title'),from:value(f,'from'),to:value(f,'to'),rows});note('Состав плана сохранён');await render();
   }));
  }
  for(const p of d.plans){
   const box=panel(p.title,el('p',p.from+' — '+p.to+' · '+({draft:'На согласовании',approved:'Согласован',stale:'Состав или полномочия изменились'}[p.status])),table(['Сотрудник','Операция','Инструктор','Начало','Срок'],p.rows.map(t=>[t.trainee,t.operation,t.instructor,t.assigned_on,t.due_on])));
   for(const kind of ['responsible','head']){
    const v=p.votes[kind],label=kind==='responsible'?'Непосредственный руководитель / ответственный':'Руководитель подразделения';
    box.append(el('p',label+': '+(v.done?'Подтверждено '+v.day:'Ожидается')));
    if(v.can)box.append(groups('Согласовать план: '+label,[input('note','Примечание','text',false)],'Согласовать весь план',async f=>{await api('training/plan-approve',{id:p.id,kind,note:value(f,'note')});note('Согласование плана зарегистрировано');await render()}));
   }
   n.append(box);
  }
  if(!d.plans.length)n.append(empty());setContent(host,n);
 }
 function training(items,user,view='plan'){
  const host=el('div'),n=panel(view==='instruction'?'Реестр инструктажей TWI':'Назначения производственного обучения');
  if(view==='instruction')n.append(el('p','Тот же реестр назначений, без дублирования. Откройте карточку для регистрации фактического этапа; факт, практика, квалификация и допуск остаются независимыми.'));
  const search=input('training_search','Поиск по сотруднику или операции','search',false),status=select('training_state','Состояние',[['all','Все'],['planned','Запланировано'],['in_progress','Выполняется'],['completed','Завершено'],['cancelled','Отменено']]),out=el('div');
  if(view==='plan'&&user.person_id&&user.permissions.includes('training.detail'))n.append(button('Планы производственного обучения',()=>productionPlanPanel(host),'primary'));
  if(view==='plan'&&user.person_id&&user.permissions.includes('training.create'))n.append(button('Назначить обучение',()=>discard()&&assignmentEditor(host)));
  const draw=()=>{const q=search.querySelector('input').value.toLocaleLowerCase('ru'),s=status.querySelector('select').value,filtered=items.filter(r=>(s==='all'||r.state===s)&&[r.trainee_name,r.operation_name].join(' ').toLocaleLowerCase('ru').includes(q));out.replaceChildren(filtered.length?table(['Обучаемый','Операция','Срок','Состояние','Действия'],filtered.map(r=>{const b=el('div',undefined,'row');if(r.can_detail)b.append(button(view==='instruction'?'Открыть инструктаж':'Карточка обучения',()=>assignment(host,r.id,view==='instruction'?'instruction':'overview')));if(r.can_sop)b.append(button('СОП обучения',()=>sop(host,r.id)));return [r.trainee_name,r.operation_name,r.due_on,state[r.state]||r.state,b.childElementCount?b:'Только чтение']})):empty())};
  search.querySelector('input').addEventListener('input',draw);status.querySelector('select').addEventListener('change',draw);draw();n.append(search,status,out,host);return n;
 }
 async function matrixEditor(host,previous=null){
  if(!discard())return;
  const info=await api('matrix/info'),unit=select('unit_id','Подразделение',opts(info.units)),base=dt('base_on','Дата исходного среза',previous?.base_on||info.day),out=el('div');
  if(previous){unit.querySelector('select').value=previous.unit_id;unit.querySelector('select').disabled=true}
  const shift=optional('shift_id','Смена',opts(info.shifts)),profession=optional('profession_id','Профессия',opts(info.professions)),category=optional('category_id','Категория навыков',opts(info.categories)),workplace=optional('workplace_id','Рабочее место',[]);
  if(previous)shift.querySelector('select').value=previous.shift_id||'';
  const filterFields=[shift,profession,workplace,category],names=['shift_id','profession_id','workplace_id','category_id'];
  const filters=()=>Object.fromEntries(filterFields.map((f,i)=>[names[i],f.querySelector('select').value||null]));
  async function chooseComposition(){
   if(!discard())return;
   const u=unit.querySelector('select').value,b=base.querySelector('input').value,q=filters();
   const params=new URLSearchParams({unit_id:u,base_on:b});for(const [k,v] of Object.entries(q))if(v)params.set(k,v);
   const d=await api('matrix/info?'+params);
   const ws=workplace.querySelector('select');ws.replaceChildren();for(const [v,label] of [['','— Все —'],...opts(d.workplaces)]){const o=el('option',label);o.value=v;ws.append(o)}ws.value=q.workplace_id||'';
   const roster=d.roster.map(r=>({key:r.person_id,label:r.name+' · '+r.position})),cols=d.columns.map(r=>({key:r.skill_id+':'+r.document_id,label:r.title+' · '+r.skill}));
   // Explicit order is preserved, including when creating a revision.
   const picker=(title,items,prefix,oldKeys)=>{
    const box=el('fieldset'),list=el('div'),lookup=new Map(items.map(r=>[r.key,r])),selected=oldKeys?new Set(oldKeys):new Set(items.map(r=>r.key));
    const ordered=[...(oldKeys||[]).filter(k=>lookup.has(k)),...items.map(r=>r.key).filter(k=>!oldKeys?.includes(k))];
    box.append(el('legend',title),button('Выбрать все',()=>{for(const c of list.querySelectorAll('input[type=checkbox]')){c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}))}}),button('Снять все',()=>{for(const c of list.querySelectorAll('input[type=checkbox]')){c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))}}),list);
    for(const k of ordered){const row=el('div'),c=check(prefix+k,lookup.get(k).label,selected.has(k));row.dataset.key=k;row.append(c,button('↑',()=>{if(row.previousElementSibling)list.insertBefore(row,row.previousElementSibling)}),button('↓',()=>{if(row.nextElementSibling)list.insertBefore(row.nextElementSibling,row)}));list.append(row)}
    return {box,keys:()=>[...list.children].filter(row=>row.querySelector('input').checked).map(row=>row.dataset.key),selectKeys:keys=>{const selected=new Set(keys);for(const row of list.children){const c=row.querySelector('input');c.checked=selected.has(row.dataset.key);c.dispatchEvent(new Event('change',{bubbles:true}))}}};
   };
   const people=picker('Строки · сотрудники',roster,'p_',previous?.roster.map(r=>r.person_id)),columns=picker('Столбцы · навыки и СОП',cols,'c_',previous?.columns.map(c=>c.skill_id+':'+c.document_id));
   const code=input('code','Код матрицы'),title=input('title','Название');code.querySelector('input').value=previous?.code||'';title.querySelector('input').value=previous?.title||'';if(previous)code.querySelector('input').readOnly=true;
   if(!roster.length||!cols.length||!d.scales.length){out.replaceChildren(el('p','Нужны сотрудники, навыки и корпоративная шкала 1–4. Проверьте фильтры.'));return}
   const scale=select('scale_id','Шкала',opts(d.scales));if(previous)scale.querySelector('select').value=previous.scale_id;
   const missing=(previous?.roster.filter(r=>!roster.some(x=>x.key===r.person_id)).length||0)+(previous?.columns.filter(c=>!cols.some(x=>x.key===c.skill_id+':'+c.document_id)).length||0);
   const warn=el('p',missing?'Часть прежнего состава недоступна в выбранных фильтрах: '+missing+'. Проверьте новый состав перед сохранением.':'Порядок строк и столбцов можно изменить стрелками.','muted');
   const summary=el('p','','muted'),include=check('include_sops','Дополнить всеми доступными СОП');
   const suggest=button('Подобрать по требованиям профессий',async()=>{
    if(JSON.stringify(filters())!==JSON.stringify(q)||unit.querySelector('select').value!==u||base.querySelector('input').value!==b)throw Error('Фильтры изменились. Повторно выберите состав');
    const r=await api('matrix/suggest',{unit_id:u,base_on:b,filters:q,scale_id:scale.querySelector('select').value,person_ids:people.keys(),include_sops:include.querySelector('input').checked});
    columns.selectKeys(r.keys);summary.textContent='Подобрано '+r.keys.length+' навыков · требований '+r.requirements+' · без доступной колонки '+r.missing+' · неоднозначных '+r.ambiguous+' · профессий без профиля '+r.unprofiled+'. Проверьте состав перед сохранением.';
   });
   out.replaceChildren(form([warn,code,title,scale,dt('target_on','Целевая дата',previous?.target_on||''),people.box,include,suggest,summary,columns.box],'Сохранить матрицу',async f=>{
    const current=filters();if(JSON.stringify(current)!==JSON.stringify(q)||unit.querySelector('select').value!==u||base.querySelector('input').value!==b)throw Error('Фильтры изменились. Повторно выберите состав');
    await api('matrix/save',{code:value(f,'code'),title:value(f,'title'),unit_id:u,scale_id:value(f,'scale_id'),base_on:b,target_on:value(f,'target_on'),...q,person_ids:people.keys(),columns:columns.keys().map(k=>{const r=d.columns.find(x=>x.skill_id+':'+x.document_id===k);return {skill_id:r.skill_id,document_id:r.document_id}}),previous_id:previous?.id??null,previous_rev:previous?.rev??0});
    note('Матрица сохранена · уровни взяты из подтверждённых оценок');await render();
   }));
  }
  unit.querySelector('select').addEventListener('change',()=>{workplace.querySelector('select').value=''});
  setContent(host,panel(previous?'Новая версия матрицы':'Конструктор матрицы',unit,base,shift,profession,workplace,category,button('Выбрать состав',chooseComposition,'primary'),out));
 }
 async function matrix(host,id){
  if(!discard())return;
  const d=await api('matrix/detail?id='+encodeURIComponent(id)),n=panel(d.code+' · '+d.title+' · v'+d.version_no,el('p','Срез '+d.base_on+' · факт '+d.day+' · цель '+d.target_on+' · пустая ячейка: нет сопоставимого факта.','muted'));
  const headings=['Сотрудник','Должность',...d.columns.map(c=>c.title),'Исходный','Факт','Цель','Потребность'];
  const detail=el('div'),rows=d.roster.map((r,i)=>[r.can_card?button(r.name,()=>card(detail,r.person_id)):r.name,r.position,...d.cells[i].map(x=>{const cell=el('div',x.actual??'—','lc81-matrix-cell');if(x.actual!==null)cell.dataset.level=String(x.actual);cell.title='Срез: '+(x.base??'—')+' · Цель: '+(x.target??'—')+' · Потребность: '+(x.need??'—')+' · '+x.reason+' · '+x.admission;return cell}),d.byPerson[i].base,d.byPerson[i].actual,d.byPerson[i].target,d.byPerson[i].need]);
  rows.push(['ИТОГО','',...d.bySkill.map(x=>x.actual),d.totals.base,d.totals.actual,d.totals.target,d.totals.need]);n.append(table(headings,rows));
  n.append(el('p',Object.entries(d.levels).map(([k,v])=>k+' — '+v).join(' · ')+' · Цели без факта: '+d.totals.unknown,'muted'));
  if(d.can_develop){
   n.append(groups('Поставить персональную цель по ячейке',[pick('person_id','Сотрудник',d.roster.map(r=>[r.person_id,r.name])),pick('skill_id','Навык',d.columns.map(c=>[c.skill_id,c.title])),pick('target_level','Цель',Object.entries(d.levels)),dt('due_on','Срок',d.target_on)],'Создать план и цель',async f=>{
    await api('development/from-matrix',{matrix_id:d.id,matrix_rev:d.rev,person_id:value(f,'person_id'),skill_id:value(f,'skill_id'),target_level:Number(value(f,'target_level')),due_on:value(f,'due_on')});note('Персональная цель создана');await render()
   }));
  }
  if(d.can_revise)n.append(button('Создать новую версию матрицы',()=>matrixEditor(host,d),'primary'));
  if(d.can_retire)n.append(groups('Закрыть матрицу',[input('reason','Причина')],'Закрыть',async f=>{await api('matrix/retire',{id:d.id,expected_revision:d.rev,reason:value(f,'reason')});note('Матрица закрыта');await render()}));
  appendExports(n,d);n.append(detail,assistant({type:'matrix',id}));setContent(host,n);
 }
 async function generalMatrix(host){
  if(!discard())return;
  const d=await api('matrix/overview-options'),n=panel('Общая матрица всех навыков'),out=el('div'),detail=el('div');
  const unit=select('unit_id','Подразделение',[...(d.all?[['','Все подразделения']]:[]),...opts(d.units)]);unit.querySelector('select').value=d.default_unit;
  const fields={unit_id:unit,profession_id:optional('profession_id','Профессия',opts(d.professions)),shift_id:optional('shift_id','Смена',opts(d.shifts)),category_id:optional('category_id','Категория',opts(d.categories)),workplace_id:optional('workplace_id','Рабочее место',opts(d.workplaces)),q:input('q','Поиск сотрудника','search',false)};
  const gaps=check('gaps','Только сотрудники с выявленными разрывами'),transpose=check('transpose','Навыки строками');
  let pp=0,sp=0,historySerial=0;
  const labels={none:'Нет оценки',not_observed:'Не наблюдалось',not_applicable:'Неприменимо',expired:'Срок истёк'};
  const assessmentLabel=(state,level)=>state==='rated'?String(level):state==='expired'?String(level)+' · '+labels.expired:labels[state]||'—';
  async function history(person,skill,offset=0){
   if(!discard())return;const serial=++historySerial;
   const d=await api('matrix/history?'+new URLSearchParams({person_id:person.id,skill_id:skill.id,offset:String(offset)}));
   if(serial!==historySerial)return;
   const nested=el('div'),n=panel('История оценок навыка',el('p',d.person+' · '+d.skill+' · срез '+d.day),el('p','Только разрешённые подтверждённые записи; предыдущие оценки не заменяют последнюю.','muted'),d.items.length?table(['Дата','Результат','Действительна до','Оценщик','Состояние записи','Действия'],d.items.map(r=>[r.assessed_on,assessmentLabel(r.state,r.level),r.valid_until,r.evaluator,r.latest?'Последняя':'История',button('Открыть оценку',()=>openLinked(nested,{type:'assessment',id:r.id}))])):empty());
   if(offset)n.append(button('Предыдущие 50',()=>history(person,skill,Math.max(0,offset-50))));
   if(d.next!==null)n.append(button('Следующие 50',()=>history(person,skill,d.next)));
   n.append(nested);setContent(detail,n);
  }
  async function draw(){
   historySerial++;detail.replaceChildren();
   const request={...Object.fromEntries(Object.entries(fields).map(([k,f])=>[k,f.querySelector('input,select').value])),gaps:gaps.querySelector('input').checked,person_page:pp,skill_page:sp};
   const x=await api('matrix/overview',request);pp=x.person_page;sp=x.skill_page;
   const cell=(i,j)=>{
    const z=x.cells[i][j];if(z.restricted)return el('span','Недоступно','muted');
    const label=assessmentLabel(z.assessment_state,z.actual)+(z.target===null?'':' / '+z.target),v=z.assessment_id?button(label,()=>history(x.people[i],x.skills[j])):el('span',label);
    v.classList.add('lc81-overview-cell');if(z.gap)v.classList.add('lc81-gap');if(z.assessment_state==='rated')v.dataset.level=String(z.actual);v.dataset.assessmentState=z.assessment_state;
    v.title=z.reason+(z.admission?' · '+z.admission:'');return v;
   };
   const person=p=>p.can_card?button(p.name,()=>card(detail,p.id)):p.name;
   const trans=transpose.querySelector('input').checked,headers=trans?['Навык',...x.people.map(p=>p.name)]:['Сотрудник',...x.skills.map(s=>s.name)],lines=trans?x.skills.map((s,j)=>[s.name,...x.people.map((p,i)=>cell(i,j))]):x.people.map((p,i)=>[person(p),...x.skills.map((s,j)=>cell(i,j))]);
   const pageButtons=el('div',undefined,'row');
   const prevP=button('← Сотрудники',()=>{pp--;return draw()}),nextP=button('Сотрудники →',()=>{pp++;return draw()}),prevS=button('← Навыки',()=>{sp--;return draw()}),nextS=button('Навыки →',()=>{sp++;return draw()});
   prevP.disabled=pp===0;nextP.disabled=(pp+1)*40>=x.person_count;prevS.disabled=sp===0;nextS.disabled=(sp+1)*20>=x.skill_count;
   pageButtons.append(prevP,nextP,prevS,nextS);
   out.replaceChildren(el('p','Срез '+x.day+' · доступно сотрудников: '+x.person_count+' · навыков: '+x.skill_count+' · факт / цель. Не оценено ≠ 0.','muted'),x.people.length&&x.skills.length?table(headers,lines):empty(),pageButtons);
  }
  n.append(el('p','Фактические уровни и действующие требования из единой базы. Ограниченные источники не считаются нулями. Допуск проверяется отдельно.'),...Object.values(fields),gaps,transpose,button('Обновить матрицу',async()=>{if(discard()){pp=sp=0;detail.replaceChildren();await draw()}},'primary'),out,detail);
  setContent(host,n);await draw();
 }
 async function professionProfiles(host){
  if(!discard())return;const o=await api('matrix/profile-options'),n=panel('Профили компетенций профессий'),out=el('div');
  const profession=pick('profile_profession','Профессия',opts(o.professions)),scale=pick('profile_scale','Корпоративная шкала 1–4',opts(o.scales));
  const next=new Date(Date.parse(o.day+'T00:00:00Z')+86400000).toISOString().slice(0,10),effective=dt('profile_effective','Действует с',next);
  n.append(el('p','Профиль использует действующий реестр требований. При изменении прежний период закрывается предыдущим днём. Для изменения существующего требования выберите дату не раньше завтра.'),profession,scale,effective,button('Открыть профиль',async()=>{
   if(!discard())return;
   const read=()=>({profession_id:profession.querySelector('select').value,scale_id:scale.querySelector('select').value,effective:effective.querySelector('input').value});
   const query=read(),d=await api('matrix/profile?'+new URLSearchParams(query)),grid=el('div'),search=input('profile_search','Поиск навыка','search',false),bulk=optional('profile_bulk','Уровень для видимых навыков',Object.entries(o.levels)),entries=new Map(d.items.map(x=>[x.id,{level:x.level,criticality:x.criticality,dirty:false}]));
   const shown=()=>d.items.filter(x=>[x.name,x.category].join(' ').toLocaleLowerCase('ru-RU').includes(search.querySelector('input').value.trim().toLocaleLowerCase('ru-RU')));
   let holder;
   function draw(){
    const groups=new Map();for(const x of shown()){if(!groups.has(x.category))groups.set(x.category,[]);groups.get(x.category).push(x)}
    grid.replaceChildren(...[...groups].map(([category,items])=>panel(category,table(['Навык','Целевой уровень','Критичность','Прежнее требование'],items.map(x=>{
     const v=entries.get(x.id),level=optional('level_'+x.id,'Уровень',Object.entries(o.levels)),critical=select('critical_'+x.id,'Критичность',Object.entries(criticalityNames));
     level.querySelector('select').value=v.level??'';critical.querySelector('select').value=v.criticality;
     for(const f of [level,critical]){f.querySelector('select').disabled=!x.editable;f.querySelector('select').addEventListener('change',()=>{v.level=level.querySelector('select').value?Number(level.querySelector('select').value):null;v.criticality=critical.querySelector('select').value;v.dirty=true;holder.dataset.profileDirty='1'})}
     return [x.name,level,critical,x.level===null?'Нет':x.level+' · с '+x.valid_from+(x.scale_id!==d.scale_id?' · другая шкала':'')];
    })))));
   }
   holder=form([search,...(d.can_edit?[bulk,button('Применить уровень к видимым',()=>{const v=bulk.querySelector('select').value;if(!confirm('Применить уровень ко всем видимым редактируемым навыкам?'))return;for(const x of shown().filter(x=>x.editable)){const z=entries.get(x.id);z.level=v?Number(v):null;z.dirty=true}holder.dataset.profileDirty='1';draw()})]:[]),grid], 'Сохранить профиль',async()=>{
    if(JSON.stringify(query)!==JSON.stringify(read()))throw Error('Параметры изменились, откройте профиль заново');
    const selected=d.items.filter(x=>entries.get(x.id).dirty).map(x=>{const v=entries.get(x.id);return {skill_id:x.id,level:v.level,criticality:v.criticality,expected_id:x.expected_id,expected_rev:x.expected_rev}});
    if(!selected.length)throw Error('Нет изменений требований');if(selected.length>150)throw Error('Сохраните не более 150 навыков за раз');
    if(!confirm('Сохранить изменения '+selected.length+' навыков с сохранением прежних периодов?'))return;
    const r=await api('matrix/profile',{...query,entries:selected});delete holder.dataset.profileDirty;holder.lcResetForm?.();note('Сохранено событий требований: '+r.changed);await render();
   });
   // The form's normal dirty guard is augmented by edits to its paged/grouped
   // inputs; filtering never discards draft values.
   const wasDirty=holder.lcIsDirty?.bind(holder);holder.lcIsDirty=()=>holder.dataset.profileDirty==='1'||!!wasDirty?.();
   if(!d.can_edit)holder.querySelector('button[type=submit],button:not([type])')?.setAttribute('disabled','');
   search.querySelector('input').addEventListener('input',draw);out.replaceChildren(holder);draw();holder.lcResetForm?.();
  },'primary'),out);
  setContent(host,n);
 }
 function matrices(items,user){
  const host=el('div'),n=panel('Матрицы компетенций');
  if(user.person_id&&user.permissions.includes('matrix.create'))n.append(button('Создать матрицу',()=>matrixEditor(host),'primary'));
  if(['skill.read','requirement.read','assessment.read','assessment.detail'].every(k=>user.permissions.includes(k)))n.append(button('Общая матрица всех навыков',()=>generalMatrix(host)));
  if(user.permissions.includes('requirement.read'))n.append(button('Профили профессий',()=>professionProfiles(host)));
  n.append(items.length?table(['Код','Название','Версия','Срез','Цель','Сотрудников','Навыков','Состояние','Действия'],items.map(r=>[r.code,r.title,r.version_no,r.base_on,r.target_on,r.people,r.skills,state[r.state]||r.state,r.can_detail?button('Открыть матрицу',()=>matrix(host,r.id)):'Только чтение'])):empty(),host);return n;
 }
 async function card(host,id){
  if(!discard())return;
  const d=await api('person/card?id='+encodeURIComponent(id)),n=panel('Карточка сотрудника · '+d.person.display_name,el('p',[d.person.employee_code,d.person.unit,d.person.position,d.person.shift?'Смена: '+d.person.shift:null,...(d.person.roles||[])].filter(Boolean).join(' · ')));
  const tabs=el('div',undefined,'lc81-card-tabs row'),body=el('div'),search=input('person_records_search','Поиск связанных записей','search',false),quick=el('div',undefined,'row'),quickHost=el('div');
  const groups=[
   ['overview','Обзор',[]],
   ['matrix','Матрицы',['matrix.read']],
   ['training','Обучение',['training.read','training.enrollment.read','preparation.read']],
   ['assessment','Оценки и допуски',['assessment.read','authorization.read']],
   ['mentoring','Наставничество',['credential.read','appointment.read','supplement.read','audit.read','self.read']],
   ['effect','Эффективность TWI',[]],
   ['library','СОП и ФРВ',['sop.read_history','frv.read','sop.evaluation.read']],
   ['plans','Планы и мероприятия',['development.read','task.read','calendar.read','roi.read']],
   ['roles','Назначения и роли',['employment.read','role_assignment.read']]
  ];
  const sectionFor=g=>d.sections.filter(s=>g[2].includes(s.action));
  const enabled=g=>g[0]==='overview'||g[0]==='matrix'&&Array.isArray(d.own_competences)||g[0]==='effect'&&d.can_twi_report||sectionFor(g).length>0;
  let active='overview';
  const reg=el('div');
  if(d.can_journal)quick.append(button('Журнал инструктажей сотрудника',async()=>{if(discard())quickHost.replaceChildren(await registerPanel('journal',id))}));
  if(d.can_retraining)quick.append(button('Переобучение и развитие',async()=>{if(discard())quickHost.replaceChildren(await registerPanel('retraining',id))}));
  if(d.can_create_training)quick.append(button('Назначить обучение',()=>discard()&&assignmentEditor(quickHost,null,null,id),'primary'));
  if(d.can_plan)quick.append(button('План сотрудника',async()=>{if(discard())quickHost.replaceChildren(await personCalendar('plan',id))}));
  if(d.can_calendar)quick.append(button('Календарь сотрудника',async()=>{if(discard())quickHost.replaceChildren(await personCalendar('calendar',id))}));
  if(d.can_twi_report)quick.append(button('Метрики сотрудника',()=>choose('effect')));
  function records(s,query){
   const details=panel(s.title),items=s.items.filter(r=>!query||Object.values(r).filter(v=>typeof v==='string'||typeof v==='number').join(' ').toLocaleLowerCase('ru-RU').includes(query));
   const labels={unit:'Подразделение',profession:'Профессия',position:'Должность',shift:'Смена',code:'Код',title:'Название',due_on:'Срок',state:'Состояние',start_on:'Начало',month:'Месяц',version_no:'Версия',role:'Роль',kind:'Вид',issued_on:'Выдан',valid_until:'Срок действия',order_on:'Дата приказа',valid_from:'Начало',valid_to:'Окончание',operation_name:'Операция',mentor_name:'Инструктор / наставник',sop_label:'Редакция СОП',assigned_on:'Дата назначения',revoked_at:'Отозвано',observed_at:'Дата наблюдения',category:'Категория',adaptation:'Адаптация',safety:'ОТ',internship:'Стажировка',base_on:'Срез',target_on:'Цель',evaluated_on:'Дата оценки',assessed_on:'Дата оценки',result_note:'Результат',people:'Сотрудников',skills:'Навыков'};
   const keys=Object.keys(labels).filter(k=>items.some(r=>Object.hasOwn(r,k))),sub=el('div');
   const rows=items.map(r=>[...keys.map(k=>k==='state'?state[r[k]]||r[k]:r[k]),s.action==='employment.read'&&r.can_transfer?button('Изменить назначение',()=>employmentEditor(sub,r.id)):s.action==='training.read'?(function(){const b=el('div',undefined,'row');if(r.can_detail)b.append(button('Открыть обучение',()=>assignment(sub,r.id)));if(r.can_sop)b.append(button('СОП обучения',()=>openLinked(sub,{type:'sop',id:r.sop_revision_id})));return b.childElementCount?b:'Только чтение'})():s.action==='sop.read_history'?button('Открыть СОП',()=>openLinked(sub,{type:'sop',id:r.revision_id})):s.action==='frv.read'?button('Открыть ФРВ',()=>openLinked(sub,{type:'frv',id:r.id})):s.action==='matrix.read'&&r.can_detail?button('Открыть матрицу',()=>matrix(sub,r.id)):s.action==='training.enrollment.read'&&r.can_detail?button('Открыть программу',()=>enrollmentCard(sub,r.id)):s.action==='preparation.read'&&r.can_detail?button('Открыть комплект',()=>preparationCard(sub,r.id)):['credential.read','appointment.read','authorization.read'].includes(s.action)?button('Открыть запись',()=>openRecord(sub,s.action.split('.')[0],r.id)):s.action==='supplement.read'&&r.can_detail?button('Открыть ходатайство',()=>supplementCard(sub,r.id)):s.action==='development.read'&&r.can_detail?button('Открыть план',()=>developmentCard(sub,r.id)):s.action==='audit.read'&&r.can_detail?button('Открыть аудит',()=>qualityCard(sub,'audit',r.id)):s.action==='self.read'&&r.can_detail?button('Открыть самооценку',()=>qualityCard(sub,'self',r.id)):s.action==='task.read'&&r.can_detail?button('Открыть мероприятие',()=>taskCard(sub,r.id)):s.action==='assessment.read'&&r.can_detail?button('Открыть оценку',()=>assessmentCard(sub,r.id)):s.action==='sop.evaluation.read'?button('Открыть оценку СОП',()=>sopEvaluationCard(sub,r.kind,r.id)):s.action==='calendar.read'&&r.can_detail?button('Открыть плановое событие',()=>openLinked(sub,{type:'schedule',id:r.id})):s.action==='roi.read'&&r.can_detail?button('Открыть эффект',()=>openLinked(sub,{type:'roi',id:r.id})):'']);
   details.append(items.length?table([...keys.map(k=>labels[k]),'Действия'],rows):empty(),sub);return details;
  }
  function draw(){
   const query=search.querySelector('input').value.trim().toLocaleLowerCase('ru-RU'),group=groups.find(g=>g[0]===active);
   if(active==='effect'){body.replaceChildren(twiReport({person_id:id,day:d.day}));return}
   if(active==='overview'&&!query){
    const overview=el('div',undefined,'lc81-grid');for(const g of groups.filter(g=>g[0]!=='overview'&&enabled(g))){const count=sectionFor(g).reduce((n,s)=>n+s.items.length,0);overview.append(panel(g[1],el('p',g[0]==='effect'?'Отчёт по выбранному сотруднику':'Доступных записей: '+count),button('Открыть',()=>choose(g[0]))))}
    body.replaceChildren(overview);return;
   }
   const ss=active==='overview'?d.sections:sectionFor(group);
   body.replaceChildren(...(ss.length?ss.map(s=>records(s,query)):[empty()]));
   if(active==='matrix'&&Array.isArray(d.own_competences)){
    const nested=el('div'),items=d.own_competences.filter(x=>!query||x.skill.toLocaleLowerCase('ru-RU').includes(query));
    body.prepend(panel('Мои компетенции',el('p','Только личные уровни и действующие требования моей профессии.','muted'),items.length?table(['Навык / СОП','Факт','Цель','Состояние','Дата','Основание'],items.map(x=>[x.skill,x.actual,x.target,x.state,x.assessed_on,x.assessment_id?button('Открыть оценку',()=>assessmentCard(nested,x.assessment_id)):'—'])):empty(),nested));
   }
  }
  function choose(key){
   if(!discard()||!groups.some(g=>g[0]===key&&enabled(g)))return;
   active=key;for(const b of tabs.querySelectorAll('button')){b.classList.toggle('active',b.dataset.tab===key);b.setAttribute('aria-pressed',String(b.dataset.tab===key))}
   search.hidden=key==='effect';draw();
  }
  for(const g of groups.filter(enabled)){const b=button(g[1],()=>choose(g[0]),'lc81-card-tab');b.dataset.tab=g[0];b.setAttribute('aria-pressed',String(g[0]===active));b.classList.toggle('active',g[0]===active);tabs.append(b)}
  search.querySelector('input').addEventListener('input',()=>{if(!body.querySelector('[data-lc-work-form]'))draw()});
  n.append(quick,quickHost,tabs,search,body,reg,assistant({type:'person',id}));draw();setContent(host,n);
 }
 function mentor(kind,items,info){
  const names={credential:'Документы о подготовке наставников',appointment:'Приказы о назначении',authorization:'Полномочия по операциям'};
  const roles={instructor:'Инструктор',mentor:'Наставник',internal_trainer:'Внутренний тренер'},types={certificate:'Сертификат',attendance:'Свидетельство'};
  const host=el('div'),n=panel(names[kind]),status=r=>r.revoked_at?'Отозван':kind==='authorization'?(r.valid_now?'Действует':'Не действует на текущую дату'):'Зарегистрирован';
  const headers=kind==='credential'?['Сотрудник','Вид','Роль','Выдан','Действует до']:kind==='appointment'?['Сотрудник','Роль','Дата приказа','С','По']:['Сотрудник','Операция','С','По'];
  n.append(items.length?table([...headers,'Состояние','Действия'],items.map(r=>[
   ...(kind==='credential'?[r.person_name,types[r.kind]||r.kind,roles[r.role]||r.role,r.issued_on,r.valid_until]:kind==='appointment'?[r.person_name,roles[r.role]||r.role,r.order_on,r.valid_from,r.valid_to]:[r.person_name,r.operation_name,r.valid_from,r.valid_to]),
   status(r),r.can_revoke?button('Отозвать',()=>{if(!discard())return;host.replaceChildren(panel('Отзыв записи',form([input('reason','Основание отзыва')],'Подтвердить отзыв',async f=>{await api('mentor/change',{kind,command:'revoke',id:r.id,expected_revision:r.rev,fields:{reason:value(f,'reason')}});note('Отзыв зарегистрирован');await render()})))}):'Только чтение'])):empty());
  if(info){
   const pick=(k,l,arr)=>select(k,l,[['','Выберите'],...arr]),people=opts(info.people,'display_name'),signers=opts(info.signers,'display_name'),optionalDate=(k,l)=>input(k,l,'date',false);
   let controls,keys,optionalKeys;
   if(kind==='credential'){
    controls=[pick('person_id','Сотрудник',people),pick('kind','Вид документа',Object.entries(types)),pick('role','Роль',Object.entries(roles)),input('number','Номер'),input('issuer','Кем выдан'),dt('issued_on','Дата выдачи',info.day),optionalDate('valid_until','Действует до'),input('evidence','Реквизиты подтверждающего документа')];
    keys=['person_id','kind','role','number','issuer','issued_on','valid_until','evidence'];optionalKeys=['valid_until'];
   }else if(kind==='appointment'){
    controls=[pick('credential_id','Сертификат',opts(info.credentials,'label')),input('order_number','Номер приказа'),dt('order_on','Дата приказа',info.day),pick('approved_by','Кто подписал бумажный приказ',signers),dt('valid_from','Действует с',info.day),optionalDate('valid_to','Действует до'),dt('acknowledged_on','Дата ознакомления',info.day),input('evidence','Реквизиты подписанного приказа')];
    keys=['credential_id','order_number','order_on','approved_by','valid_from','valid_to','acknowledged_on','evidence'];optionalKeys=['valid_to'];
   }else{
    controls=[pick('appointment_id','Действующий приказ',opts(info.appointments,'label')),pick('operation_id','Операция',info.operations.map(r=>[r.id,r.code+' · '+r.name])),dt('valid_from','Действует с',info.day),optionalDate('valid_to','Действует до')];
    keys=['appointment_id','operation_id','valid_from','valid_to'];optionalKeys=['valid_to'];
   }
   n.append(button(kind==='authorization'?'Оформить полномочие':'Зарегистрировать документ',()=>{if(!discard())return;host.replaceChildren(panel(kind==='authorization'?'Право обучать по операции':'Фактический документ (не электронная подпись)',form(controls,'Сохранить',async f=>{const fields=Object.fromEntries(keys.map(k=>[k,optionalKeys.includes(k)?value(f,k)||null:value(f,k)]));await api('mentor/change',{kind,command:'register',id:null,expected_revision:0,fields});note('Запись подтверждена сервером');await render()})))},'primary'));
  }
  n.append(host);return n;
 }
 const kindLabels={entry:'Ввод в профессию',adaptation:'Адаптация',safety:'Обучение безопасным методам',internship:'Стажировка',production:'Производственное обучение'};
 const partLabels={general:'Общая часть',individual:'Индивидуальная часть',practice:'Практические навыки',knowledge:'Проверка знаний'};
 const fill=(field,val)=>{field.querySelector('input,select').value=val??'';return field};
 const pick=(k,l,items,val='',required=true)=>{const field=select(k,l,[['','Выберите'],...items]);field.querySelector('select').required=required;return fill(field,val)};
 const num=(k,l,min,max,val,step=1)=>{const field=number(k,l,min,max,val);field.querySelector('input').step=String(step);return field};
 async function programEditor(host,previous=null,defaultKind=null){
  if(!discard())return;
  const d=await api('program/options'),tasksHost=el('div'),taskRows=[],sopSkills=d.sops.flatMap(r=>r.skills.map(s=>[r.id+'/'+s.id,r.title+' · '+s.name]));
  const targets=d.scales.flatMap(s=>s.levels.map(l=>[s.id+'/'+l.value,s.name+' · '+l.value+' '+l.label]));
  let index=0;
  function add(t={}){
   if(taskRows.length>=100)throw Error('Не более 100 заданий');
   const key='t'+(++index)+'_',row=el('fieldset');row.className='panel';
   const sop=t.sop_revision_id?t.sop_revision_id+'/'+t.skill_id:'',target=t.scale_id?t.scale_id+'/'+t.target_level:'';
   const oldChoice=(items,v,label)=>v&&!items.some(x=>x[0]===v)?[...items,[v,label]]:items;
   row.append(el('legend','Задание'),pick(key+'part','Часть',Object.entries(d.parts),t.part||'general'),fill(input(key+'title','Тема / операция'),t.title),num(key+'hours','План, ч',0,1000,t.hours??0,'any'),num(key+'day','День от начала (0 — первый день)',0,3660,t.day_offset??0),pick(key+'sop','СОП и навык (необязательно)',oldChoice(sopSkills,sop,'Прежняя редакция — выберите действующую'),sop,false),pick(key+'target','Шкала и уровень (для СОП)',oldChoice(targets,target,'Прежняя шкала / уровень'),target,false));
   const entry={row,key};taskRows.push(entry);
   row.append(button('Удалить задание',()=>{taskRows.splice(taskRows.indexOf(entry),1);row.remove()}));tasksHost.append(row);
  }
  for(const t of previous?.tasks?.length?previous.tasks:[{}])add(t);
  const code=fill(input('code','Код программы'),previous?.code);if(previous)code.querySelector('input').readOnly=true;
  const fields=[code,fill(input('title','Название'),previous?.title),pick('standard_kind','Вид документа',Object.entries(d.kinds).filter(([k])=>!defaultKind||k===defaultKind),previous?.standard_kind||previous?.kind||defaultKind||'production'),pick('profession_id','Профессия (необязательно)',opts(d.professions),previous?.profession_id||'',false),pick('position_id','Должность (необязательно)',opts(d.positions),previous?.position_id||'',false),tasksHost,button('Добавить задание',()=>add())];
  const editor=form(fields,previous?'Сохранить новую версию':'Создать шаблон',async f=>{
   if(!taskRows.length)throw Error('Добавьте хотя бы одно задание');
   const tasks=taskRows.map(({key:k})=>{
    const s=value(f,k+'sop'),t=value(f,k+'target');if(!!s!==!!t)throw Error('Для задания по СОП выберите навык и целевой уровень; для остальных оставьте их пустыми');
    const [sop_revision_id,skill_id]=s?s.split('/'):[null,null],[scale_id,lv]=t?t.split('/'):[null,null];
    return {part:value(f,k+'part'),title:value(f,k+'title'),hours:Number(value(f,k+'hours')),day_offset:Number(value(f,k+'day')),sop_revision_id,skill_id,scale_id,target_level:lv===null?null:Number(lv)};
   });
   await api('program/save',{code:value(f,'code').trim(),title:value(f,'title'),standard_kind:value(f,'standard_kind'),profession_id:value(f,'profession_id')||null,position_id:value(f,'position_id')||null,tasks,previous_id:previous?.id??null,previous_rev:previous?.rev??0});note('Версия программы сохранена');await render();
  });
  setContent(host,panel(previous?'Новая версия программы':'Конструктор программы',editor));
 }
 async function programCard(host,id){
  if(!discard())return;
  const d=await api('program/detail?id='+encodeURIComponent(id)),n=panel(d.code+' · '+d.title+' · v'+d.version_no,el('p',(kindLabels[d.standard_kind||d.kind]||d.kind)+' · '+(state[d.state]||d.state)),table(['№','Часть','Задание','Часы','День от начала','По СОП','Цель'],d.tasks.map(t=>[t.position,partLabels[t.part]||t.part,t.title,t.hours,t.day_offset,t.sop_revision_id?'Да':'—',t.target_level??'—'])));
  if(d.can_revise)n.append(button('Создать новую версию',()=>programEditor(host,d),'primary'));
  if(d.can_retire)n.append(groups('Закрыть шаблон',[input('reason','Основание')],'Закрыть шаблон',async f=>{await api('program/retire',{id:d.id,expected_revision:d.rev,reason:value(f,'reason')});note('Шаблон закрыт');await render()}));
  n.append(assistant({type:'program',id}));setContent(host,n);
 }
 async function enrollmentEditor(host,kind=null){
  if(!discard())return;
  const d=await api('enrollment/options');if(kind)d.programs=d.programs.filter(p=>p.standard_kind===kind||p.kind===kind);
  if(!d.programs.length||!d.trainees.length||!d.mentors.length||!d.managers.length){setContent(host,panel('Назначение программы',el('p','Нужны действующий шаблон, обучаемый, наставник и руководитель, доступные вашей роли.')));return}
  const optionalDate=(k,l)=>input(k,l,'date',false);
  setContent(host,panel('Назначение персональной программы',form([pick('program_id','Действующий шаблон',opts(d.programs,'label')),pick('trainee_id','Обучаемый',opts(d.trainees)),pick('mentor_id','Наставник',opts(d.mentors)),pick('manager_id','Руководитель',opts(d.managers)),dt('start_on','Начало',d.day),dt('due_on','Срок',''),input('reason','Основание'),optionalDate('internship_start','Стажировка: начало (при необходимости)'),optionalDate('internship_end','Стажировка: окончание'),optionalDate('entry_start','Ввод: начало (при необходимости)'),optionalDate('entry_end','Ввод: окончание')],'Назначить программу',async f=>{
   const fields=Object.fromEntries(['program_id','trainee_id','mentor_id','manager_id','start_on','due_on','reason','internship_start','internship_end','entry_start','entry_end'].map(k=>[k,value(f,k)||null]));
   fields.program_rev=d.programs.find(p=>p.id===fields.program_id).rev;
   await api('enrollment/create',fields);note('Персональная программа назначена');await render();
  })));
 }
 async function enrollmentCard(host,id){
  if(!discard())return;
  const d=await api('enrollment/detail?id='+encodeURIComponent(id)),sub=el('div'),n=panel(d.code+' · '+d.title+' · v'+d.version_no,
   el('p',[d.trainee,d.mentor?'Наставник: '+d.mentor:null,d.manager?'Руководитель: '+d.manager:null].filter(Boolean).join(' · ')),
   el('p',d.start_on+' — '+d.due_on+' · '+(state[d.state]||d.state)+' · '+d.tasks.filter(t=>t.done).length+'/'+d.tasks.length+' заданий'),
   table(['№','Часть','Задание','План, ч','Плановая дата','Факт','Действие'],d.tasks.map(t=>[t.position,d.parts[t.part]||t.part,t.title,t.hours,t.planned_on,t.done?'Выполнено':t.shared?'Общее задание стажировки':t.assignment_state?state[t.assignment_state]||t.assignment_state:t.result?state[t.result.result]||t.result.result:'Ожидается',t.assignment_id?button('Открыть обучение',()=>assignment(sub,t.assignment_id)):t.link?button('Назначить инструктаж',()=>assignmentEditor(sub,t.link)):'—'])));
  const facts=d.tasks.filter(t=>t.result);
  if(facts.length)n.append(table(['Задание','Дата','Минуты','Результат','Подтверждение'],facts.map(t=>[t.title,t.result.held_on,t.result.minutes,t.result.result==='completed'?'Выполнено':'Не выполнено',t.result.evidence])));
  if(d.conclusion)n.append(el('p','Заключение: '+(d.conclusions[d.conclusion]||d.conclusion)+(d.feedback?' · '+d.feedback:'')));
  const command=(cmd,get)=>async f=>{await api('enrollment/change',{id:d.id,expected_revision:d.rev,command:cmd,fields:get(f)});note('Результат подтверждён сервером');await render()};
  const ordinary=d.tasks.filter(t=>!t.sop);
  if(d.cap.result&&ordinary.length)n.append(groups('Зарегистрировать фактическое задание',[pick('task_id','Задание',ordinary.map(t=>[t.id,t.title])),dt('held_on','Фактическая дата',d.day),pick('result','Результат',[['completed','Выполнено'],['incomplete','Не выполнено']],'completed'),num('minutes','Фактически, мин.',0,1440,0),input('evidence','Подтверждение / комментарий')],'Зарегистрировать факт',command('result',f=>({task_id:value(f,'task_id'),held_on:value(f,'held_on'),result:value(f,'result'),minutes:Number(value(f,'minutes')),evidence:value(f,'evidence')}))));
  if(d.cap.finish&&d.tasks.every(t=>t.done))n.append(groups('Завершить программу',[pick('conclusion','Заключение',Object.entries(d.conclusions)),input('feedback','Обратная связь')],'Завершить',command('finish',f=>({conclusion:value(f,'conclusion'),feedback:value(f,'feedback')}))));
  if(d.cap.cancel)n.append(groups('Отменить программу',[input('feedback','Основание отмены')],'Отменить программу',command('cancel',f=>({conclusion:null,feedback:value(f,'feedback')}))));
  n.append(sub);appendExports(n,d);n.append(assistant({type:'enrollment',id}));setContent(host,n);
 }
 async function preparationEditor(host){
  if(!discard())return;
  const d=await api('preparation/options'),people=[...new Map(d.docs.map(x=>[x.trainee_id,x.trainee||'Сотрудник'])).entries()];
  if(!people.length||!d.shifts.length){setContent(host,panel('Комплект подготовки',el('p','Сначала назначьте документы адаптации, ОТ и стажировки и настройте смены.')));return}
  const person=pick('trainee_id','Сотрудник',people),kinds=['adaptation','safety','internship'],docs=kinds.map(k=>pick(k+'_id',kindLabels[k],[]));
  function updateDocs(){
   docs.forEach((field,i)=>{const s=field.querySelector('select');s.replaceChildren();const first=el('option','Выберите');first.value='';s.append(first);for(const x of d.docs.filter(x=>x.trainee_id===person.querySelector('select').value&&x.kind===kinds[i])){const o=el('option',x.label);o.value=x.id;s.append(o)}});
  }
  person.querySelector('select').addEventListener('change',updateDocs);updateDocs();
  const shiftHost=el('div'),shiftRows=[];let i=0;
  function addShift(){
   if(shiftRows.length>=366)throw Error('Не более 366 смен');const k='sh'+(++i)+'_',row=el('div'),entry={k,row};
   row.append(dt(k+'date','Дата смены',''),pick(k+'shift_id','Смена',d.shifts.map(s=>[s.id,s.code+' · '+s.name])),button('Удалить смену',()=>{shiftRows.splice(shiftRows.indexOf(entry),1);row.remove()}));shiftRows.push(entry);shiftHost.append(row);
  }
  addShift();addShift();
  const f=form([person,pick('category','Категория',[['new','Новый сотрудник'],['transfer','Перевод']]),...docs,shiftHost,button('Добавить смену',addShift),input('note','Примечание','text',false)],'Сформировать комплект',async f=>{
   if(shiftRows.length<2)throw Error('Запланируйте не менее двух смен');
   const ids=Object.fromEntries(kinds.map(k=>[k+'_id',value(f,k+'_id')]));
   const revisions=Object.fromEntries(kinds.map(k=>[k,d.docs.find(x=>x.id===ids[k+'_id']).rev]));
   await api('preparation/create',{trainee_id:value(f,'trainee_id'),category:value(f,'category'),...ids,revisions,shifts:shiftRows.map(({k})=>({date:value(f,k+'date'),shift_id:value(f,k+'shift_id')})),note:value(f,'note')});note('Комплект подготовки сформирован');await render();
  });
  setContent(host,panel('Связать документы подготовки',f));
 }
 const preparationNames={shift:'Факт смены',safety:'Протокол ОТ',internship:'Итог стажировки',questions:'Выдача вопросов',commission:'Заключение комиссии'};
 const theoryNames={technology:'Технология',quality:'Качество',equipment:'Оборудование',lean:'Бережливое производство'};
 const resultNames={completed:'Завершена',incomplete:'Не завершена',pass:'Пройдено',fail:'Не пройдено',not_meet:'Не соответствует',basic:'Соответствует базовому уровню',exceeds:'Превосходит базовый уровень'};
 async function prepFactEditor(host,d,kind){
  if(!discard())return;
  const on=dt('fact_on','Фактическая дата',d.day),content=el('div');
  const load=button('Выбрать дату',async()=>{
   if(!discard())return;
   const day=on.querySelector('input').value,optsData=await api('preparation/fact-options?id='+encodeURIComponent(d.id)+'&on='+encodeURIComponent(day));
   if(!optsData.capabilities[kind]){content.replaceChildren(el('p','На эту дату полномочия недоступны'));return}
   let fields,get;
   if(kind==='shift'){
    fields=[pick('shift_id','Смена',optsData.shifts.map(s=>[s.id,s.code+' · '+s.name])),pick('result','Результат',[['completed','Завершена'],['incomplete','Не завершена']]),num('minutes','Фактически, мин.',1,1440,480),input('note','Основание / комментарий')];
    get=f=>({shift_id:value(f,'shift_id'),result:value(f,'result'),minutes:Number(value(f,'minutes')),note:value(f,'note')});
   }else if(kind==='safety'||kind==='internship'){
    fields=[pick('result','Результат',[['pass','Пройдено'],['fail','Не пройдено']]),input('reference','Реквизиты фактического протокола'),input('feedback','Обратная связь')];
    get=f=>({result:value(f,'result'),reference:value(f,'reference'),feedback:value(f,'feedback')});
   }else if(kind==='questions'){
    const banks=optsData.banks;
    if(!banks.length){content.replaceChildren(el('p','Нет актуальной зарегистрированной редакции банка вопросов. Сначала актуализируйте банк в исходном контуре.'));return}
    const bank=pick('bank_id','Редакция банка',banks.map(b=>[b.id,b.label])),questionsHost=el('div');
    function showQuestions(){
     const b=banks.find(x=>x.id===bank.querySelector('select').value);questionsHost.replaceChildren();
     for(const block of b?.blocks||[]){const group=el('fieldset');group.append(el('legend',block.title));for(const q of block.questions)group.append(check('q_'+q.id,q.number+'. '+q.text));questionsHost.append(group)}
    }
    bank.querySelector('select').addEventListener('change',showQuestions);
    fields=[bank,questionsHost,input('note','Основание выдачи')];
    get=f=>{const b=banks.find(x=>x.id===value(f,'bank_id'));if(!b)throw Error('Выберите редакцию банка');return {bank_id:b.id,blocks:d.theory_blocks.map(id=>({block:id,question_ids:(b.blocks.find(x=>x.id===id)?.questions||[]).filter(q=>checked(f,'q_'+q.id)).map(q=>q.id)})),note:value(f,'note')}};
   }else{
    const p=optsData.people.map(x=>[x.id,x.name]),r=d.commission_roles;
    fields=[el('p','Руководитель: '+(optsData.manager.name||'')+' · наставник: '+(optsData.mentor.name||'')),...['trainer','agent','hr'].map(k=>pick(k,r[k],p)),...d.theory_blocks.flatMap(k=>[pick(k+'_result',theoryNames[k]||k,[['pass','Пройдено'],['fail','Не пройдено']]),input(k+'_note','Основание: '+(theoryNames[k]||k))]),pick('conclusion','Заключение',[['not_meet',resultNames.not_meet],['basic',resultNames.basic],['exceeds',resultNames.exceeds]]),input('reference','Реквизиты подписанного решения'),input('feedback','Рекомендации по развитию')];
    get=f=>({members:{manager:optsData.manager.id,mentor:optsData.mentor.id,...Object.fromEntries(['trainer','agent','hr'].map(k=>[k,value(f,k)]))},theory:d.theory_blocks.map(k=>({block:k,result:value(f,k+'_result'),note:value(f,k+'_note')})),conclusion:value(f,'conclusion'),reference:value(f,'reference'),feedback:value(f,'feedback')});
   }
   content.replaceChildren(form(fields,'Зарегистрировать факт',async f=>{if(on.querySelector('input').value!==day)throw Error('Дата изменена. Снова выберите дату');await api('preparation/fact',{id:d.id,kind,fact_on:day,expected_fact_id:d.last[kind],data:get(f)});note('Факт зарегистрирован сервером');await render()}));
  });
  setContent(host,panel(preparationNames[kind]+' · фактическая запись, не электронная подпись',on,load,content));
 }
 async function preparationCard(host,id){
  if(!discard())return;const d=await api('preparation/detail?id='+encodeURIComponent(id)),sub=el('div');
  const n=panel('Комплект подготовки · '+(d.trainee||''),el('p',(d.category==='new'?'Новый сотрудник':'Перевод')+' · '+d.status),table(['Документ','Состояние','Действия'],d.documents.map(x=>[kindLabels[x.kind],state[x.state]||x.state,x.id?button('Открыть программу',()=>enrollmentCard(sub,x.id)):'—'])),el('p','Смены стажировки: факт '+d.completed_shifts+' / план '+d.planned_shifts.length),table(['Дата','Смена'],d.planned_shifts.map(s=>[s.date,s.shift])));
  n.append(el('p','ОТ: '+(d.safety_current?'Актуальный протокол':'Нет актуального протокола')+' · Стажировка: '+(d.internship_current?'Актуальный итог':'Нет актуального итога')+' · Вопросы: '+(d.questions_issued?'Выданы':'Не выданы')+' · Комиссия: '+(d.commission_current?'Актуальное решение':'Нет актуального решения')));
  if(d.facts.length)n.append(table(['Этап','Дата','Смена','Мин.','Результат','Реквизиты','Комментарий'],d.facts.map(x=>[preparationNames[x.kind],x.date,x.shift,x.minutes,resultNames[x.result]||x.result,x.reference,x.note])));
  for(const [kind,label] of Object.entries(preparationNames))if(d.cap[kind])n.append(button(label,()=>prepFactEditor(sub,d,kind),'primary'));
  n.append(sub);appendExports(n,d);n.append(assistant({type:'preparation',id}));setContent(host,n);
 }
 function programPanel(page,items,user,mode=null){
  if(page!=='preparation.read')items=items.filter(x=>mode==='internship'?(x.standard_kind||x.kind)==='internship':(x.standard_kind||x.kind)!=='internship');
  const host=el('div'),n=panel(mode==='internship'?(page==='program.read'?'Шаблоны стажировки':'Персональные программы стажировки'):page==='program.read'?'Шаблоны программ':page==='training.enrollment.read'?'Персональные программы':'Комплекты подготовки');
  const create=page==='program.read'?'program.create':page==='training.enrollment.read'?'training.enrollment.create':'preparation.create';
  if(user.person_id&&user.permissions.includes(create))n.append(button(page==='program.read'?'Создать шаблон':page==='training.enrollment.read'?'Назначить программу':'Сформировать комплект',()=>page==='program.read'?programEditor(host,null,mode):page==='training.enrollment.read'?enrollmentEditor(host,mode):preparationEditor(host),'primary'));
  if(page==='program.read')n.append(items.length?table(['Код','Название','Вид','Версия','Состояние','Действия'],items.map(r=>[r.code,r.title,kindLabels[r.standard_kind||r.kind]||r.kind,r.version_no,state[r.state]||r.state,r.can_detail?button('Открыть шаблон',()=>programCard(host,r.id)):'—'])):empty());
  else if(page==='training.enrollment.read')n.append(items.length?table(['Сотрудник','Программа','Версия','Начало','Срок','Состояние','Действия'],items.map(r=>[r.trainee_name,r.title,r.version_no,r.start_on,r.due_on,state[r.state]||r.state,r.can_detail?button('Открыть программу',()=>enrollmentCard(host,r.id)):'—'])):empty());
  else n.append(items.length?table(['Сотрудник','Категория','Адаптация','ОТ','Стажировка','Действия'],items.map(r=>[r.trainee_name,r.category==='new'?'Новый сотрудник':'Перевод',state[r.adaptation]||r.adaptation,state[r.safety]||r.safety,state[r.internship]||r.internship,r.can_detail?button('Открыть комплект',()=>preparationCard(host,r.id)):'—'])):empty());
  n.append(host);return n;
 }
 const mentorRoles={instructor:'Инструктор',mentor:'Наставник',internal_trainer:'Внутренний тренер'};
 const supplementStates={draft:'Черновик',approved:'Согласовано',declined:'Отклонено'};
 async function orderEditor(host){
  if(!discard())return;const d=await api('order/options'),list=el('div'),members=[];let i=0;
  if(!d.certs.length){setContent(host,panel('Групповой приказ',el('p','Нужны сотрудники с действующим сертификатом и указанной должностью в справочнике.')));return}
  function add(){
   if(members.length>=200)throw Error('Не более 200 участников');
   const k='m'+(++i)+'_',row=el('fieldset'),m={k,row};
   row.append(el('legend','Назначаемый сотрудник'),pick(k+'credential_id','Сертификат',opts(d.certs,'label')),dt(k+'acknowledged_on','Дата ознакомления',d.day),button('Удалить',()=>{members.splice(members.indexOf(m),1);row.remove()}));members.push(m);list.append(row);
  }
  add();
  const money=(k,l)=>{const x=num(k,l,0,10000000,'');x.querySelector('input').required=false;return x};
  const f=form([input('organization','Организация'),input('city','Город'),input('order_number','Номер приказа'),dt('order_on','Дата приказа',d.day),pick('approved_by','Подписант бумажного приказа',opts(d.people)),dt('valid_from','Действует с',d.day),input('valid_to','Действует по','date',false),money('instructor_amount','Доплата инструктору, руб. (по приказу)'),money('trainer_amount','Доплата ВТ, руб. (по приказу)'),input('supplement_from','Начало доплаты','date',false),input('evidence','Реквизиты подписанного приказа'),list,button('Добавить участника',add)],'Зарегистрировать приказ',async f=>{
   if(!members.length)throw Error('Добавьте участников приказа');
   const amount=k=>value(f,k)===''?null:Number(value(f,k));
   const data=Object.fromEntries(['organization','city','order_number','order_on','approved_by','valid_from','valid_to','supplement_from','evidence'].map(k=>[k,value(f,k)||null]));
   await api('order/register',{...data,instructor_amount:amount('instructor_amount'),trainer_amount:amount('trainer_amount'),members:members.map(({k})=>({credential_id:value(f,k+'credential_id'),acknowledged_on:value(f,k+'acknowledged_on')}))});note('Приказ и связанные назначения зарегистрированы');await render();
  });
  setContent(host,panel('Групповой приказ · регистрация подписанного документа',f));
 }
 async function orderCard(host,id){
  if(!discard())return;const d=await api('order/detail?id='+encodeURIComponent(id));
  const n=panel('Приказ № '+d.order_number+' от '+d.order_on,el('p',d.organization+' · '+d.city+' · подписант '+d.approved_name),el('p','Действует '+d.valid_from+' — '+(d.valid_to||'без срока')+' · '+d.evidence),el('p','По приказу: инструктор '+(d.instructor_amount??'не установлено')+' руб. · ВТ '+(d.trainer_amount??'не установлено')+' руб. · с '+(d.supplement_from||'—')),table(['Сотрудник','Должность','Роль','Ознакомление','Состояние'],d.members.map(m=>[m.person_name,m.position_name,mentorRoles[m.role]||m.role,m.acknowledged_on,m.revoked_at?'Отозвано':'Зарегистрировано'])));
  appendExports(n,d);setContent(host,n);
 }
 function supplementTasksEditor(catalog,previous=[]){
  const host=el('div'),entries=[];
  for(const [code,label] of catalog){
   const old=previous.find(t=>t.code===code),group=el('fieldset'),selected=check('use_'+code,label,!!old),day=dt('day_'+code,'Дата выполнения',old?.done_on||''),evidence=fill(input('evidence_'+code,'Основание / результат'),old?.evidence);
   const toggle=()=>{const v=selected.querySelector('input').checked;for(const f of [day,evidence]){f.hidden=!v;const inp=f.querySelector('input');inp.disabled=!v;inp.required=v}};
   selected.querySelector('input').addEventListener('change',toggle);toggle();
   group.append(selected,day,evidence);host.append(group);entries.push(code);
  }
  return {host,tasks:f=>entries.filter(k=>checked(f,'use_'+k)).map(code=>({code,done_on:value(f,'day_'+code),evidence:value(f,'evidence_'+code)}))};
 }
 async function supplementEditor(host){
  if(!discard())return;const d=await api('supplement/options');
  if(!d.subjects.length){setContent(host,panel('Ходатайство',el('p','Нет доступных сотрудников с зарегистрированным сертификатом инструктора или ВТ.')));return}
  const role=pick('role','Роль',[['instructor','Инструктор'],['internal_trainer','Внутренний тренер']],'instructor'),tasksHost=el('div');let editor;
  const rebuild=()=>{editor=supplementTasksEditor(d.tasks[role.querySelector('select').value]||[]);tasksHost.replaceChildren(editor.host)};
  role.querySelector('select').addEventListener('change',rebuild);rebuild();
  setContent(host,panel('Ходатайство о доплате · не расчёт зарплаты',form([pick('person_id','Сотрудник',opts(d.subjects)),pick('manager_id','Руководитель',opts(d.people)),role,fill(input('month','Календарный месяц','month'),d.day.slice(0,7)),tasksHost],'Создать ходатайство',async f=>{
   await api('supplement/create',{person_id:value(f,'person_id'),manager_id:value(f,'manager_id'),role:value(f,'role'),month:value(f,'month'),tasks:editor.tasks(f)});note('Ходатайство зарегистрировано');await render();
  })));
 }
 async function supplementCard(host,id){
  if(!discard())return;const d=await api('supplement/detail?id='+encodeURIComponent(id)),n=panel('Ходатайство · '+d.month+' · '+(d.person_name||''),el('p',mentorRoles[d.role]+' · '+supplementStates[d.state]+' · руководитель '+(d.manager_name||'')),el('p','Подтверждённых задач: '+d.status.count+' / '+d.status.minimum+' · норматив '+d.status.amount+' руб. · '+(d.status.eligible?'Минимум выполнен':'Минимум не выполнен')),el('p','Согласование ходатайства не означает начисление или выплату зарплаты.','muted'),table(['Задача','Дата','Основание'],d.tasks.map(t=>[d.catalog.find(c=>c[0]===t.code)?.[1]||t.code,t.done_on,t.evidence])));
  if(d.decision_note)n.append(el('p','Решение: '+d.decision_note));
  const command=(c,get)=>async f=>{await api('supplement/change',{id:d.id,expected_revision:d.rev,command:c,fields:get(f)});note('Запись подтверждена сервером');await render()};
  if(d.can_revise){const e=supplementTasksEditor(d.catalog,d.tasks);n.append(groups('Уточнить выполненные задачи',[e.host],'Сохранить задачи',command('revise',f=>({tasks:e.tasks(f)}))))}
  if(d.can_decide){if(d.status.eligible)n.append(groups('Согласовать',[input('note','Основание решения')],'Согласовать',command('approve',f=>({note:value(f,'note')}))));n.append(groups('Отклонить',[input('note','Основание решения')],'Отклонить',command('decline',f=>({note:value(f,'note')}))))}
  appendExports(n,d);setContent(host,n);
 }
 function mentorWorkflow(page,items,user){
  const order=page==='order.read',host=el('div'),n=panel(order?'Групповые приказы наставников':'Ходатайства о доплате');
  if(user.person_id&&user.permissions.includes(order?'order.register':'supplement.create'))n.append(button(order?'Зарегистрировать групповой приказ':'Создать ходатайство',()=>order?orderEditor(host):supplementEditor(host),'primary'));
  n.append(items.length?order?table(['Номер','Дата','Организация','Участников','Действует с','По','Действия'],items.map(r=>[r.order_number,r.order_on,r.organization,r.members,r.valid_from,r.valid_to,r.can_detail?button('Открыть приказ',()=>orderCard(host,r.id)):'—'])):table(['Сотрудник','Месяц','Роль','Состояние','Действия'],items.map(r=>[r.person_name,r.month,mentorRoles[r.role],supplementStates[r.state],r.can_detail?button('Открыть ходатайство',()=>supplementCard(host,r.id)):'—'])):empty(),host);return n;
 }
 const taskStates={open:'Открыто',in_progress:'В работе',implemented:'Ожидает проверки',verified:'Эффект подтверждён',ineffective:'Эффект не подтверждён',cancelled:'Отменено'},taskKinds={corrective:'Корректирующее мероприятие',instructor_training:'Переобучение инструктора',trainee_training:'Повторное обучение',development:'Индивидуальное развитие'};
 const methodNames={rc1:'RC1 · 20 критериев',corporate:'Приложение 13 · 17 критериев',self:'Приложение 14 · 16 критериев'};
 async function developmentEditor(host,initial=null){
  if(!discard())return;const d=await api('development/options');
  setContent(host,panel('Новый план развития',form([pick('person_id','Сотрудник',opts(initial?d.people.filter(p=>p.id===initial.person_id):d.people),initial?.person_id||''),fill(input('title','Цель плана'),initial?.title),dt('start_on','Начало',d.day),dt('due_on','Срок','')],'Создать план',async f=>{
   await api('development/create',Object.fromEntries(['person_id','title','start_on','due_on'].map(k=>[k,value(f,k)])));note('План создан');await render();
  })));
 }
 async function developmentCard(host,id){
  if(!discard())return;const d=await api('development/detail?id='+encodeURIComponent(id)),sub=el('div');
  const command=(c,get)=>async f=>{await api('development/change',{id:d.id,expected_revision:d.rev,command:c,fields:get(f)});note('Изменения сохранены');await render()};
  const n=panel(d.title+' · '+(d.person_name||''),el('p',d.start_on+' — '+d.due_on+' · '+(state[d.state]||d.state)));
  n.append(table(['Цель','Навык','Факт','Целевой уровень','Срок','Состояние','Действия'],d.goals.map(g=>{
   const actions=el('div');if(g.state==='open'){
    if(d.can_task)actions.append(button('Создать мероприятие',()=>taskEditor(sub,{kind:'development_goal',id:g.id,criterion_id:null})));
    if(d.can_close_goal){
     if(!g.skill_id||g.reached)actions.append(button('Завершить',()=>setContent(sub,panel('Фактический результат цели',form([input('reason','Результат / основание')],'Подтвердить',command('goal.finish',f=>({goal_id:g.id,goal_rev:g.rev,reason:value(f,'reason')})))))));
     actions.append(button('Отменить',()=>setContent(sub,panel('Отмена цели',form([input('reason','Основание')],'Отменить',command('goal.cancel',f=>({goal_id:g.id,goal_rev:g.rev,reason:value(f,'reason')})))))));
    }
   }
   return [g.title,g.skill,g.actual,g.target_level,g.due_on,g.state==='open'?'Открыта':state[g.state]||g.state,actions];
  })));
  if(d.can_goal){
   const skill=pick('skill_id','Навык (необязательно)',opts(d.skills),'',false),scale=pick('target','Шкала и уровень',d.scales.flatMap(s=>s.levels.map(l=>[s.id+'/'+l.value,s.name+' · '+l.value+' — '+l.label])),'',false);
   n.append(groups('Добавить цель',[input('title','Название цели'),skill,scale,dt('due_on','Срок',d.due_on)],'Добавить цель',command('goal.create',f=>{
    const skill_id=value(f,'skill_id')||null,t=value(f,'target');if(!!skill_id!==!!t)throw Error('Выберите навык и уровень либо оставьте оба поля пустыми');const [scale_id,level]=t?t.split('/'):[null,null];
    return {title:value(f,'title'),skill_id,scale_id,target_level:level===null?null:Number(level),due_on:value(f,'due_on')};
   })));
  }
  if(d.can_close){
   if(d.goals.length&&!d.goals.some(g=>g.state==='open'))n.append(groups('Завершить план',[input('reason','Результат')],'Завершить',command('finish',f=>({reason:value(f,'reason')}))));
   n.append(groups('Отменить план',[input('reason','Основание')],'Отменить',command('cancel',f=>({reason:value(f,'reason')}))));
  }
  n.append(sub);n.append(assistant({type:'development',id}));setContent(host,n);
 }
 async function bankEditor(host,previous=null){
  if(!discard())return;const d=await api('bank/options'),blocks=previous?.blocks||d.template,groupsHost=el('div'),entries=[];
  let key=0;
  for(const block of blocks){
   const section=el('fieldset'),list=el('div'),items=[],seen=new Set(block.questions.map(q=>q.id));let serial=0;
   function add(q=null){
    if(items.length>=300)throw Error('Не более 300 вопросов на блок');
    let id=q?.id;if(!id){do{id=block.id+'-extra-'+(++serial)}while(seen.has(id));seen.add(id)}
    const field='question_'+(++key),row=el('div'),entry={id,field,row};
    row.append(fill(input(field,'Вопрос'),q?.text),button('Удалить вопрос',()=>{items.splice(items.indexOf(entry),1);row.remove()}));items.push(entry);list.append(row)
   }
   block.questions.forEach(add);section.append(el('legend',block.title),list,button('Добавить вопрос',()=>add()));entries.push({block,items});groupsHost.append(section);
  }
  const profession=pick('profession_id','Профессия (пусто — общий банк)',opts(d.professions),previous?.profession_id||'',false);
  if(previous)profession.querySelector('select').disabled=true;
  setContent(host,panel(previous?'Актуализация банка вопросов':'Первичная редакция банка',el('p','Существующие номера и текст проверяются исходной методикой. Для ежегодной актуализации требуется изменение или добавление не менее 10% вопросов каждого блока.'),
   form([profession,dt('reviewed_on','Дата актуализации',d.day),input('note','Основание'),groupsHost],'Сохранить редакцию',async f=>{
    await api('bank/save',{profession_id:previous?previous.profession_id:value(f,'profession_id')||null,reviewed_on:value(f,'reviewed_on'),previous_id:previous?.id??null,note:value(f,'note'),blocks:entries.map(({block,items})=>({id:block.id,title:block.title,questions:items.map((q,i)=>({id:q.id,number:i+1,text:value(f,q.field)}))}))});note('Редакция банка сохранена');await render()
   })));
 }
 async function bankCard(host,id){
  if(!discard())return;const d=await api('bank/detail?id='+encodeURIComponent(id)),n=panel(d.profession+' · банк v'+d.version_no,el('p',d.reviewed_on+' · '+d.note));
  if(d.changes.length)n.append(table(['Блок','Прежних вопросов','Изменено','Требуется','Статус'],d.changes.map(x=>[x.title,x.previous,x.changed,x.required,x.ok?'Выполнено':'Не выполнено'])));
  for(const b of d.blocks){const det=el('details');det.append(el('summary',b.title+' · '+b.questions.length),table(['№','Вопрос'],b.questions.map(q=>[q.number,q.text])));n.append(det)}
  if(d.can_revise)n.append(button('Создать новую редакцию',()=>bankEditor(host,d),'primary'));
  appendExports(n,d);setContent(host,n);
 }
 async function qualityEditor(host,kind){
  if(!discard())return;const d=await api('quality/options?kind='+kind),n=panel(kind==='audit'?'Новый аудит первого уровня':'Новая самооценка'),sub=el('div');
  for(const k of d.installable)n.append(button('Установить '+methodNames[k],async()=>{await api('quality/install',{kind:k});note('Методика зарегистрирована');await render()}));
  if(!d.methods.length){n.append(el('p','Нет действующей методики. Зарегистрируйте утверждённую форму.'));setContent(host,n);return}
  if(kind==='audit'&&!d.assignments.length){n.append(el('p','Нет доступных согласованных инструктажей с фактическими этапами.'));setContent(host,n);return}
  if(kind==='self'&&!d.can_create){setContent(host,n);return}
  const method=pick('method_id','Методика',d.methods.map(m=>[m.id,m.label+' · '+m.criteria.length+' критериев']));
  n.append(method,button('Открыть чек-лист',()=>{
   if(!discard())return;const m=d.methods.find(x=>x.id===method.querySelector('select').value);if(!m)throw Error('Выберите методику');
   const answers=m.criteria.flatMap((q,i)=>[pick('answer_'+i,q.position+'. '+q.section+' · '+q.question,kind==='audit'?[['1','Да'],['0','Нет'],['not_observed','Не наблюдалось'],['not_applicable','Не применимо']]:Object.entries(m.levels)),input('note_'+i,'Комментарий / основание','text',false)]);
   const get=f=>m.criteria.map((q,i)=>{const v=value(f,'answer_'+i);return {criterion_id:q.id,value:kind==='self'||v==='0'||v==='1'?Number(v):v,note:value(f,'note_'+i)}});
   if(kind==='audit'){
    const t=pick('assignment_id','Фактическое обучение',opts(d.assignments,'label')),s=pick('session_id','Наблюдаемый этап',[]);
    const sync=()=>{const x=d.assignments.find(x=>x.id===t.querySelector('select').value),sel=s.querySelector('select');sel.replaceChildren();const o=el('option','Выберите');o.value='';sel.append(o);for(const v of x?.sessions||[]){const o=el('option',v.stage_code+' · '+v.held_at);o.value=v.id;sel.append(o)}};
    t.querySelector('select').addEventListener('change',sync);
    sub.replaceChildren(form([t,s,dt('observed_on','Дата наблюдения',d.day),...answers,input('feedback','Обратная связь')],'Зарегистрировать аудит',async f=>{
     const assignment_id=value(f,'assignment_id'),x=d.assignments.find(x=>x.id===assignment_id);await api('quality/audit',{assignment_id,assignment_rev:x.rev,session_id:value(f,'session_id'),method_id:m.id,observed_on:value(f,'observed_on'),responses:get(f),feedback:value(f,'feedback')});note('Аудит зарегистрирован');await render()
    }));
   }else sub.replaceChildren(form([el('p','Самооценка регистрируется от вашего имени.'),dt('evaluated_on','Дата',d.day),input('place','Место'),...answers,input('feedback','Обратная связь','text',false)],'Сохранить самооценку',async f=>{await api('quality/self',{method_id:m.id,evaluated_on:value(f,'evaluated_on'),place:value(f,'place'),responses:get(f),feedback:value(f,'feedback')});note('Самооценка зарегистрирована');await render()}));
  }),sub);setContent(host,n);
 }
 async function qualityCard(host,kind,id){
  if(!discard())return;const d=await api('quality/detail?kind='+kind+'&id='+encodeURIComponent(id)),sub=el('div'),n=panel(kind==='audit'?'Аудит · '+(d.mentor||''):'Самооценка · '+(d.person_name||''),el('p',d.date+' · v'+d.version+' · '+(kind==='audit'?d.method+' · '+d.operation:'Место: '+d.place)));
  if(kind==='audit'){
   n.append(el('p','Наблюдалось '+d.stats.observed+' / '+d.stats.expected+' · Да '+d.stats.yes+' · Нет '+d.stats.no+' · Результат '+(d.stats.pct===null?'нет сопоставимого факта':d.stats.pct.toFixed(1)+'%')+' · '+(d.state==='void'?'Аннулирован':'Зарегистрирован')),table(['№','Раздел','Критерий','Ответ','Комментарий','Рекомендация','Действие'],d.questions.map(q=>[q.position,q.section,q.question,d.labels[q.response]||q.response,q.note,q.recommendation,d.can_task&&q.response==='no'?button('Создать мероприятие',()=>taskEditor(sub,{kind:'audit',id:d.id,criterion_id:q.id})):'—'])),el('p',d.summary||''));
   if(d.can_void)n.append(groups('Аннулировать ошибочную запись',[input('reason','Основание')],'Аннулировать',async f=>{await api('quality/void',{id:d.id,expected_revision:d.rev,reason:value(f,'reason')});note('Запись аннулирована');await render()}));
   if(d.void_reason)n.append(el('p','Основание аннулирования: '+d.void_reason));
  }else n.append(table(['№','Раздел','Критерий','Уровень','Комментарий','Действие'],d.questions.map(q=>[q.position,q.section,q.question,q.value===null?'—':q.value+' · '+d.levels[q.value],q.note,d.can_task?button('Мероприятие',()=>taskEditor(sub,{kind:'self_eval',id:d.id,criterion_id:q.id})):'—'])),el('p',d.feedback||''));
  n.append(sub);appendExports(n,d);n.append(assistant({type:kind,id}));setContent(host,n);
 }
 async function taskEditor(host,source=null){
  if(!discard())return;const d=await api('tasks/options',source);
  if(!d.owners.length){setContent(host,panel('Мероприятие',el('p','Нет доступных исполнителей')));return}
  setContent(host,panel('Новое мероприятие',el('p','Источник: '+d.label),form([fill(input('title','Что необходимо выполнить'),source?d.label.slice(0,500):''),pick('owner_id','Ответственный',opts(d.owners)),pick('kind','Вид',d.kinds),pick('priority','Приоритет',[['normal','Обычный'],['major','Значимый'],['critical','Критический']],'normal'),dt('due_on','Срок',d.day)],'Создать мероприятие',async f=>{
   await api('tasks/create',{source,title:value(f,'title'),owner_id:value(f,'owner_id'),due_on:value(f,'due_on'),kind:value(f,'kind'),priority:value(f,'priority')});note('Мероприятие зарегистрировано');await render()
  })));
 }
 async function taskCard(host,id){
  if(!discard())return;const d=await api('tasks/detail?id='+encodeURIComponent(id)),sub=el('div'),n=panel(d.title,el('p',d.kind_label+' · '+d.state_label+' · срок '+d.due_on),el('p','Ответственный: '+(d.owner||'—')+' · сотрудник: '+(d.subject||'—')),el('p','Источник: '+d.source));
  const command=(c,get)=>async f=>{await api('tasks/change',{id:d.id,expected_revision:d.rev,command:c,fields:get(f)});note('Изменения подтверждены');await render()};
  if(d.result)n.append(el('p','Результат: '+d.result));
  if(d.followup)n.append(el('p',d.followup));
  if(d.followup_link){const l=d.followup_link;n.append(button('Открыть связанное обучение / план',()=>l.type==='assignment'?assignment(sub,l.id):l.type==='enrollment'?enrollmentCard(sub,l.id):developmentCard(sub,l.id)))}
  if(d.cap.link&&d.candidates.type){if(d.candidates.items.length)n.append(groups('Связать повторное обучение / план',[pick('id','Назначение / план',opts(d.candidates.items,'label'))],'Сохранить связь',command('link',f=>({type:d.candidates.type,id:value(f,'id')}))));else n.append(el('p','Сначала создайте соответствующее новое назначение обучения или план в рабочем разделе.'))}
  if(d.cap.start)n.append(button('Взять в работу',command('start',()=>({}))));
  if(d.cap.implement)n.append(groups('Выполнить своё мероприятие',[input('result','Фактический результат')],'Подтвердить выполнение',async f=>{await api('tasks/implement',{id:d.id,expected_revision:d.rev,result:value(f,'result')});note('Факт выполнения подтверждён');await render()}));
  if(d.cap.verify)n.append(groups('Независимая проверка эффекта',[pick('outcome','Результат проверки',[['effective','Эффект подтверждён'],['ineffective','Неэффективно'],['insufficient','Недостаточно данных']]),pick('audit_id','Последующий аудит',opts(d.evidence.audits,'label'),'',false),pick('assessment_id','Последующая практическая оценка',opts(d.evidence.practical,'label'),'',false),pick('sop_evaluation_id','Повторная корпоративная оценка СОП',opts((d.evidence.sop||[]).filter(x=>x.kind==='sop_evaluation'),'label'),'',false),pick('weighted_event_id','Повторный взвешенный чек-лист',opts((d.evidence.sop||[]).filter(x=>x.kind==='weighted_sop'),'label'),'',false),input('evidence','Обоснование и подтверждение')],'Зарегистрировать проверку',command('verify',f=>({outcome:value(f,'outcome'),audit_id:value(f,'audit_id')||null,assessment_id:value(f,'assessment_id')||null,sop_evaluation_id:value(f,'sop_evaluation_id')||null,weighted_event_id:value(f,'weighted_event_id')||null,evidence:value(f,'evidence')}))));
  if(d.cap.cancel)n.append(groups('Отменить мероприятие',[input('reason','Основание')],'Отменить',command('cancel',f=>({reason:value(f,'reason')}))));
  if(d.verification.length)n.append(table(['Дата проверки','Результат','Основание'],d.verification.map(v=>[v.checked_at,v.outcome,v.evidence_note])));
  n.append(sub);n.append(assistant({type:'task',id}));setContent(host,n);
 }
 function qualityPanel(page,items,user){
  const titles={'development.read':'Планы развития','audit.read':'Аудиты первого уровня','self.read':'Самооценки наставников','task.read':'Задачи и корректирующие мероприятия','bank.read':'Банк вопросов'},host=el('div'),n=panel(titles[page]);
  const specs={'development.read':['development.create','Создать план',()=>developmentEditor(host)],'audit.read':['audit.create','Новый аудит',()=>qualityEditor(host,'audit')],'self.read':['self.create','Новая самооценка',()=>qualityEditor(host,'self')],'task.read':['task.create','Создать мероприятие',()=>taskEditor(host)],'bank.read':['bank.save','Создать редакцию',()=>bankEditor(host)]};
  const [permission,label,fn]=specs[page];if(user.person_id&&(user.permissions.includes(permission)||['audit.read','self.read'].includes(page)&&user.permissions.includes('mentor.method.install')))n.append(button(label,fn,'primary'));
  if(page==='audit.read'){
   n.append(el('p','RC1 — основная рабочая форма из 20 критериев. Приложение 13 — отдельная форма из 17 критериев.'));
   if(user.person_id&&user.permissions.includes('audit.create')&&['audit.mobile.export','audit.mobile.import'].some(k=>user.permissions.includes(k)))n.append(button('Мобильный аудит · выгрузка и приём',async()=>{if(discard())setContent(host,await mobilePanel())}));
  }
  if(!items.length)n.append(empty());
  else if(page==='development.read')n.append(table(['Сотрудник','План','Начало','Срок','Состояние','Действия'],items.map(r=>[r.person_name,r.title,r.start_on,r.due_on,state[r.state]||r.state,r.can_detail?button('Открыть план',()=>developmentCard(host,r.id)):'—'])));
  else if(page==='audit.read')n.append(table(['Инструктор','Операция','Дата','Состояние','Действия'],items.map(r=>[r.mentor_name,r.operation_name,r.observed_at,r.state==='void'?'Аннулирован':r.historical?'Исторический':'Зарегистрирован',r.can_history?button('Исторический аудит',()=>openLinked(host,{type:'rc1_history',id:r.id})):r.can_detail?button('Открыть аудит',()=>qualityCard(host,'audit',r.id)):'—'])));
  else if(page==='self.read')n.append(table(['Сотрудник','Дата','Действия'],items.map(r=>[r.person_name,r.evaluated_on,r.can_detail?button('Открыть самооценку',()=>qualityCard(host,'self',r.id)):'—'])));
  else if(page==='bank.read')n.append(table(['Профессия','Версия','Дата','Действия'],items.map(r=>[r.profession,r.version_no,r.reviewed_on,r.can_detail?button('Открыть банк',()=>bankCard(host,r.id)):'—'])));
  else n.append(table(['Мероприятие','Вид','Исполнитель','Срок','Состояние','Действия'],items.map(r=>[r.title,taskKinds[r.kind],r.owner,r.due_on,taskStates[r.state]||r.state,r.can_detail?button('Открыть мероприятие',()=>taskCard(host,r.id)):r.can_implement?button('Выполнить',()=>setContent(host,panel(r.title,form([input('result','Фактический результат')],'Подтвердить выполнение',async f=>{await api('tasks/implement',{id:r.id,expected_revision:r.rev,result:value(f,'result')});note('Выполнение подтверждено');await render()})))):'—'])));
  n.append(host);return n;
 }
 const competencyStates={rated:'Подтверждённый уровень',not_observed:'Не наблюдалось',not_applicable:'Неприменимо'};
 const assessmentKinds={general_skill:'Общий навык',practical:'Практическая оценка',qualification:'Квалификация по СОП'};
 const criticalityNames={normal:'Обычная',important:'Важная',critical:'Критическая'};
 function levelChoices(scales){return scales.flatMap(s=>s.levels.map(l=>[s.id+'/'+l.value,s.name+' · '+l.value+' — '+l.label]))}
 const saveCompetency=async(command,fields,message='Запись сохранена')=>{await api('competency/change',{command,fields});note(message);await render()};
 async function skillEditor(host){
  if(!discard())return;const d=await api('competency/options?kind=skill'),n=panel('Каталог навыков');
  if(d.can_category)n.append(groups('Новая категория',[input('name','Название категории')],'Создать категорию',f=>saveCompetency('category.create',{name:value(f,'name')})));
  if(d.can_general)n.append(groups('Общий навык (без операции)',[pick('category_id','Категория',opts(d.categories)),input('name','Название навыка')],'Создать навык',f=>saveCompetency('skill.create',{category_id:value(f,'category_id'),name:value(f,'name')})));
  if(d.sops.length)n.append(groups('Создать навыки из действующих СОП',[el('p','Операции без активного навыка. Выберите одну редакцию для каждой операции.'),pick('category_id','Категория',opts(d.categories)),...d.sops.map(r=>check('sop_'+r.id,r.label))],'Создать выбранные навыки',f=>saveCompetency('skill.from_sop',{category_id:value(f,'category_id'),revisions:d.sops.filter(r=>checked(f,'sop_'+r.id)).map(({id,rev})=>({id,rev}))},'Навыки связаны с операциями')));
  if(!d.can_category&&!d.can_general&&!d.sops.length)n.append(el('p','Нет доступных команд или операций без навыка.'));
  setContent(host,n);
 }
 async function requirementEditor(host){
  if(!discard())return;const d=await api('competency/options?kind=requirement');
  if(!d.can_create){setContent(host,panel('Требование к профессии',el('p','Создание общего профиля доступно только в области предприятия.')));return}
  setContent(host,panel('Требование к профессии',form([pick('profession_id','Профессия',opts(d.professions)),pick('skill_id','Навык',opts(d.skills)),pick('target','Требуемая шкала и уровень',levelChoices(d.scales)),pick('criticality','Критичность',Object.entries(criticalityNames),'normal'),dt('valid_from','Начало действия',d.day),input('valid_to','Окончание (необязательно)','date',false)],'Создать требование',async f=>{
   const [scale_id,l]=value(f,'target').split('/');
   await saveCompetency('requirement.create',{profession_id:value(f,'profession_id'),skill_id:value(f,'skill_id'),scale_id,required_level:Number(l),criticality:value(f,'criticality'),valid_from:value(f,'valid_from'),valid_to:value(f,'valid_to')||null});
  })));
 }
 async function coverageEditor(host,previous=null){
  if(!discard())return;const d=await api('competency/options?kind=coverage');
  const u=pick('unit_id','Подразделение',opts(d.units),previous?.unit_id||''),s=pick('skill_id','Навык',opts(d.skills),previous?.skill_id||''),shift=optional('shift_code','Смена',d.shifts.map(r=>[r.code,r.name]));
  if(previous){shift.querySelector('select').value=previous.shift_code;for(const f of [u,s,shift])f.querySelector('select').disabled=true}
  setContent(host,panel(previous?'Уточнить потребность':'Потребность в покрытии',el('p','Фактическое покрытие рассчитывается по действующим оценкам и, для операционных навыков, допускам.'),form([u,s,shift,num('min_people','Необходимое число сотрудников',0,100000,previous?.min_people??1),pick('target','Шкала и требуемый уровень',levelChoices(d.scales),previous?previous.scale_id+'/'+previous.required_level:'')],'Сохранить потребность',async f=>{
   const [scale_id,l]=value(f,'target').split('/');await saveCompetency('coverage.save',{id:previous?.id??null,rev:previous?.rev??0,unit_id:previous?.unit_id||value(f,'unit_id'),skill_id:previous?.skill_id||value(f,'skill_id'),shift_code:previous?previous.shift_code:value(f,'shift_code'),min_people:Number(value(f,'min_people')),scale_id,required_level:Number(l)});
  })));
 }
 async function assessmentEditor(host,personId=null){
  if(!discard())return;const d=await api('competency/options?kind=assessment'),person=pick('person_id','Сотрудник',opts(d.people),personId||''),skill=pick('skill_id','Общий навык',opts(d.skills)),sub=el('div');
  const load=button('Выбрать сотрудника и навык',async()=>{
   if(!discard())return;
   const person_id=person.querySelector('select').value,skill_id=skill.querySelector('select').value;
   if(!person_id||!skill_id)throw Error('Выберите сотрудника и навык');
   const x=await api('competency/options?kind=assessment&person_id='+encodeURIComponent(person_id)+'&skill_id='+encodeURIComponent(skill_id));
   const observation=pick('observation_state','Состояние',Object.entries(competencyStates),'rated'),target=pick('target','Шкала и уровень',levelChoices(x.scales)),scale=pick('scale_id','Шкала',opts(x.scales)),until=input('valid_until','Действует до (необязательно)','date',false);
   const sync=()=>{const rated=observation.querySelector('select').value==='rated';target.hidden=!rated;target.querySelector('select').disabled=!rated;scale.hidden=rated;scale.querySelector('select').disabled=rated;until.hidden=!rated;until.querySelector('input').disabled=!rated};
   observation.querySelector('select').addEventListener('change',sync);sync();
   sub.replaceChildren(panel('Фактическая оценка',el('p',x.previous?'Последняя оценка '+x.previous.day+'. Новая запись сохраняет историю.':'Прежних оценок нет.'),form([dt('assessed_on','Дата оценки',x.day),observation,target,scale,until,input('evidence','Подтверждающее основание'),input('feedback','Обратная связь')],'Зарегистрировать оценку',async f=>{
    if(person.querySelector('select').value!==person_id||skill.querySelector('select').value!==skill_id)throw Error('Состав изменился. Повторно выберите сотрудника и навык');
    const observation_state=value(f,'observation_state'),rated=observation_state==='rated',[scale_id,l]=rated?value(f,'target').split('/'):[value(f,'scale_id'),null];
    await saveCompetency('assessment.general',{person_id,skill_id,scale_id,assessed_on:value(f,'assessed_on'),observation_state,level:rated?Number(l):null,valid_until:rated?value(f,'valid_until')||null:null,evidence:value(f,'evidence'),feedback:value(f,'feedback'),previous_assessment_id:x.previous?.id??null},'Оценка сохранена. Матрица использует подтверждённый факт.');
   })));
  });
  setContent(host,panel('Оценка общего навыка',el('p','Фактическая оценка, не допуск к операции. Операционные навыки подтверждаются через обучение по СОП.'),person,skill,load,sub));
 }
 async function assessmentCard(host,id){
  if(!discard())return;const d=await api('assessment/detail?id='+encodeURIComponent(id)),sub=el('div'),n=panel((assessmentKinds[d.kind]||d.kind)+' · '+(d.person||''),el('p',d.assessed_on+' · оценщик '+(d.evaluator||'—')),table(['Навык','Шкала','Уровень / состояние','Действует до','Основание'],d.items.map(x=>[x.skill,x.scale,x.level??competencyStates[x.observation_state],x.valid_until,x.evidence_note])),el('p',d.feedback||''));
  if(d.assignment_id)n.append(button('Открыть связанное обучение',()=>assignment(sub,d.assignment_id)),sub);appendExports(n,d);n.append(assistant({type:'assessment',id}));setContent(host,n);
 }
 function competencyPanel(page,items,user){
  const host=el('div'),n=panel({'skill.read':'Каталог навыков','requirement.read':'Требования к профессиям','coverage.read':'Покрытие по участкам и сменам','assessment.read':'Оценки компетенций'}[page]);
  const can=k=>!!user.person_id&&user.permissions.includes(k);
  if(page==='skill.read'){
   if(['skill.category.create','skill.create','skill.from_sop'].some(can))n.append(button('Создать навыки',()=>skillEditor(host),'primary'));
   n.append(items.length?table(['Навык','Категория','Операция'],items.map(r=>[r.name,r.category,r.operation||(r.operation_id?'Операция':'Общий навык')])):empty());
  }else if(page==='requirement.read'){
   if(can('requirement.create'))n.append(button('Добавить требование',()=>requirementEditor(host),'primary'));
   const closeRequirement=r=>{
    if(!discard())return;
    const editor=form([dt('valid_to','Последний день действия','')],'Закрыть',f=>saveCompetency('requirement.close',{id:r.id,rev:r.rev,valid_to:value(f,'valid_to')}));
    setContent(host,panel('Закрытие требования',editor));
   };
   const records=items.map(r=>[r.profession,r.skill,r.scale,r.required_level,criticalityNames[r.criticality],r.valid_from,r.valid_to,r.can_close?button('Закрыть требование',()=>closeRequirement(r)):'—']);
   n.append(records.length?table(['Профессия','Навык','Шкала','Уровень','Критичность','Начало','Окончание','Действия'],records):empty());
  }else if(page==='coverage.read'){
   if(can('coverage.save'))n.append(button('Добавить потребность',()=>coverageEditor(host),'primary'));
   n.append(el('p','Компетенции и зарегистрированные допуски — разные показатели. Покрытие по допускам не заменяет проверку фактической безопасности.','muted'),items.length?table(['Подразделение','Навык','Смена','Уровень','Требуется','По компетенции','Дефицит компетенции','С допуском','Действия'],items.map(r=>[r.unit,r.skill,r.shift_code||'Все',r.required_level,r.min_people,r.competent,r.competence_deficit,r.requires_admission_measure?r.actual:'—',r.can_edit?button('Изменить',()=>coverageEditor(host,r)):'—'])):empty());
  }else{
   if(can('assessment.general'))n.append(button('Оценить общий навык',()=>assessmentEditor(host),'primary'));
   n.append(items.length?table(['Сотрудник','Дата','Тип оценки','Навык','Оценщик','Действия'],items.map(r=>[r.person_name,r.assessed_on,assessmentKinds[r.kind]||r.kind,r.title,r.evaluator_name,r.can_detail?button('Открыть оценку',()=>assessmentCard(host,r.id)):'—'])):empty());
  }
  n.append(host);return n;
 }
 async function openRecord(host,type,id){
  const fn={training:assignment,enrollment:enrollmentCard,program:programCard,preparation:preparationCard,assessment:assessmentCard,audit:(h,i)=>qualityCard(h,'audit',i),self:(h,i)=>qualityCard(h,'self',i),task:taskCard,development:developmentCard,bank:bankCard,supplement:supplementCard,person:card,matrix}[type];
  if(['credential','appointment','authorization'].includes(type)){
   if(!discard())return;const r=await api('resources?action='+type+'.read&id='+encodeURIComponent(id));
   return setContent(host,mentor(type,[r.data],null));
  }
  if(!fn)throw Error('Источник недоступен');
  return fn(host,id);
 }
 async function employmentEditor(host,id){
  if(!discard())return;
  const d=await api('employment/detail?id='+encodeURIComponent(id)),n=panel('Кадровое назначение · '+(d.person_name||'Сотрудник'),el('p',[d.unit,d.profession,d.position,d.shift,d.valid_from,d.valid_to].filter(Boolean).join(' · ')));
  if(d.can_transfer){
   const options=(key,label,current)=>{const list=d.references[key]||[];const found=list.some(x=>x.id===current);const choices=opts(list);if(current&&!found)choices.push([current,'Существующая ссылка (нет доступа)']);const field=optional(key,label,choices);field.querySelector('select').value=current||'';return field};
   const unit=pick('unit_id','Новое подразделение',opts(d.units),d.unit_id),start=dt('valid_from','Дата начала нового назначения',d.earliest);
   start.querySelector('input').min=d.earliest;
   n.append(el('p','Предыдущее назначение будет закрыто днём, предшествующим новому. История и документы сохраняются. Бизнес-роли и выданные права автоматически не изменяются.'),form([unit,options('profession_id','Профессия',d.profession_id),options('position_id','Должность',d.position_id),options('shift_id','Смена',d.shift_id),start],'Оформить новое назначение',async f=>{
    await api('employment/transfer',{id:d.id,expected_revision:d.rev,unit_id:value(f,'unit_id'),profession_id:value(f,'profession_id')||null,position_id:value(f,'position_id')||null,shift_id:value(f,'shift_id')||null,valid_from:value(f,'valid_from')});note('Кадровое назначение сохранено');await render();
   }));
  }else n.append(el('p','Перемещение недоступно: закрытое, будущее или уже имеющее преемника назначение, либо недостаточно полномочий.'));
  setContent(host,n);
 }
 function personnelPanel(page,items){
  const host=el('div'),role=page==='role_assignment.read',n=panel(role?'История назначений бизнес-ролей':'Кадровые назначения');
  n.append(el('p',role?'Бизнес-роли не равны правам приложения. Управление ролями и грантами остаётся отдельной административной операцией.':'История назначения сохраняется. При перемещении нужны единые полномочия на исходное и целевое подразделения.'));
  if(role)n.append(items.length?table(['Сотрудник','Роль','Начало','Окончание','Состояние'],items.map(r=>[r.person_name,r.role,r.valid_from,r.valid_to,r.state])):empty());
  else n.append(items.length?table(['Сотрудник','Подразделение','Профессия','Должность','Смена','Начало','Окончание','Состояние','Действия'],items.map(r=>[r.person_name,r.unit,r.profession,r.position,r.shift,r.valid_from,r.valid_to,r.state,r.can_transfer?button('Изменить назначение',()=>employmentEditor(host,r.id)):'—'])):empty());
  n.append(host);return n;
 }

 const queueTypes={all:'Все основания',revision:'Изменение СОП',practical:'Практическая оценка',audit:'Аудит L1',skill:'Разрыв навыков',self_eval:'Самооценка / развитие',action:'Мероприятие'};
 const queueStates={all:'Все состояния',needs:'Требуется решение',linked:'Есть связанная запись',done:'Новое обучение завершено',blocked:'Нет действующей редакции'};
 const actualStates={completed:'Выполнено',incomplete:'Не выполнено',started:'Начато'};
 async function registerPanel(page,personId=null){
  const journal=page==='journal',host=el('div'),out=el('div'),today=new Date().toISOString().slice(0,10);
  const from=dt('journal_from','С даты',today.slice(0,8)+'01'),to=dt('journal_to','По дату',today),q=input('register_search','Поиск по сотруднику, СОП, основанию','text',false);
  const type=select('queue_type','Основание',Object.entries(queueTypes)),status=select('queue_state','Состояние',Object.entries(queueStates));
  const val=x=>x.querySelector('input,select').value;
  async function load(offset=0){
   const params=new URLSearchParams({q:val(q),offset:String(offset),...(personId?{person_id:personId}:{}),...(journal?{from:val(from),to:val(to)}:{type:val(type),state:val(status)})});
   const d=await api('training/'+(journal?'journal':'retraining')+'?'+params);
   const open=(r,label)=>r?button(label,()=>openLinked(host,r)):'—';
   const headers=journal?['Дата / время','Подразделение','Инструктор','Обучаемый','СОП','Этап','Минут','Результат','Основание','Действия']:['Сотрудник','Подразделение','Основание','Содержание','Новая редакция','Срок','Состояние','Действия'];
   const lines=d.items.map(x=>{
    const actions=el('div',undefined,'row');
    if(journal){
     actions.append(button('Открыть обучение',()=>assignment(host,x.assignment_id)));
     if(x.can_export)actions.append(button('Журнал XLSX',()=>downloadForm('journal',x.assignment_id)));
     return [x.date,x.unit,x.mentor,x.trainee,x.sop,x.stage,x.minutes,actualStates[x.result]||x.result,x.note,actions];
    }
    if(x.source)actions.append(open(x.source,'Основание'));
    if(x.next)actions.append(open(x.next,'Связанная запись'));
    if(x.create?.type==='training')actions.append(button('Назначить переобучение',()=>assignmentEditor(host,null,x.create)));
    if(x.create?.type==='task')actions.append(button('Создать мероприятие',()=>taskEditor(host,x.create.source)));
    if(x.create?.type==='development')actions.append(button('Запланировать развитие',()=>developmentEditor(host,x.create)));
    return [x.person,x.unit,queueTypes[x.type],x.description,x.current,x.due,queueStates[x.status],actions];
   });
   const paging=el('div',undefined,'row');if(offset)paging.append(button('Предыдущие 100',()=>load(Math.max(0,offset-100))));if(d.next!==null)paging.append(button('Следующие 100',()=>load(d.next)));
   out.replaceChildren(el('p','Доступных записей по фильтру: '+d.total+(journal?' · Фактических минут: '+d.minutes:'')),d.items.length?table(headers,lines):empty(),paging);
  }
  const root=panel(journal?'Журнал заданий и проведённых инструктажей':'Единая очередь оснований для переобучения',el('p',journal?'Фактические записи из назначений. Повторения сохраняются отдельно, плановая дата не считается фактом.':'Изменения СОП, практика, аудит, дефицит навыков и мероприятия. Новые назначения не создаются автоматически. Очередь требует полной видимости исходных регистров.'),...(journal?[from,to]:[type,status]),q,button('Применить фильтр',()=>load()),out,host);
  await load();return root;
 }
 const scoreText=x=>x===null?'Нет сопоставимой оценки':(100*x).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%';
 async function sopEvaluationEditor(host){
  if(!discard())return;
  const d=await api('sop-evaluation/options'),n=panel('Новая корпоративная оценка СОП'),sub=el('div');
  if(d.can_install)n.append(button('Установить утверждённый чек-лист из 20 критериев',async()=>{await api('sop-evaluation/install',{kind:'builtin'});note('Методика зарегистрирована');await sopEvaluationEditor(host)}));
  if(!d.methods.length||!d.revisions.length){n.append(el('p','Нужны доступная редакция СОП и действующая методика.'));setContent(host,n);return}
  const revision=pick('revision_id','Редакция СОП',opts(d.revisions,'label')),method=pick('method_id','Методика',d.methods.map(x=>[x.id,'Версия '+x.version+' · '+x.criteria.length+' критериев']));
  n.append(revision,method,button('Открыть чек-лист',()=>{
   const rev=d.revisions.find(x=>x.id===revision.querySelector('select').value),m=d.methods.find(x=>x.id===method.querySelector('select').value);
   if(!rev||!m)throw Error('Выберите редакцию и методику');
   const answers=m.criteria.flatMap((q,i)=>[pick('answer_'+i,q.position+'. '+q.question,[['1','Да'],['0','Нет']]),input('note_'+i,'Комментарий','text',false)]);
   sub.replaceChildren(form([el('p','Оценщик — текущий сотрудник. Все критерии требуют ответа. '+rev.label),dt('evaluated_on','Дата оценки',d.day),input('place','Место проведения'),...answers],'Зарегистрировать оценку',async f=>{
    if(revision.querySelector('select').value!==rev.id||method.querySelector('select').value!==m.id)throw Error('Выбранная редакция или методика изменилась. Откройте чек-лист заново.');
    await api('sop-evaluation/create',{revision_id:rev.id,method_id:m.id,source_sha256:rev.source_sha256,evaluated_on:value(f,'evaluated_on'),place:value(f,'place'),responses:m.criteria.map((q,i)=>({criterion_id:q.id,value:Number(value(f,'answer_'+i)),note:value(f,'note_'+i)}))});
    note('Оценка зарегистрирована');await render();
   }));
  }),sub);setContent(host,n);
 }
 async function sopEvaluationCard(host,kind,id){
  if(!discard())return;
  const d=await api('sop-evaluation/detail?kind='+encodeURIComponent(kind)+'&id='+encodeURIComponent(id)),weighted=kind==='weighted_sop',sub=el('div');
  const n=panel(weighted?'Исторический взвешенный чек-лист':'Корпоративная оценка СОП',el('p',[d.sop,d.date,d.actor||'Оценщик не указан',d.method,d.place,scoreText(d.score)].filter(Boolean).join(' · ')),button('Открыть редакцию СОП',()=>openLinked(sub,{type:'sop',id:d.revision_id})));
  if(d.actor===null&&weighted)n.append(el('p','Оценщик не зарегистрирован. Мероприятие по этому снимку недоступно.'));
  n.append(table(['№','Требование','Оценка',...(weighted?['Вес','Источник']:[]),'Комментарий','Действие'],d.questions.map(q=>[q.position,q.question,q.value??'—',...(weighted?[q.weight,q.source]:[]),q.note,q.can_task?button('Создать мероприятие',()=>taskEditor(sub,{kind,id,criterion_id:q.id})):'—'])));
  if(d.tasks.length)n.append(panel('Связанные мероприятия',table(['Задача','Срок','Состояние',''],d.tasks.map(t=>[t.title,t.due_on,taskStates[t.state]||t.state,button('Открыть',()=>taskCard(sub,t.id))]))));
  n.append(sub);n.append(assistant({type:kind,id}));setContent(host,n);
 }
 async function sopEvaluationPanel(){
  const host=el('div'),out=el('div'),today=new Date().toISOString().slice(0,10),kind=select('sop_eval_kind','Вид оценки',[['sop_evaluation','Корпоративная бинарная'],['weighted_sop','Взвешенный чек-лист конструктора']]),from=dt('sop_eval_from','С даты',today.slice(0,4)+'-01-01'),to=dt('sop_eval_to','По дату',today),q=input('sop_eval_search','Поиск','text',false),method=select('sop_eval_method','Методика',[['','Все версии']]),val=x=>x.querySelector('input,select').value;
  let canCreate=false,canInstall=false;
  const controls=el('div',undefined,'row');
  async function load(offset=0,reset=false){
   const k=val(kind),m=reset?'':val(method),p=new URLSearchParams({kind:k,from:val(from),to:val(to),q:val(q),method:m,offset:String(offset)});
   const d=await api('sop-evaluation?'+p);
   const sel=method.querySelector('select');sel.replaceChildren(...[['','Все версии'],...d.methods.map(x=>[x.id,x.label])].map(([id,label])=>{const o=el('option',label);o.value=id;return o}));sel.value=d.methods.some(x=>x.id===m)?m:'';
   canCreate=d.can_create;canInstall=d.can_install;controls.replaceChildren();
   if(canCreate)controls.append(button('Новая оценка СОП',()=>sopEvaluationEditor(host),'primary'));
   if(canInstall&&!canCreate)controls.append(button('Установить утверждённую методику',async()=>{await api('sop-evaluation/install',{kind:'builtin'});note('Методика зарегистрирована');await load()}));
   const paging=el('div',undefined,'row');if(offset)paging.append(button('Предыдущие 100',()=>load(Math.max(0,offset-100))));if(d.next!==null)paging.append(button('Следующие 100',()=>load(d.next)));
   out.replaceChildren(el('p','Записей: '+d.total+' · Сравнивайте только одну версию методики / одинаковый набор требований и весов.'),d.items.length?table(['Дата','СОП','Оценщик','Методика','Результат',''],d.items.map(x=>[x.date,x.sop,x.actor,x.method,scoreText(x.score),button('Открыть оценку',()=>sopEvaluationCard(host,x.kind,x.id))])):empty(),paging);
  }
  kind.querySelector('select').addEventListener('change',()=>run(()=>load(0,true)));
  const root=panel('Оценки СОП',el('p','Бинарная корпоративная оценка и взвешенная методика Stage43 не объединяются. Исторические снимки не редактируются. По подтверждённому отклонению создаётся мероприятие.'),controls,kind,from,to,method,q,button('Применить фильтр',()=>load()),out,host);
  await load();return root;
 }

 return {training,matrices,card,mentor,programPanel,mentorWorkflow,qualityPanel,competencyPanel,openRecord,personnelPanel,registerPanel,sopEvaluationPanel,sopEvaluationCard};
}
