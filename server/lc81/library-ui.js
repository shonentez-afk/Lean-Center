// Client-side interaction only. Permissions, source checks and every write
// are decided on the server. The opaque editor receives exactly one source.
const context=(kind,command,operation_id,id=null,revision_id=null,origin_id=null,origin_revision=null)=>({kind,command,id,revision_id,operation_id,origin_id,origin_revision});
const stateLabel={draft:'Черновик',review:'На согласовании',approved:'Согласован (прежний порядок)',effective:'Действует',superseded:'Заменён',withdrawn:'Выведен',final:'Завершено',archived:'Архив'};
const max=30*1024*1024;
export function createLibraryUI({api,run,button,panel,table,el,input,select,form,value,note,refresh,render,discard,assistant,openLinked,twiReport}){
 let active=null;
 function clear(){
  const s=active;active=null;
  if(s){clearTimeout(s.timeout);if(s.ai){s.ai.controller.abort();if(s.ai.dialog?.open)s.ai.dialog.close();s.ai.dialog?.remove()}s.host.remove();document.body.classList.remove('editor-active');document.querySelector('main')?.removeAttribute('inert')}
  refresh();
 }
 function close(){if(!active)return true;if(!confirm(active.attempted?'Сохранение могло быть принято сервером. Проверьте каталог после закрытия. Закрыть рабочую копию?':'Закрыть рабочую копию без сохранения в каталог?'))return false;clear();return true}
 function reply(s,message){if(active===s&&s.frame)s.frame.contentWindow.postMessage({protocol:'lean-editor-v1',session:s.session,type:'result',message},'*')}
 async function requestEditorAI(s,m){
  if(active!==s||!s.loaded||!Number.isSafeInteger(m.request)||m.request<1)return;
  const send=extra=>{if(active===s&&s.frame)s.frame.contentWindow.postMessage({protocol:'lean-editor-v1',session:s.session,type:'ai-response',request:m.request,...extra},'*')};
  if(s.open.editor_ai_enabled!==true){send({error:'Внешний ИИ конструктора отключён администратором'});return}
  if(s.ai||!s.preview.hidden){send({error:'Дождитесь ответа предыдущего запроса ИИ или вернитесь в редактор'});return}
  const p=m.payload;let encoded;
  try{encoded=JSON.stringify(p)}catch{}
  if(!p||typeof p!=='object'||!Array.isArray(p.messages)||p.messages.length!==2||p.messages.some(x=>typeof x?.content!=='string')||typeof encoded!=='string'||new TextEncoder().encode(encoded).length>384*1024){send({error:'Неверный или слишком большой запрос ИИ'});return}
  const state={request:m.request,controller:new AbortController(),dialog:null};s.ai=state;
  const finish=extra=>{if(s.ai!==state)return;s.ai=null;state.dialog?.remove();s.cancelAI.hidden=true;send(extra)};
  s.cancelAI.onclick=()=>{state.controller.abort();if(state.dialog?.open)state.dialog.close();finish({error:'Запрос ИИ отменён'})};s.cancelAI.hidden=false;
  const go=async()=>{
   try{
    const result=await api('editor/ai',{context:s.open.context,payload:p,confirmed:true},state.controller.signal);
    finish(result);
   }catch(e){finish({error:e.name==='AbortError'?'Запрос ИИ отменён':e.message||'Не удалось получить ответ ИИ'})}
  };
  // The existing "Проверить AI" sends only fixed non-document test text.
  // Server independently verifies this exact healthcheck packet.
  if(p.task==='healthcheck'){await go();return}
  const d=el('dialog',undefined,'lc81-ai-confirm'),head=el('h2','Отправить запрос в Yandex Cloud?');
  d.setAttribute('aria-label','Подтверждение запроса ИИ');state.dialog=d;
  const details=el('details');details.open=true;details.append(el('summary','Точный текст, который будет отправлен'));
  const preview=el('pre',JSON.stringify(p,null,2));preview.className='lc81-ai-payload';details.append(preview);
  const actions=el('div',undefined,'row'),yes=el('button','Отправить запрос','primary'),no=el('button','Отмена');
  yes.type=no.type='button';actions.append(yes,no);
  let approved=false;yes.onclick=()=>{approved=true;d.close();void go()};no.onclick=()=>d.close();
  d.addEventListener('close',()=>{d.remove();if(!approved)finish({error:'Отправка запроса ИИ отменена'})},{once:true});
  d.append(head,el('p','Модель: '+String(p.model)+' · задача: '+String(p.task)),el('p','В запросе могут быть сведения из рабочего документа. Отправляйте только данные, разрешённые вашей организацией. Пароли, персональные и закрытые производственные сведения не должны передаваться внешнему сервису.'),details,actions);
  document.body.append(d);d.showModal();no.focus();
 }
 function showPreview(s,text){
  if(active!==s)return;
  if(s.ai)throw Error('Дождитесь ответа ИИ или отмените запрос перед сохранением');
  const raw=JSON.parse(text),ctx=s.open.context,kind=ctx.kind;
  if(kind==='sop'&&(!raw.constructor||!Array.isArray(raw.constructor.steps))||kind==='frv'&&(!raw.study||!Array.isArray(raw.cycles)))throw Error('Неверный формат исходного файла');
  s.frame&&(s.frame.hidden=true);s.preview.hidden=false;s.preview.replaceChildren();s.note.textContent='Подтвердите сохранение черновика';s.source=text;s.attempted=null;
  const unbound=ctx.command==='create'&&ctx.operation_id===null,opts=s.open.options||{},operations=opts.operations||[],units=opts.operation_units||[];
  const title=s.open.title|| (kind==='sop'?raw.constructor.meta?.operation:raw.study.operationId)||'';
  const titleInput=input('library_title','Название');titleInput.querySelector('input').value=title;
  const codeInput=input('library_code','Код документа');codeInput.querySelector('input').value=s.open.code||(kind==='sop'&&raw.document?.number!=='Черновик'?raw.document?.number||'':'');
  const dateInput=input('library_observed','Фактическая дата наблюдения','date');dateInput.querySelector('input').value=s.open.observed_at||'';
  const fields=[titleInput,...(kind==='sop'&&ctx.command==='create'?[codeInput]:[]),...(kind==='frv'?[dateInput]:[])];
  if(unbound){
   const binding=select('library_operation','Операция для сохранения',[['','— Выберите —'],...operations.map(x=>[x.id,x.code+' · '+x.name]),...(units.length?[['new','+ Создать новую операцию']]:[])]);
   const newFields=el('div',undefined,'lc81-form'),unit=select('library_unit','Подразделение',[['','— Выберите —'],...units.map(x=>[x.id,x.name])]),opCode=input('library_operation_code','Код новой операции'),opName=input('library_operation_name','Название новой операции');
   opName.querySelector('input').value=title;
   if(units.length===1)unit.querySelector('select').value=units[0].id;
   newFields.append(unit,opCode,opName);
   const chooser=binding.querySelector('select');
   if(!operations.length&&units.length)chooser.value='new';
   const sync=()=>{const creating=chooser.value==='new';newFields.hidden=!creating;for(const control of newFields.querySelectorAll('input,select'))control.disabled=!creating};
   chooser.addEventListener('change',sync);sync();
   fields.unshift(binding,newFields);
  }
  const saveLabel=ctx.command==='create'?'Сохранить новый черновик':ctx.command==='revise'?'Создать новую редакцию':'Сохранить изменения черновика';
  const f=form(fields,saveLabel,async f=>{
   let req=s.attempted;
   if(!req){
    const choice=unbound?value(f,'library_operation'):null;
    if(unbound&&!choice)throw Error('Выберите операцию или создайте новую при наличии права');
    req={request_id:crypto.randomUUID(),context:unbound&&choice!=='new'?{...ctx,operation_id:choice}:ctx,expected_revision:s.open.expected_revision,title:value(f,'library_title'),code:kind==='sop'&&ctx.command==='create'?value(f,'library_code'):null,observed_at:kind==='frv'?value(f,'library_observed'):null,text:s.source,...(unbound&&choice==='new'?{new_operation:{unit_id:value(f,'library_unit'),code:value(f,'library_operation_code'),name:value(f,'library_operation_name')}}:{})};
   }
   s.attempted=req;
   const controls=[...f.querySelectorAll('input,select')],disabled=controls.map(control=>control.disabled);
   for(const control of controls)control.disabled=true;
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
     s.attempted=null;controls.forEach((control,i)=>{control.disabled=disabled[i]});
     back.disabled=!s.frame;status.textContent=e.message;
    }
    refresh();throw e;
   }
  });
  const back=button('Вернуться в редактор',()=>{if(s.attempted)return;s.preview.hidden=true;s.preview.replaceChildren();if(s.frame)s.frame.hidden=false;s.note.textContent='Рабочая копия открыта';s.source=null;refresh()});
  back.disabled=!s.frame;
  const status=el('p','Ожидается подтверждение. Исходный статус Stage43 не является согласованием.','muted');
  const summary=kind==='sop'?'Шагов: '+raw.constructor.steps.length+' · Фото: '+Object.keys(raw.photoAssets||{}).length:'Циклов: '+raw.cycles.length;
  s.preview.append(panel('Проверка исходного файла',el('p',summary),el('p',unbound?'Перед сохранением свяжите черновик с реальной операцией.':'Операция: '+s.open.operation.name),unbound&&!operations.length&&!units.length?el('p','Пока нет доступных операций. Попросите управляющего центром добавить операцию. Рабочая копия не сохраняется без связи.','muted'):el('span'),ctx.origin_id?el('p','Проект из подтверждённого исходного ФРВ. Связь сохранится с черновиком.','muted'):el('span'),status,f,back));
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
  s.cancelAI=el('button','Отменить запрос ИИ');s.cancelAI.type='button';s.cancelAI.hidden=true;bar.append(s.cancelAI);
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
  }else if(m.type==='ai-request'&&s.loaded&&!s.attempted){void requestEditorAI(s,m)
  }else if(m.type==='ai-cancel'&&s.ai?.request===m.request){const pending=s.ai;s.ai=null;s.cancelAI.hidden=true;pending.controller.abort();if(pending.dialog?.open)pending.dialog.close();pending.dialog?.remove()
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
  const n=panel(kind==='sop'?'Новый СОП':'Новое исследование ФРВ',el('p',kind==='sop'?'Проект сохраняется как черновик. Официальное согласование и ввод в действие — отдельно.':'Черновик виден автору и уполномоченным сотрудникам. После завершения итоговые замеры доступны предприятию. Не помещайте личные сведения в название и общие поля.','muted'));
  if(!info.can_prepare){n.append(el('p','Создание документов недоступно.','muted'));return n}
  if(!info.operations.length)n.append(el('p',info.operation_units.length?'Справочник операций пока пуст. Начните работу в редакторе; при сохранении можно создать первую операцию.':'Справочник операций пока пуст. Начните работу в редакторе; для сохранения потребуется операция, созданная управляющим или администратором.','muted'));
  const op=select('create_operation','Операция (можно выбрать при сохранении)',[['','— Выбрать позднее —'],...info.operations.map(x=>[x.id,x.code+' · '+x.name])]);
  const make=()=>context(kind,'create',op.querySelector('select').value||null);
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
  if(assistant)row.append(assistant({type:kind==='sop'?'sop':'frv',id:kind==='sop'?r.revision_id:r.id},'Проверить запись'));
  return row.childElementCount?row:'Только чтение';
 }
 function detailButton(r,action,title){
  const d=el('div'),out=el('div'),id=action==='frv.read_summary'?r.id:r.revision_id;
  const btn=button(title,async()=>{
   if(out.childElementCount){out.replaceChildren();return}
   const {data}=await api('library/detail?action='+encodeURIComponent(action)+'&id='+encodeURIComponent(id));
   if(action==='sop.read_twi')out.append(el('p',data.status+' · заполнено '+data.filled),table(['Этап','Содержание'],data.fields.map(x=>[x.label,x.value])));
   else if(action==='sop.read_linked_frv')out.append(el('p','Расчёт по шагам СОП, не фактические замеры. Секунд: '+data.totals.seconds+' · некорректных шагов: '+data.invalid),table(['Шаг','Действие','Сек.','ВДЦ','М1','М2','Не распределено'],data.rows.map(x=>[x.position,x.action,x.seconds,x.vdc,x.m1,x.m2,x.unclassified])));
   else out.append(el('p','Фактические замеры · полных до: '+data.baselineCount+' · после: '+data.improvedCount+' · незаполнено: '+data.missing),el('p',data.comparable?'Сопоставление подтверждено; разница '+data.delta+' с.':'Сопоставление до/после не подтверждено.'),table(['Цикл','Фаза','Сек.','Полный'],data.cycles.map(x=>[x.index,x.phase,x.seconds,x.complete?'Да':'Нет'])));
  });
  d.append(btn,out);return d;
 }
 function history(items){
  const host=el('div'),action=r=>{const box=el('div');box.append(button('Карточка СОП',()=>card(host,r.revision_id)),editActions(r,'sop'));return box};
  return panel('Редакции и черновики СОП',el('p','Согласование и утверждение в защищённом режиме появятся после LC8.3.','muted'),items.length?table(['Код','Название','Редакция','Состояние','Формат','Пересмотр','Действия'],items.map(r=>[r.code,r.title,'v'+r.version_no,stateLabel[r.state]||r.state,r.print_format||'—',r.review_due,action(r)])):el('p','Нет доступных записей','empty'),host)}
 function frv(items){return panel('ФРВ',items.length?table(['Название','Дата','Состояние','Действия','Результаты'],items.map(r=>[r.title,r.observed_at,stateLabel[r.state]||r.state,editActions(r,'frv'),r.can_summary?detailButton(r,'frv.read_summary','Замеры'):'—'])):el('p','Нет доступных записей','empty'))}
 function linked(items,action){const key=action==='sop.read_twi'?'can_twi':'can_linked_frv',title=action==='sop.read_twi'?'Планы инструктажа TWI':'ФРВ по действующим СОП';const visible=items.filter(r=>r[key]);return panel(title,visible.length?table(['Код','Название','Редакция','Материал'],visible.map(r=>[r.code,r.title,'v'+r.version_no,detailButton(r,action,'Открыть')])):el('p','Нет доступных материалов','empty'))}
 // The eight original card areas share one exact server-checked revision.
 // Historical access alone is not permission to read raw source or photos.
 async function card(host,id,initial='steps',trail=[]){
  if(!discard())return;
  const d=await api('library/card?id='+encodeURIComponent(id)),r=d.revision;
  const n=panel('Карточка СОП · '+r.code+' · v'+r.version_no,el('h3',r.title),el('p',(stateLabel[r.state]||r.state)+' · '+(r.effective_at?'Введён: '+r.effective_at.slice(0,10):'Редакция '+r.version_no),'muted'));
  if(trail.length)n.append(button('Назад к редакции v'+trail[trail.length-1].version,()=>card(host,trail[trail.length-1].id,'versions',trail.slice(0,-1))));
  const tabs=el('div',undefined,'lc81-card-tabs row'),body=el('div'),nested=el('div');let selected=null,serial=0;
  const keys=[['steps','Шаги',d.can_steps],['passport','Паспорт',true],['versions','Версии',true],['frv','ФРВ',d.can_linked_frv||d.measured.length>0||!!d.origin],['twi','План TWI',d.can_twi],['effect','Эффективность TWI',d.can_effectiveness],['evaluation','Оценка СОП',d.can_evaluation],['materials','Материалы',d.can_public||d.measured.length>0||!!d.origin]];
  const fieldNames={branch:'Филиал',department:'Подразделение',workplace:'Рабочее место',operation:'Операция',sopNumber:'Номер',safety:'Безопасность',tools:'Инструменты',material:'Материалы'};
  const meta=async()=>d.can_public?(await api('library/detail?action=sop.read_public&id='+encodeURIComponent(id))).data:null;
  const openVersion=x=>card(host,x.revision_id,'passport',[...trail,{id,version:r.version_no}]);
  const measured=()=>d.measured.length?table(['Исследование','Дата','Состояние','Фактические замеры'],d.measured.map(f=>[f.title,f.observed_at,stateLabel[f.state]||f.state,f.can_summary?detailButton(f,'frv.read_summary','Открыть замеры'):'—'])):el('p','Нет доступных связанных фактических исследований.','muted');
  const sourceSnapshot=async()=>{
   if(!d.origin)return null;
   const o=await api('library/origin?id='+encodeURIComponent(id)),s=o.summary;
   const n=panel('Сохранённый снимок исходного ФРВ',el('p',o.title+' · '+o.created_at.slice(0,10)),el('p',o.current?'Источник совпадает с текущими замерами.':'Исследование изменилось после создания этой редакции. Ниже — сохранённый исходный снимок, не новые замеры.','muted'),el('p','Фактические замеры на момент создания СОП · полных до: '+s.baselineCount+' · после: '+s.improvedCount+' · незаполнено: '+s.missing),table(['Цикл','Фаза','Сек.','Полный'],s.cycles.map(x=>[x.index,x.phase,x.seconds,x.complete?'Да':'Нет'])));
   n.append(detailButton({id:o.study_id},'frv.read_summary','Открыть текущие замеры исследования'));
   return n;
  };
  const getSteps=async()=> (await api('resources?action=sop.read_steps&id='+encodeURIComponent(id))).data;
  const photo=(s,can)=>{const cell=el('div');if(can){const b=button('Показать фото',()=>{if(cell.querySelector('img'))return;const im=el('img',undefined,'lc81-image');im.alt='Фото шага '+s.position;im.addEventListener('error',()=>{im.remove();cell.append(el('span','Фото отсутствует','muted'));b.disabled=false},{once:true});im.src='/api/lc81/sop/photo?revision_id='+encodeURIComponent(id)+'&position='+s.position;cell.append(im);b.disabled=true});cell.append(b)}return cell};
  async function show(key,guard=true){
   const spec=keys.find(x=>x[0]===key&&x[2]);if(!spec||guard&&!discard())return;
   selected=key;const request=++serial;for(const b of tabs.querySelectorAll('button')){b.classList.toggle('active',b.dataset.tab===key);b.setAttribute('aria-pressed',String(b.dataset.tab===key))}
   body.replaceChildren(el('p','Загрузка доступных материалов…','muted'));nested.replaceChildren();
   const content=panel(spec[1]);
   if(key==='steps'){
    const doc=await meta(),steps=await getSteps();
    if(doc?.description)content.append(el('p',doc.description));
    content.append(table(['Шаг','Действие','Ключевые моменты','Причина','Секунды','Фото'],steps.steps.map(s=>[s.position,s.action_text,s.key_points.join(' · '),s.reason_text,s.duration_seconds,photo(s,steps.can_read_photo)])));
   }else if(key==='passport'){
    const doc=await meta(),fields=[['Код',r.code],['Название',r.title],['Редакция','v'+r.version_no],['Состояние',stateLabel[r.state]||r.state],...Object.entries({created_at:'Создана',effective_at:'Ввод в действие',review_due:'Срок пересмотра',changed_on:'Изменена',print_format:'Формат А3'}).filter(([k])=>Object.hasOwn(r,k)).map(([k,label])=>[label,k==='print_format'?({portrait:'Вертикальный',landscape:'Горизонтальный'}[r[k]]||'—'):r[k]])];
    if(doc)fields.push(...Object.entries(doc.meta).filter(([,v])=>v).map(([k,v])=>[fieldNames[k]||k,v]));
    content.append(table(['Реквизит','Значение'],fields),el('p','Согласование и ввод в действие остаются отдельным защищённым процессом LC8.3. Исторический статус не является новым согласованием.','muted'),editActions(r,'sop'));
   }else if(key==='versions'){
    content.append(table(['Редакция','Название','Состояние','Введена','Действия'],d.versions.map(v=>['v'+v.version_no,v.title,stateLabel[v.state]||v.state,v.effective_at,v.revision_id===id?'Открыта':button('Открыть редакцию',()=>openVersion(v))])));
    content.append(el('p','Показаны только редакции, доступные текущей учётной записи.','muted'));
   }else if(key==='frv'){
    if(d.can_linked_frv)content.append(detailButton(r,'sop.read_linked_frv','Расчёт ФРВ по шагам'));
    const source=await sourceSnapshot();if(source)content.append(source);
    content.append(el('h3','Связанные исследования с фактическими замерами'),measured());
   }else if(key==='twi')content.append(detailButton(r,'sop.read_twi','Открыть план TWI'));
   else if(key==='effect')content.append(twiReport({revision_id:id,day:d.day}));
   else if(key==='evaluation'){
    content.append(d.evaluations.length?table(['Дата','Оценщик','Методика','Результат','Действия'],d.evaluations.map(x=>[x.date,x.actor,x.method,x.score===null?'—':(100*x.score).toFixed(1)+'%',button('Открыть оценку',()=>openLinked(nested,{type:x.kind,id:x.id}))])):el('p','Нет доступных оценок этой редакции.','muted'));
   }else if(key==='materials'){
    const doc=await meta();if(doc)content.append(table(['Материал','Содержание'],['safety','tools','material','workplace'].filter(k=>doc.meta[k]).map(k=>[fieldNames[k],doc.meta[k]])));
    if(d.can_steps)content.append(button('Фото и материалы шагов',()=>show('steps')));
    const source=await sourceSnapshot();if(source)content.append(source);
    content.append(el('h3','Исследования, связанные с редакцией'),measured());
   }
   if(request!==serial)return;body.replaceChildren(content);
  }
  for(const [key,label,allowed] of keys){if(!allowed)continue;const b=button(label,()=>show(key),'lc81-card-tab');b.dataset.tab=key;b.setAttribute('aria-pressed','false');tabs.append(b)}
  n.append(tabs,body,nested,assistant({type:'sop',id},'ИИ-помощник СОП'));host.replaceChildren(n);
  await show(keys.some(x=>x[0]===initial&&x[2])?initial:'passport',false);
  if(host.isConnected)host.scrollIntoView({block:'nearest'});
 }
 function effective(items){
  const search=input('sop_filter','Поиск по коду или названию','text',false),list=el('div'),host=el('div'),root=panel('Каталог действующих СОП предприятия',el('p','Действующие редакции для ознакомления. Проекты изменений не заменяют действующий документ.','muted'),search,list,host);
  const draw=()=>{
   const q=search.querySelector('input').value.trim().toLocaleLowerCase('ru'),visible=items.filter(r=>(r.code+' '+r.title).toLocaleLowerCase('ru').includes(q));
   list.replaceChildren(el('p','Показано '+visible.length+' из '+items.length,'muted'),visible.length?table(['Код','Название','Редакция','Действия'],visible.map(r=>[r.code,r.title,'v'+r.version_no,button('Открыть СОП',()=>card(host,r.revision_id))])):el('p','Нет подходящих СОП','empty'));
  };search.querySelector('input').addEventListener('input',draw);draw();return root;
 }
 return {active:()=>!!active,clear,close,launch,createPanel,history,frv,linked,effective,card};
}
