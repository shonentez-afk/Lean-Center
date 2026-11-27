// Existing offline HTML form + JSON handoff. No protected database in browser.
export function createMobileAuditUI({api,button,panel,table,el,input,select,form,value,note,discard}){
 const save=(filename,body,type)=>{const blob=new Blob([body],{type}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)};
 async function panelFor(){
  const d=await api('mobile-audit/options'),n=panel('Мобильный аудит L1 · RC1',el('p','Автономный HTML работает без сети. Форму можно использовать только от своего имени. После наблюдения сохраните JSON, затем импортируйте его в защищённый центр. Скачанный файл и очередь браузера содержат служебные данные; храните их только на разрешённом устройстве.'));
  if(d.assignments.length&&d.methods.length){
   const consent=el('input');consent.type='checkbox';consent.name='offline_consent';consent.required=true;const label=el('label','Разрешено хранение служебного бланка на этом устройстве','field');label.append(consent);
   n.append(panel('1. Подготовить автономный бланк',form([select('assignment_id','Согласованное назначение',d.assignments.map(x=>[x.id,x.label])),select('method_id','Методика',d.methods.map(x=>[x.id,x.label])),label],'Скачать мобильный HTML',async f=>{
    const t=d.assignments.find(x=>x.id===value(f,'assignment_id'));if(!t||!consent.checked)throw Error('Подтвердите сохранение бланка');
    const r=await api('mobile-audit/export',{assignment_id:t.id,assignment_rev:t.rev,method_id:value(f,'method_id'),confirmed:true});
    save(r.filename,r.html,'text/html;charset=utf-8');note('Автономный бланк сформирован. Это не зарегистрированный аудит.');
   })));
  }else n.append(el('p','Нет доступных назначений или действующей методики RC1 для выгрузки. Проверьте назначение ВТ и права.'));
  if(!d.can_import)return n;
  const file=input('mobile_packet','Мобильный пакет JSON до 5 МБ','file'),fi=file.querySelector('input');fi.accept='.json,application/json';const out=el('div');let packet=null;
  fi.addEventListener('change',()=>{packet=null;out.replaceChildren()});
  async function preview(){
   const p=packet,result=await api('mobile-audit/preview',p);if(p!==packet)return;
   const controls=[],labels={ready:'Готов к выбору',waiting:'Ожидает факта',duplicate:'Уже принят',conflict:'Конфликт',invalid:'Недоступен / ошибка'};
   const lines=result.items.map(x=>{
    const cell=el('div'),use=el('input');use.type='checkbox';use.disabled=x.status!=='ready';use.setAttribute('aria-label','Импортировать строку '+x.row);
    if(x.status==='ready'){
     const s=select('session_'+x.row,'Факт инструктажа',[['','— Выберите —'],...x.facts.map(f=>[f.id,f.label])]);const field=s.querySelector('select');cell.append(use,s);controls.push({x,use,field});
    }else cell.append(el('span','—'));
    return [x.row,x.label,x.observed_on,labels[x.status],x.message,cell];
   });
   const act=el('div',undefined,'row');if(controls.length)act.append(button('Подтвердить импорт мобильных аудитов',async()=>{
    if(p!==packet)return;const chosen=controls.filter(c=>c.use.checked);
    if(!chosen.length||chosen.some(c=>!c.field.value))throw Error('Отметьте записи и выберите фактический инструктаж');
    if(!confirm('Импортировать '+chosen.length+' наблюдений? Все выбранные строки сохраняются одним пакетом.'))return;
    const r=await api('mobile-audit/commit',{packet:p,selected:chosen.map(({x,field})=>({id:x.id,hash:x.hash,assignment_rev:x.assignment_rev,session_id:field.value}))});
    note('Подтверждено сервером: '+r.imported+' наблюдений. Скачайте квитанцию для телефона.');await preview();
   },'primary'));
   act.append(button('Скачать подтверждение приёма',async()=>{
    if(p!==packet)return;const r=await api('mobile-audit/receipt',p);if(!r.accepted.length)throw Error('Нет принятых совпадающих наблюдений');
    save('LeanCenter-L1-confirmation.json',JSON.stringify(r,null,2),'application/json');note('Подтверждение сформировано: '+r.accepted.length+' наблюдений');
   }));
   out.replaceChildren(table(['Строка','Назначение','Дата','Статус','Основание','Выбор факта'],lines),act);
  }
  n.append(panel('2. Проверить и принять мобильный пакет',el('p','Выберите исходный JSON. Для каждой новой записи выберите реальный этап инструктажа; повторное принятие и совпадение одного наблюдения блокируются.'),file,button('Предварительная проверка JSON',async()=>{
   if(!discard())return;
   const f=fi.files?.[0];if(!f||f.size>5*1024*1024)throw Error('Выберите мобильный JSON до 5 МБ');
   let raw;try{raw=JSON.parse(await f.text())}catch{throw Error('Некорректный JSON')};packet=raw;await preview();
  }),out));
  return n;
 }
 return {panel:panelFor};
}
