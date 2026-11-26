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
 async function assignmentEditor(host){
  const root=await api('training/options'),out=el('div'),op=select('operation_id','Операция',[['','— Выберите операцию —'],...opts(root.operations)]);
  const load=button('Выбрать операцию',async()=>{
   const id=op.querySelector('select').value;if(!id)throw Error('Выберите операцию');
   const d=await api('training/options?operation_id='+encodeURIComponent(id));
   if(!d.people.length||!d.mentors.length||!d.revisions.length||!d.skills.length||!d.scales.length){out.replaceChildren(el('p','Для операции нужны обучаемые, действующий инструктор с полномочием, СОП, навык и шкала.'));return}
   const revision=select('revision_id','Действующая редакция СОП',opts(d.revisions,'title'));
   const scale=select('scale_id','Шкала',opts(d.scales)),level=select('target_level','Целевой уровень',[]);
   function levels(){level.querySelector('select').replaceChildren(...(d.scales.find(x=>x.id===scale.querySelector('select').value)?.levels||[]).map(x=>{const n=el('option',x.value+' · '+x.label);n.value=x.value;return n}))}
   scale.querySelector('select').addEventListener('change',levels);levels();
   const variant=select('variant','Методика JI-2',Object.entries(d.variants));
   const realShow=number('real_show','SMED · номер реального показа',1,3,1),realTry=number('real_try','SMED · номер реальной пробы',1,4,1);
   const segments=input('segments','Дробный инструктаж · группы шагов (например 1-3,4-6)','text',false),hazard=check('hazardous','Требуется предварительная проверка безопасности');
   function mode(){const v=variant.querySelector('select').value;realShow.hidden=realTry.hidden=v!=='smed';segments.hidden=v!=='fractional';segments.querySelector('input').required=v==='fractional'}
   variant.querySelector('select').addEventListener('change',mode);mode();
   out.replaceChildren(form([select('trainee_id','Обучаемый',opts(d.people)),select('authorization_id','Инструктор с действующим полномочием',opts(d.mentors)),revision,select('skill_id','Навык',opts(d.skills)),scale,level,dt('assigned_on','Начало',d.day),dt('due_on','Срок',''),input('reason','Основание'),variant,number('followups','Контрольные проверки',2,10,2),realShow,realTry,segments,hazard,check('plan_reviewed','План TWI действующей редакции проверен')],'Создать назначение',async f=>{
    const v=value(f,'variant'),parts=v==='fractional'?value(f,'segments').split(',').map(s=>{const m=/^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(s);if(!m)throw Error('Укажите группы шагов, например 1-3,4-6');return {from:Number(m[1]),to:Number(m[2])}}):[];
    await api('training/create',{operation_id:id,trainee_id:value(f,'trainee_id'),authorization_id:value(f,'authorization_id'),revision_id:value(f,'revision_id'),skill_id:value(f,'skill_id'),scale_id:value(f,'scale_id'),target_level:Number(value(f,'target_level')),assigned_on:value(f,'assigned_on'),due_on:value(f,'due_on'),reason:value(f,'reason'),variant:v,method_config:{followups:Number(value(f,'followups')),segments:parts,realShow:v==='smed'?Number(value(f,'real_show')):null,realTry:v==='smed'?Number(value(f,'real_try')):null,hazardous:checked(f,'hazardous')},plan_reviewed:checked(f,'plan_reviewed')});
    note('Назначение сохранено. Требуются подтверждения согласующих.');await render();
   }));
  },'primary');
  setContent(host,panel('Новое назначение',op,load,out));
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
  if(previous)unit.querySelector('select').value=previous.unit_id;
  const choose=button('Выбрать состав',async()=>{
   const u=unit.querySelector('select').value,b=base.querySelector('input').value,d=await api('matrix/info?unit_id='+encodeURIComponent(u)+'&base_on='+encodeURIComponent(b));
   const roster=d.roster.map(r=>({key:r.person_id,label:r.name+' · '+r.position})),cols=d.columns.map(r=>({key:r.skill_id+':'+r.document_id,label:r.title+' · '+r.skill}));
   const picker=(title,items,prefix,selected)=>{const box=el('fieldset');box.append(el('legend',title));for(const r of items){const c=check(prefix+r.key,r.label,selected.has(r.key));box.append(c)}return box};
   const chosenPeople=new Set(previous?.roster.map(r=>r.person_id)||roster.map(r=>r.key)),chosenCols=new Set(previous?.columns.map(c=>c.skill_id+':'+c.document_id)||cols.map(c=>c.key));
   const code=input('code','Код матрицы'),title=input('title','Название');code.querySelector('input').value=previous?.code||'';title.querySelector('input').value=previous?.title||'';if(previous)code.querySelector('input').readOnly=true;
   if(!roster.length||!cols.length||!d.scales.length){out.replaceChildren(el('p','Нужны сотрудники, операционные навыки с действующими СОП и корпоративная шкала 1–4.'));return}
   out.replaceChildren(form([code,title,select('scale_id','Шкала',opts(d.scales)),dt('target_on','Целевая дата',previous?.target_on||''),picker('Строки · сотрудники',roster,'p_',chosenPeople),picker('Столбцы · навыки и СОП',cols,'c_',chosenCols)],'Сохранить матрицу',async f=>{
    await api('matrix/save',{code:value(f,'code'),title:value(f,'title'),unit_id:u,scale_id:value(f,'scale_id'),base_on:b,target_on:value(f,'target_on'),person_ids:roster.filter(r=>checked(f,'p_'+r.key)).map(r=>r.key),columns:d.columns.filter(r=>checked(f,'c_'+r.skill_id+':'+r.document_id)).map(r=>({skill_id:r.skill_id,document_id:r.document_id})),previous_id:previous?.id??null,previous_rev:previous?.rev??0});
    note('Матрица сохранена · уровни взяты из подтверждённых оценок');await render();
   }));
  },'primary');
  setContent(host,panel(previous?'Новая версия матрицы':'Конструктор матрицы',unit,base,choose,out));
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
   const labels={code:'Код',title:'Название',due_on:'Срок',state:'Состояние',start_on:'Начало',month:'Месяц',version_no:'Версия',role:'Роль',kind:'Вид',issued_on:'Выдан',valid_until:'Срок действия',order_on:'Дата приказа',valid_from:'Начало',valid_to:'Окончание',observed_at:'Дата наблюдения',category:'Категория',adaptation:'Адаптация',safety:'ОТ',internship:'Стажировка',base_on:'Срез',target_on:'Цель',people:'Сотрудников',skills:'Навыков'};
   const keys=Object.keys(labels).filter(k=>s.items.some(r=>Object.hasOwn(r,k))),sub=el('div');
   const rows=s.items.map(r=>[...keys.map(k=>k==='state'?state[r[k]]||r[k]:r[k]),s.action==='training.read'?button('Открыть обучение',()=>assignment(sub,r.id)):s.action==='matrix.read'?button('Открыть матрицу',()=>matrix(sub,r.id)):'']);
   details.append(table([...keys.map(k=>labels[k]),'Действия'],rows),sub);n.append(details);
  }
  if(!d.sections.length)n.append(el('p','Нет связанных записей, доступных вашей учётной записи.'));
  setContent(host,n);
 }
 return {training,matrices,card};
}
