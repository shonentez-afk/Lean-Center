const el=id=>document.getElementById(id);
const fmt=new Intl.DateTimeFormat('ru-RU',{
  timeZone:'Asia/Krasnoyarsk',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'
});
const sizeFmt=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
const types={backup:'Резервное копирование',restart:'Перезапуск стенда'};
const labels={ok:'Готово',failed:'Ошибка',running:'Выполняется'};
let csrf=null,choice=null,loading=false,actionPending=false,requestError="";
const buttons=[el('snapshot'),el('restart')];
const confirmDialog=el('confirm');

function text(id,value){el(id).textContent=value;}
function node(tag,className,value){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(value!==undefined)element.textContent=value;
  return element;
}
function time(value){
  const element=node('time','',fmt.format(new Date(value)));
  element.dateTime=value;
  return element;
}
function bytes(value){return sizeFmt.format(value/1024/1024)+' МБ';}
function notice(message='',error=false){
  text('notice',message);
  el('notice').classList.toggle('error',error);
}
function renderBackups(items){
  const rows=items.map(item=>{
    const row=node('li');
    const main=node('div','row-main');
    main.append(node('div','row-title',item.name),time(item.when));
    row.append(main,node('span','row-note','Размер базы · '+bytes(item.bytes)));
    return row;
  });
  el('backups').replaceChildren(...(rows.length?rows:[node('li','empty','Копий пока нет')]));
}
function renderEvents(events){
  const rows=events.map(event=>{
    const row=node('li');
    const main=node('div','row-main');
    const source=event.via==='portal'?'Вручную':'По расписанию';
    main.append(node('div','row-title',types[event.type]),time(event.when),node('span','row-note',' · '+source));
    row.append(main,node('span','state '+event.status,labels[event.status]));
    return row;
  });
  el('events').replaceChildren(...(rows.length?rows:[node('li','empty','Записей пока нет')]));
}
function render(data){
  csrf=data.csrf;
  text('site-status',data.app?'Работает':'Недоступен');
  el('site-dot').className='dot '+(data.app?'up':'down');
  text('tunnel-status',data.relay?'Туннель запущен':'Туннель остановлен или запускается');
  text('version',data.sha?.slice(0,12)??'—');
  el('version').title=data.sha??'';
  text('version-detail',data.run?'GitHub Actions · выпуск '+data.run:'Тестовый выпуск');
  if(data.backups[0]){
    text('last-copy',fmt.format(new Date(data.backups[0].when)));
    text('last-size',bytes(data.backups[0].bytes)+' · снимок базы');
  }else{
    text('last-copy','Нет копий');
    text('last-size','');
  }
  renderBackups(data.backups);
  renderEvents(data.events);
  for(const button of buttons)button.disabled=Boolean(data.operation)||actionPending;
  if(data.operation){notice(types[data.operation.type]+' выполняется…');}
  else if(requestError){notice(requestError,true);}
  else if(data.events[0]?.via==='portal'&&data.events[0].status!=='running'){
    const event=data.events[0];
    notice(types[event.type]+(event.status==='ok'?' завершено.':' завершилось ошибкой.'),event.status==='failed');
  }else{notice();}
}
async function refresh(){
  if(loading)return;
  loading=true;
  try{
    const response=await fetch('/api/overview',{cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error();
    render(await response.json());
  }catch{
    csrf=null;
    for(const button of buttons)button.disabled=true;
    notice('Не удалось обновить состояние портала. Повторим автоматически.',true);
  }finally{loading=false;}
}
for(const button of buttons){
  button.addEventListener('click',()=>{
    choice=button.id;
    text('confirm-title',choice==='snapshot'?'Создать резервную копию?':'Перезапустить тестовый стенд?');
    confirmDialog.showModal();
  });
}
el('cancel').addEventListener('click',()=>confirmDialog.close());
el('submit').addEventListener('click',async()=>{
  const action=choice;
  confirmDialog.close();
  if(!csrf||actionPending||!['snapshot','restart'].includes(action))return;
  actionPending=true;
  requestError='';
  for(const button of buttons)button.disabled=true;
  try{
    const response=await fetch('/api/'+action,{method:'POST',headers:{'x-lean-ops-csrf':csrf}});
    if(!response.ok)throw new Error((await response.json()).error);
    notice(types[action==='snapshot'?'backup':'restart']+' запущено.');
  }catch(error){requestError=error.message||'Операция не запущена.';notice(requestError,true);}
  finally{actionPending=false;await refresh();}
});
void refresh();
setInterval(()=>{if(!document.hidden)void refresh();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
