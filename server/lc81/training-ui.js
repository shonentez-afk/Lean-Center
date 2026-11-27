// Protected forms and corporate fact tables. All authority, status, scores and
// actor identities are determined by the server.
export function createTrainingUI({api,run,button,panel,table,el,input,select,form,value,note,render,discard,check}){
 const opts=(items,field='name')=>items.map(x=>[x.id,x[field]]);
 const empty=()=>el('p','Нет доступных записей','muted');
 const state={planned:'Запланировано',in_progress:'В работе',completed:'Завершено',cancelled:'Отменено',active:'Действует',retired:'Архив',pass:'Пройдено',fail:'Не пройдено'};
 const dt=(name,label,day)=>{const x=input(name,label,'date');x.querySelector('input').value=day||'';return x};
 const optional=(name,label,items)=>{const x=select(name,label,[['','— Не выбрано —'],...items]);x.querySelector('select').required=false;return x};
 const number=(name,label,min,max,def='')=>{const x=input(name,label,'number'),n=x.querySelector('input');n.min=min;n.max=max;n.step=1;n.value=def;return x};
 const checked=(f,k)=>f.elements.namedItem(k).checked;
 function groups(title,fields,submit,fn){
  const det=el('details');det.append(el('summary',title),form(fields,submit,fn));return det;
 }
 function setContent(host,n){host.replaceChildren(n);host.scrollIntoView({block:'nearest'})}
 async function assignmentEditor(host,link=null){
  const root=await api('training/options'),out=el('div'),op=select('operation_id','Операция',[['','— Выберите операцию —'],...opts(root.operations)]);
  if(link){const field=op.querySelector('select');field.value=link.operation_id;field.disabled=true;if(!field.value)throw Error('Операция задания недоступна')}
  const load=button('Выбрать операцию',async()=>{
   const id=op.querySelector('select').value;if(!id)throw Error('Выберите операцию');
   const d=await api('training/options?operation_id='+encodeURIComponent(id));
   if(link){
    d.people=d.people.filter(p=>p.id===link.trainee_id);d.revisions=d.revisions.filter(r=>r.id===link.revision_id);d.skills=d.skills.filter(s=>s.id===link.skill_id);d.scales=d.scales.filter(s=>s.id===link.scale_id).map(s=>({...s,levels:s.levels.filter(l=>l.value===link.target_level)}));
   }
   if(!d.people.length||!d.mentors.length||!d.revisions.length||!d.skills.length||!d.scales.length||link&&!d.scales[0]?.levels.length){out.replaceChildren(el('p','Для операции нужны обучаемые, действующий инструктор с полномочием, СОП, навык и шкала.'));return}
   const revision=select('revision_id','Действующая редакция СОП',opts(d.revisions,'title'));
   const scale=select('scale_id','Шкала',opts(d.scales)),level=select('target_level','Целевой уровень',[]);
   function levels(){level.querySelector('select').replaceChildren(...(d.scales.find(x=>x.id===scale.querySelector('select').value)?.levels||[]).map(x=>{const n=el('option',x.value+' · '+x.label);n.value=x.value;return n}))}
   scale.querySelector('select').addEventListener('change',levels);levels();
   const variant=select('variant','Методика JI-2',Object.entries(d.variants));
   const realShow=number('real_show','SMED · номер реального показа',1,3,1),realTry=number('real_try','SMED · номер реальной пробы',1,4,1);
   const segments=input('segments','Дробный инструктаж · группы шагов (например 1-3,4-6)','text',false),hazard=check('hazardous','Требуется предварительная проверка безопасности');
   function mode(){const v=variant.querySelector('select').value;realShow.hidden=realTry.hidden=v!=='smed';segments.hidden=v!=='fractional';segments.querySelector('input').required=v==='fractional'}
   variant.querySelector('select').addEventListener('change',mode);mode();
   out.replaceChildren(form([select('trainee_id','Обучаемый',opts(d.people)),select('authorization_id','Инструктор с действующим полномочием',opts(d.mentors)),revision,select('skill_id','Навык',opts(d.skills)),scale,level,dt('assigned_on','Начало',link&&link.start_on>d.day?link.start_on:d.day),dt('due_on','Срок',link?.due_on||''),input('reason','Основание'),variant,number('followups','Контрольные проверки',2,10,2),realShow,realTry,segments,hazard,check('plan_reviewed','План TWI действующей редакции проверен')],'Создать назначение',async f=>{
    const v=value(f,'variant'),parts=v==='fractional'?value(f,'segments').split(',').map(s=>{const m=/^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(s);if(!m)throw Error('Укажите группы шагов, например 1-3,4-6');return {from:Number(m[1]),to:Number(m[2])}}):[];
    await api('training/create',{operation_id:id,trainee_id:value(f,'trainee_id'),authorization_id:value(f,'authorization_id'),revision_id:value(f,'revision_id'),skill_id:value(f,'skill_id'),scale_id:value(f,'scale_id'),target_level:Number(value(f,'target_level')),assigned_on:value(f,'assigned_on'),due_on:value(f,'due_on'),reason:value(f,'reason'),variant:v,method_config:{followups:Number(value(f,'followups')),segments:parts,realShow:v==='smed'?Number(value(f,'real_show')):null,realTry:v==='smed'?Number(value(f,'real_try')):null,hazardous:checked(f,'hazardous')},plan_reviewed:checked(f,'plan_reviewed'),...(link?{enrollment_id:link.enrollment_id,program_task_id:link.program_task_id,enrollment_rev:link.enrollment_rev}:{})});
    note('Назначение сохранено. Требуются подтверждения согласующих.');await render();
   }));
  },'primary');
  setContent(host,panel(link?'Назначение по заданию программы':'Новое назначение',op,load,out));
 }
 async function assignment(host,id){
  if(!discard())return;
  const d=await api('training/detail?id='+encodeURIComponent(id)),n=panel('Карточка обучения · '+d.trainee,
   el('p',d.operation+' · '+d.mentor+' · '+(state[d.state]||d.state)+' · '+d.method_version),
   el('p','Срок '+d.due_on+' · '+d.completed+'/'+d.stages.length+' этапов · '+(d.approved?'Согласовано':'Требуется согласование')),
   table(['Этап','Состояние'],d.stages.map(s=>[s.label,s.done?'Выполнено':s.code===d.next?'Следующий':'Ожидается'])),
   table(['Фактический этап','Дата','Мин.','Результат','Примечание'],d.facts.map(f=>[d.stages.find(s=>s.code===f.stage_code)?.label||f.stage_code,f.held_at,f.duration_minutes,state[f.result]||f.result,f.notes])),
   table(['Проверка','Результат','Дата'],d.verification.map(v=>[v.kind==='safety'?'Безопасность':'Теория',state[v.result]||'Нет',v.day])),
   el('p','Практика: '+(d.practical?d.conclusions[d.practical.conclusion]:'Нет оценки')+' · Квалификация: '+(d.qualification?.level??'Нет уровня')+' · '+d.admission));
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
    const held=input('held_at','Фактические дата и время','datetime-local');
    n.append(groups('Регистрация инструктажа',[stage,held,number('duration','Минуты',1,1440),select('result','Результат',[['completed','Выполнен'],['incomplete','Не завершён']]),input('notes','Что выполнено'),optional('witness_id','Демонстратор (если требуется)',opts(d.witnesses)),check('mentor_ack','Инструктор подтвердил факт'),check('trainee_ack','Обучаемый подтвердил факт')],'Записать факт инструктажа',command('stage',f=>({stage_code:value(f,'stage_code'),held_at:value(f,'held_at'),duration_minutes:Number(value(f,'duration')),result:value(f,'result'),notes:value(f,'notes'),witness_id:value(f,'witness_id')||null,mentor_ack:checked(f,'mentor_ack'),trainee_ack:checked(f,'trainee_ack')}))));
   }
   if(cap.verify)n.append(groups('Проверка знаний',[select('kind','Вид проверки',[['safety','Безопасность'],['theory','Теория']]),dt('evaluated_on','Фактическая дата',d.day),select('result','Результат',[['pass','Пройдено'],['fail','Не пройдено']]),input('evidence','Подтверждающий документ / факт'),input('feedback','Обратная связь')],'Записать проверку',command('verify',f=>({kind:value(f,'kind'),evaluated_on:value(f,'evaluated_on'),result:value(f,'result'),evidence:value(f,'evidence'),feedback:value(f,'feedback')}))));
   if(cap.practical&&d.methods.length){
    const method=d.methods[0],fields=method.criteria.flatMap((q,i)=>[select('answer_'+i,q.section+' · '+q.question,[['','— Выберите —'],['1','Да'],['0','Нет']]),input('note_'+i,'Примечание','text',false)]);
    n.append(groups('Практическая оценка',[dt('assessed_on','Дата',d.day),...fields,select('conclusion','Заключение',Object.entries(d.conclusions)),input('feedback','Обратная связь')],'Сохранить оценку',command('practical',f=>({assessed_on:value(f,'assessed_on'),method_id:method.id,responses:method.criteria.map((q,i)=>({criterion_id:q.id,value:Number(value(f,'answer_'+i)),note:value(f,'note_'+i)})),conclusion:value(f,'conclusion'),feedback:value(f,'feedback')}))));
   }
   if(cap.qualify&&d.practical){
    const until=input('valid_until','Действует до','date',false);
    n.append(groups('Квалификация',[dt('assessed_on','Дата',d.day),select('observation_state','Результат наблюдения',[['rated','Оценено'],['not_observed','Не наблюдалось'],['not_applicable','Неприменимо']]),select('level','Уровень',d.levels.map(x=>[x.value,x.label])),until,input('evidence','Подтверждение'),input('feedback','Обратная связь')],'Подтвердить квалификацию',command('qualify',f=>({assessed_on:value(f,'assessed_on'),practical_id:d.practical.id,observation_state:value(f,'observation_state'),level:value(f,'observation_state')==='rated'?Number(value(f,'level')):null,valid_until:value(f,'observation_state')==='rated'?value(f,'valid_until')||null:null,evidence:value(f,'evidence'),feedback:value(f,'feedback')}))));
   }
   if(cap.admit)n.append(groups('Решение о допуске',[dt('decided_on','Дата решения',d.day),select('decision','Решение',[['granted','Допустить'],['denied','Отказать']]),input('valid_until','Действует до','date',false),input('evidence','Основание'),input('feedback','Обратная связь')],'Зарегистрировать решение',command('admit',f=>({decided_on:value(f,'decided_on'),valid_until:value(f,'decision')==='granted'?value(f,'valid_until')||null:null,decision:value(f,'decision'),evidence:value(f,'evidence'),feedback:value(f,'feedback')}))));
  }
  setContent(host,n);
 }
 async function sop(host,id){
  if(!discard())return;
  const d=await api('training/sop?id='+encodeURIComponent(id));
  setContent(host,panel(d.code+' · '+d.title+' · v'+d.version_no,table(['Шаг','Действие','Ключевые моменты','Причина','Сек.'],d.steps.map(s=>[s.position,s.action_text,s.key_points.join(' · '),s.reason_text,s.duration_seconds]))));
 }
 function training(items,user){
  const host=el('div'),n=panel('Назначения производственного обучения');
  if(user.person_id&&user.permissions.includes('training.create'))n.append(button('Назначить обучение',()=>discard()&&assignmentEditor(host),'primary'));
  n.append(items.length?table(['Обучаемый','Операция','Срок','Состояние','Действия'],items.map(r=>{const b=el('div',undefined,'row');if(r.can_detail)b.append(button('Карточка обучения',()=>assignment(host,r.id)));if(r.can_sop)b.append(button('СОП обучения',()=>sop(host,r.id)));return [r.trainee_name,r.operation_name,r.due_on,state[r.state]||r.state,b.childElementCount?b:'Только чтение']})):empty(),host);return n;
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
    return {box,keys:()=>[...list.children].filter(row=>row.querySelector('input').checked).map(row=>row.dataset.key)};
   };
   const people=picker('Строки · сотрудники',roster,'p_',previous?.roster.map(r=>r.person_id)),columns=picker('Столбцы · навыки и СОП',cols,'c_',previous?.columns.map(c=>c.skill_id+':'+c.document_id));
   const code=input('code','Код матрицы'),title=input('title','Название');code.querySelector('input').value=previous?.code||'';title.querySelector('input').value=previous?.title||'';if(previous)code.querySelector('input').readOnly=true;
   if(!roster.length||!cols.length||!d.scales.length){out.replaceChildren(el('p','Нужны сотрудники, навыки и корпоративная шкала 1–4. Проверьте фильтры.'));return}
   const scale=select('scale_id','Шкала',opts(d.scales));if(previous)scale.querySelector('select').value=previous.scale_id;
   const missing=(previous?.roster.filter(r=>!roster.some(x=>x.key===r.person_id)).length||0)+(previous?.columns.filter(c=>!cols.some(x=>x.key===c.skill_id+':'+c.document_id)).length||0);
   const warn=el('p',missing?'Часть прежнего состава недоступна в выбранных фильтрах: '+missing+'. Проверьте новый состав перед сохранением.':'Порядок строк и столбцов можно изменить стрелками.','muted');
   out.replaceChildren(form([warn,code,title,scale,dt('target_on','Целевая дата',previous?.target_on||''),people.box,columns.box],'Сохранить матрицу',async f=>{
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
  const rows=d.roster.map((r,i)=>[r.name,r.position,...d.cells[i].map(x=>{const cell=el('div',x.actual??'—','lc81-matrix-cell');if(x.actual!==null)cell.dataset.level=String(x.actual);cell.title='Срез: '+(x.base??'—')+' · Цель: '+(x.target??'—')+' · Потребность: '+(x.need??'—')+' · '+x.reason+' · '+x.admission;return cell}),d.byPerson[i].base,d.byPerson[i].actual,d.byPerson[i].target,d.byPerson[i].need]);
  rows.push(['ИТОГО','',...d.bySkill.map(x=>x.actual),d.totals.base,d.totals.actual,d.totals.target,d.totals.need]);n.append(table(headings,rows));
  n.append(el('p',Object.entries(d.levels).map(([k,v])=>k+' — '+v).join(' · ')+' · Цели без факта: '+d.totals.unknown,'muted'));
  if(d.can_revise)n.append(button('Создать новую версию матрицы',()=>matrixEditor(host,d),'primary'));
  if(d.can_retire)n.append(groups('Закрыть матрицу',[input('reason','Причина')],'Закрыть',async f=>{await api('matrix/retire',{id:d.id,expected_revision:d.rev,reason:value(f,'reason')});note('Матрица закрыта');await render()}));
  setContent(host,n);
 }
 function matrices(items,user){
  const host=el('div'),n=panel('Матрицы компетенций');
  if(user.person_id&&user.permissions.includes('matrix.create'))n.append(button('Создать матрицу',()=>matrixEditor(host),'primary'));
  n.append(items.length?table(['Код','Название','Версия','Срез','Цель','Сотрудников','Навыков','Состояние','Действия'],items.map(r=>[r.code,r.title,r.version_no,r.base_on,r.target_on,r.people,r.skills,state[r.state]||r.state,r.can_detail?button('Открыть матрицу',()=>matrix(host,r.id)):'Только чтение'])):empty(),host);return n;
 }
 async function card(host,id){
  if(!discard())return;
  const d=await api('person/card?id='+encodeURIComponent(id)),n=panel('Карточка сотрудника · '+d.person.display_name,el('p',[d.person.employee_code,d.person.unit,d.person.position].filter(Boolean).join(' · ')));
  for(const s of d.sections){
   const details=el('details');details.append(el('summary',s.title+' · '+s.items.length));
   const labels={code:'Код',title:'Название',due_on:'Срок',state:'Состояние',start_on:'Начало',month:'Месяц',version_no:'Версия',role:'Роль',kind:'Вид',issued_on:'Выдан',valid_until:'Срок действия',order_on:'Дата приказа',valid_from:'Начало',valid_to:'Окончание',operation_name:'Операция',revoked_at:'Отозвано',observed_at:'Дата наблюдения',category:'Категория',adaptation:'Адаптация',safety:'ОТ',internship:'Стажировка',base_on:'Срез',target_on:'Цель',people:'Сотрудников',skills:'Навыков'};
   const keys=Object.keys(labels).filter(k=>s.items.some(r=>Object.hasOwn(r,k))),sub=el('div');
   const rows=s.items.map(r=>[...keys.map(k=>k==='state'?state[r[k]]||r[k]:r[k]),s.action==='training.read'&&r.can_detail?button('Открыть обучение',()=>assignment(sub,r.id)):s.action==='matrix.read'&&r.can_detail?button('Открыть матрицу',()=>matrix(sub,r.id)):s.action==='training.enrollment.read'&&r.can_detail?button('Открыть программу',()=>enrollmentCard(sub,r.id)):s.action==='preparation.read'&&r.can_detail?button('Открыть комплект',()=>preparationCard(sub,r.id)):'']);
   details.append(table([...keys.map(k=>labels[k]),'Действия'],rows),sub);n.append(details);
  }
  if(!d.sections.length)n.append(el('p','Нет связанных записей, доступных вашей учётной записи.'));
  setContent(host,n);
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
 async function programEditor(host,previous=null){
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
  const fields=[code,fill(input('title','Название'),previous?.title),pick('standard_kind','Вид документа',Object.entries(d.kinds),previous?.standard_kind||previous?.kind||'production'),pick('profession_id','Профессия (необязательно)',opts(d.professions),previous?.profession_id||'',false),pick('position_id','Должность (необязательно)',opts(d.positions),previous?.position_id||'',false),tasksHost,button('Добавить задание',()=>add())];
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
  setContent(host,n);
 }
 async function enrollmentEditor(host){
  if(!discard())return;
  const d=await api('enrollment/options');
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
  n.append(sub);setContent(host,n);
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
 async function preparationCard(host,id){
  if(!discard())return;const d=await api('preparation/detail?id='+encodeURIComponent(id)),sub=el('div');
  setContent(host,panel('Комплект подготовки · '+(d.trainee||''),el('p',(d.category==='new'?'Новый сотрудник':'Перевод')+' · '+d.status),table(['Документ','Состояние','Действия'],d.documents.map(x=>[kindLabels[x.kind],state[x.state]||x.state,x.id?button('Открыть программу',()=>enrollmentCard(sub,x.id)):'—'])),el('p','Смены стажировки: факт '+d.completed_shifts+' / план '+d.planned_shifts.length),table(['Дата','Смена'],d.planned_shifts.map(s=>[s.date,s.shift])),sub));
 }
 function programPanel(page,items,user){
  const host=el('div'),n=panel(page==='program.read'?'Шаблоны программ':page==='training.enrollment.read'?'Персональные программы':'Комплекты подготовки');
  const create=page==='program.read'?'program.create':page==='training.enrollment.read'?'training.enrollment.create':'preparation.create';
  if(user.person_id&&user.permissions.includes(create))n.append(button(page==='program.read'?'Создать шаблон':page==='training.enrollment.read'?'Назначить программу':'Сформировать комплект',()=>page==='program.read'?programEditor(host):page==='training.enrollment.read'?enrollmentEditor(host):preparationEditor(host),'primary'));
  if(page==='program.read')n.append(items.length?table(['Код','Название','Вид','Версия','Состояние','Действия'],items.map(r=>[r.code,r.title,kindLabels[r.standard_kind||r.kind]||r.kind,r.version_no,state[r.state]||r.state,r.can_detail?button('Открыть шаблон',()=>programCard(host,r.id)):'—'])):empty());
  else if(page==='training.enrollment.read')n.append(items.length?table(['Сотрудник','Программа','Версия','Начало','Срок','Состояние','Действия'],items.map(r=>[r.trainee_name,r.title,r.version_no,r.start_on,r.due_on,state[r.state]||r.state,r.can_detail?button('Открыть программу',()=>enrollmentCard(host,r.id)):'—'])):empty());
  else n.append(items.length?table(['Сотрудник','Категория','Адаптация','ОТ','Стажировка','Действия'],items.map(r=>[r.trainee_name,r.category==='new'?'Новый сотрудник':'Перевод',state[r.adaptation]||r.adaptation,state[r.safety]||r.safety,state[r.internship]||r.internship,r.can_detail?button('Открыть комплект',()=>preparationCard(host,r.id)):'—'])):empty());
  n.append(host);return n;
 }
 return {training,matrices,card,mentor,programPanel};
}
