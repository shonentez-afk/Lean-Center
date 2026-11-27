// All facts and workbook generation remain on the protected server.
import {localChart} from '/shared/center-report.js';
export function createFinalUI({api,button,panel,table,el,input,select,note,discard,openLinked}){
 const val=x=>x.querySelector('input,select').value;
 const choices=(xs,blank='Все')=>[['',blank],...xs.map(x=>[x.id,x.label])];
 const pick=(k,l,xs,blank='Все',v='')=>{const f=select(k,l,choices(xs,blank));f.querySelector('select').value=v;return f};
 const dt=(k,l,v)=>{const f=input(k,l,'date');f.querySelector('input').value=v;return f};
 const query=(p,x)=>p+'?'+new URLSearchParams(x);
 const save=(name,text,mime)=>{const blob=new Blob([text],{type:mime}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)};
 const renderTables=(d,host,links)=>{
  const n=panel(d.title,...d.notes.map(x=>el('p',x,'muted')));
  if(d.facts.length)n.append(table(['Показатель','Значение'],d.facts.map(x=>[x.label,x.value])));
  for(const x of d.charts){const h=el('div',undefined,'lc81-chart');n.append(panel(x.title,h));requestAnimationFrame(()=>{if(h.isConnected)localChart(h,x.labels,x.series,{percentAxis:x.series.some(s=>s.yAxisIndex===1)})})}
  for(const t of d.tables){
   const content=el('div'),p=panel(t.title,content);
   const show=(offset=0)=>{const page=t.items.slice(offset,offset+100),hasLink=t.items.some(x=>x.route);const lines=page.map(x=>[...x.cells,...(hasLink?[x.route?button('Открыть источник',()=>openLinked(links,x.route)):'—']:[])]);
    content.replaceChildren(el('p','Записей: '+t.items.length+(t.items.length?' · '+(offset+1)+'–'+Math.min(t.items.length,offset+100):'')),table([...t.headers,...(hasLink?['Источник']:[])],lines));
    if(offset)content.append(button('Предыдущие 100',()=>show(Math.max(0,offset-100))));if(offset+100<t.items.length)content.append(button('Следующие 100',()=>show(offset+100)));
   };show();n.append(p);
  }
  host.replaceChildren(n);return n;
 };
 async function frvDetail(host,id){
  if(!discard())return;const d=await api(query('analytics/frv',{id})),links=el('div');renderTables(d,host,links);
  host.append(button('Карточка ФРВ',()=>openLinked(links,{type:'frv',id})),links);host.scrollIntoView({block:'nearest'});
 }
 async function analytics(){
  const o=await api('analytics/subjects'),root=panel('Расширенные отчёты LC7',el('p','Исходные расчёты, версии методик, фильтры и первичные факты. Полный отчёт доступен только при наличии прав на все необходимые регистры предприятия. Отдельные показатели ограниченной области остаются в общем обзоре.'));
  if(!o.reports.length){root.append(el('p','Нет разрешённых полных отчётов.'));return root}
  const controls=el('div'),out=el('div'),links=el('div'),tabs=el('div',undefined,'row');
  const retained={from:o.day.slice(0,7)+'-01',to:o.day,unit_id:''};let generation=0;
  async function choose(kind,sop_kind='sop_evaluation'){
   const serial=++generation,d=await api(query('analytics/subjects',{kind,sop_kind}));if(serial!==generation)return;
   const f={from:dt('report_from','С даты',retained.from),to:dt('report_to','По дату',retained.to),unit_id:pick('report_unit','Подразделение (точное)',d.units,'Всё предприятие',retained.unit_id)};
   for(const k of ['from','to','unit_id'])f[k].querySelector('input,select').addEventListener('change',()=>{retained[k]=val(f[k]);out.replaceChildren();links.replaceChildren()});
   const put=(flag,key,label,xs,blank='Все',v='')=>{if(d.filters.includes(flag))f[key]=pick('report_'+key,label,xs,blank,v)};
   put('person','person_id',kind==='audit'?'Инструктор':kind==='sop'?'Оценщик':'Сотрудник',d.people);
   put('shift','shift_id','Смена',d.shifts);put('operation','operation_id','Операция',d.operations);put('revision','revision_id','Редакция СОП',d.revisions);put('program','program_id','Программа',d.programs);put('method','method_id','Методика / версия',d.methods,'— Выберите —',d.methods[0]?.id||'');
   put('self','self_id','Сохранённая самооценка',d.selves,'— Выберите —');
   if(d.filters.includes('self')&&f.person_id)f.person_id.querySelector('select').addEventListener('change',()=>{const s=f.self_id.querySelector('select');s.replaceChildren(...choices(d.selves.filter(x=>!val(f.person_id)||x.person_id===val(f.person_id)),'— Выберите —').map(([id,l])=>new Option(l,id)));});
   if(d.filters.includes('role'))f.role=select('report_role','Роль',[['all','Все участники'],['trainee','Обучаемый'],['mentor','Инструктор'],['auditor','ВТ']]);
   if(d.filters.includes('state'))f.state=select('report_state','Состояние',kind==='preparation'?[['all','Все'],['open','Открытые'],['overdue','Просроченные'],['complete','Завершено'],['review','Повторная проверка'],['negative','Отрицательное решение'],['finish','Готов к завершению'],['cancelled','Отменено']]:[['all','Все'],['open','Открытые'],['overdue','Просроченные'],['in_progress','В работе'],['implemented','Ожидает проверки'],['verified','Подтверждено'],['ineffective','Не подтверждено'],['cancelled','Отменено']]);
   if(d.filters.includes('sop_kind')){f.sop_kind=select('report_sop_kind','Вид методики',[['sop_evaluation','Корпоративная бинарная'],['weighted_sop','Взвешенные снимки Stage43']]);f.sop_kind.querySelector('select').value=sop_kind;f.sop_kind.querySelector('select').addEventListener('change',()=>{choose(kind,val(f.sop_kind)).catch(e=>out.replaceChildren(el('p',e.message,'warn')))})}
   const request=()=>({kind,from:val(f.from),to:val(f.to),unit_id:val(f.unit_id),person_id:f.person_id?val(f.person_id):'',shift_id:f.shift_id?val(f.shift_id):'',operation_id:f.operation_id?val(f.operation_id):'',revision_id:f.revision_id?val(f.revision_id):'',program_id:f.program_id?val(f.program_id):'',method_id:f.method_id?val(f.method_id):'',self_id:f.self_id?val(f.self_id):'',role:f.role?val(f.role):'all',state:f.state?val(f.state):'all',sop_kind});
   for(const x of Object.values(f))x.querySelector('input,select').addEventListener('change',()=>{out.replaceChildren();links.replaceChildren()});
   async function draw(){const q=request(),r=await api('analytics/report',q);if(serial!==generation||JSON.stringify(q)!==JSON.stringify(request()))return;links.replaceChildren();const n=renderTables(r,out,links);
    if(r.can_export)n.append(button('Скачать полный отчёт XLSX',async()=>{
     if(JSON.stringify(q)!==JSON.stringify(request()))throw Error('Фильтры изменились. Обновите отчёт');
     const res=await fetch('/api/lc81/analytics/export',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-LC81-Request':'1'},body:JSON.stringify(q)});
     if(!res.ok)throw Error((await res.json().catch(()=>({}))).error||'Отчёт недоступен');
     const filename=res.headers.get('Content-Disposition')?.match(/filename="(TWI-03-REPORT-[a-z-]+\.xlsx)"/)?.[1];if(!filename)throw Error('Имя отчёта не подтверждено');save(filename,await res.blob(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');note('Отчёт сформирован из актуального среза');
    }));
   }
   controls.replaceChildren(panel(d.reports.find(x=>x.id===kind).label,...Object.values(f),button('Сформировать подробный отчёт',draw,'primary')));out.replaceChildren();links.replaceChildren();
  }
  for(const r of o.reports)tabs.append(button(r.label,()=>{if(discard())return choose(r.id)}));root.append(tabs,controls,out,links);return root;
 }
 async function historyDetail(host,id){
  if(!discard())return;const d=await api(query('history/detail',{id})),n=panel('Исторический аудит RC1',el('p',d.date+' · '+d.version+' · исходный ID '+d.source_id+' · ревизия '+d.source_revision),el('p','Инструктор: '+d.names.mentor+' · ВТ: '+d.names.auditor+' · Обучаемый: '+(d.names.trainee||'—')),el('p','Работа: '+d.job),el('p','Исторические ответы не подтверждают допуск или действующую норму L1.'),table(['№','Раздел','Критерий','Исходная оценка','Комментарий'],d.questions.map(q=>[q.position,q.section,q.question,q.value,q.note])),el('p',d.feedback));
  if(d.annulment)n.append(el('p','Аннулирование: '+(d.annulment.status==='known'?(d.annulment.reason||'Без причины')+' · '+(d.annulment.time||'Время не указано')+' · '+d.annulment.source:d.annulment.status==='conflict'?'Конфликт исходных свидетельств':'Причина и дата не подтверждены')));
  host.replaceChildren(n);host.scrollIntoView({block:'nearest'});
 }
 async function history(){
  const opts=await api('history/options'),root=panel('Историческая база RC1',el('p','Импорт RC1 v2/v3 и twi-audit-transfer v1. Версии методик и исходные ответы сохраняются неизменными; архивные действия и циклы не становятся активными задачами. Нативный мобильный аудит — отдельный механизм.')),registry=el('div'),detail=el('div');
  async function list(offset=0){
   const d=await api(query('history/list',{offset}));
   const auditRows=d.items.map(x=>[x.date,x.mentor,x.auditor,x.job,x.version,x.state==='void'?'Аннулирован':'Исторический',button('Открыть архивный аудит',()=>historyDetail(detail,x.id))]);
   const archives=d.archives.map(x=>[x.at,x.counts.actions,x.counts.cycles,x.counts.changes,x.counts.mobileLog,button('Открыть пакет',async()=>{
    const r=await api(query('history/archive',{id:x.id})),json=JSON.stringify(r.records,null,2);
    detail.replaceChildren(panel('Неизменяемая исходная история',el('pre',json),button('Скачать исходную историю JSON',()=>save('RC1-history-'+r.id.slice(0,8)+'.json',json,'application/json'))));
   })]);
   registry.replaceChildren(panel('Принятые исторические аудиты',el('p','Записей: '+d.total),table(['Дата','Инструктор','ВТ','Работа','Версия','Состояние',''],auditRows)),panel('Дополнительная история',el('p','Пакетов: '+d.archive_total),table(['Принят','Мероприятия','Циклы','Изменения','Мобильный журнал',''],archives)));
   if(offset)registry.append(button('Предыдущие 100',()=>list(Math.max(0,offset-100))));if(offset+100<Math.max(d.total,d.archive_total))registry.append(button('Следующие 100',()=>list(offset+100)));
  }
  if(opts.can_import){
   const file=input('rc1_history_file','Исходная база RC1 JSON до 5 МБ','file'),fi=file.querySelector('input');fi.accept='.json,application/json';const out=el('div');let raw=null;
   fi.addEventListener('change',()=>{raw=null;out.replaceChildren()});
   async function preview(offset=0){
    const current=raw,p=await api('history/preview',{raw:current,offset});if(current!==raw)return;
    const labels={ready:'Готов к сопоставлению',duplicate:'Уже принят',conflict:'Конфликт',metadata:'Уточнение истории аннулирования',invalid:'Ошибка'},controls=[],annotations=[];
    const n=panel('Предварительная проверка RC1',el('p',Object.entries(p.counts).map(([k,v])=>labels[k]+': '+v).join(' · ')));
    for(const [i,x] of p.items.entries()){
     const box=panel((x.date||'Строка '+(offset+i+1))+' · '+(x.names?.mentor||'')+' · '+labels[x.status],el('p',x.error||[x.job,x.version,x.names?.auditor,x.names?.trainee].filter(Boolean).join(' · ')));
     if(x.status==='ready'){
      const include=el('input');include.type='checkbox';include.setAttribute('aria-label','Импортировать '+x.id);const l=el('label','Выбрать запись','row');l.append(include);
      const mentor=pick('rc1_mentor','Инструктор',opts.people,'— Сопоставьте —',x.suggestions.mentor),auditor=pick('rc1_auditor','ВТ',opts.people,'— Сопоставьте —',x.suggestions.auditor),trainee=pick('rc1_trainee','Обучаемый',opts.people,'Не сопоставлен',x.suggestions.trainee),revision=pick('rc1_revision','Точная редакция СОП',opts.revisions,'Без подтверждённой связи');
      box.append(l,mentor,auditor,trainee,revision);controls.push({x,include,mentor,auditor,trainee,revision});
     }else if(x.status==='metadata'){const include=el('input');include.type='checkbox';const l=el('label','Дополнить исходную причину и время','row');l.append(include);box.append(l);annotations.push({x,include})}
     if(x.annulment)box.append(el('p','Исходное аннулирование: '+x.annulment.reason+' · '+x.annulment.annulledAt));n.append(box);
    }
    const commit=async archive_hash=>{
     if(raw!==current)return;const selected=controls.filter(c=>c.include.checked).map(c=>({id:c.x.id,hash:c.x.hash,mentor_id:val(c.mentor),auditor_id:val(c.auditor),trainee_id:val(c.trainee)||null,revision_id:val(c.revision)||null})),metadata=annotations.filter(c=>c.include.checked).map(c=>c.x.id);
     if(!selected.length&&!metadata.length&&!archive_hash)throw Error('Выберите записи или пакет дополнительной истории');
     if(selected.some(x=>!x.mentor_id||!x.auditor_id))throw Error('Сопоставьте инструктора и ВТ');
     if(!confirm('Подтвердить импорт исторических данных без перезаписи исходных оценок?'))return;
     const r=await api('history/import',{raw:current,token:p.token,selected,metadata,archive_hash});note('Принято аудитов: '+r.imported+' · уточнений: '+r.metadata);await list();await preview(offset);
    };
    if(controls.length||annotations.length)n.append(button('Подтвердить выбранные записи',()=>commit(null),'primary'));
    if(p.archive_error)n.append(el('p',p.archive_error,'warn'));for(const a of p.archive)n.append(button('Сохранить пакет истории · '+Object.entries(a.counts).map(([k,v])=>k+': '+v).join(', '),()=>commit(a.hash)));
    if(offset)n.append(button('Предыдущие 100',()=>preview(Math.max(0,offset-100))));if(offset+100<p.total)n.append(button('Следующие 100',()=>preview(offset+100)));
    out.replaceChildren(n);
   }
   root.append(panel('Импорт исторической базы',file,button('Проверить и сопоставить RC1',async()=>{const f=fi.files?.[0];if(!f||f.size>5*1024*1024)throw Error('Выберите JSON до 5 МБ');raw=JSON.parse(await f.text());await preview()}),out));
  }
  root.append(registry,detail);await list();return root;
 }
 return {analytics,frvDetail,history,historyDetail};
}
