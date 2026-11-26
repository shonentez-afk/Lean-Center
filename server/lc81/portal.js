// No tokens or domain snapshot in localStorage/IndexedDB. Cookies are HttpOnly.
const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n};
let user=null,page='person.read_basic',busy=false,sequence=0;
const actions={'person.read_basic':'Сотрудники','sop.read_effective':'Действующие СОП','training.read':'Обучение','task.read':'Мои задачи / мероприятия',"org.read":"Структура предприятия","operation.read":"Операции","sop.read_history":"Редакции СОП","sop.read_steps":"Шаги действующих СОП","frv.read":"ФРВ","training.enrollment.read":"Персональные программы","preparation.read":"Комплекты подготовки","credential.read":"Подготовка наставников","appointment.read":"Приказы о назначении","development.read":"Планы развития","audit.read":"Аудиты","supplement.read":"Доплаты","roi.read":"Экономический эффект","calendar.read":"Личный календарь"};
const actionLabels={...actions,'task.implement_own':'Выполнение собственных задач'};
const note=(text,bad=false)=>{$('status').textContent=text;$('status').className=bad?'bad':''};
async function api(url,data){
 const options={cache:'no-store',credentials:'same-origin'};
 if(data!==undefined)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json','X-LC81-Request':'1'},body:JSON.stringify(data)});
 const r=await fetch('/api/lc81/'+url,options),b=await r.json();
 if(!r.ok)throw Object.assign(Error(b.error||'Запрос отклонён'),{status:r.status});return b;
}
function button(text,fn){const n=el('button',text);n.type='button';n.addEventListener('click',()=>run(fn));return n}
async function run(fn){if(busy)return;busy=true;try{await fn()}catch(e){note(e.message||'Ошибка',true);if(e.status===401)showLogin()}finally{busy=false}}
function showLogin(){sequence++;user=null;$('workspace').hidden=true;$('content').replaceChildren();$('identity').replaceChildren();$('login-panel').hidden=false;$('login').reset()}
function showUser(a){user=a;$('login-panel').hidden=true;$('workspace').hidden=false;$('identity').replaceChildren(el('span',a.display_name+' · '+a.login),button('Выйти',async()=>{await api('logout',{});showLogin();note('Выход выполнен')}))}
function panel(title,...children){const n=el('section');n.className='panel';n.append(el('h2',title),...children);return n}
function table(headers,values){const wrap=el('div');wrap.className='table-wrap';const t=el('table'),h=el('thead'),tr=el('tr');for(const v of headers)tr.append(el('th',v));h.append(tr);t.append(h);const b=el('tbody');for(const row of values){const r=el('tr');for(const v of row){const d=el('td');d.append(v instanceof Node?v:el('span',v??'—'));r.append(d)}b.append(r)}t.append(b);wrap.append(t);return wrap}
function input(name,label,type='text',required=true){const n=el('input');n.name=name;n.type=type;n.required=required;if(type==='password')n.autocomplete='new-password';const l=el('label',label);l.append(n);return l}
function select(name,label,items){const s=el('select');s.name=name;s.required=true;for(const [id,title] of items){const o=el('option',title);o.value=id;s.append(o)}const l=el('label',label);l.append(s);return l}
function check(name,label,checked=false){const l=el('label'),n=el('input');n.type='checkbox';n.name=name;n.checked=checked;l.append(n,el('span',label));return l}
const value=(f,k)=>f.elements.namedItem(k).value;
function form(fields,submit,fn){const f=el('form');f.append(...fields,el('button',submit));f.addEventListener('submit',e=>{e.preventDefault();run(async()=>{await fn(f)})});return f}
const options=items=>items.map(x=>[x.id,x.name||x.display_name||x.login||x.id]);
function adminPanel(d){
 const people=new Map(d.people.map(x=>[x.id,x.display_name])),roles=new Map(d.roles.map(x=>[x.id,x.name])),units=new Map(d.units.map(x=>[x.id,x.name])),accounts=new Map(d.accounts.map(x=>[x.id,x.login]));
 const renew=async(text)=>{note(text);await render()};
 const post=async(route,data,msg)=>{await api('admin/'+route,data);await renew(msg)};
 const grid=el('div');grid.className='grid';
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
  f.reset();await renew('Пользователь создан. Назначьте подтверждённый доступ.');
  if(r.issued_password){const n=el('div','Выданный пароль: '+r.issued_password);n.id='issued';n.append(button('Скрыть пароль',()=>n.remove()));$('content').prepend(n)}
 });
 const accountTable=table(['Логин','Сотрудник','Статус','Действие'],d.accounts.map(a=>[a.login,a.display_name,a.state==='active'?'Активен':'Заблокирован',a.admin?'Защищённый администратор':button(a.state==='active'?'Заблокировать':'Разблокировать',()=>post('state',{id:a.id,state:a.state==='active'?'blocked':'active'},'Состояние изменено'))]));
 const policyForms=d.roles.map(r=>{
  const p=d.policies.find(x=>x.role_id===r.id);
  if(d.protectedRoles.includes(r.id))return panel(r.name,el('p','Защищённая системная политика'));
  const checks=el('div');checks.className='checks';for(const a of d.actions)checks.append(check(a,actionLabels[a],p?.permissions.includes(a)));
  return panel(r.name,form([checks],'Сохранить права',f=>post('policy',{role_id:r.id,revision:p?.revision||0,permissions:d.actions.filter(a=>f.elements.namedItem(a).checked)},'Права сохранены; прежние гранты требуют подтверждения')));
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
async function render(){
 const serial=++sequence;
 const fresh=await api('session');if(serial!==sequence)return;user=fresh.user;
 const nav=$('nav');nav.replaceChildren();const sections=[...Object.entries(actions).filter(([id])=>user.permissions.includes(id)),...(user.admin?[['admin','Пользователи и права доступа']]:[])];
 if(!sections.some(([id])=>id===page))page=sections[0]?.[0]||'';
 for(const [id,title] of sections){const b=button(title,async()=>{page=id;await render()});b.setAttribute('aria-current',String(id===page));nav.append(b)}
 if(page==='admin'&&user.admin){const data=await api('admin');if(serial===sequence)$('content').replaceChildren(...adminPanel(data));return}
 if(!page){$('content').replaceChildren(panel('Личное рабочее пространство',el('p','Вам пока не назначены права на рабочие разделы. Обратитесь к администратору.')));return}
 if(!Object.hasOwn(actions,page))throw Error('Раздел недоступен');
 const data=await api('resources?action='+encodeURIComponent(page));if(serial!==sequence)return;
 const items=data.items;const cols=items.length?Object.keys(items[0]).filter(k=>!['steps','can_implement','rev'].includes(k)):[];
 const labels={id:'ID',display_name:'Сотрудник',revision_id:'Редакция',version_no:'Версия',state:'Состояние',document_id:'Документ',code:'Код',title:'Название',operation_id:'Операция',trainee_id:'Обучаемый',sop_revision_id:'Версия СОП',due_on:'Срок'};
 const content=panel(actions[page],items.length?table(cols.map(k=>labels[k]||k),items.map(r=>cols.map(k=>r[k]))):el('p','Нет доступных записей.'));
 if(page==='sop.read_steps')for(const r of items){const details=el('details');details.append(el('summary',r.title+' · v'+r.version_no),table(['Шаг','Действие','Ключевые моменты','Причина','Секунды'],r.steps.map(s=>[s.position,s.action_text,s.key_points.join(' · '),s.reason_text,s.duration_seconds])));content.append(details)}
 if(page==='task.read'&&user.permissions.includes('task.implement_own')&&user.person_id){
  content.append(el('h3','Выполнить своё мероприятие'),el('p','Сервер проверит владельца, полномочия, версию и условия выполнения.'));
  const candidates=items.filter(r=>r.can_implement===true);
  if(candidates.length)content.append(form([select('id','Мероприятие',candidates.map(r=>[r.id,r.title])),input('result','Фактический результат')],'Подтвердить выполнение',async f=>{const r=candidates.find(x=>x.id===value(f,'id'));await api('tasks/implement',{id:r.id,expected_revision:r.rev,result:value(f,'result')});note('Выполнение подтверждено сервером');await render()}));
 }
 $('content').replaceChildren(content);
}
$('login').addEventListener('submit',e=>{e.preventDefault();run(async()=>{const f=e.currentTarget;const b=await api('login',{login:value(f,'login'),password:value(f,'password')});f.reset();showUser(b.user);page=b.user.admin?'admin':'person.read_basic';note('Вход выполнен');await render()})});
run(async()=>{try{const b=await api('session');showUser(b.user);page=b.user.admin?'admin':'person.read_basic';await render()}catch(e){if(e.status!==401)throw e;showLogin()}});
