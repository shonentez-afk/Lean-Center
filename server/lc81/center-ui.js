// The protected browser consumes only authorized projections. Shared
// controls, corporate styles and chart palette; no browser database.
import {localChart} from '/shared/center-report.js';
export function createCenterUI({api,run,button,panel,table,el,input,select,form,value,note,render,discard,check,openLinked,assistant,goMetric}){
 const opts=(items,field='name')=>items.map(x=>[x.id,x[field]]);
 const empty=text=>el('p',text||'Нет доступных записей','muted');
 const state={planned:'Запланировано',done:'Выполнено',cancelled:'Отменено',needs_replan:'Требует перепланирования',replanned:'Перепланировано',open:'Открыто',active:'Действует',in_progress:'В работе',completed:'Завершено',implemented:'Ожидает проверки',verified:'Эффект подтверждён',ineffective:'Эффект не подтверждён',final:'Зарегистрировано',draft:'Черновик',confirmed:'Подтверждён',void:'Аннулирован'};
 const scheduleNames={audit:'Аудит первого уровня',practical:'Практическая оценка',self_eval:'Самооценка'};
 const typeLabels={training:'Открыть обучение',enrollment:'Открыть программу',preparation:'Открыть комплект',assessment:'Открыть оценку',audit:'Открыть аудит',self:'Открыть самооценку',task:'Открыть мероприятие',development:'Открыть план развития',schedule:'Открыть событие',sop:'Открыть СОП',frv:'Открыть ФРВ',person:'Открыть сотрудника',roi:'Открыть эффект',bank:'Открыть банк',supplement:'Открыть ходатайство'};
 const fill=(f,v)=>{f.querySelector('input,select').value=v??'';return f};
 const date=(k,l,v)=>fill(input(k,l,'date'),v);
 const pick=(k,l,items,v='',required=true)=>{const f=fill(select(k,l,[['','— Выберите —'],...items]),v);f.querySelector('select').required=required;return f};
 const num=(k,l,v='',step='any',min=null)=>{const f=input(k,l,'number'),n=f.querySelector('input');n.step=String(step);n.value=v??'';if(min!==null)n.min=String(min);return f};
 const checked=(f,k)=>f.elements.namedItem(k).checked;
 const section=(title,fields,submit,fn)=>{const n=el('details');n.append(el('summary',title),form(fields,submit,fn));return n};
 const hostSet=(host,n)=>{host.replaceChildren(n);if(host.isConnected)host.scrollIntoView({block:'nearest'})};
 const route=(host,r,label)=>r?button(label||typeLabels[r.type]||'Открыть источник',()=>openLinked(host,r)):'—';
 const fmt=n=>n===null||n===undefined?'—':Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
 const money=(minor,c)=>minor===null||minor===undefined?'—':fmt(minor/100)+' '+c;
 const major=(n,c)=>n===null||n===undefined?'—':fmt(n)+' '+c;
 const iso=d=>d.toISOString().slice(0,10),today=()=>iso(new Date()),plus=(d,n)=>iso(new Date(Date.parse(d+'T00:00:00Z')+n*86400000));
 const bounds=m=>({from:m+'-01',to:iso(new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)))});
 const query=(p,params)=>p+'?'+new URLSearchParams(params);
 const save=async(path,data,message)=>{await api(path,data);note(message);await render()};
 async function scheduleEditor(host,initialType='audit'){
  if(!discard())return;
  const type=pick('type','Вид планового события',Object.entries(scheduleNames),initialType),out=el('div');
  const choose=button('Выбрать вид',async()=>{
   if(!discard())return;const t=type.querySelector('select').value,d=await api(query('calendar/options',{type:t}));
   if(!d.sources.length){out.replaceChildren(empty('Нет доступных источников для планирования. Проверьте назначение обучения и роли.'));return}
   const source=pick('source_id',t==='self_eval'?'Наставник':'Назначение обучения',opts(d.sources,'label')),sub=el('div');
   const chooseSource=button('Выбрать источник',async()=>{
    if(!discard())return;const id=source.querySelector('select').value,x=d.sources.find(x=>x.id===id);if(!x)throw Error('Выберите источник');
    const info=t==='self_eval'?d:await api(query('calendar/options',{type:t,source_id:id}));
    const owners=t==='self_eval'?[]:info.owners;
    if(t!=='self_eval'&&!owners.length){sub.replaceChildren(empty('Нет доступного ответственного'));return}
    sub.replaceChildren(form([...(t==='self_eval'?[]:[pick('owner_id','Ответственный',opts(owners))]),date('due_on','Плановая дата',info.day)],'Запланировать',async f=>{
     if(type.querySelector('select').value!==t||source.querySelector('select').value!==id)throw Error('Источник изменился. Повторите выбор.');
     await save('calendar/create',{type:t,source_id:id,source_rev:t==='self_eval'?null:x.rev,owner_id:t==='self_eval'?id:value(f,'owner_id'),due_on:value(f,'due_on')},'План зарегистрирован');
    }));
   });
   out.replaceChildren(source,chooseSource,sub);
  });
  hostSet(host,panel('Запланировать аудит или оценку',el('p','Планирование не создаёт фактический результат. Завершение только по отдельной зарегистрированной записи.'),type,choose,out));
 }
 async function scheduleCard(host,id){
  if(!discard())return;const d=await api(query('calendar/detail',{id})),sub=el('div');
  const cmd=(command,fields)=>save('calendar/change',{id:d.id,expected_revision:d.rev,command,fields},'План обновлён');
  const n=panel(d.label+' · '+d.title,el('p',d.date+' · '+(state[d.state]||d.state)+' · '+(d.owner||'—')));
  if(d.source)n.append(route(sub,d.source,'Открыть источник планирования'));
  if(d.fact)n.append(route(sub,d.fact,'Открыть зарегистрированный факт'));
  if(d.cap.complete)n.append(d.candidates.length?section('Подтвердить выполнение',[pick('fact_id','Фактическая запись',opts(d.candidates,'label'))],'Связать факт и завершить',f=>cmd('complete',{fact_id:value(f,'fact_id')})):empty('Для завершения нужен зарегистрированный после планирования факт того же источника и ответственного.'));
  if(d.cap.replan)n.append(section('Перепланировать аудит',[date('due_on','Новая дата',d.day)],'Перепланировать',f=>cmd('replan',{due_on:value(f,'due_on')})));
  if(d.cap.cancel)n.append(button('Отменить план',async()=>{if(confirm('Отменить этот план? Фактическая история останется.'))await cmd('cancel',{})}));
  n.append(sub);hostSet(host,n);
 }
 function agenda(items,sub){
  return items.length?table(['Дата','Вид','Содержание','Ответственный','Состояние','Источник'],items.map(x=>[x.date,x.type,x.title,x.owner,(x.overdue?'Просрочено · ':'')+(state[x.state]||x.state),route(sub,x.route)])):empty('В выбранном периоде нет доступных событий');
 }
 async function calendar(mode,personId=null){
  const month=fill(input('month','Месяц','month'),today().slice(0,7)),from=date('from','С даты',today()),to=date('to','По дату',plus(today(),30)),out=el('div'),root=el('div'),personal=mode==='plan';
  async function draw(){
   const period=personal?{from:from.querySelector('input').value,to:to.querySelector('input').value}:bounds(month.querySelector('input').value);
   const d=await api(query('calendar/view',{mode,...period,...(personId?{person_id:personId}:{})})),sub=el('div'),list=el('div');
   const open=d.items.filter(x=>x.pending),late=d.items.filter(x=>x.overdue),n=panel(personal?(personId?'План работы сотрудника':'Мой план работы'):(personId?'Календарь сотрудника · ':'Календарь · ')+period.from.slice(0,7),el('p','Дата центра '+d.day+' · '+d.items.length+' событий · открыто '+open.length+' · просрочено '+late.length));
   if(d.can_plan){const commands=el('div',undefined,'row');commands.append(button('Запланировать аудит',()=>scheduleEditor(sub,'audit'),'primary'),button('Запланировать оценку',()=>scheduleEditor(sub,'practical')),button('Запланировать самооценку',()=>scheduleEditor(sub,'self_eval')));n.append(commands)}
   if(personal){
    n.append(el('p','Открытые просроченные события до начала периода включаются в план. Календарь сохраняет выбранные границы.','muted'));
    const filter=pick('filter','Показать',[['open','Открытые и просроченные'],['all','Все события'],['late','Только просроченные']],'open');
    const show=()=>{const f=filter.querySelector('select').value;list.replaceChildren(agenda(f==='open'?open:f==='late'?late:d.items,sub))};
    filter.querySelector('select').addEventListener('change',()=>{if(discard())show()});n.append(filter);show();
   }else{
    const grid=el('div',undefined,'lc81-calendar');
    for(const name of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'])grid.append(el('span',name,'lc81-cal-weekday'));
    const start=new Date(period.from+'T00:00:00Z'),offset=(start.getUTCDay()+6)%7;
    for(let i=0;i<offset;i++)grid.append(el('span',''));
    const by=new Map();for(const item of d.items){if(!by.has(item.date))by.set(item.date,[]);by.get(item.date).push(item)}
    const count=Number(period.to.slice(-2));
    for(let i=1;i<=count;i++){
     const day=period.from.slice(0,8)+String(i).padStart(2,'0'),items=by.get(day)||[],cell=button('',()=>{if(!discard())return;list.replaceChildren(el('h3',day),agenda(items,sub));sub.replaceChildren()},'lc81-cal-day');
     cell.append(el('strong',i),el('small',items.length?items.length+' событий':'—'));if(day===d.day)cell.dataset.today='1';if(items.some(x=>x.overdue))cell.dataset.late='1';grid.append(cell);
    }
    n.append(grid,button('Все события месяца',()=>{if(!discard())return;list.replaceChildren(agenda(d.items,sub));sub.replaceChildren()}));list.replaceChildren(agenda(d.items,sub));
   }
   n.append(list,sub);out.replaceChildren(n);
  }
  const move=n=>async()=>{if(!discard())return;const field=month.querySelector('input'),m=field.value,d=new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7))-1+n,1));field.value=iso(d).slice(0,7);await draw()};
  root.append(panel(personal?'Период личного плана':'Выбор месяца',...(personal?[from,to]:[button('Предыдущий месяц',move(-1)),month,button('Следующий месяц',move(1))]),button('Обновить',async()=>{if(discard())await draw()},'primary')),out);
  await draw();return root;
 }

 // Account-local UI state, no persisted records, permissions or identities.
 // Manual dates stay manual; relative periods follow the enterprise day.
 let reportSelection=null,pendingMetric=null;
 const resetReports=()=>{reportSelection=null;pendingMetric=null};
 const focusMetric=(id,scope)=>{pendingMetric={id,scope};const prior=reportSelection;reportSelection={...scope,preset:prior&&prior.from===scope.from&&prior.to===scope.to&&prior.unit_id===scope.unit_id?prior.preset:'custom'}};
 const presetBounds=(day,preset)=>{
  const month=Number(day.slice(5,7)),start=preset==='year'?1:preset==='quarter'?Math.floor((month-1)/3)*3+1:month;
  return {from:day.slice(0,4)+'-'+String(start).padStart(2,'0')+'-01',to:day};
 };
 const metricText=m=>m.availability==='restricted'?'Недоступно по правам':m.denominator===null?fmt(m.value):m.denominator===0?'— · нет знаменателя':fmt(m.value)+' / '+fmt(m.denominator)+' · '+fmt(100*m.value/m.denominator)+'%';
 const priority={urgent:'Сначала проверить',review:'Требуется решение',plan:'Запланировать / настроить'};
 const basis={event:'Факт за период',cohort:'Когорта периода',current:'Текущее состояние'};
 const metricTable=(metrics,show)=>table(['Показатель','Значение','Основание','Действия'],metrics.map(m=>[m.label,metricText(m),basis[m.basis]||m.basis,m.availability==='restricted'?'—':button('Раскрыть расчёт',()=>show(m.id))]));
 async function report(kind){
  const d=await api(query('center/options',{kind})),unit=select('unit_id','Подразделение (точное)',[...(d.all?[['','Всё предприятие']]:[]),...opts(d.units)]),from=date('from','С даты',d.day.slice(0,7)+'-01'),to=date('to','По дату',d.day),out=el('div'),root=el('div');
  let preset=reportSelection?.preset||'month';
  const unitId=reportSelection?.unit_id;
  unit.querySelector('select').value=(unitId===''&&d.all||d.units.some(x=>x.id===unitId))?unitId:d.default_unit;
  const dates=preset==='custom'&&reportSelection?reportSelection:presetBounds(d.day,preset);
  from.querySelector('input').value=dates.from;to.querySelector('input').value=dates.to;
  const scope=()=>({unit_id:unit.querySelector('select').value,from:from.querySelector('input').value,to:to.querySelector('input').value});
  const scopeListeners=new Set(),saveSelection=()=>{reportSelection={...scope(),preset};for(const fn of scopeListeners)fn()};
  root.lc81ReportScope={read:scope,onChange:fn=>scopeListeners.add(fn)};
  let drawSerial=0;
  async function draw(){
   const serial=++drawSerial,s=scope();saveSelection();
   const data=await api(query('center/view',{kind,...s}));if(serial!==drawSerial)return;
   const sub=el('div'),evidence=el('div'),metrics=data.metrics;
   let evidenceSerial=0;
   const show=async(id,offset=0,selected=s)=>{
    if(!discard()||serial!==drawSerial)return;
    const request=++evidenceSerial,r=await api(query('center/evidence',{kind,...selected,id,offset}));
    if(request!==evidenceSerial||serial!==drawSerial)return;
    const n=panel(r.label,el('p','Период основания: '+selected.from+' — '+selected.to+' · '+(d.units.find(u=>u.id===selected.unit_id)?.name||'Всё предприятие'),'muted'),el('p',metricText({...r,availability:'available'})+' · '+r.source),el('p',r.definition),el('p',r.rules,'muted'),table(['Дата','Запись','Сотрудник','Состояние','В расчёте','Основание','Источник'],r.items.map(x=>[x.date,x.label,x.person,x.state,x.included?'Числитель / факт':'Только знаменатель',x.reason,route(sub,x.route)])));
    if(r.total>50)n.append(button('Предыдущая страница',()=>show(id,Math.max(0,offset-50),selected)),el('p',(offset+1)+'–'+Math.min(offset+50,r.total)+' из '+r.total),button('Следующая страница',()=>show(id,Math.min(Math.max(0,r.total-1),offset+50),selected)));
    evidence.replaceChildren(n);sub.replaceChildren();if(evidence.isConnected)evidence.scrollIntoView({block:'nearest'});
   };
   const header=panel(kind==='center.read'?'Оперативный обзор':kind==='analytics.read'?'Аналитика за период':'Дерево показателей',el('p','Дата среза: '+data.day+' · '+s.from+' — '+s.to+' · '+(d.units.find(u=>u.id===s.unit_id)?.name||'Всё предприятие')),el('p','Отдельные показатели используют исходные определения LC7. Недоступные источники не заменяются нулями.','muted'));
   const cards=el('div',undefined,'lc81-grid');
   const groups=new Map();for(const m of metrics){if(!groups.has(m.group))groups.set(m.group,[]);groups.get(m.group).push(m)}
   const addMonthlyCharts=()=>{
     const openMonth=(month,id)=>{
      const b=bounds(month),selected={...s,from:b.from>s.from?b.from:s.from,to:b.to<s.to?b.to:s.to};
      return show(id,0,selected);
     };
     const addChart=(title,labels,series,headers,values,ids)=>{
      const drill=(i,j)=>labels[i]&&ids[j]?openMonth(labels[i],ids[j]):undefined;
      const h=el('div',undefined,'lc81-chart'),p=panel(title,h,table(headers,values.map((row,i)=>[row[0],...row.slice(1).map((v,j)=>button(String(v),()=>drill(i,j),'lc81-number-link'))])));header.append(p);
      requestAnimationFrame(()=>{if(h.isConnected)localChart(h,labels,series,{onClick:(i,j)=>{if(h.isConnected)void run(()=>drill(i,j))}})});
     };
     if(Array.isArray(data.cohortMonths)&&!data.cohortMonths.length)header.append(panel('Назначения обучения по месяцам когорты',empty('За выбранный период нет назначений обучения.')));
     if(data.cohortMonths?.length){const x=data.cohortMonths;addChart('Назначения обучения по месяцам когорты',x.map(r=>r.id),[{name:'Назначено',data:x.map(r=>r.assignments)},{name:'Завершено из назначенных',data:x.map(r=>r.completed)}],['Месяц','Назначено','Завершено'],x.map(r=>[r.id,r.assignments,r.completed]),['training_assigned','training_completed'])}
     if(Array.isArray(data.auditMonths)&&!data.auditMonths.length)header.append(panel('Факты аудита L1',empty('За выбранный период нет фактических аудитов L1.')));
     if(data.auditMonths?.length){const x=data.auditMonths;addChart('Факты аудита L1',x.map(r=>r.id),[{name:'Аудиты',data:x.map(r=>r.count)}],['Месяц','Аудиты'],x.map(r=>[r.id,r.count]),['audit_count'])}
   };
   if(kind==='center.read'){
    const primary=['prep_completed','twi_first','training_overdue','skill_coverage','audit_count','actions_overdue','effect_pending','lc83_familiarization_coverage','lc83_familiarization_overdue'];
    for(const m of metrics.filter(x=>primary.includes(x.id))){
     const kpi=m.availability==='restricted'?el('strong',metricText(m),'lc81-kpi'):button(metricText(m),()=>goMetric?goMetric(m.id,s,()=>show(m.id)):show(m.id),'lc81-kpi lc81-kpi-link');
     cards.append(panel(m.label,kpi,m.availability==='restricted'?empty('Ограничено правами'):button('Раскрыть расчёт',()=>show(m.id))));
    }
    header.append(cards);
    const attention=panel('Требует внимания');
    for(const x of data.attention.filter(x=>x.count>0).sort((a,b)=>['urgent','review','plan'].indexOf(a.priority)-['urgent','review','plan'].indexOf(b.priority))){
     const det=el('details');det.append(el('summary',x.label+' · '+x.count),el('p',priority[x.priority]),el('p',x.advice),el('p',x.basis,'muted'));
     if(x.records.length)det.append(table(['Дата','Запись','Источник'],x.records.map(r=>[r.date,r.label,route(sub,r.route)])));
     if(x.count>x.records.length)det.append(empty('Показаны первые 20 доступных записей. Откройте соответствующий реестр.'));
     attention.append(det);
    }
    if(!attention.querySelector('details'))attention.append(empty('Нет доступных предупреждений. Это не означает отсутствие отклонений в недоступных разделах.'));
    header.append(attention);addMonthlyCharts();
   }else{
    if(kind==='analytics.read'){
     addMonthlyCharts();
     if(data.auditGroups?.length)header.append(panel('Аудиты по отдельным методикам и версиям',table(['Методика','Версия','Аудитов','Наблюдалось','Да','Результат'],data.auditGroups.map(x=>[x.methodCode,x.version,x.count,x.observed,x.passed,x.observed?fmt(100*x.passed/x.observed)+'%':'—']))));
     if(data.annual!==null)header.append(panel('Годовой контроль L1 · '+data.day.slice(0,4),data.annual.length?table(['Инструктор','Норма','Зачтено','Осталось','Состояние'],data.annual.map(x=>[x.person,x.required,x.actual,x.remaining,x.status])):empty()));
     if(data.currencies!==null)header.append(panel('Подтверждённые денежные факты · валюты не суммируются',data.currencies.length?table(['Валюта','Фактов','Валовый эффект','Затраты','Инвестиции','Чистый эффект'],data.currencies.map(x=>[x.currency,x.count,money(x.gross,x.currency),money(x.recurring,x.currency),money(x.investment,x.currency),money(x.net,x.currency)])):empty('За период нет действующих подтверждённых денежных фактов')));
    }
    for(const [name,items] of groups)header.append(panel(name,metricTable(items,show)));
    if(kind==='metrics.read'){
     const by=new Map(metrics.map(m=>[m.id,m]));
     header.append(panel('Связи показателей · не единый рейтинг',table(['От','К','Тип связи'],data.relations.map(r=>{const a=by.get(r.from),b=by.get(r.to);return [a.availability==='restricted'?a.label:button(a.label,()=>show(a.id)),b.availability==='restricted'?b.label:button(b.label,()=>show(b.id)),r.label]}))));
    }
   }
   header.append(assistant({type:'report',kind,scope:s,group:'all'},'ИИ-помощник отчёта'),evidence,sub);out.replaceChildren(header);
   if(kind==='metrics.read'&&pendingMetric){
    const focus=pendingMetric;pendingMetric=null;
    if(metrics.some(m=>m.id===focus.id&&m.availability!=='restricted'))await show(focus.id);
   }
  }
  const choosePreset=key=>async()=>{if(!discard())return;preset=key;const b=presetBounds(d.day,key);from.querySelector('input').value=b.from;to.querySelector('input').value=b.to;await draw()};
  for(const field of [unit,from,to])field.querySelector('input,select').addEventListener('change',()=>{if(!discard()){const saved=reportSelection;if(saved){unit.querySelector('select').value=saved.unit_id;from.querySelector('input').value=saved.from;to.querySelector('input').value=saved.to}return}if(field!==unit)preset='custom';drawSerial++;out.replaceChildren(empty('Фильтры изменены. Нажмите «Обновить» для общего обзора.'));saveSelection()});
  root.append(panel('Область и период',el('p','Единая область для дашборда, аналитики, подробных отчётов и дерева показателей.','muted'),unit,from,to,button('Месяц',choosePreset('month')),button('Квартал',choosePreset('quarter')),button('Год',choosePreset('year')),button('Обновить',async()=>{if(discard())await draw()},'primary')),out);
  await draw();return root;
 }

 const effectLabels={hours:'Часы в год',annualBenefit:'Валовый годовой эффект',annualNet:'Чистый годовой эффект',yearOne:'Эффект первого года',roi:'ROI, %',payback:'Окупаемость, мес.'};
 function scenario(method,initial={},locked=false){
  const defs=method==='time'?[['deltaSeconds','Разница времени, с'],['cyclesPerYear','Циклов в год',1,1],['hourRate','Стоимость часа',0],['realization','Реализация, %',0],['investment','Инвестиции',0],['annualCost','Годовые затраты',0]]:[['annualGross','Годовой валовый эффект'],['investment','Инвестиции',0],['annualCost','Годовые затраты',0]];
  const fields=defs.map(([k,l,min,step])=>num(k,l,initial[k]??(k==='realization'?100:k==='cyclesPerYear'?1:0),step||'any',min??null));
  if(locked&&method==='time'){fields[0].querySelector('input').readOnly=true;fields[0].querySelector('input').value=initial.deltaSeconds??0;fields[0].append(el('small','Фактическую разницу определяет сервер из проверенного источника.','muted'))}
  return {fields,get:f=>Object.fromEntries(defs.map(([k])=>[k,Number(value(f,k))]))};
 }
 function resultTable(result,currency){return table(['Расчётный показатель','Значение'],Object.entries(effectLabels).map(([k,l])=>[l,['hours','roi','payback'].includes(k)?fmt(result[k]):major(result[k],currency)]))}
 async function roiEditor(host){
  if(!discard())return;const d=await api('roi/options'),kind=pick('source_type','Источник',[['frv','ФРВ'],['task','Самостоятельное мероприятие']],'task'),out=el('div');
  const load=button('Выбрать источник',async()=>{
   if(!discard())return;const t=kind.querySelector('select').value,items=t==='frv'?d.frv:d.actions;
   if(!items.length){out.replaceChildren(empty('Нет доступных источников без карточки эффекта'));return}
   const source=pick('source_id','Источник',opts(items,'label')),method=pick('method','Способ расчёта',t==='frv'?[['time','По времени']]:[['time','По времени'],['direct','Прямой денежный сценарий']],t==='frv'?'time':'direct'),sub=el('div');
   out.replaceChildren(source,method,button('Открыть расчёт',()=>{
    if(!discard())return;const x=items.find(r=>r.id===source.querySelector('select').value),m=method.querySelector('select').value;
    if(!x||!m)throw Error('Выберите источник и способ расчёта');const e=scenario(m);
    sub.replaceChildren(panel('Годовой плановый сценарий · не денежный факт',el('p','Подразделение: '+(d.units.find(u=>u.id===x.unit_id)?.name||'—')),form([fill(input('title','Название'),x.label),pick('owner_id','Ответственный',opts(d.people)),pick('currency','Валюта',d.currencies.map(c=>[c,c]),'RUB'),...e.fields,input('plan_basis','Основание планового расчёта'),date('review_due','Срок проверки',d.day)],'Создать карточку',async f=>{
     if(kind.querySelector('select').value!==t||source.querySelector('select').value!==x.id||method.querySelector('select').value!==m)throw Error('Источник изменился. Повторите выбор.');
     await save('roi/create',{study_id:t==='frv'?x.id:null,action_id:t==='task'?x.id:null,owner_id:value(f,'owner_id'),unit_id:x.unit_id,currency:value(f,'currency'),method:m,title:value(f,'title'),plan:e.get(f),plan_basis:value(f,'plan_basis'),review_due:value(f,'review_due')},'Карточка эффекта создана');
    })));
   }),sub);
  });
  hostSet(host,panel('Новая карточка экономического эффекта',kind,load,out));
 }
 function factEditor(host,d,old,command){
  const flds=[date('period_from','Начало периода',old?.period_from||d.last_closed),date('period_to','Конец периода',old?.period_to||d.last_closed),num('gross','Валовый денежный факт, '+d.currency,(old?.gross_minor??0)/100,0.01),num('recurring','Затраты, '+d.currency,(old?.recurring_minor??0)/100,0.01,0),num('investment','Инвестиции, '+d.currency,(old?.investment_minor??0)/100,0.01,0),fill(input('evidence','Первичные документы / основание'),old?.evidence)];
  hostSet(host,panel('Фактические деньги за закрытый период',el('p','Суммы не выводятся автоматически из годового сценария; нужны первичные документы.'),form(flds,'Сохранить черновик факта',f=>command(old?'fact.save':'fact.create',{...(old?{fact_id:old.id,fact_rev:old.rev}:{}),period_from:value(f,'period_from'),period_to:value(f,'period_to'),gross_minor:Math.round(Number(value(f,'gross'))*100),recurring_minor:Math.round(Number(value(f,'recurring'))*100),investment_minor:Math.round(Number(value(f,'investment'))*100),evidence:value(f,'evidence')}))));
 }
 async function twiEditor(host,d,command){
  if(!discard())return;const o=await api(query('roi/twi-options',{id:d.id})),kind=pick('kind','Источник сравнения',[['assignment','Назначения одного контекста'],['program','Версия программы']],'assignment'),sub=el('div'),result=el('div');
  const choose=button('Выбрать источник',()=>{
   if(!discard())return;
   const k=kind.querySelector('select').value,items=k==='assignment'?o.assignments:o.programs;
   if(!items.length){sub.replaceChildren(empty('Нет доступного источника'));return}
   sub.replaceChildren(form([pick('source_id','Источник',opts(items,'label')),date('before_from','До: с',''),date('before_to','До: по',''),date('after_from','После: с',''),date('after_to','После: по','')],'Проверить сопоставимость',async f=>{
    const scope={kind:k,source_id:value(f,'source_id'),unit_id:o.unit_id,...Object.fromEntries(['before_from','before_to','after_from','after_to'].map(x=>[x,value(f,x)]))};
    if(kind.querySelector('select').value!==k)throw Error('Источник изменился');
    const p=await api('roi/twi-preview',{id:d.id,expected_revision:d.rev,scope});f.lcResetForm?.();
    const n=panel('Сравнение TWI',table(['Группа','Назначено','Завершено','Среднее время, мин'],[['До',p.baseline.total,p.baseline.complete,fmt(p.baseline.meanMinutes)],['После',p.result.total,p.result.complete,fmt(p.result.meanMinutes)]]),el('p',p.comparable?'Сопоставимо · разница '+fmt(p.delta_minutes)+' мин':'Группы не сопоставимы. Незавершённые назначения не исключаются из знаменателя.'));
    if(p.comparable)n.append(form([input('note','Основание сравнения')],'Зафиксировать основание TWI',f=>command('twi_basis',{scope,stamp:p.stamp,note:value(f,'note')})));
    result.replaceChildren(n);
   }));result.replaceChildren();
  });
  hostSet(host,panel('Основание TWI · два непересекающихся периода',kind,choose,sub,result));
 }
 async function roiCard(host,id){
  if(!discard())return;const d=await api(query('roi/detail',{id})),sub=el('div'),n=panel(d.title,el('p',d.status+' · '+d.currency+' · '+(d.owner||'—')+' · контроль '+d.review_due),route(sub,d.source,'Открыть исходный документ / мероприятие'));
  const command=(command,fields)=>save('roi/change',{id:d.id,expected_revision:d.rev,command,fields},'Карточка / факт обновлены');
  n.append(panel('Исходный годовой сценарий',el('p',d.plan.basis),resultTable(d.plan.result,d.currency)));
  if(d.actual)n.append(panel(d.actual.current?'Проверенный годовой сценарий':'Прежняя проверка · основания утратили актуальность',el('p',(d.actual.reviewer||'—')+' · '+d.actual.evidence),resultTable(d.actual.result,d.currency),...(d.actual.measurement?[el('p','ФРВ: до '+fmt(d.actual.measurement.before)+' с · после '+fmt(d.actual.measurement.after)+' с · полных циклов '+d.actual.measurement.baselineCount+' / '+d.actual.measurement.improvedCount)]:[])));
  if(d.twi)n.append(panel('Зафиксированное сравнение TWI',el('p',(d.twi.current?'Актуально':'Утратило актуальность')+' · разница '+fmt(d.twi.delta_minutes)+' мин · '+d.twi.note)));
  if(d.cap.plan){const e=scenario(d.method,d.plan.inputs);n.append(section('Уточнить годовой план',[...e.fields,fill(input('plan_basis','Основание'),d.plan.basis)],'Сохранить план',f=>command('plan',{plan:e.get(f),plan_basis:value(f,'plan_basis')})))}
  if(d.cap.twi)n.append(button('Сравнение TWI до / после',()=>twiEditor(sub,d,command)));
  if(d.cap.measure){
   if(!d.actions.length)n.append(empty('Для проверки нужны связанные мероприятия с действующей независимой проверкой эффективности.'));
   else{const e=scenario(d.method,d.actual?.inputs||d.plan.inputs,d.source.type==='frv'||!!d.twi);n.append(section('Проверить фактическое основание расчёта',[...e.fields,input('evidence','Фактическое основание проверки'),...d.actions.map(x=>check('act_'+x.id,x.label,true))],'Зарегистрировать проверку',f=>save('roi/measure',{id:d.id,expected_revision:d.rev,inputs:e.get(f),evidence:value(f,'evidence'),action_ids:d.actions.filter(x=>checked(f,'act_'+x.id)).map(x=>x.id)},'Проверка расчёта зарегистрирована')))}
  }
  if(d.cap.reschedule)n.append(section('Изменить срок',[date('review_due','Новый срок',d.review_due),input('reason','Основание')],'Сохранить срок',f=>command('reschedule',{review_due:value(f,'review_due'),reason:value(f,'reason')})));
  if(d.cap.cancel)n.append(section('Отменить карточку',[input('reason','Основание')],'Отменить',f=>command('cancel',{reason:value(f,'reason')})));
  const facts=panel('Денежные факты · отдельные периоды');
  if(d.cap.fact)facts.append(button('Зарегистрировать денежный факт',()=>{if(discard())factEditor(sub,d,null,command)},'primary'));
  facts.append(d.facts.length?table(['Период','Валовый','Затраты','Инвестиции','Чистый','Статус','Действия'],d.facts.map(x=>{
   const a=el('div');
   a.append(button('Основание',()=>hostSet(sub,panel('Факт '+x.period_from+' — '+x.period_to,el('p',x.evidence),el('p','Регистратор: '+(x.registered_by||'—')+' · проверяющий: '+(x.verifier||'—')),el('p',x.note||'')))));
   if(x.cap.save)a.append(button('Изменить черновик',()=>{if(discard())factEditor(sub,d,x,command)}));
   if(x.cap.confirm)a.append(button('Подтвердить факт',()=>{if(discard())hostSet(sub,panel('Независимое подтверждение',form([input('note','Основание подтверждения')],'Подтвердить',f=>command('fact.confirm',{fact_id:x.id,fact_rev:x.rev,note:value(f,'note')}))))}));
   if(x.cap.void)a.append(button('Аннулировать факт',()=>{if(discard())hostSet(sub,panel('Аннулирование денежного факта',form([input('reason','Основание')],'Аннулировать',f=>command('fact.void',{fact_id:x.id,fact_rev:x.rev,reason:value(f,'reason')}))))}));
   return [x.period_from+' — '+x.period_to,money(x.gross_minor,d.currency),money(x.recurring_minor,d.currency),money(x.investment_minor,d.currency),money(x.net_minor,d.currency),(state[x.state]||x.state)+(x.state==='confirmed'&&!x.current?' · требуется повторная проверка':''),a];
  })):empty());
  const targets=panel('Цели по периодам');
  if(d.cap.target)targets.append(section('Добавить денежную цель',[date('from','Начало',d.day),date('to','Окончание',d.day),num('target','Чистая цель, '+d.currency,0,0.01),input('basis','Основание')],'Создать цель',f=>command('target',{from:value(f,'from'),to:value(f,'to'),target_minor:Math.round(Number(value(f,'target'))*100),basis:value(f,'basis')})));
  targets.append(d.targets.length?table(['Период','Цель','Полный факт','Отклонение','Состояние','Действия'],d.targets.map(t=>{
   const a=el('div');
   a.append(button('Подробности',()=>{if(!discard())return;const p=panel('Цель '+t.from+' — '+t.to,el('p',t.basis),el('p',t.complete?'Период полностью покрыт фактами':'Полный факт не сформирован · частично подтверждено '+money(t.partial_minor,d.currency)));if(t.review){p.append(el('p',t.review.cause+' · '+t.review.note+(t.review.current?'':' · основание устарело')));if(t.review.route)p.append(route(sub,t.review.route))}hostSet(sub,p)}));
   if(t.cap.cancel)a.append(button('Отменить цель',()=>{if(discard())hostSet(sub,panel('Отмена цели',form([input('reason','Основание')],'Отменить',f=>command('target.cancel',{target_id:t.id,reason:value(f,'reason')}))))}));
   if(t.cap.review)a.append(button('Разобрать отклонение',()=>{if(discard())hostSet(sub,panel('Разбор отклонения',form([pick('cause','Причина',Object.entries(d.causes)),input('note','Решение'),pick('action_id','Связанное мероприятие',opts(d.target_actions,'label'),'',false)],'Зарегистрировать разбор',f=>command('target.review',{target_id:t.id,signature:t.signature,cause:value(f,'cause'),note:value(f,'note'),action_id:value(f,'action_id')||null}))))}));
   return [t.from+' — '+t.to,money(t.target_minor,d.currency),money(t.actual_minor,d.currency),money(t.delta_minor,d.currency),t.status,a];
  })):empty());
  n.append(facts,targets,assistant({type:'roi',id}),sub);hostSet(host,n);
 }
 function roiPanel(items,user){
  const host=el('div'),n=panel('Экономический эффект',el('p','Годовые сценарии, факты за закрытые периоды и денежные цели — разные сущности. Финансовые детали требуют отдельных полномочий уровня предприятия.'));
  if(user.person_id&&user.permissions.includes('roi.create'))n.append(button('Создать карточку эффекта',()=>roiEditor(host),'primary'));
  n.append(items.length?table(['Карточка','Валюта','Метод','Срок проверки','Состояние','Действия'],items.map(r=>[r.title,r.currency,r.method==='time'?'По времени':'Прямой',r.review_due,r.display_state||state[r.state]||r.state,r.can_detail?button('Открыть эффект',()=>roiCard(host,r.id)):'Только реестр'])):empty(),host);
  return n;
 }
 return {resetReports,focusMetric,calendar,report,roiPanel,open:(host,type,id)=>type==='schedule'?scheduleCard(host,id):roiCard(host,id)};
}
