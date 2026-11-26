// Client-side interaction only. Permissions, source checks and every write
// are decided on the server. The opaque editor receives exactly one source.
const context=(kind,command,operation_id,id=null,revision_id=null,origin_id=null,origin_revision=null)=>({kind,command,id,revision_id,operation_id,origin_id,origin_revision});
const stateLabel={draft:'Черновик',review:'На согласовании',approved:'Согласован (прежний порядок)',effective:'Действует',superseded:'Заменён',withdrawn:'Выведен',final:'Завершено',archived:'Архив'};
const max=30*1024*1024;
export function createLibraryUI({api,run,button,panel,table,el,input,select,form,value,note,refresh,render,discard}){
 let active=null;
 function clear(){
  const s=active;active=null;
  if(s){clearTimeout(s.timeout);s.host.remove();document.body.classList.remove('editor-active');document.querySelector('main')?.removeAttribute('inert')}
  refresh();
 }
 function close(){if(!active)return true;if(!confirm(active.attempted?'Сохранение могло быть принято сервером. Проверьте каталог после закрытия. Закрыть рабочую копию?':'Закрыть рабочую копию без сохранения в каталог?'))return false;clear();return true}
 function reply(s,message){if(active===s&&s.frame)s.frame.contentWindow.postMessage({protocol:'lean-editor-v1',session:s.session,type:'result',message},'*')}
 function showPreview(s,text){
  if(active!==s)return;
  const raw=JSON.parse(text),ctx=s.open.context,kind=ctx.kind;
  if(kind==='sop'&&(!raw.constructor||!Array.isArray(raw.constructor.steps))||kind==='frv'&&(!raw.study||!Array.isArray(raw.cycles)))throw Error('Неверный формат исходного файла');
  s.frame&&(s.frame.hidden=true);s.preview.hidden=false;s.preview.replaceChildren();s.note.textContent='Подтвердите сохранение черновика';s.source=text;s.attempted=null;
  const title=s.open.title|| (kind==='sop'?raw.constructor.meta?.operation:raw.study.operationId)||'';
  const titleInput=input('library_title','Название');titleInput.querySelector('input').value=title;
  const codeInput=input('library_code','Код документа');codeInput.querySelector('input').value=s.open.code||(kind==='sop'&&raw.document?.number!=='Черновик'?raw.document?.number||'':'');
  const dateInput=input('library_observed','Фактическая дата наблюдения','date');dateInput.querySelector('input').value=s.open.observed_at||'';
  const fields=[titleInput,...(kind==='sop'&&ctx.command==='create'?[codeInput]:[]),...(kind==='frv'?[dateInput]:[])];
  const saveLabel=ctx.command==='create'?'Сохранить новый черновик':ctx.command==='revise'?'Создать новую редакцию':'Сохранить изменения черновика';
  const f=form(fields,saveLabel,async f=>{
   const req=s.attempted??{request_id:crypto.randomUUID(),context:ctx,expected_revision:s.open.expected_revision,title:value(f,'library_title'),code:kind==='sop'&&ctx.command==='create'?value(f,'library_code'):null,observed_at:kind==='frv'?value(f,'library_observed'):null,text:s.source};
   s.attempted=req;
   for(const control of f.querySelectorAll('input'))control.disabled=true;
   back.disabled=true;status.textContent='Сохранение на сервере…';refresh();
   try{
    const result=await api('library/save',req);
    if(active!==s)return;
    clear();note(result.duplicate?'Сервер подтвердил ранее сохранённый черновик.':'Черновик сохранён на сервере.');await render();
   }catch(e){
    if(active!==s)throw e;
    const ambiguous=!e.status||e.status>=500;
    if(ambiguous){status.textContent='Подтверждение не получено. Повторите тот же запрос, не создавайте новый документ. Поля зафиксированы.'}
    else{
     s.attempted=null;for(const control of f.querySelectorAll('input'))control.disabled=false;
     back.disabled=!s.frame;status.textContent=e.message;
    }
    refresh();throw e;
   }
  });
  const back=button('Вернуться в редактор',()=>{if(s.attempted)return;s.preview.hidden=true;s.preview.replaceChildren();if(s.frame)s.frame.hidden=false;s.note.textContent='Рабочая копия открыта';s.source=null;refresh()});
  back.disabled=!s.frame;
  const status=el('p','Ожидается подтверждение. Исходный статус Stage43 не является согласованием.','muted');
  const summary=kind==='sop'?'Шагов: '+raw.constructor.steps.length+' · Фото: '+Object.keys(raw.photoAssets||{}).length:'Циклов: '+raw.cycles.length;
  s.preview.append(panel('Проверка исходного файла',el('p',summary),el('p','Операция: '+s.open.operation.name),ctx.origin_id?el('p','Проект из подтверждённого исходного ФРВ. Связь сохранится с черновиком.','muted'):el('span'),status,f,back));
  refresh();
 }
 async function launch(ctx,tab=null,importText=null){
  if(!discard()||active&&!close())return;
  const opened=await api('library/open',ctx);
  const host=el('section',undefined,'editor-host lc81-library-host'),bar=el('div',undefined,'editor-host-bar'),preview=el('div',undefined,'lc81-library-preview'),label=el('span','Загрузка рабочей копии…','editor-host-note');
  host.id='lc81-library-host';host.setAttribute('role','region');host.setAttribute('aria-label','Редактор документов');preview.hidden=true;
  const session=crypto.randomUUID(),s={session,host,preview,note:label,frame:null,open:opened,loaded:false,loading:false,source:null,attempted:null,timeout:null};
  active=s;
  bar.append(el('strong',ctx.kind==='frv'?'Редактор ФРВ':tab==='twi'?'План инструктажа TWI':tab==='frv'?'ФРВ по СОП':'Конструктор СОП'),label,button('Закрыть редактор',()=>close()));
  host.append(bar);document.body.append(host);document.body.classList.add('editor-active');document.querySelector('main')?.setAttribute('inert','');
  if(importText!==null){
   try{showPreview(s,importText)}catch(e){clear();throw e}
   host.append(preview);return;
  }
  const frame=el('iframe');s.frame=frame;frame.id='lc81-editor-frame';frame.title='Изолированный редактор Stage43';frame.setAttribute('sandbox','allow-scripts allow-modals');
  frame.referrerPolicy='no-referrer';frame.src='/editor/frame?session='+encodeURIComponent(session)+'&kind='+ctx.kind+(tab?'&tab='+tab:'');
  host.append(frame,preview);
  s.timeout=setTimeout(()=>{if(active===s&&!s.loaded){label.textContent='Редактор не подтвердил загрузку. Закройте его; каталог не изменён.';note(label.textContent,true)}},30000);refresh();
 }
 window.addEventListener('message',e=>{
  const s=active,m=e.data;
  if(!s?.frame||e.source!==s.frame.contentWindow||e.origin!=='null'||m?.protocol!=='lean-editor-v1'||m.session!==s.session)return;
  if(m.type==='ready'&&!s.loading&&!s.loaded){
   s.loading=true;s.frame.contentWindow.postMessage({protocol:'lean-editor-v1',session:s.session,type:'load',text:s.open.text,defaults:{operation:s.open.operation.name,unit:s.open.operation.unit,people:s.open.people,theme:'light'}},'*');
  }else if(m.type==='loaded'&&s.loading){
   clearTimeout(s.timeout);s.loaded=true;s.loading=false;s.note.textContent='Редактор готов · рабочая копия в памяти';s.open.text=null;refresh();
  }else if(m.type==='source'&&s.loaded&&!s.attempted){
   if(m.kind!==s.open.context.kind||typeof m.text!=='string'||new TextEncoder().encode(m.text).length>max){reply(s,'Неверный исходный файл или превышен лимит 30 МБ');return}
   try{showPreview(s,m.text);reply(s,'Подтвердите сохранение в каталоге')}catch(e){reply(s,e.message);note(e.message,true)}
  }else if(m.type==='error'){clearTimeout(s.timeout);s.note.textContent='Ошибка редактора: '+String(m.message||'неизвестно');note(s.note.textContent,true)}
 });
 function importButton(ctxFn){
  const chooser=el('input');chooser.type='file';chooser.accept='.json,application/json';chooser.hidden=true;
  chooser.addEventListener('change',()=>{const file=chooser.files?.[0];if(!file)return;run(async()=>{if(file.size>max)throw Error('JSON до 30 МБ');await launch(ctxFn(),null,await file.text());chooser.value=''})});
  const wrap=el('span');wrap.append(button('Импорт JSON Stage43',()=>{ctxFn();chooser.click()}),chooser);return wrap;
 }
 function createPanel(kind,info){
  const n=panel(kind==='sop'?'Новый СОП':'Новое исследование ФРВ');
  if(!info.operations.length){n.append(el('p','Нет операций, для которых назначено право создания.','muted'));return n}
  const op=select('create_operation','Операция',[['','— Выберите операцию —'],...info.operations.map(x=>[x.id,x.code+' · '+x.name])]);
  const make=()=>{const id=op.querySelector('select').value;if(!id)throw Error('Выберите операцию');return context(kind,'create',id)};
  const row=el('div',undefined,'row');row.append(button('Открыть конструктор',()=>launch(make()),'primary'),importButton(make));n.append(op,row);return n;
 }
 function editActions(r,kind){
  const row=el('div',undefined,'row');
  if(kind==='sop'){
   if(r.can_edit||r.can_revise){
    const ctx=()=>context('sop',r.can_edit?'save':'revise',r.operation_id,r.document_id,r.revision_id);
    row.append(button(r.can_edit?'Открыть редактор':'Создать редакцию',()=>launch(ctx()),'primary'),importButton(ctx));
    row.append(button('План TWI',()=>launch(ctx(),'twi')),button('ФРВ по СОП',()=>launch(ctx(),'frv')));
   }
   if(r.can_passport){
    const d=el('details');d.append(el('summary','Паспорт СОП'));
    const format=select('format','Формат А3',[['portrait','Вертикальный'],['landscape','Горизонтальный']]);format.querySelector('select').value=r.print_format||'portrait';
    const changed=input('changed','Дата изменения','date');changed.querySelector('input').value=r.changed_on||'';
    d.append(form([format,changed],'Сохранить паспорт',async f=>{await api('library/passport',{id:r.document_id,revision_id:r.revision_id,expected_revision:r.document_rev,print_format:value(f,'format'),changed_on:value(f,'changed')});note('Паспорт сохранён');await render()}));row.append(d);
   }
  }else{
   if(r.can_edit){
    const ctx=()=>context('frv','save',r.operation_id,r.id);
    row.append(button('Открыть редактор',()=>launch(ctx()),'primary'),importButton(ctx));
   }
   if(r.can_create_sop)row.append(button('Создать СОП из ФРВ',()=>launch(context('sop','create',r.operation_id,null,null,r.id,r.rev))));
   if(r.can_finalize){
    const d=el('details');d.append(el('summary','Завершить исследование'),form([input('note','Примечание','text',false)],'Подтвердить завершение',async f=>{await api('library/finalize',{id:r.id,expected_revision:r.rev,note:value(f,'note')});note('Исследование завершено');await render()}));row.append(d);
   }
  }
  return row.childElementCount?row:'Только чтение';
 }
 function detailButton(r,action,title){
  const d=el('div'),out=el('div'),id=r.revision_id||r.id;
  const btn=button(title,async()=>{
   if(out.childElementCount){out.replaceChildren();return}
   const {data}=await api('library/detail?action='+encodeURIComponent(action)+'&id='+encodeURIComponent(id));
   if(action==='sop.read_twi')out.append(el('p',data.status+' · заполнено '+data.filled),table(['Этап','Содержание'],data.fields.map(x=>[x.label,x.value])));
   else if(action==='sop.read_linked_frv')out.append(el('p','Расчёт по шагам СОП, не фактические замеры. Секунд: '+data.totals.seconds+' · некорректных шагов: '+data.invalid),table(['Шаг','Действие','Сек.','ВДЦ','М1','М2','Не распределено'],data.rows.map(x=>[x.position,x.action,x.seconds,x.vdc,x.m1,x.m2,x.unclassified])));
   else out.append(el('p','Фактические замеры · полных до: '+data.baselineCount+' · после: '+data.improvedCount+' · незаполнено: '+data.missing),el('p',data.comparable?'Сопоставление подтверждено; разница '+data.delta+' с.':'Сопоставление до/после не подтверждено.'),table(['Цикл','Фаза','Сек.','Полный'],data.cycles.map(x=>[x.index,x.phase,x.seconds,x.complete?'Да':'Нет'])));
  });
  d.append(btn,out);return d;
 }
 function history(items){return panel('Каталог СОП · редакции',el('p','Согласование и утверждение в защищённом режиме появятся после LC8.3.','muted'),items.length?table(['Код','Название','Редакция','Состояние','Формат','Пересмотр','Действия'],items.map(r=>[r.code,r.title,'v'+r.version_no,stateLabel[r.state]||r.state,r.print_format||'—',r.review_due,editActions(r,'sop')])):el('p','Нет доступных записей','empty'))}
 function frv(items){return panel('ФРВ',items.length?table(['Название','Дата','Состояние','Действия','Результаты'],items.map(r=>[r.title,r.observed_at,stateLabel[r.state]||r.state,editActions(r,'frv'),r.can_summary?detailButton(r,'frv.read_summary','Замеры'):'—'])):el('p','Нет доступных записей','empty'))}
 function linked(items,action){const key=action==='sop.read_twi'?'can_twi':'can_linked_frv',title=action==='sop.read_twi'?'Планы инструктажа TWI':'ФРВ по действующим СОП';const visible=items.filter(r=>r[key]);return panel(title,visible.length?table(['Код','Название','Редакция','Материал'],visible.map(r=>[r.code,r.title,'v'+r.version_no,detailButton(r,action,'Открыть')])):el('p','Нет доступных материалов','empty'))}
 return {active:()=>!!active,clear,close,launch,createPanel,history,frv,linked};
}
