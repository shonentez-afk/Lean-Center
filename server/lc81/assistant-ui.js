// Read-only assistant; the server owns facts, permissions and outbound payload.
export function createAssistantUI({api,button,panel,table,el,input,select,note,openLinked,permitted}){
 const options=(field,items,chosen)=>{const s=field.querySelector('select');s.replaceChildren(...items.map(([id,label])=>new Option(label,id)));s.value=chosen??items[0]?.[0]??'';return s};
 const fieldValue=x=>x.querySelector('input,select').value;
 const priority={urgent:'Сначала проверить',review:'Требуется решение',plan:'Запланировать / настроить'};
 const plainButton=(text,fn)=>{const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b};
 function renderData(d,context,host,follow){
  const root=panel(d.title,el('p',d.scope+' · '+d.day),...d.notices.map(x=>el('p',x,'muted')));
  if(d.facts.length)root.append(table(['Что установлено по доступным данным','Значение'],d.facts.map(x=>[x.label,x.value])));
  if(d.metrics?.length)root.append(panel('Показатели и определения',table(['Показатель','Значение','Знаменатель','Определение'],d.metrics.map(m=>[m.label,m.value,m.denominator,m.definition]))));
  if(!d.checks.length)root.append(el('p','По доступным проверкам нет открытых сигналов. Это не означает отсутствие отклонений в недоступных источниках.'));
  for(const c of d.checks)root.append(panel(c.label+' · '+c.count,el('p',priority[c.priority]||''),el('p',c.basis,'muted'),el('p',c.advice),...c.links.slice(0,20).map(l=>button(l.label,()=>follow(l.route)))));
  const cloud=panel('Дополнительно · облачный ИИ',el('p','Внешний сервис получает только выбранные общие темы и инструкции. Имена, ID, исходные данные, даты, суммы, количества и свободный текст не передаются.'));
  if(!d.cloud_enabled||!d.can_cloud){cloud.append(el('p','Внешний ИИ отключён настройкой сервера или не разрешён для этой области. Локальные рекомендации доступны.','muted'));root.append(cloud);return root}
  if(!d.checks.length){cloud.append(el('p','Нет тем для отправки.'));root.append(cloud);return root}
  const selectors=d.checks.map((c,i)=>{const x=el('input');x.type='checkbox';x.checked=i<4;x.setAttribute('aria-label',c.label);const l=el('label',undefined,'row');l.append(x,el('span',c.label));return {c,x,l}});
  const model=select('assistant_model','Модель',d.models.map(m=>[m.id,m.label])),preview=el('pre','','lc7-preview'),out=el('div'),consent=el('input');consent.type='checkbox';const consentLabel=el('label',undefined,'row');consentLabel.append(consent,el('span','Разрешаю отправить показанный запрос во внешний сервис'));
  let payload=null,controller=null;
  const send=button('Запросить рекомендации ИИ',async()=>{
   if(!payload||!consent.checked||controller)return;
   const request=payload;consent.checked=false;send.disabled=true;controller=new AbortController();const signal=controller.signal;
   out.replaceChildren(el('p','Запрос онлайн…'),plainButton('Отменить запрос',()=>controller?.abort()));
   try{
    const result=await api('assistant/cloud',{...request,confirmed:true},signal);
    if(!root.isConnected||signal.aborted)return;
    out.replaceChildren(el('p','Дополнительные советы, не подтверждённые факты. Сверьте с исходными записями.','muted'),el('p','Запрошено: '+(d.models.find(m=>m.id===result.requested)?.label||'—')+' · Прокси: '+(d.models.find(m=>m.id===result.reported)?.label||'маршрут не подтверждён')));
    for(const x of result.recommendations)out.append(panel(d.checks.find(q=>q.id===x.id)?.label||'Рекомендация',el('p',x.text)));
   }catch(e){if(root.isConnected)out.replaceChildren(el('p',signal.aborted?'Запрос отменён':e.message+' · локальные рекомендации доступны.','warn'))}
   finally{controller=null;send.disabled=true}
  },'primary');send.disabled=true;consent.disabled=true;
  root.lcAssistantAbort=()=>controller?.abort();
  const invalidate=()=>{controller?.abort();payload=null;consent.checked=false;consent.disabled=true;send.disabled=true;preview.textContent='Сначала сформируйте предпросмотр.';out.replaceChildren()};
  selectors.forEach(s=>s.x.addEventListener('change',invalidate));model.querySelector('select').addEventListener('change',invalidate);consent.addEventListener('change',()=>{send.disabled=!consent.checked||!payload});
  cloud.append(el('p','Выберите до 8 тем.'),...selectors.map(s=>s.l),model,button('Предпросмотр запроса ИИ',async()=>{
   invalidate();const ids=selectors.filter(s=>s.x.checked).map(s=>s.c.id);if(!ids.length||ids.length>8)throw Error('Выберите от 1 до 8 тем');
   const request={context,ids,model:fieldValue(model)},r=await api('assistant/preview',request);
   payload=request;preview.textContent=JSON.stringify(r.payload,null,2);consent.disabled=false;
  }),preview,consentLabel,send,out);
  root.append(cloud);return root;
 }
 async function dialog(context){
  const d=await api('assistant/context',context),trigger=document.activeElement,dialog=el('dialog',undefined,'lc72-context-dialog');dialog.setAttribute('aria-label','Контекстный помощник');const head=el('div',undefined,'lc72-context-head');head.append(el('h2','Проверка сохранённой записи'),plainButton('Закрыть помощник',()=>dialog.close()));
  const content=el('div',undefined,'lc72-context-body');
  const follow=async route=>{
   if(route.type===context.type&&route.id===context.id){dialog.close();return}
   dialog.close();const target=el('div');hostForLinks().append(target);await openLinked(target,route)
  };
  const result=renderData(d,context,content,follow);content.append(result);dialog.append(head,content);document.body.append(dialog);
  dialog.addEventListener('close',()=>{result.lcAssistantAbort?.();dialog.remove();if(trigger?.isConnected)trigger.focus()},{once:true});dialog.showModal();
 }
 const hostForLinks=()=>document.getElementById('content');
 function contextButton(context,label='Проверить запись'){
  return permitted()?button(label,()=>dialog(context)):el('span');
 }
 async function workspace(){
  const d=await api('assistant/options'),root=panel('ИИ-помощник',el('p','Локальные рекомендации из тех же защищённых расчётов, что дашборд и аналитика. Свободный чат и автоматическое изменение данных не предусмотрены.')),out=el('div'),source=el('div');
  if(!d.reports.length){root.append(el('p','Нет разрешённых отчётов. Откройте помощника в доступной карточке.'));return root}
  const names={'center.read':'Оперативный обзор','analytics.read':'Аналитика','metrics.read':'Дерево показателей'},kind=select('assistant_report','Отчёт',d.reports.map(x=>[x.kind,names[x.kind]])),unit=select('assistant_unit','Подразделение',[]),group=select('assistant_group','Направление',d.groups),from=input('assistant_from','С даты','date'),to=input('assistant_to','По дату','date');
  from.querySelector('input').value=d.day.slice(0,7)+'-01';to.querySelector('input').value=d.day;
  const setUnits=()=>{const x=d.reports.find(r=>r.kind===fieldValue(kind));options(unit,[...(x.all?[['','Всё предприятие']]:[]),...x.units.map(u=>[u.id,u.name])],x.default_unit);out.replaceChildren();source.replaceChildren()};
  kind.querySelector('select').addEventListener('change',setUnits);setUnits();
  async function load(){const context={type:'report',kind:fieldValue(kind),scope:{unit_id:fieldValue(unit),from:fieldValue(from),to:fieldValue(to)},group:fieldValue(group)},result=await api('assistant/context',context);source.replaceChildren();out.replaceChildren(renderData(result,context,out,route=>openLinked(source,route)))}
  root.append(kind,unit,group,from,to,button('Проверить выбранную область',load,'primary'),out,source);await load();return root;
 }
 return {workspace,contextButton};
}
