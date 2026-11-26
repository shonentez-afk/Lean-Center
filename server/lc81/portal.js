// Protected workspace: reuse accepted navigation, registry controls, corporate
// CSS and unsaved-form guard. Never load SQL.js or a snapshot in the browser.
import {navGroups} from '/shared/navigation.js';
import {registryFields} from '/shared/registry-fields.js';
import {protectWorkForm,hasUnsavedForms} from '/shared/form-guard.js';
import {cloudSaveState} from '/shared/cloud-save-state.js';
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
let user=null,page='person.read_basic',busy=false,sequence=0,saving=false,checking=false,saveFailed=false,networkFailed=false;
const actions={...{'person.read_basic':'Сотрудники','sop.read_effective':'Действующие СОП','training.read':'Обучение','task.read':'Мои задачи / мероприятия',"org.read":"Структура предприятия","operation.read":"Операции","sop.read_history":"Редакции СОП","sop.read_steps":"Шаги действующих СОП","frv.read":"ФРВ","training.enrollment.read":"Персональные программы","preparation.read":"Комплекты подготовки","credential.read":"Подготовка наставников","appointment.read":"Приказы о назначении","development.read":"Планы развития","audit.read":"Аудиты","supplement.read":"Доплаты","roi.read":"Экономический эффект","calendar.read":"Личный календарь"},'person.read_directory':'Сотрудники — справочник','equipment.read':'Оборудование','workplace.read':'Рабочие места'};
const directoryActions={'person.read_directory':'person','org.read':'org_unit','equipment.read':'equipment','workplace.read':'workplace','operation.read':'operation'};
const actionLabels={...actions,'task.implement_own':'Выполнение собственных задач','sop.read_photo':'Просмотр фотографий СОП'};
for(const [action,type] of Object.entries(directoryActions)){
 const prefix=action==='person.read_directory'?'person':action.split('.')[0];
 for(const [op,label] of [['create','Создание'],['update','Изменение'],['archive','Архивирование']])actionLabels[prefix+'.'+op]=label+': '+actions[action];
}
const pageActions={person:['person.read_directory','person.read_basic'],home:[],calendar:['calendar.read'],actions:['task.read'],sop:['sop.read_effective','sop.read_steps','sop.read_history'],frv:['frv.read'],twi:['training.read'],programs:['training.enrollment.read'],preparation:['preparation.read'],development:['development.read'],certification:['credential.read'],appointments:['appointment.read'],audit:['audit.read'],supplements:['supplement.read'],roi:['roi.read'],org_unit:['org.read'],workplace:['workplace.read'],operation:['operation.read'],equipment:['equipment.read'],storage:['admin']};
const dirty=()=>hasUnsavedForms($('content'));
const discard=()=>!dirty()||confirm('Есть несохранённые изменения. Продолжить без сохранения?');
function refreshIndicator(){
 if(!user)return;
 const value=cloudSaveState({dirty:dirty(),saving,checking,offline:navigator.onLine===false||networkFailed,saveFailed});
 const n=$('save-indicator');
 n.dataset.kind=value.kind;
 n.textContent=value.kind==='offline'?'Нет связи · изменения не отправлены':value.text;
}
const note=(text,bad=false)=>{const s=$('status');s.hidden=!text;s.textContent=text;s.className='status'+(bad?' error':'');refreshIndicator()};
async function api(url,data){
 const options={cache:'no-store',credentials:'same-origin'},write=data!==undefined&&!['login','logout'].includes(url);
 if(data!==undefined)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json','X-LC81-Request':'1'},body:JSON.stringify(data)});
 if(write){saving=true;saveFailed=false;refreshIndicator()}
 try{
  const r=await fetch('/api/lc81/'+url,options),b=await r.json();
  networkFailed=false;if(!r.ok)throw Object.assign(Error(b.error||'Запрос отклонён'),{status:r.status});
  return b;
 }catch(e){if(!e.status)networkFailed=true;if(write)saveFailed=true;throw e}finally{if(write)saving=false;refreshIndicator()}
}
function button(text,fn,cls=''){const n=el('button',text,cls);n.type='button';n.addEventListener('click',()=>run(fn));return n}
async function run(fn){if(busy)return;busy=true;try{await fn()}catch(e){if(e.status===401)showLogin();note(e.message||'Ошибка',true)}finally{busy=false;refreshIndicator()}}
function showLogin(){sequence++;user=null;saving=false;checking=false;saveFailed=false;$('shell').classList.add('lc81-logged-out');$('workspace').hidden=true;$('nav').hidden=true;$('nav').replaceChildren();$('menu').hidden=true;$('save-indicator').hidden=true;$('content').replaceChildren();$('identity').replaceChildren();$('login-panel').hidden=false;$('login').reset()}
function showUser(a){user=a;$('shell').classList.remove('lc81-logged-out');$('login-panel').hidden=true;$('workspace').hidden=false;$('nav').hidden=false;$('menu').hidden=false;$('save-indicator').hidden=false;$('identity').replaceChildren(el('span',a.display_name+' · '+a.login,'lc81-login-name'),button('Выйти',async()=>{if(!discard())return;await api('logout',{});showLogin();note('Выход выполнен')}));refreshIndicator()}
function panel(title,...children){const n=el('section',undefined,'panel');n.append(el('h2',title),...children);return n}
function table(headers,values){const wrap=el('div',undefined,'tablewrap lc81-rows');const t=el('table'),h=el('thead'),tr=el('tr');for(const v of headers)tr.append(el('th',v));h.append(tr);t.append(h);const b=el('tbody');for(const row of values){const r=el('tr');for(const v of row){const d=el('td');d.append(v instanceof Node?v:el('span',v??'—'));r.append(d)}b.append(r)}t.append(b);wrap.append(t);return wrap}
function input(name,label,type='text',required=true){const n=el('input');n.name=name;n.type=type;n.required=required;if(type==='password')n.autocomplete='new-password';const l=el('label',label,'field');l.append(n);return l}
function select(name,label,items){const s=el('select');s.name=name;s.required=true;for(const [id,title] of items){const o=el('option',title);o.value=id;s.append(o)}const l=el('label',label,'field');l.append(s);return l}
function check(name,label,checked=false){const l=el('label'),n=el('input');n.type='checkbox';n.name=name;n.checked=checked;l.append(n,el('span',label));return l}
const value=(f,k)=>f.elements.namedItem(k).value;
function form(fields,submit,fn){const f=el('form',undefined,'lc81-form');f.append(...fields,el('button',submit,'primary'));f.addEventListener('submit',e=>{e.preventDefault();run(async()=>{if([...$('content').querySelectorAll('[data-lc-work-form]')].some(x=>x!==f&&x.lcIsDirty?.())&&!confirm('В другой форме есть изменения. Продолжить без их сохранения?'))return;await fn(f)})});return protectWorkForm(f)}
const options=items=>items.map(x=>[x.id,x.name||x.display_name||x.login||x.id]);
function adminPanel(d){
 const people=new Map(d.people.map(x=>[x.id,x.display_name])),roles=new Map(d.roles.map(x=>[x.id,x.name])),units=new Map(d.units.map(x=>[x.id,x.name])),accounts=new Map(d.accounts.map(x=>[x.id,x.login]));
 const renew=async(text)=>{note(text);await render()};
 const post=async(route,data,msg)=>{await api('admin/'+route,data);await renew(msg)};
 const grid=el('div');grid.className='lc81-grid';
 const addRef=(title,type,fields,make)=>panel(title,form(fields,'Добавить',f=>post('reference',{type,payload:make(f)},'Запись сохранена')));
 grid.append(
  addRef('Учебный сотрудник','person',[input('employee_code','Табельный номер'),input('display_name','ФИО / имя')],f=>({employee_code:value(f,'employee_code'),display_name:value(f,'display_name')})),
  addRef('Подразделение','org_unit',[input('code','Код'),input('name','Название'),select('parent_id','В составе',options(d.units)),select('kind','Тип',[['Цех','Цех'],['Участок','Участок'],['Служба','Служба'],['Группа','Группа']])],f=>({code:value(f,'code'),name:value(f,'name'),kind:value(f,'kind'),parent_id:value(f,'parent_id')})),
  addRef('Назначение сотрудника','person_assignment',[select('person_id','Сотрудник',options(d.people)),select('unit_id','Подразделение',options(d.units)),input('valid_from','С','date')],f=>({person_id:value(f,'person_id'),unit_id:value(f,'unit_id'),profession_id:null,position_id:null,shift_id:null,shift_code:null,valid_from:value(f,'valid_from'),valid_to:null})),
  addRef('Роль сотрудников','business_role',[input('code','Код'),input('name','Название')],f=>({code:value(f,'code'),name:value(f,'name')})),
  addRef('Назначение роли','role_assignment',[select('person_id','Сотрудник',options(d.people)),select('role_id','Роль',options(d.roles.filter(r=>r.id!==d.protectedRoles[0]))),input('valid_from','С','date')],f=>({person_id:value(f,'person_id'),role_id:value(f,'role_id'),valid_from:value(f,'valid_from'),valid_to:null}))
 );
 const userForm=form([select('person_id','Сотрудник',options(d.people.filter(p=>!d.accounts.some(a=>a.person_id===p.id)))),input('login','Рабочая почта или логин'),input('password','Пароль (12–128 байт)','password',false),check('generate','Сгенерировать пароль на сервере')],'Создать пользователя',async f=>{
  const generate=f.elements.generate.checked,password=value(f,'password');
  const r=await api('admin/account',{person_id:value(f,'person_id'),login:value(f,'login'),password:generate?null:password,generate});
  f.reset();f.lcResetForm?.();await renew('Пользователь создан. Назначьте подтверждённый доступ.');
  if(r.issued_password){const n=el('div','Выданный пароль: '+r.issued_password);n.id='issued';n.append(button('Скрыть пароль',()=>n.remove()));$('content').prepend(n)}
 });
 const accountTable=table(['Логин','Сотрудник','Статус','Действие'],d.accounts.map(a=>[a.login,a.display_name,a.state==='active'?'Активен':'Заблокирован',a.admin?'Защищённый администратор':button(a.state==='active'?'Заблокировать':'Разблокировать',()=>post('state',{id:a.id,state:a.state==='active'?'blocked':'active'},'Состояние изменено'))]));
 const policyForms=d.roles.map(r=>{
  const p=d.policies.find(x=>x.role_id===r.id);
  if(d.protectedRoles.includes(r.id)){
   const detail=el('details');detail.className='lc81-policy';detail.append(el('summary',r.name),el('p','Защищённая системная политика.'));
   if(r.id===d.protectedRoles[1]&&p){detail.append(el('p','Разрешений: '+p.permissions.length+' из '+d.actions.length+' · версия '+p.revision));if(d.actions.some(a=>!p.permissions.includes(a)))detail.append(button('Принять новые возможности управляющего',async()=>{if(!confirm('Обновить рабочие полномочия управляющего? Прежние назначения доступа нужно будет подтвердить заново.'))return;await post('manager-policy',{revision:p.revision},'Права обновлены; подтвердите назначения заново.')}))}
   return detail;
  }
  const checks=el('div');checks.className='lc81-checks';for(const a of d.actions)checks.append(check(a,actionLabels[a],p?.permissions.includes(a)));
  const detail=el('details');detail.className='lc81-policy';detail.append(el('summary',r.name+' · '+(p?.permissions.length||0)+' разрешений'),form([checks],'Сохранить права',f=>post('policy',{role_id:r.id,revision:p?.revision||0,permissions:d.actions.filter(a=>f.elements.namedItem(a).checked)},'Права сохранены; прежние гранты требуют подтверждения')));return detail;
 });
 const grantForm=form([
  select('account_id','Пользователь',options(d.accounts.filter(a=>!a.admin&&a.state==='active'))),
  select('assignment_id','Действующее назначение роли',d.assignments.map(a=>[a.id,(people.get(a.person_id)||a.person_id)+' — '+(roles.get(a.role_id)||a.role_id)])),
  select('scope','Область',[['self','Своё'],['assigned','Назначенное обучение'],['unit_tree','Подразделение с дочерними']]),
  select('unit_id','Подразделение (если выбрана область)',options(d.units)),input('valid_to','До (необязательно)','date',false)
 ],'Подтвердить доступ',f=>post('grant',{account_id:value(f,'account_id'),assignment_id:value(f,'assignment_id'),scope:value(f,'scope')==='unit_tree'?{kind:'unit_tree',unit_id:value(f,'unit_id')}:{kind:value(f,'scope')},valid_to:value(f,'valid_to')||null},'Доступ назначен'));
 const grants=table(['Пользователь','Роль','Область','Ревизия','Состояние'],d.grants.map(g=>[accounts.get(g.account_id),roles.get(g.role_id),g.scope.kind==='unit_tree'?units.get(g.scope.unit_id):g.scope.kind,g.policy_revision,g.state==='active'?button('Отозвать',()=>post('revoke',{id:g.id},'Доступ отозван')):'Отозван']));
 return [panel('Пользователи',accountTable,userForm),panel('Права в существующих ролях',...policyForms),panel('Подтверждённые назначения доступа',grantForm,grants),panel('Учебные справочники',grid),panel('Журнал управления доступом',table(['Время','Действие','Цель'],d.audit.map(a=>[a.occurred_at,a.action,a.target_id])))];
}

function directoryPanel(info,items){
 const type=info.type,d=info.definition,section=panel(actions[page]),editor=el('div',undefined,'lc81-editor'),wrap=el('div'),search=el('input');
 search.type='search';search.placeholder='Поиск по справочнику';const row=el('div',undefined,'row');row.append(search);
 const close=()=>{editor.replaceChildren();refreshIndicator()};
 function open(v){
  if(!discard())return;
  const creating=!v,defs={label:d.label,fields:creating?d.createFields:d.fields},locked=creating?[]:d.lockedFields;
  const opts=(ref,k)=>{let records=info.refs[ref]||[];if(creating&&ref==='org_unit')records=records.filter(x=>x.can_create);const out=records.map(x=>[x.id,x.label]);if(v?.[k]&&!out.some(x=>x[0]===v[k]))out.push([v[k],'Существующая ссылка (без доступа к справочнику)']);return out};
  const {grid,controls,values}=registryFields(defs,v,{optionsFor:opts,today:()=>info.day,lockedFields:locked});
  if(creating&&type==='org_unit')for(const o of [...controls.kind.options])if(o.value==='Предприятие')o.remove();
  // Keep the existing ref if it is not among the user's readable choices.
  if(v)for(const [k,x] of Object.entries(defs.fields))if(x.ref&&v[k]&&!(info.refs[x.ref]||[]).some(r=>r.id===v[k]))controls[k].disabled=true;
  const f=form([grid],'Сохранить',async()=>{await api('directory/change',{type,operation:creating?'create':'update',id:v?.id??null,expected_revision:v?.rev??0,fields:values()});note('Запись сохранена на сервере');await render()});
  f.append(button('Отмена',()=>{if(discard())close()}));
  editor.replaceChildren(panel(creating?'Новая запись':'Редактирование',f));
  refreshIndicator();
 }
 if(info.can_create)row.append(button('Добавить',()=>open(null),'primary'));
 const display=(k,field,r)=>{
  if(field.ref)return (info.refs[field.ref]||[]).find(x=>x.id===r[k])?.label??(r[k]?'Связанная запись':'—');
  if(k==='criticality')return {normal:'Обычная',important:'Важная',critical:'Критическая'}[r[k]]||r[k];
  return r[k]??'—';
 };
 const fields=Object.entries(d.fields);
 function draw(){
  const q=search.value.trim().toLocaleLowerCase('ru-RU'),visible=items.filter(r=>!q||fields.some(([k,f])=>String(display(k,f,r)).toLocaleLowerCase('ru-RU').includes(q))||String(r.unit||'').toLocaleLowerCase('ru-RU').includes(q));
  const headers=fields.map(([,f])=>f.label);
  if(type==='person')headers.push('Подразделение','Должность');
  headers.push('Версия','Действия');
  wrap.replaceChildren(el('p','Показано '+visible.length+' из '+items.length,'muted'),visible.length?table(headers,visible.map(r=>{
   const cells=fields.map(([k,f])=>display(k,f,r));if(type==='person')cells.push(r.unit,r.position);
   const buttons=el('div',undefined,'row');
   if(r.can_update)buttons.append(button('Изменить',()=>open(r)));
   if(r.can_archive)buttons.append(button('Архив',async()=>{if(!discard()||!confirm('Архивировать запись? История сохранится.'))return;await api('directory/change',{type,operation:'archive',id:r.id,expected_revision:r.rev,fields:null});note('Запись архивирована на сервере');await render()},'danger'));
   cells.push('v'+r.rev,buttons.childElementCount?buttons:'Только чтение');return cells;
  })):el('p','Нет доступных записей','empty'));
 }
 search.addEventListener('input',draw);draw();section.append(row,editor,wrap);return section;
}
const labels={id:'ID',display_name:'Сотрудник',revision_id:'Редакция',version_no:'Версия',state:'Состояние',document_id:'Документ',code:'Код',title:'Название',operation_id:'Операция',trainee_id:'Обучаемый',sop_revision_id:'Версия СОП',due_on:'Срок',created_at:'Создано',effective_at:'Введено в действие',review_due:'Пересмотр',start_on:'Начало',kind:'Тип',role:'Роль',issued_on:'Выдано',valid_until:'Действует до',valid_from:'Начало',valid_to:'Окончание',observed_at:'Дата',category:'Категория',adaptation:'Адаптация',safety:'ОТ',internship:'Стажировка',month:'Месяц',currency:'Валюта',method:'Метод',owner_id:'Ответственный',person_id:'Сотрудник',mentor_id:'Наставник'};
const states={draft:'Черновик',review:'На согласовании',approved:'Согласован (старый статус)',effective:'Действует',superseded:'Заменён',withdrawn:'Выведен',planned:'Запланировано',in_progress:'В работе',completed:'Завершено',active:'Активно',cancelled:'Отменено',implemented:'Выполнено',verified:'Проверено',ineffective:'Неэффективно',open:'Открыто',final:'Завершено',retired:'Архив',void:'Аннулировано',declined:'Отклонено'};
function resourcePanel(items){
 // IDs are internal navigation anchors, not useful visible table columns.
 const cols=items.length?Object.keys(items[0]).filter(k=>!['steps','can_implement','can_read_photo','rev','id'].includes(k)&&!k.endsWith('_id')):[];
 const content=panel(actions[page],items.length?table(cols.map(k=>labels[k]||k),items.map(r=>cols.map(k=>k==='state'?states[r[k]]||r[k]:r[k]))):el('p','Нет доступных записей','empty'));
 if(page==='sop.read_steps')for(const r of items){
  const details=el('details');details.append(el('summary',r.title+' · v'+r.version_no));
  const rows=r.steps.map(s=>{
   const cell=el('div');
   if(r.can_read_photo){const b=button('Показать фото',()=>{
    if(cell.querySelector('img'))return;
    const image=el('img',undefined,'lc81-image');image.alt='Фото шага '+s.position;image.loading='lazy';
    image.addEventListener('error',()=>{image.remove();cell.append(el('span','Фото отсутствует или недоступно','muted'));b.disabled=false},{once:true});
    image.src='/api/lc81/sop/photo?revision_id='+encodeURIComponent(r.revision_id)+'&position='+s.position;cell.append(image);b.disabled=true
   });cell.append(b)}
   else cell.append(el('span','Нет разрешения','muted'));
   return [s.position,s.action_text,s.key_points.join(' · '),s.reason_text,s.duration_seconds,cell];
  });details.append(table(['Шаг','Действие','Ключевые моменты','Причина','Секунды','Фото'],rows));content.append(details);
 }
 if(page==='task.read'&&user.permissions.includes('task.implement_own')&&user.person_id){
  const candidates=items.filter(r=>r.can_implement===true);
  if(candidates.length)content.append(el('h3','Выполнить своё мероприятие'),form([select('id','Мероприятие',candidates.map(r=>[r.id,r.title])),input('result','Фактический результат')],'Подтвердить выполнение',async f=>{const r=candidates.find(x=>x.id===value(f,'id'));await api('tasks/implement',{id:r.id,expected_revision:r.rev,result:value(f,'result')});note('Выполнение подтверждено сервером');await render()}));
 }
 return content;
}
function buildNav(){
 const nav=$('nav');nav.replaceChildren();const available=new Set(Object.keys(actions).filter(id=>user.permissions.includes(id)));if(user.admin)available.add('admin');
 if(available.has('person.read_directory'))available.delete('person.read_basic');
 const selected=[];
 const groupFor=act=>navGroups.find(([,keys])=>keys.some(k=>(pageActions[k]||[]).includes(act)))?.[0]||'Рабочие разделы';
 for(const [name,keys] of navGroups){
  const list=keys.flatMap(k=>pageActions[k]||[]).filter(a=>available.has(a)&&!selected.includes(a));
  if(!list.length)continue;
  const group=el('details',undefined,'nav-section');group.open=list.includes(page)||['Ежедневная работа','Люди и компетенции','Управление центром'].includes(name);group.append(el('summary',name,'navgroup'));
  for(const act of list){selected.push(act);group.append(navButton(act,available))}
  nav.append(group);
 }
 for(const act of available)if(!selected.includes(act)){selected.push(act);nav.append(navButton(act,available))}
 if(!available.has(page))page=available.has('person.read_directory')?'person.read_directory':selected[0]||'';
 const current=nav.querySelector('[data-action="'+page+'"]');if(current){current.classList.add('active');current.setAttribute('aria-current','page');if(current.closest('details'))current.closest('details').open=true}
 const head=$('page-heading'),left=el('div');left.append(el('div',groupFor(page),'eyebrow'),el('h1',page==='admin'?'Пользователи и права доступа':actions[page]||'Личное рабочее пространство'));head.replaceChildren(left,el('span','Подтверждение сервером','pill'));
}
function navButton(act,available){
 const n=button(act==='admin'?'Пользователи и права доступа':actions[act],async()=>{if(!discard())return;page=act;$('nav').classList.remove('lc53-menu-open');$('menu').setAttribute('aria-expanded','false');await render()},'nav');
 n.dataset.action=act;return n;
}
async function render(){
 const serial=++sequence;checking=true;refreshIndicator();
 try{
  const fresh=await api('session');if(serial!==sequence)return;user=fresh.user;
  buildNav();$('content').replaceChildren(); // do not retain stale authorized rows
  if(page==='admin'&&user.admin){const data=await api('admin');if(serial===sequence)$('content').replaceChildren(...adminPanel(data));return}
  if(!page){$('content').replaceChildren(panel('Личное рабочее пространство',el('p','Вам пока не назначены права на рабочие разделы. Обратитесь к администратору.')));return}
  const data=await api('resources?action='+encodeURIComponent(page));if(serial!==sequence)return;
  if(directoryActions[page]){
   const info=await api('directory/info?type='+encodeURIComponent(directoryActions[page]));if(serial!==sequence)return;
   $('content').replaceChildren(directoryPanel(info,data.items));return;
  }
  $('content').replaceChildren(resourcePanel(data.items));
 }finally{checking=false;refreshIndicator()}
}
$('menu').addEventListener('click',()=>{const open=$('nav').classList.toggle('lc53-menu-open');$('menu').setAttribute('aria-expanded',String(open))});
$('content').addEventListener('input',refreshIndicator,true);$('content').addEventListener('change',refreshIndicator,true);
window.addEventListener('offline',refreshIndicator);window.addEventListener('online',()=>{if(user&&!dirty()&&!busy&&!$('issued'))run(render);else refreshIndicator()});
window.addEventListener('beforeunload',e=>{if(user&&(dirty()||saving)){e.preventDefault();e.returnValue=''}});
$('login').addEventListener('submit',e=>{e.preventDefault();run(async()=>{const f=e.currentTarget;const b=await api('login',{login:value(f,'login'),password:value(f,'password')});f.reset();showUser(b.user);page=b.user.admin?'admin':b.user.permissions.includes('person.read_directory')?'person.read_directory':'person.read_basic';note('Вход выполнен');await render()})});
run(async()=>{try{const b=await api('session');showUser(b.user);page=b.user.admin?'admin':b.user.permissions.includes('person.read_directory')?'person.read_directory':'person.read_basic';await render()}catch(e){if(e.status!==401)throw e;showLogin()}});
