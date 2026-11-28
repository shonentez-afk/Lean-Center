// Protected workspace: reuse accepted navigation, registry controls, corporate
// CSS and unsaved-form guard. Never load SQL.js or a snapshot in the browser.
import {createTrainingUI} from '/training-ui.js';
import {createCenterUI} from '/center-ui.js';
import {createAssistantUI} from '/assistant-ui.js';
import {createMobileAuditUI} from '/mobile-audit-ui.js';
import {createFinalUI} from '/final-ui.js';
import {createLibraryUI} from '/library-ui.js';
import {createApprovalUI} from '/sop-approval-ui.js';
import {navGroups as baselineNavGroups} from '/shared/navigation.js';
// Keep every authorized destination reachable while taking nonessential
// tools out of the everyday TWI flow. The offline baseline is unchanged.
const optionalPages=new Set(['ai','development','metrics','roi']);
const navGroups=[...baselineNavGroups.map(([title,pages])=>[title,pages.filter(p=>!optionalPages.has(p))]),['Дополнительные инструменты',[...optionalPages]]];
import {registryFields} from '/shared/registry-fields.js';
import {protectWorkForm,hasUnsavedForms} from '/shared/form-guard.js';
import {cloudSaveState} from '/shared/cloud-save-state.js';
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
let libraryUI=null,trainingUI=null,centerUI=null,assistantUI=null,mobileUI=null,finalUI=null;
let user=null,page='person.read_basic',busy=false,sequence=0,saving=false,checking=false,saveFailed=false,networkFailed=false;
let authGeneration=0,statusVersion=0,accessCheck=null,accessRefreshPending=false,provisionManager=false;
let navigationStarted=false,historyReplay=false,navAccount=null,navOpen=new Map();
let noticeCounterFetch=null,noticeCounterAt=0;
const adminPages=Object.freeze({admin:'Начало работы','admin.enterprise':'Предприятие','admin.users':'Пользователи','admin.roles':'Роли и права','admin.access':'Назначения и доступ','admin.storage':'Хранение и журнал','admin.notifications':'Фоновые уведомления'});
const isAdminPage=key=>Object.hasOwn(adminPages,key);
const titleFor=key=>adminPages[key]||actions[key]||'Личное рабочее пространство';
const landingPage=a=>a.admin?'admin':a.workspace_actions?.includes('center.read')?'center.read':a.permissions.includes('person.read_directory')?'person.read_directory':a.workspace_actions?.includes('sop.constructor')?'sop.constructor':'person.read_basic';
const actions={'sop.approvals':'Согласование СОП',...{'person.read_basic':'Сотрудники','sop.read_effective':'Каталог СОП','training.read':'План производственного обучения','task.read':'Мои задачи / мероприятия',"org.read":"Структура предприятия","operation.read":"Операции","sop.read_history":"Редакции и черновики СОП","sop.read_steps":"Шаги действующих СОП","frv.read":"ФРВ","program.read":"Шаблоны программ","training.enrollment.read":"Персональные программы","preparation.read":"Комплекты подготовки","credential.read":"Подготовка наставников","appointment.read":"Приказы о назначении","development.read":"Планы развития","audit.read":"Аудиты","supplement.read":"Доплаты","roi.read":"Экономический эффект","calendar.read":"Календарь","plan.read":"Мой план","center.read":"Дашборд","analytics.read":"Аналитика","metrics.read":"Дерево показателей"},'person.read_directory':'Сотрудники — справочник','equipment.read':'Оборудование','workplace.read':'Рабочие места','sop.constructor':'Конструктор СОП','sop.read_twi':'Планы инструктажа TWI','sop.read_linked_frv':'ФРВ по СОП','matrix.read':'Матрицы компетенций','authorization.read':'Полномочия наставников','order.read':'Групповые приказы','self.read':'Самооценка наставников','bank.read':'Банк вопросов','skill.read':'Каталог навыков','requirement.read':'Требования по профессиям','coverage.read':'Покрытие компетенций','assessment.read':'Оценки компетенций','profession.read':'Профессии','position.read':'Должности','shift.read':'Смены','category.read':'Категории навыков','scale.read':'Шкалы оценивания','role.read':'Роли сотрудников','employment.read':'Кадровые назначения','role_assignment.read':'Назначения ролей','forms.read':'Бланки и методики','sop.evaluation.read':'Оценки СОП','journal.view':'Журнал инструктажей','retraining.view':'Переобучение','import.view':'Импорт XLSX','assistant.read':'ИИ-помощник','instruction.view':'Проведение инструктажей TWI','internship.view':'Программы стажировки','mentoring.view':'Наставники и ВТ','audit.history.read':'Исторический RC1'};
const directoryActions={'person.read_directory':'person','org.read':'org_unit','equipment.read':'equipment','workplace.read':'workplace','operation.read':'operation','profession.read':'profession','position.read':'position','shift.read':'work_shift','category.read':'skill_category','scale.read':'rating_scale','role.read':'business_role'};
const actionLabels={...actions,'sop.approval.safety':'СОП: согласование ОТ','sop.approval.engineering':'СОП: техническое согласование','sop.approval.twi':'СОП: методическое согласование ВТ','sop.approval.director':'СОП: утверждение директором','sop.approval.publish':'СОП: ввод в действие','sop.approval.withdraw':'СОП: вывод из действия','task.implement_own':'Выполнение собственных задач','sop.read_photo':'Просмотр фотографий СОП','sop.create':'Создание СОП','sop.edit_draft':'Редактирование черновика СОП','sop.revise':'Создание редакции СОП','sop.passport':'Паспорт СОП','sop.from_frv':'Создание СОП из ФРВ','frv.create':'Создание ФРВ','frv.edit_draft':'Редактирование ФРВ','frv.finalize':'Завершение ФРВ','frv.read_summary':'Результаты фактических замеров ФРВ','training.create':'Назначение обучения','training.approve_responsible':'Подтверждение плана ответственным','training.approve_head':'Подтверждение плана руководителем','training.reschedule':'Изменение срока обучения','training.cancel':'Отмена назначения','training.stage':'Факт инструктажа','training.verify':'Проверка знаний','training.practical':'Практическая оценка','training.qualify':'Подтверждение квалификации','training.admit':'Решение о допуске','training.detail':'Карточка обучения','training.read_sop':'СОП назначенного обучения','matrix.create':'Конструктор матриц','matrix.retire':'Закрытие матриц','matrix.detail':'Детальная матрица','person.read_card':'Карточка сотрудника','credential.register':'Регистрация документов подготовки','credential.revoke':'Отзыв документов подготовки','appointment.register':'Регистрация приказов','appointment.revoke':'Отзыв назначений','authorization.register':'Выдача права обучать','authorization.revoke':'Отзыв права обучать','program.create':'Конструктор программ и новые версии','program.retire':'Закрытие шаблонов','program.detail':'Карточка шаблона','training.enrollment.create':'Назначение персональной программы','training.enrollment.result':'Регистрация результата задания','training.enrollment.finish':'Завершение программы','training.enrollment.cancel':'Отмена программы','training.enrollment.detail':'Карточка персональной программы','preparation.create':'Формирование комплекта подготовки','preparation.detail':'Карточка комплекта подготовки','preparation.shift':'Фактическая смена стажировки','preparation.safety':'Протокол обучения безопасным методам','preparation.internship':'Итог стажировки','preparation.questions':'Выдача вопросов','preparation.commission':'Регистрация решения комиссии','order.register':'Регистрация группового приказа','order.detail':'Карточка группового приказа','supplement.create':'Создание ходатайства','supplement.revise':'Уточнение ходатайства','supplement.decide':'Решение по ходатайству','supplement.detail':'Карточка ходатайства','development.create':'Создание планов развития','development.goal.create':'Постановка целей','development.goal.close':'Завершение целей','development.close':'Закрытие планов','development.from_matrix':'Цели из матрицы','development.detail':'Карточка плана развития','audit.create':'Регистрация аудита L1','audit.void':'Аннулирование аудита','audit.detail':'Результаты аудита','self.create':'Собственная самооценка','self.detail':'Результаты самооценки','task.create':'Создание мероприятий','task.start':'Начало выполнения своего мероприятия','task.link':'Связь с повторным обучением или развитием','task.cancel':'Отмена мероприятия','task.verify':'Независимая проверка эффекта','task.detail':'Карточка мероприятия','bank.save':'Версии банка вопросов','bank.detail':'Вопросы и история версий','mentor.method.install':'Первичная установка утверждённой методики','skill.category.create':'Создание категорий навыков','skill.create':'Создание общих навыков','skill.from_sop':'Создание навыков из действующего СОП','requirement.create':'Требования к профессии','requirement.close':'Закрытие требования','coverage.save':'Планирование покрытия','assessment.general':'Регистрация оценки общего навыка','assessment.detail':'Подробности оценки компетенции','calendar.detail':'Карточка планового события','calendar.plan':'Планирование аудитов и оценок','calendar.cancel':'Отмена плана','calendar.complete':'Завершение своего плана по факту','calendar.replan':'Перепланирование после аннулирования','roi.detail':'Финансовые данные и источники эффекта','roi.create':'Создание карточек эффекта','roi.plan':'Плановые расчёты','roi.reschedule':'Сроки контроля эффекта','roi.cancel':'Отмена карточки эффекта','roi.measure':'Независимая проверка расчёта','roi.fact.create':'Регистрация денежного факта','roi.fact.save':'Уточнение своего черновика','roi.fact.confirm':'Независимое подтверждение денег','roi.fact.void':'Аннулирование денежного факта','roi.target':'Денежные цели','roi.target.cancel':'Отмена цели','roi.target.review':'Разбор отклонения цели','roi.twi_basis':'Сопоставимые основания TWI','profession.create':'Создание профессии','profession.update':'Изменение названия профессии','position.create':'Создание должности','position.update':'Изменение названия должности','shift.create':'Создание смены','shift.update':'Изменение названия смены','scale.create':'Создание новой версии шкалы','employment.detail':'Детали кадрового назначения','employment.transfer':'Кадровое перемещение','forms.read':'Редактируемые бланки TWI 03','forms.export':'Выгрузка разрешённых записей','sop.evaluation.read':'Чтение оценок СОП','sop.evaluation.create':'Регистрация оценки СОП','sop.method.install':'Установка методики оценки СОП','audit.mobile.export':'Выгрузка своего автономного аудита RC1','audit.mobile.import':'Приём своего мобильного аудита RC1','assistant.read':'Локальный и контекстный помощник','assistant.cloud':'Разрешение отправки общих тем во внешний ИИ','audit.history.read':'Архив RC1 всего предприятия','audit.history.import':'Импорт неизменяемой истории RC1'};
for(const [action,type] of Object.entries(directoryActions)){
 const prefix=action==='person.read_directory'?'person':action.split('.')[0];
 for(const [op,label] of [['create','Создание'],['update','Изменение'],['archive','Архивирование']])actionLabels[prefix+'.'+op]=label+': '+actions[action];
}
const pageActions={person:['person.read_directory','person.read_basic'],home:['center.read'],ai:['assistant.read'],my_plan:['plan.read'],calendar:['calendar.read'],actions:['task.read'],sop:['sop.read_effective','sop.read_steps','sop.read_history','sop.approvals'],sop_constructor:['sop.constructor'],frv:['frv.read','sop.read_linked_frv'],twi_plans:['sop.read_twi'],twi:['training.read'],instruction:['instruction.view'],internship:['internship.view'],mentoring:['mentoring.view'],journal:['journal.view'],retraining:['retraining.view'],sop_evaluation:['sop.evaluation.read'],skills:['matrix.read','requirement.read','coverage.read'],practical:['assessment.read'],skill:['skill.read'],programs:['program.read','training.enrollment.read'],preparation:['preparation.read'],knowledge_bank:['bank.read'],development:['development.read'],certification:['credential.read'],appointments:['appointment.read','order.read','authorization.read'],audit:['audit.read','audit.history.read'],self_eval:['self.read'],supplements:['supplement.read'],analytics:['analytics.read'],metrics:['metrics.read'],roi:['roi.read'],org_unit:['org.read'],workplace:['workplace.read'],operation:['operation.read'],equipment:['equipment.read'],profession:['profession.read'],position:['position.read'],work_shift:['shift.read'],skill_category:['category.read'],rating_scale:['scale.read'],business_role:['role.read'],person_assignment:['employment.read'],role_assignment:['role_assignment.read'],forms:['forms.read'],import_xlsx:['import.view'],storage:['admin']};
const dirty=()=>hasUnsavedForms($('content'))||libraryUI?.active()===true;
const discard=()=>{if(libraryUI?.active()&&!libraryUI.close())return false;return !hasUnsavedForms($('content'))||confirm('Есть несохранённые изменения. Продолжить без сохранения?')};
function refreshIndicator(){
 if(!user)return;
 const value=cloudSaveState({dirty:dirty(),saving,checking,offline:navigator.onLine===false||networkFailed,saveFailed});
 const n=$('save-indicator'),locked=busy||checking||document.documentElement.classList.contains('lc81-access-check');
 n.dataset.kind=value.kind;
 n.textContent=value.kind==='offline'?'Нет связи · изменения не отправлены':value.text;
 if(locked&&value.kind==='saved')n.textContent='Операция выполняется…';
 n.title=locked?'Дождитесь окончания операции или проверки доступа; переходы временно недоступны.':'';
 const nav=$('nav');nav.setAttribute('aria-busy',String(locked));
 for(const b of nav.querySelectorAll('button[data-action]')){b.disabled=locked;b.title=locked?'Переход после завершения текущей операции':''}
 const pending=$('lc81-nav-wait');if(pending)pending.hidden=!locked;
}
const note=(text,bad=false)=>{statusVersion++;const s=$('status');s.hidden=!text;s.textContent=text;s.className='status'+(bad?' error':'');refreshIndicator()};
async function api(url,data,signal){
 const generation=authGeneration;
 const options={cache:'no-store',credentials:'same-origin',...(signal?{signal}:{})},write=data!==undefined&&!['login','logout','library/open','tasks/options','matrix/suggest','matrix/overview','roi/twi-preview','import/inspect','import/preview','mobile-audit/preview','mobile-audit/receipt','assistant/context','assistant/preview','assistant/cloud','editor/ai','history/preview','analytics/report'].includes(url);
 if(data!==undefined)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json','X-LC81-Request':'1'},body:JSON.stringify(data)});
 if(write){saving=true;saveFailed=false;refreshIndicator()}
 try{
  const r=await fetch('/api/lc81/'+url,options),b=await r.json();
  if(generation!==authGeneration)throw new DOMException('Контекст доступа изменился','AbortError');
  networkFailed=false;if(!r.ok)throw Object.assign(Error(b.error||'Запрос отклонён'),{status:r.status,write,retryAfter:r.headers.get('Retry-After')});
  return b;
 }catch(e){if(generation===authGeneration&&e.name!=='AbortError'){if(!e.status)networkFailed=true;if(write)saveFailed=true}throw e}finally{if(generation===authGeneration&&write)saving=false;refreshIndicator()}
}
function button(text,fn,cls=''){const n=el('button',text,cls);n.type='button';n.addEventListener('click',()=>run(fn));return n}
async function run(fn){
 if(busy||user&&document.documentElement.classList.contains('lc81-access-check'))return;
 busy=true;refreshIndicator();
 try{await fn()}catch(e){
  if(e.name!=='AbortError'){
   if(e.status===401)showLogin();
   const retry=e.write&&e.status===429;
   note(retry?'Не сохранено: '+e.message+'. '+(e.retryAfter?'Повторите вручную не ранее чем через '+e.retryAfter+' сек. ':'Повторите вручную после освобождения сервера. ')+'Введённые поля не сбрасываются. Автоматического повтора записи нет.':e.message||'Ошибка',true);
  }
 }finally{busy=false;refreshIndicator();if(accessRefreshPending&&user)void checkAccess(true)}
}
function closeProtectedViews(){if($('lc82-bell')){$('lc82-bell').textContent='🔔 Уведомления';$('lc82-bell').setAttribute('aria-label','Уведомления');noticeCounterAt=0}for(const d of document.querySelectorAll('dialog.lc81-password-dialog,dialog.lc72-context-dialog,dialog.lc82-notification-dialog')){if(d.open)d.close();else d.remove()}libraryUI?.clear();$('content').replaceChildren();$('issued').hidden=true;$('issued').replaceChildren()}
function showLogin(){authGeneration++;sequence++;user=null;navigationStarted=false;historyReplay=false;navAccount=null;navOpen.clear();centerUI?.resetReports();history.replaceState(null,'');accessRefreshPending=false;maskAccess(false);closeProtectedViews();saving=false;checking=false;saveFailed=false;$('shell').classList.add('lc81-logged-out');$('workspace').hidden=true;$('nav').hidden=true;$('nav').replaceChildren();$('menu').hidden=true;$('save-indicator').hidden=true;$('content').replaceChildren();$('issued').hidden=true;$('issued').replaceChildren();$('identity').replaceChildren();$('login-panel').hidden=false;$('login').reset()}
function showUser(a){user=a;maskAccess(false);$('shell').classList.remove('lc81-logged-out');$('login-panel').hidden=true;$('workspace').hidden=false;$('nav').hidden=false;$('menu').hidden=false;$('save-indicator').hidden=false;$('identity').replaceChildren(el('span',a.display_name+' · '+a.login,'lc81-login-name'),button('Изменить пароль',ownPasswordDialog),button('Выйти',async()=>{if(!discard()||!$('issued').hidden&&!confirm('Выданный пароль ещё открыт. Завершить сеанс?'))return;await api('logout',{});showLogin();note('Выход выполнен')}));if(a.notifications_enabled){const bell=button('🔔 Уведомления',openNotifications,'lc82-bell');bell.id='lc82-bell';bell.setAttribute('aria-label','Уведомления');$('identity').prepend(bell);noticeCounterAt=0;void refreshNoticeCounter(true)}refreshIndicator()}
function panel(title,...children){const n=el('section',undefined,'panel');n.append(el('h2',title),...children);return n}
function table(headers,values){const wrap=el('div',undefined,'tablewrap lc81-rows');const t=el('table'),h=el('thead'),tr=el('tr');for(const v of headers)tr.append(el('th',v));h.append(tr);t.append(h);const b=el('tbody');for(const row of values){const r=el('tr');for(const v of row){const d=el('td');d.append(v instanceof Node?v:el('span',v??'—'));r.append(d)}b.append(r)}t.append(b);wrap.append(t);return wrap}
function input(name,label,type='text',required=true){const n=el('input');n.name=name;n.type=type;n.required=required;if(type==='password')n.autocomplete='new-password';const l=el('label',label,'field');l.append(n);return l}
function select(name,label,items){const s=el('select');s.name=name;s.required=true;for(const [id,title] of items){const o=el('option',title);o.value=id;s.append(o)}const l=el('label',label,'field');l.append(s);return l}
function check(name,label,checked=false){const l=el('label'),n=el('input');n.type='checkbox';n.name=name;n.checked=checked;l.append(n,el('span',label));return l}
const value=(f,k)=>f.elements.namedItem(k).value;
function form(fields,submit,fn){const f=el('form',undefined,'lc81-form');f.append(...fields,el('button',submit,'primary'));f.addEventListener('submit',e=>{e.preventDefault();run(async()=>{if([...$('content').querySelectorAll('[data-lc-work-form]')].some(x=>x!==f&&x.lcIsDirty?.())&&!confirm('В другой форме есть изменения. Продолжить без их сохранения?'))return;await fn(f)})});return protectWorkForm(f)}
const options=items=>items.map(x=>[x.id,x.name||x.display_name||x.login||x.id]);
// Header count is an independent, read-only request; its failure must not
// change the save indicator or interfere with a domain mutation.
function setNoticeCount(n){
 const b=$('lc82-bell');if(!b)return;
 const count=Number.isSafeInteger(n)&&n>=0?n:null;
 b.textContent='🔔 Уведомления'+(count?' · '+(count>99?'99+':count):count===null?' · ?':'');
 b.setAttribute('aria-label',count===null?'Уведомления, счётчик недоступен':'Уведомления, '+count+' непрочитанных');
}
async function refreshNoticeCounter(force=false){
 if(!user?.notifications_enabled||!$('lc82-bell')||document.visibilityState==='hidden'||noticeCounterFetch||!force&&Date.now()-noticeCounterAt<10000)return;
 const generation=authGeneration,account=user.id;
 noticeCounterAt=Date.now();
 const task=(async()=>{try{
  const r=await fetch('/api/lc81/notifications?limit=1',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(8000)});
  const d=await r.json();if(generation===authGeneration&&user?.id===account)setNoticeCount(r.ok?d.unread:null);
 }catch{if(generation===authGeneration&&user?.id===account)setNoticeCount(null)}})();
 noticeCounterFetch=task;
 try{await task}finally{if(noticeCounterFetch===task)noticeCounterFetch=null}
}
async function openNotifications(){
 if(!user?.notifications_enabled)return;
 const trigger=$('lc82-bell'),d=el('dialog',undefined,'lc82-notification-dialog'),head=el('div',undefined,'lc82-notice-head'),body=el('div',undefined,'lc82-notice-list'),tools=el('div',undefined,'row');
 d.setAttribute('aria-label','Личные уведомления');
 const close=button('Закрыть',()=>d.close()),summary=el('p','Загрузка…','muted');
 head.append(el('h2','Уведомления'),close);
 const tabs=el('div',undefined,'row');let filter='all',snapshot=null,next=null;
 const allRead=button('Отметить все прочитанными',async()=>{await api('notifications/read-all',{snapshot});await load()});
 const reload=button('Обновить',()=>load());
 const tabButtons=[['actions','Требуют действия'],['unread','Непрочитанные'],['all','Все']].map(([key,title])=>{
  const b=button(title,async()=>{filter=key;await load()});tabs.append(b);return [key,b];
 });
 const prefs=button('Настройки уведомлений',async()=>{
  const v=await api('notifications/preferences');if(!d.isConnected)return;
  const labels={approval:'Согласование СОП',familiarization:'Ознакомление',training:'Обучение TWI',audit:'Аудиты и оценки',task:'Мероприятия',information:'Информационные события'};
  const rkeys=['approval','familiarization','training'],pkeys=[...rkeys,'audit','task','information'];
  const reminders=el('fieldset');reminders.append(el('legend','Дополнительные напоминания внутри портала'),...rkeys.map(k=>check('reminder_'+k,labels[k]+(v.policy[k]===null?' · выключено предприятием':' · за '+v.policy[k]+' дн.'),v.reminders[k])));
  const push=el('fieldset');push.append(el('legend','Предпочтения будущего Web Push'),el('p','Внешняя отправка пока не подключена. Эти настройки не включают браузерную подписку.'),...pkeys.map(k=>check('push_'+k,labels[k],v.push_types[k])));
  const window=el('fieldset'),start=input('window_start','Начало','time',false),end=input('window_end','Окончание','time',false);
  start.querySelector('input').required=false;end.querySelector('input').required=false;
  start.querySelector('input').value=v.delivery_window?.start??'';end.querySelector('input').value=v.delivery_window?.end??'';
  window.append(el('legend','Разрешённое окно будущей доставки'),check('window_enabled','Ограничить доставку временем и днями',!!v.delivery_window),start,end,el('p','Часовой пояс предприятия: '+v.zone+'. Если окончание раньше начала, окно продолжается после полуночи. Дни относятся к началу окна. Реальный график вводится вручную.'),...[ 'Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((l,i)=>check('day_'+(i+1),l,v.delivery_window?.days.includes(i+1)??false)));
  const f=form([el('p','Обязательные события и рабочие поручения остаются доступны. Можно отключить дополнительные напоминания, не закрывая задания.'),reminders,push,window],'Сохранить настройки',async f=>{
   const checked=k=>f.elements.namedItem(k).checked;
   const delivery_window=checked('window_enabled')?{days:[1,2,3,4,5,6,7].filter(n=>checked('day_'+n)),start:value(f,'window_start'),end:value(f,'window_end')}:null;
   await api('notifications/preferences',{expected_revision:v.rev,reminders:Object.fromEntries(rkeys.map(k=>[k,checked('reminder_'+k)])),push_types:Object.fromEntries(pkeys.map(k=>[k,checked('push_'+k)])),delivery_window});
   f.lcResetForm?.();summary.textContent='Настройки сохранены';await load();
  });
  const enable=f.elements.namedItem('window_enabled'),update=()=>{for(const n of [f.elements.namedItem('window_start'),f.elements.namedItem('window_end'),...[1,2,3,4,5,6,7].map(i=>f.elements.namedItem('day_'+i))])n.disabled=!enable.checked;f.elements.namedItem('window_start').required=enable.checked;f.elements.namedItem('window_end').required=enable.checked};
  enable.addEventListener('change',update);update();f.lcResetForm?.();
  body.replaceChildren(el('h3','Настройки уведомлений'),f);summary.textContent='Настройки пользователя';allRead.disabled=true;
 });
 tools.append(reload,allRead,prefs);d.append(head,summary,tabs,tools,body);document.body.append(d);
 d.addEventListener('close',()=>{d.remove();if(trigger?.isConnected)trigger.focus({preventScroll:true})},{once:true});
 d.showModal();
 async function load(cursor=null){
  if(!d.isConnected)return;
  body.replaceChildren(el('p','Загрузка…','muted'));allRead.disabled=true;
  for(const [key,b] of tabButtons){b.setAttribute('aria-pressed',String(key===filter));b.classList.toggle('primary',key===filter)}
  try{
   const q=new URLSearchParams({filter,limit:'30',...(cursor?{cursor}:{})}),v=await api('notifications?'+q);
   if(!d.isConnected)return;
   snapshot=v.snapshot;next=v.next_cursor;setNoticeCount(v.unread);
   summary.textContent='Непрочитанных: '+v.unread+' · требуют действия: '+v.action_count+' · записей в выборке: '+v.total;
   allRead.disabled=!snapshot||v.unread===0;body.replaceChildren();
   if(!v.items.length)body.append(el('p','Нет доступных уведомлений в этой выборке.','empty'));
   for(const n of v.items){
    const c=el('article',undefined,'lc82-notice-card'),h=el('h3',n.label),row=el('div',undefined,'row');
    c.dataset.noticeId=n.id;c.classList.toggle('lc82-unread',!n.read_at);
    c.append(h,el('p',n.title),el('p',n.reason,'muted'),el('p',(n.overdue?'Просрочено · ':'')+n.state+(n.due_on?' · срок '+n.due_on:''),'lc83-state'),el('p',n.occurred_at.replace('T',' ').slice(0,19)+' UTC · '+(n.read_at?'Прочитано':'Не прочитано'),'muted'));
    row.append(button(({sop_approval:'Открыть согласование',familiarization:'Открыть ознакомление',training:'Открыть обучение'})[n.route.type]||'Открыть поручение',async()=>{
     const r=await api('notifications/read',{id:n.id});d.close();void refreshNoticeCounter(true);
     // The returned server route is reauthorized again by its own endpoint.
     await openLinked($('content'),r.route);
    },'primary'));
    if(!n.read_at)row.append(button('Отметить прочитанным',async()=>{await api('notifications/read',{id:n.id});await load()}));
    c.append(row);body.append(c);
   }
   if(cursor)body.append(button('К началу',()=>load()));
   if(next)body.append(button('Следующая страница',()=>load(next)));
  }catch(e){
   if(e.status===401){showLogin();return}
   if(e.name==='AbortError'||!d.isConnected)return;
   body.replaceChildren(el('p',e.status===409?'Лента изменилась. Обновите список.':'Не удалось получить уведомления. Проверьте связь.','status error'),button('Повторить',()=>load()));setNoticeCount(null);
  }
 }
 await load();
}
function ownPasswordDialog(){
 if(!discard())return;
 if(!$('issued').hidden)throw Error('Сначала сохраните и закройте выданный пароль');
 const d=el('dialog',undefined,'lc72-context-dialog lc81-password-dialog'),head=el('div',undefined,'lc72-context-head'),body=el('div',undefined,'lc72-context-body'),trigger=document.activeElement;
 d.setAttribute('aria-label','Изменение пароля');
 const close=button('Отмена',()=>d.close());
 head.append(el('h2','Изменение пароля'),close);
 const old=input('current_password','Текущий пароль','password');old.querySelector('input').autocomplete='current-password';
 const f=form([old,input('new_password','Новый пароль (12–128 байт)','password'),input('new_password_confirm','Повторите новый пароль','password')],'Сменить пароль',async f=>{
  if(value(f,'new_password')!==value(f,'new_password_confirm'))throw Error('Пароли не совпадают');
  await api('password/change',{current_password:value(f,'current_password'),new_password:value(f,'new_password')});
  f.reset();f.lcResetForm?.();d.close();showLogin();note('Пароль изменён. Все прежние сеансы завершены. Войдите с новым паролем.');
 });
 body.append(el('p','После изменения пароля потребуется повторный вход на всех устройствах.'),f);d.append(head,body);document.body.append(d);
 d.addEventListener('close',()=>{f.reset();d.remove();if(trigger?.isConnected)trigger.focus()},{once:true});d.showModal();
}
function displayIssued(r){
 if(!r.issued_password)return;
 const n=$('issued');n.hidden=false;n.replaceChildren(el('p','Выданный пароль для '+r.login+': '+r.issued_password),button('Пароль записан · скрыть',()=>{n.replaceChildren();n.hidden=true}));
}
const grantLabels={effective:'Действует',revoked:'Отозван',future:'Ещё не действует',expired:'Истёк срок',blocked:'Аккаунт заблокирован',role_ended:'Роль не действует',policy_changed:'Политика изменена · требуется подтверждение',employment_changed:'Кадровое назначение изменилось',scope_changed:'Область недоступна'};
function notificationAdminPanel(v){
 const labels={approval:'Согласование СОП',familiarization:'Ознакомление с СОП',training:'Обучение TWI'},fields=Object.keys(labels).map(k=>{
  const l=select(k,labels[k],[['off','Отключено'],...Array.from({length:31},(_,i)=>[String(i),i===0?'В день срока':('За '+i+' дн.')])]);l.querySelector('select').value=v.policy[k]===null?'off':String(v.policy[k]);return l;
 });
 const settings=form(fields,'Сохранить политику напоминаний',async f=>{
  const p={expected_revision:v.policy.rev,...Object.fromEntries(Object.keys(labels).map(k=>[k,value(f,k)==='off'?null:Number(value(f,k))]))};
  await api('admin/notification-policy',p);f.lcResetForm?.();note('Политика напоминаний сохранена');await render();
 });
 settings.lcResetForm?.();
 const state={pending:'В очереди',retry:'Повторная попытка',completed:'Выполнено',cancelled:'Отменено как неактуальное',failed:'Ошибка'};
 return panel('Фоновые уведомления',el('p',v.enabled&&!v.worker_disabled?'Внутренний обработчик разрешён':'Обработчик выключен настройкой размещения'),el('p','Часовой пояс: '+v.zone+(v.clock_configured?' · закреплён':' · не настроен')+' · лимит пакета: '+v.batch_limit),table(['Состояние задания','Количество'],Object.keys(state).map(k=>[state[k],v.counts[k]])),el('p','Готовы к обработке: '+v.ready+' · незавершённых ознакомлений без активного аккаунта: '+v.missing_accounts),el('p','Последнее завершение: '+(v.last_finished||'ещё нет')+' · внешняя отправка отключена.'),el('p','Последний проход текущего процесса: '+(v.last_scan?({running:'выполняется',ok:'завершён',deferred:'отложен из-за занятости хранилища',error:'ошибка'}[v.last_scan.state]||'—')+' · '+(v.last_scan.finished_at||v.last_scan.started_at):'ещё нет (сбрасывается при перезапуске)'),'muted'),button('Обновить состояние',()=>render()),el('h3','Политика напоминаний предприятия'),el('p','Сроки СОП, ознакомления и обучения берутся из действующих записей. Пока категория отключена, дополнительных напоминаний нет. Существующие обязательные уведомления продолжают работать.'),settings);
}
function adminPanel(d){
 const people=new Map(d.people.map(x=>[x.id,x.display_name])),roles=new Map(d.roles.map(x=>[x.id,x.name])),units=new Map(d.units.map(x=>[x.id,x.name])),accounts=new Map(d.accounts.map(x=>[x.id,x.login]));
 const renew=async(text)=>{note(text);await render()};
 const post=async(route,data,msg)=>{await api('admin/'+route,data);await renew(msg)};
 const grid=el('div');grid.className='lc81-grid';
 const addRef=(title,type,fields,make)=>panel(title,form(fields,'Добавить',f=>post('reference',{type,payload:make(f)},'Запись сохранена')));
 grid.append(
  addRef('Сотрудник','person',[input('employee_code','Табельный номер'),input('display_name','ФИО / имя')],f=>({employee_code:value(f,'employee_code'),display_name:value(f,'display_name')})),
  addRef('Подразделение','org_unit',[input('code','Код'),input('name','Название'),select('parent_id','В составе',options(d.units)),select('kind','Тип',[['Цех','Цех'],['Участок','Участок'],['Служба','Служба'],['Группа','Группа']])],f=>({code:value(f,'code'),name:value(f,'name'),kind:value(f,'kind'),parent_id:value(f,'parent_id')})),
  addRef('Назначение сотрудника','person_assignment',[select('person_id','Сотрудник',options(d.people)),select('unit_id','Подразделение',options(d.units)),input('valid_from','С','date')],f=>({person_id:value(f,'person_id'),unit_id:value(f,'unit_id'),profession_id:null,position_id:null,shift_id:null,shift_code:null,valid_from:value(f,'valid_from'),valid_to:null})),
  addRef('Создать роль сотрудников','business_role',[input('code','Код'),input('name','Название')],f=>({code:value(f,'code'),name:value(f,'name')})),
  addRef('Назначение роли','role_assignment',[select('person_id','Сотрудник',options(d.people)),select('role_id','Роль',options(d.roles.filter(r=>r.id!==d.protectedRoles[0]))),input('valid_from','С','date')],f=>({person_id:value(f,'person_id'),role_id:value(f,'role_id'),valid_from:value(f,'valid_from'),valid_to:null}))
 );
 const employed=id=>d.employment.filter(x=>x.person_id===id&&x.valid_from<=d.clock.day&&(!x.valid_to||x.valid_to>=d.clock.day)).length===1;
 const eligible=d.people.filter(p=>employed(p.id)&&!d.accounts.some(a=>a.person_id===p.id));
 const picker=select('person_id','Сотрудник',[['new','Создать нового сотрудника'],...options(eligible)]);
 const personFields=el('div',undefined,'lc81-form'),unit=select('unit_id','Подразделение',options(d.units));
 unit.querySelector('select').value=d.site;
 personFields.append(input('employee_code','Табельный номер'),input('display_name','ФИО сотрудника'),unit);
 const presetList=d.rolePresets||[],readyPresets=presetList.filter(p=>p.role_id&&['ready','custom'].includes(p.status));
 const mode=select('access_mode','Доступ при создании',[['employee','Базовый доступ — общая библиотека и свои СОП/ФРВ'],['manager','Управляющий центром TWI — всё предприятие'],...readyPresets.map(p=>[p.role_id,p.name])]);
 const accessUnit=select('access_unit','Область рабочей роли',[['','— Выберите подразделение —'],...options(d.units)]);
 const ownAlso=check('own_also','Дополнительно собственные записи',true);
 const accessDetails=el('div',undefined,'lc81-form');accessDetails.append(accessUnit,ownAlso);
 mode.querySelector('select').value=provisionManager?'manager':'employee';
 const passwordFields=el('div',undefined,'lc81-form'),generateField=check('generate','Сгенерировать надёжный пароль',true);
 passwordFields.append(input('password','Пароль (12–128 байт)','password',false),input('password_confirm','Повторите пароль','password',false));
 const explanation=el('p','','muted');
 const userForm=form([picker,personFields,input('login','Рабочая почта или логин'),mode,explanation,accessDetails,generateField,passwordFields,check('confirmed','Подтверждаю создание пользователя и выбранный доступ')],'Создать пользователя',async f=>{
  if(!f.elements.confirmed.checked)throw Error('Подтвердите создание пользователя и выбранный доступ');
  const generate=f.elements.generate.checked,password=value(f,'password');
  if(!generate&&password!==value(f,'password_confirm'))throw Error('Пароли не совпадают');
  if(!$('issued').hidden)throw Error('Сначала сохраните и закройте ранее выданный пароль');
  const id=value(f,'person_id'),manager=value(f,'access_mode')==='manager',preset=readyPresets.find(p=>p.role_id===value(f,'access_mode'));
  const scopes=preset?[preset.scope==='unit_tree'?{kind:'unit_tree',unit_id:value(f,'access_unit')}:{kind:preset.scope},...(preset.scope==='assigned'&&f.elements.own_also.checked?[{kind:'self'}]:[])]:null;
  const r=await api('admin/provision',{person_id:id==='new'?null:id,new_person:id==='new'?{employee_code:value(f,'employee_code'),display_name:value(f,'display_name'),unit_id:value(f,'unit_id')}:null,login:value(f,'login'),password:generate?null:password,generate,manager,...(preset?{access:{role_id:preset.role_id,scopes}}:{})});
  f.reset();f.lcResetForm?.();provisionManager=false;displayIssued(r);
  await renew(manager?'Управляющий создан. Доступ ко всему предприятию подтверждён.':preset?'Пользователь создан. Назначен профиль '+preset.name+'.':'Пользователь создан. Базовый доступ к СОП и ФРВ уже действует.');
 });
 const syncUserForm=()=>{
  const show=userForm.elements.person_id.value==='new',manual=!userForm.elements.generate.checked;
  personFields.hidden=!show;for(const n of personFields.querySelectorAll('input,select'))n.disabled=!show;
  passwordFields.hidden=!manual;for(const n of passwordFields.querySelectorAll('input')){n.disabled=!manual;n.required=manual}
  const preset=readyPresets.find(p=>p.role_id===userForm.elements.access_mode.value);
  accessDetails.hidden=!preset;accessUnit.hidden=preset?.scope!=='unit_tree';userForm.elements.access_unit.disabled=preset?.scope!=='unit_tree';ownAlso.hidden=preset?.scope!=='assigned';userForm.elements.own_also.disabled=preset?.scope!=='assigned';
  if(preset?.scope==='unit_tree'&&!userForm.elements.access_unit.value){
   const id=userForm.elements.person_id.value,emp=d.employment.find(x=>x.person_id===id&&x.valid_from<=d.clock.day&&(!x.valid_to||x.valid_to>=d.clock.day));
   userForm.elements.access_unit.value=id==='new'?userForm.elements.unit_id.value:emp?.unit_id||'';
  }
  if(preset){explanation.textContent=preset.description+' · '+(preset.scope==='self'?'Свои записи':preset.scope==='assigned'?'Назначенные записи':'Выбранное подразделение и его дочерние')+(preset.status==='custom'?' · Права этой роли изменены администратором.':'');return}
  explanation.textContent=userForm.elements.access_mode.value==='manager'?'Будут связаны сотрудник, учётная запись, роль управляющего и действующий доступ ко всему предприятию. Административные права не выдаются.':'Сотрудник сможет работать со своими черновиками и общей библиотекой. Дополнительные рабочие права можно назначить позже.';
 };
 for(const key of ['person_id','access_mode','generate','unit_id'])userForm.elements[key].addEventListener('change',()=>{if(key!=='generate')userForm.elements.access_unit.value='';syncUserForm()});syncUserForm();userForm.lcResetForm?.();
 const accountEditor=el('div'),accountTable=table(['Логин','Сотрудник','Состояние','Действующий доступ','Действия'],d.accounts.map(a=>{
  const controls=el('div',undefined,'row');
  if(a.admin)controls.append(el('span','Защищённый администратор. Пароль меняется в личном меню.'));
  else{
   controls.append(button(a.state==='active'?'Заблокировать':'Разблокировать',async()=>{
    if(!discard()||!confirm(a.state==='active'?'Заблокировать вход и завершить все сеансы пользователя?':'Разрешить вход? Доступны только действующие ранее подтверждённые полномочия.'))return;
    await post('state',{id:a.id,state:a.state==='active'?'blocked':'active',expected_revision:a.credential_revision},'Состояние изменено; старые сеансы не возобновляются');
   }),button('Сбросить пароль',()=>{
    if(!discard())return;if(!$('issued').hidden)throw Error('Сначала сохраните и закройте выданный пароль');
    const f=form([input('password','Новый пароль','password',false),input('password_confirm','Повторите пароль','password',false),check('generate','Сгенерировать пароль на сервере')],'Подтвердить сброс',async f=>{
     const generate=f.elements.generate.checked,password=value(f,'password');
     if(!generate&&password!==value(f,'password_confirm'))throw Error('Пароли не совпадают');
     if(!$('issued').hidden)throw Error('Сначала сохраните и закройте выданный пароль');
     if(!confirm('Сбросить пароль? Все сеансы этого аккаунта завершатся; блокировка и роли не меняются.'))return;
     const r=await api('admin/password-reset',{id:a.id,expected_revision:a.credential_revision,password:generate?null:password,generate});
     f.reset();f.lcResetForm?.();displayIssued(r);await renew('Пароль сброшен; старые сеансы завершены');
    });
    accountEditor.replaceChildren(panel('Сброс пароля · '+a.login,f));accountEditor.scrollIntoView({block:'nearest'});
   }),button('Изменить логин',()=>{
    if(!discard())return;
    const login=input('login','Новый логин или рабочая почта');login.querySelector('input').value=a.login;
    accountEditor.replaceChildren(panel('Изменение логина · '+a.login,form([login],'Сохранить новый логин',async f=>{
     if(!confirm('Изменить логин и завершить все текущие сеансы?'))return;
     await post('login-change',{id:a.id,expected_revision:a.credential_revision,login:value(f,'login')},'Логин изменён; требуется повторный вход');
    })));accountEditor.scrollIntoView({block:'nearest'});
   }));
  }
  const effective=d.grants.filter(g=>g.account_id===a.id&&g.status==='effective').map(g=>roles.get(g.role_id));
  const access=a.admin?'Системный администратор':a.state==='blocked'||!a.employment_active?'Нет доступа':effective.length?[...new Set(effective)].join(', '):'Базовый доступ сотрудника';
  return [a.login,a.display_name,a.state==='blocked'?'Заблокирован':!a.employment_active?'Нет действующего кадрового назначения':'Активен',access,controls];
 }));
 const policyForms=d.roles.map(r=>{
  const p=d.policies.find(x=>x.role_id===r.id),preset=presetList.find(x=>x.role_id===r.id);
  if(d.protectedRoles.includes(r.id)){
   const detail=el('details');detail.className='lc81-policy';detail.append(el('summary',r.name),el('p','Защищённая системная политика.'));
   if(r.id===d.protectedRoles[1]&&p){detail.append(el('p','Разрешений: '+p.permissions.length+' из '+d.actions.length+' · версия '+p.revision));if(d.actions.some(a=>!p.permissions.includes(a)))detail.append(button('Принять новые возможности управляющего',async()=>{if(!confirm('Обновить рабочие полномочия управляющего? Прежние назначения доступа нужно будет подтвердить заново.'))return;await post('manager-policy',{revision:p.revision},'Права обновлены; подтвердите назначения заново.')}))}
   return detail;
  }
  const checks=el('div',undefined,'lc81-policy-groups'),groups=new Map();
  const areas=[['Сотрудники и структура',['person','org','profession','position','shift','employment','role','role_assignment','equipment','workplace','operation']],['СОП, ФРВ и методики',['sop','frv','forms']],['Обучение и наставничество',['training','program','preparation','credential','appointment','authorization','order','supplement','mentor','bank']],['Компетенции и развитие',['matrix','skill','requirement','coverage','assessment','category','scale','development']],['Аудит и задачи',['audit','self','task']],['Планирование и аналитика',['calendar','plan','center','analytics','metrics','roi','assistant']]];
  for(const a of d.actions){const name=areas.find(([,prefixes])=>prefixes.includes(a.split('.')[0]))?.[0]||'Прочее';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(a)}
  for(const [name,items] of groups){
   const details=el('details',undefined,'lc81-policy'),body=el('div',undefined,'lc81-checks');
   details.append(el('summary',name+' · '+items.filter(a=>p?.permissions.includes(a)).length+' / '+items.length));
   for(const a of items)body.append(check(a,actionLabels[a]||a,p?.permissions.includes(a)));
   details.append(body);checks.append(details);
  }
  const detail=el('details');detail.className='lc81-policy';detail.append(el('summary',r.name+' · '+(p?.permissions.length||0)+' разрешений'),...(preset?[el('p',preset.description,'muted'),button('Выбрать рекомендуемые права',()=>{if(!confirm('Заполнить форму рекомендованными правами? Сохранение прав потребует повторного подтверждения доступа.'))return;for(const input of checks.querySelectorAll('input[type=checkbox]')){input.checked=preset.permissions.includes(input.name);input.dispatchEvent(new Event('change',{bubbles:true}))}})]:[]),form([checks],'Сохранить права',f=>post('policy',{role_id:r.id,revision:p?.revision||0,permissions:d.actions.filter(a=>f.elements.namedItem(a).checked)},'Права сохранены; прежние гранты требуют подтверждения')));return detail;
 });
 const usableAccounts=d.accounts.filter(a=>!a.admin&&a.state==='active'&&a.employment_active);
 const roleOptions=d.roles.filter(r=>r.id!==d.protectedRoles[0]&&d.policies.some(p=>p.role_id===r.id));
 const grantForm=form([
  select('account_id','Пользователь',[['','— Выберите пользователя —'],...usableAccounts.map(a=>[a.id,a.display_name+' · '+a.login])]),
  select('role_id','Рабочая роль',[['','— Выберите роль —'],...options(roleOptions)]),
  select('scope','Где действует доступ',[['self','Только собственные записи'],['assigned','Назначенное обучение'],['unit_tree','Подразделение и его дочерние подразделения']]),
  select('unit_id','Подразделение',[['','— Выберите подразделение —'],...options(d.units)]),input('valid_to','До (необязательно)','date',false),check('confirmed','Подтверждаю выбранную роль и область доступа')
 ],'Назначить доступ',async f=>{
  if(!f.elements.confirmed.checked)throw Error('Подтвердите роль и область доступа');
  await post('access',{account_id:value(f,'account_id'),role_id:value(f,'role_id'),scope:value(f,'scope')==='unit_tree'?{kind:'unit_tree',unit_id:value(f,'unit_id')}:{kind:value(f,'scope')},valid_to:value(f,'valid_to')||null},'Роль и доступ назначены');
 });
 const roleField=grantForm.elements.role_id,scopeField=grantForm.elements.scope,unitField=grantForm.elements.unit_id;let wasManager=false;
 const updateScope=()=>{
  const manager=roleField.value===d.protectedRoles[1];
  scopeField.disabled=manager;if(manager){scopeField.value='unit_tree';unitField.value=d.site}else if(wasManager){scopeField.value='self';unitField.value=''}
  wasManager=manager;unitField.disabled=manager||scopeField.value!=='unit_tree';
 };
 roleField.addEventListener('change',()=>{
  const preset=readyPresets.find(p=>p.role_id===roleField.value);
  if(preset){scopeField.value=preset.scope;unitField.value='';if(preset.scope==='unit_tree'){const a=usableAccounts.find(x=>x.id===grantForm.elements.account_id.value),emp=d.employment.find(x=>x.person_id===a?.person_id&&x.valid_from<=d.clock.day&&(!x.valid_to||x.valid_to>=d.clock.day));unitField.value=emp?.unit_id||''}wasManager=false}
  updateScope();
 });scopeField.addEventListener('change',updateScope);updateScope();grantForm.lcResetForm?.();
 const grants=table(['Пользователь','Роль','Область','Период','Версия прав','Состояние доступа','Действие'],d.grants.map(g=>[accounts.get(g.account_id),roles.get(g.role_id),g.scope.kind==='unit_tree'?units.get(g.scope.unit_id):g.scope.kind==='self'?'Своё':'Назначенное обучение',g.valid_from+' — '+(g.valid_to||'без срока'),g.policy_revision,grantLabels[g.status]||'Проверить',g.state==='active'?button('Отозвать',async()=>{if(discard()&&confirm('Немедленно отозвать этот доступ?'))await post('revoke',{id:g.id},'Доступ отозван')}):'—']));
 const history=el('div'),endForm=(type,x)=>{
  if(!discard())return;
  const dateField=input('valid_to',type==='role'?'Последний день действия роли':'Последний рабочий день','date');dateField.querySelector('input').min=x.valid_from>d.clock.day?x.valid_from:d.clock.day;dateField.querySelector('input').value=dateField.querySelector('input').min;
  const flag=type==='role'?'revoke_now':'block_now';
  history.replaceChildren(panel((type==='role'?'Завершить роль · ':'Завершить кадровое назначение · ')+(people.get(x.person_id)||''),el('p','Дата включается в период действия. История сохраняется; закрытую запись нельзя переписать.'),form([dateField,input('reason','Основание'),check(flag,type==='role'?'Отозвать связанные доступы немедленно':'Немедленно заблокировать аккаунт и отозвать доступы',true)],'Подтвердить завершение',async f=>{
   if(!confirm('Завершить назначение без удаления истории?'))return;
   await post(type==='role'?'role-end':'employment-end',{id:x.id,expected_revision:x.rev,valid_to:value(f,'valid_to'),reason:value(f,'reason'),[flag]:f.elements[flag].checked},'Назначение завершено');
  })));history.scrollIntoView({block:'nearest'});
 };
 const periodText=x=>x.valid_from+' — '+(x.valid_to||'без срока');
 const peopleHistory=panel('Кадровая история и роли',el('p','Перевод выполняется в кадровом реестре. Здесь — окончание действующей роли и последнего кадрового назначения. Сначала урегулируйте открытое обучение, задачи, планы и роли.'),table(['Сотрудник','Роль','Период','Действие'],d.assignments.map(x=>[people.get(x.person_id),roles.get(x.role_id),periodText(x),x.valid_to===null&&x.role_id!==d.protectedRoles[0]?button('Завершить роль',()=>endForm('role',x)):'—'])),table(['Сотрудник','Подразделение','Период','Действие'],d.employment.map(x=>[people.get(x.person_id),units.get(x.unit_id),periodText(x),x.valid_to===null&&x.valid_from<=d.clock.day?button('Завершить назначение',()=>endForm('employment',x)):'—'])),history);
 const clock=panel('Календарь предприятия',el('p','Текущий часовой пояс: '+d.clock.zone+' · рабочая дата '+d.clock.day+' · смещение '+d.clock.offset_minutes+' мин.'),el('p',d.clock.configured?'Часовой пояс закреплён в хранилище. Старые события не пересчитываются.':'Пока используется UTC. Укажите фактический IANA часовой пояс предприятия; он будет зафиксирован один раз. Не определяется по компьютеру пользователя.'));
 if(!d.clock.configured)clock.append(form([input('zone','IANA часовой пояс (например Asia/Novokuznetsk)'),check('confirmed','Подтверждаю календарь предприятия; текущие сеансы сотрудников завершатся')],'Закрепить часовой пояс',async f=>{
  if(!f.elements.confirmed.checked)throw Error('Подтвердите часовой пояс');
  await post('clock',{zone:value(f,'zone').trim(),confirmed:true},'Календарь предприятия закреплён');
 }));
 for(const field of grid.querySelectorAll('input[type=date][name=valid_from]'))field.value=d.clock.day;
 for(const f of grid.querySelectorAll('form'))f.lcResetForm?.();
 const openPage=act=>async()=>{if(!discard())return;page=act;await render()};
 const activeManager=d.grants.some(g=>g.role_id===d.protectedRoles[1]&&g.status==='effective'),root=d.units.find(u=>u.id===d.site);
 const goManager=async()=>{if(!discard())return;provisionManager=true;page='admin.users';await render()};
 const statusCard=(title,description,done,links)=>{
  const card=el('section',undefined,'lc81-start-card');card.append(el('span',done?'Готово':'Настроить',done?'lc81-start-ready':'lc81-start-next'),el('h3',title),el('p',description,'muted'));
  const row=el('div',undefined,'row');row.append(...links);card.append(row);return card;
 };
 const cards=el('div',undefined,'lc81-start-grid');
 cards.append(
  statusCard('1. Предприятие и календарь',(root?.name||'Предприятие')+' · '+d.units.length+' подразделений (включая предприятие). Часовой пояс: '+d.clock.zone,d.clock.configured&&(root?.code!=='LC81-QA'||root?.name!=='Учебное предприятие'),[button('Настроить предприятие',openPage('admin.enterprise'))]),
  statusCard('2. Сотрудники','В справочнике: '+d.people.length+'. Добавьте сотрудников вручную или импортируйте XLSX.',d.people.length>0,[button('Справочник сотрудников',openPage('person.read_directory')),button('Импорт сотрудников',openPage('import.view'))]),
  statusCard('3. Рабочие пользователи','Учётных записей сотрудников: '+d.accounts.filter(a=>!a.admin).length+'. '+(activeManager?'Доступ управляющего действует.':'Назначьте управляющего, чтобы открыть рабочие разделы центра.'),activeManager,[button('Создать управляющего',goManager,'primary'),button('Пользователи',openPage('admin.users')),button('Роли и права',openPage('admin.roles')),button('Назначить доступ',openPage('admin.access'))]),
  statusCard('4. Начать работу','Операций: '+d.setup.operations+' · СОП: '+d.setup.sop+' · ФРВ: '+d.setup.frv+'. Можно начать без заполнения всех справочников.',d.setup.operations>0||d.setup.sop>0||d.setup.frv>0,[button('Конструктор СОП',openPage('sop.constructor'),'primary'),button('ФРВ',openPage('frv.read')),button('Операции',openPage('operation.read'))])
 );
 const guide=panel('Настройка центра',el('p',activeManager?'Доступ управляющего настроен. Откройте нужный рабочий раздел или продолжите настройки предприятия.':'Добро пожаловать в Центр TWI. Настройте предприятие и создайте рабочий аккаунт управляющего — система сама свяжет сотрудника, роль и доступ.'),cards,el('p','Системный администратор отвечает за пользователей и права. Производственные решения выполняются под рабочими учётными записями.','muted'));
 const storage=panel('Хранение и восстановление',el('p','Резервная копия выполняется только администратором сервера на остановленном экземпляре в отдельную новую папку. Копия содержит закрытые учётные записи, права и исходники; её нельзя передавать в браузер или хранить в общей папке.'),el('pre','LC81_QA=1 node server/lc81-maintenance.mjs backup /abs/source /abs/new-backup\nLC81_QA=1 node server/lc81-maintenance.mjs restore-new /abs/new-backup /abs/new-restored'),el('p','После аварийного завершения не удаляйте writer.lock. Остановите сервис и его автозапуск, подтвердите отсутствие писателя; создайте отдельную изолированную копию с сохранённой блокировкой.'),el('pre','LC81_QA=1 LC81_RECOVERY_OFFLINE=1 node server/lc81-maintenance.mjs recover-copy /abs/stopped-copy /abs/new-recovered'),el('p','Восстановление не перезаписывает исходное хранилище и не снимает исходную блокировку. Сначала проверьте копию в изолированном QA; только после приёмки переключайте размещение. Рабочий Amvera этим экраном не изменяется.'));
 const auditPanel=panel('Журнал управления доступом',table(['Время (UTC)','Кто','Действие','Цель','Основание'],d.audit.map(a=>[a.occurred_at,accounts.get(a.actor_account_id)||a.actor_account_id,a.action,a.target_id,a.reason])));
 const [personRef,unitRef,employmentRef,roleRef,assignmentRef]=[...grid.children];
 if(page==='admin.enterprise')return [panel('Данные предприятия',el('p',root?.name||'Предприятие'),el('p','Измените название и код корневого предприятия в справочнике структуры. Дочерние подразделения создаются там же.'),button('Структура предприятия',openPage('org.read'),'primary'),button('Справочник сотрудников',openPage('person.read_directory')),button('Импорт XLSX',openPage('import.view'))),clock,panel('ИИ и интеграции',el('p','ИИ конструктора: '+(d.integrations?.editor_ai?'Включён':'Отключён')),el('p','Помощник центра: '+(d.integrations?.center_ai?'Включён':'Отключён')),el('p','ИИ конструктора и помощник центра включаются отдельно в настройках размещения. Внешняя отправка содержимого СОП требует разрешения организации и подтверждения запроса. При отключении ИИ ручная работа сохраняется.','muted')),panel('Справочники',unitRef,personRef,employmentRef)];
 if(page==='admin.users')return [panel('Создание пользователя',el('p','Выберите существующего сотрудника или создайте нового. Для управляющего роль и доступ назначаются автоматически после вашего подтверждения. Если существующий сотрудник не отображается, проверьте его кадровое назначение или уже созданную учётную запись.'),userForm),panel('Пользователи',accountTable,accountEditor)];
 const presetLabels={ready:'Готовая роль',missing:'Не установлена',unconfigured:'Нет прав — требуется настройка',custom:'Настроена вручную',conflict:'Проверьте совпадающие роли'};
 const presetPanel=panel('Предустановленные роли TWI',el('p','Рекомендуемые системные права для рабочих ролей. Область действия назначается отдельно; сертификат, приказ и допуск к операциям не создаются автоматически.'),table(['Роль','Назначение и рекомендуемая область','Состояние','Права'],presetList.map(p=>{
  const details=el('details');details.append(el('summary',p.permissions.length+' разрешений'),...p.permissions.map(a=>el('div',actionLabels[a]||a)));
  return [p.name,p.description+' · '+({self:'Свои записи',assigned:'Назначенные записи',unit_tree:'Подразделение'}[p.scope]),presetLabels[p.status]||p.status,details];
 })));
 if(presetList.some(p=>p.status==='missing'))presetPanel.append(button('Добавить недостающие роли TWI',async()=>{if(!discard()||!confirm('Добавить недостающие роли и начальные настройки прав? Существующие роли и доступы останутся прежними.'))return;const r=await api('admin/role-presets',{confirmed:true});await renew('Добавлено ролей: '+r.created)},'primary'));
 if(page==='admin.roles')return [presetPanel,panel('Роли и права',el('p','Роль — набор разрешённых действий. Выберите роль, чтобы настроить права. Системные роли защищены. Изменение прав требует подтверждения доступа в разделе «Назначения и доступ».'),roleRef,...policyForms),button('Справочник ролей',openPage('role.read'))];
 if(page==='admin.access')return [panel('Назначение доступа',el('p','Выберите пользователя, рабочую роль и область. Система создаст недостающее назначение роли и подтвердит доступ одной операцией. Роль без настроенных прав здесь не появляется.'),grantForm),panel('Действующие и завершённые доступы',grants),peopleHistory, panel('Дополнительные кадровые назначения',assignmentRef,employmentRef)];
 if(page==='admin.storage')return [storage,auditPanel];
 return [guide];

}

function directoryPanel(info,items,pagination=null){
 const type=info.type,d=info.definition,section=panel(actions[page]),editor=el('div',undefined,'lc81-editor'),wrap=el('div'),search=el('input');
 search.type='search';search.placeholder='Поиск по справочнику';search.maxLength=120;search.setAttribute('aria-label','Поиск по справочнику');const row=el('div',undefined,'row');row.append(search);
 let unit=null;
 if(pagination){
  unit=el('select');unit.setAttribute('aria-label','Подразделение сотрудников');
  for(const [id,title] of [['','Все доступные подразделения'],...(info.refs.org_unit||[]).map(x=>[x.id,x.label])]){const opt=el('option',title);opt.value=id;unit.append(opt)}
  row.append(unit,button('Найти',()=>load(1)),button('Сбросить фильтр',()=>{search.value='';unit.value='';return load(1)}));
  search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void run(()=>load(1))}});
  unit.addEventListener('change',()=>void run(()=>load(1)));
 }
 async function load(pageNo){
  if(!pagination||!discard())return;
  close();
  const args=new URLSearchParams({action:'person.read_directory',page:String(pageNo),limit:String(pagination.limit),q:search.value.trim(),unit:unit.value});
  wrap.replaceChildren(el('p','Загрузка страницы…','muted'));
  try{
   const next=await api('resources?'+args);pagination=next;items=next.items;draw();
  }catch(e){
   wrap.replaceChildren(el('p','Страница не получена. Проверьте права или связь.','empty'),button('Повторить чтение',()=>load(pageNo)));throw e;
  }
 }
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
 if(type==='business_role'){
  if(user.admin)row.append(button('Создать роль',()=>{
   if(!discard())return;
   editor.replaceChildren(panel('Новая роль сотрудников',el('p','Создаётся роль справочника. Права и назначения подтверждаются отдельно.'),form([input('code','Код'),input('name','Название')],'Сохранить роль',async f=>{
    await api('admin/reference',{type:'business_role',payload:{code:value(f,'code'),name:value(f,'name')}});note('Роль создана. Настройте её права в разделе пользователей.');await render();
   })));
  },'primary'),button('Права и назначения',async()=>{if(!discard())return;page='admin.roles';await render()}));
  else section.append(el('p','Создание ролей и выдача прав выполняются администратором; управляющий использует подтверждённые роли.','muted'));
 }
 if(info.can_create)row.append(button('Добавить',()=>open(null),'primary'));
 const display=(k,field,r)=>{
  if(field.ref)return (info.refs[field.ref]||[]).find(x=>x.id===r[k])?.label??(r[k]?'Связанная запись':'—');
  if(k==='criticality')return {normal:'Обычная',important:'Важная',critical:'Критическая'}[r[k]]||r[k];
  return r[k]??'—';
 };
 const fields=Object.entries(d.fields);
 function draw(){
  const q=search.value.trim().toLocaleLowerCase('ru-RU'),visible=pagination?items:items.filter(r=>!q||fields.some(([k,f])=>String(display(k,f,r)).toLocaleLowerCase('ru-RU').includes(q))||String(r.unit||'').toLocaleLowerCase('ru-RU').includes(q));
  const headers=fields.map(([,f])=>f.label);
  if(type==='person')headers.push('Подразделение','Должность');
  headers.push('Версия','Действия');
  const summary=pagination?'Показано '+(pagination.total?(pagination.page-1)*pagination.limit+1:0)+'–'+Math.min(pagination.page*pagination.limit,pagination.total)+' из '+pagination.total+' · доступно всего: '+pagination.accessible:'Показано '+visible.length+' из '+items.length;
  wrap.replaceChildren(el('p',summary,'muted'),visible.length?table(headers,visible.map(r=>{
   const cells=fields.map(([k,f])=>display(k,f,r));if(type==='person')cells.push(r.unit,r.position);
   const buttons=el('div',undefined,'row');
   if(type==='person'&&r.can_card)buttons.append(button('Карточка',()=>trainingUI.card(editor,r.id)));
   if(r.can_update)buttons.append(button('Изменить',()=>open(r)));
   if(r.can_archive)buttons.append(button('Архив',async()=>{if(!discard()||!confirm('Архивировать запись? История сохранится.'))return;await api('directory/change',{type,operation:'archive',id:r.id,expected_revision:r.rev,fields:null});note('Запись архивирована на сервере');await render()},'danger'));
   cells.push('v'+r.rev,buttons.childElementCount?buttons:'Только чтение');return cells;
  })):el('p','Нет доступных записей','empty'));
  if(pagination){
   const paging=el('div',undefined,'row lc81-paging'),prev=button('← Назад',()=>load(pagination.page-1)),next=button('Вперёд →',()=>load(pagination.page+1));
   prev.disabled=pagination.page<=1;next.disabled=pagination.page>=pagination.page_count;
   paging.append(prev,el('span','Страница '+pagination.page+' из '+pagination.page_count),next);wrap.append(paging);
  }
 }
 if(!pagination)search.addEventListener('input',draw);draw();section.append(row,editor,wrap);return section;
}
const labels={id:'ID',display_name:'Сотрудник',revision_id:'Редакция',version_no:'Версия',state:'Состояние',document_id:'Документ',code:'Код',title:'Название',operation_id:'Операция',trainee_id:'Обучаемый',sop_revision_id:'Версия СОП',due_on:'Срок',created_at:'Создано',effective_at:'Введено в действие',review_due:'Пересмотр',start_on:'Начало',kind:'Тип',role:'Роль',issued_on:'Выдано',valid_until:'Действует до',valid_from:'Начало',valid_to:'Окончание',observed_at:'Дата',category:'Категория',adaptation:'Адаптация',safety:'ОТ',internship:'Стажировка',month:'Месяц',currency:'Валюта',method:'Метод',owner_id:'Ответственный',person_id:'Сотрудник',mentor_id:'Наставник'};
const states={draft:'Черновик',review:'На согласовании',approved:'Согласован (старый статус)',effective:'Действует',superseded:'Заменён',withdrawn:'Выведен',planned:'Запланировано',in_progress:'В работе',completed:'Завершено',active:'Активно',cancelled:'Отменено',implemented:'Выполнено',verified:'Проверено',ineffective:'Неэффективно',open:'Открыто',final:'Завершено',retired:'Архив',void:'Аннулировано',declined:'Отклонено'};
function resourcePanel(items){
 // IDs are internal navigation anchors, not useful visible table columns.
 const cols=items.length?Object.keys(items[0]).filter(k=>!['steps','rev','id','document_rev','document_archived'].includes(k)&&!k.startsWith('can_')&&!k.endsWith('_id')):[];
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
const approvalUI=createApprovalUI({api,button,panel,table,el,input,select,form,value,note,discard,render,refresh:refreshIndicator,openSop:(host,id)=>openLinked(host,{type:'sop',id}),openTraining:(host,id)=>openLinked(host,{type:'training',id}),assignFamiliarization:(host,context,onSaved)=>trainingUI.familiarizationAssignmentEditor(host,context,onSaved)});
async function openFamiliarization(host,filter){if(discard())host.replaceChildren(await approvalUI.familiarizationPanel(filter))}
libraryUI=createLibraryUI({api,run,button,panel,table,el,input,select,form,value,note,refresh:refreshIndicator,render,discard,check,assistant:(ctx,label)=>assistantUI.contextButton(ctx,label),openLinked,twiReport:context=>finalUI.twiReport(context),assignRollout:(host,context,onSaved)=>trainingUI.rolloutAssignmentEditor(host,context,onSaved),downloadForm,openApproval:id=>approvalUI.detail($('content'),id),openFamiliarization});
async function downloadForm(kind,id=null,appendix=null,version=null){
 const generation=authGeneration;
 const r=await fetch('/api/lc81/forms/export',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-LC81-Request':'1'},body:JSON.stringify(kind==='batch'?{kind,items:id}:kind==='rollout_report'?{kind,id,version}:{kind,id,appendix})});
 if(!r.ok){const b=await r.json().catch(()=>({}));throw Object.assign(Error(b.error||'Выгрузка не подтверждена'),{status:r.status})}
 const filename=r.headers.get('Content-Disposition')?.match(/filename="(TWI-03-[A-Za-z0-9-]+\.(?:xlsx|docx|zip))"/)?.[1];
 if(!filename)throw Error('Сервер не подтвердил имя документа');
 const blob=await r.blob();if(generation!==authGeneration)throw new DOMException('Контекст доступа изменился','AbortError');const url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 note('Документ сформирован без подписей');
}
function formsPanel(d){
 const root=panel('Бланки и методики TWI · редакция '+d.version,el('p','17 приложений стандарта. Редактируемые формы без заполненных подписей. Выписки из зарегистрированных записей доступны непосредственно в соответствующих карточках.'),table(['№','Приложение','Применение','Файл'],d.forms.map(f=>[f.id,f.title,f.notes,button('Скачать '+f.format,()=>downloadForm('blank',null,f.id))])));
 if(d.batch_types?.length){
  const types=d.batch_types,labels=Object.fromEntries(types.map(x=>[x.kind,'Приложение '+x.appendix+' · '+(d.forms.find(f=>f.id===x.appendix)?.title||x.kind)]));
  const kind=select('kind','Документ',types.map(x=>[x.kind,labels[x.kind]])),selected=kind.querySelector('select'),records=el('div'),queue=el('div'),items=[];
  const label=x=>[x.trainee_name||x.person_name||x.mentor_name||x.display_name,x.operation_name||x.title||x.name||x.code,x.start_on||x.assigned_on||x.assessed_on||x.observed_on||x.month,x.state,x.id.slice(0,8)].filter(Boolean).join(' · ');
  const draw=()=>{queue.replaceChildren(el('p','Выбрано '+items.length+' / 20'),table(['Документ','Запись',''],items.map((x,i)=>[labels[x.kind],x.label,button('Убрать',()=>{items.splice(i,1);draw()})])));};
  const load=async()=>{
   const k=selected.value,t=types.find(x=>x.kind===k),result=await api('resources?action='+encodeURIComponent(t.read));
   if(selected.value!==k)return;
   const filter=input('batch_filter','Поиск по записи'),out=el('div');
   const list=result.items.filter(x=>x.can_detail!==false&&(k!=='entry'||x.kind==='entry')&&(k!=='practical'||x.kind==='practical'));
   const update=()=>{const q=filter.querySelector('input').value.trim().toLocaleLowerCase('ru-RU'),matches=list.filter(x=>label(x).toLocaleLowerCase('ru-RU').includes(q));out.replaceChildren(el('p','Найдено '+matches.length+' · показано не более 100. Доступ проверяется при формировании.'),table(['Запись',''],matches.slice(0,100).map(x=>[label(x),button('Добавить',()=>{if(items.some(i=>i.kind===k&&i.id===x.id))return;if(items.length>=20)throw Error('Не более 20 документов');items.push({kind:k,id:x.id,label:label(x)});draw()})])));};
   filter.querySelector('input').addEventListener('input',update);records.replaceChildren(filter,out);update();
  };
  selected.addEventListener('change',()=>records.replaceChildren());draw();
  root.append(panel('Пакетная выгрузка ZIP',el('p','Выберите до 20 записей из разрешённых разделов. При недоступности хотя бы одного источника архив не формируется. Подписи остаются пустыми.'),kind,button('Показать записи',load),records,queue,button('Скачать выбранные документы',async()=>{if(!items.length)throw Error('Добавьте документы');await downloadForm('batch',items.map(({kind,id})=>({kind,id})));})));
 }
 return root;
}
async function importPanel(){
 const d=await api('import/types'),host=el('div'),out=el('div');
 if(!d.types.length)return panel('Импорт XLSX',el('p','Нет доступных для импорта справочников.'));
 const type=select('import_type','Справочник',d.types.map(x=>[x.type,x.label])),file=input('import_file','Файл XLSX до 2 МБ','file'),fi=file.querySelector('input');
 fi.accept='.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 const sheet=select('import_sheet','Лист',[['0','Первый лист']]),header=input('import_header','Строка заголовков','number'),hr=header.querySelector('input');hr.value='1';hr.min=1;hr.max=20;hr.step=1;
 const updates=el('input');updates.type='checkbox';const ul=el('label','Разрешить обновление существующих записей','field');ul.append(updates);
 const val=x=>x.querySelector('input,select').value;
 let base64=null,inspected=null,preview=null;
 const invalidate=()=>{preview=null;out.replaceChildren()};
 const reset=()=>{inspected=null;invalidate();host.replaceChildren()};
 fi.addEventListener('change',()=>{base64=null;sheet.querySelector('select').replaceChildren(new Option('Первый лист','0'));reset()});
 type.querySelector('select').addEventListener('change',reset);sheet.querySelector('select').addEventListener('change',reset);hr.addEventListener('change',reset);updates.addEventListener('change',invalidate);
 async function encoded(){
  const file=fi.files?.[0];if(!file||file.size>d.max_bytes||!file.name.toLowerCase().endsWith('.xlsx'))throw Error('Выберите XLSX до 2 МБ');
  if(base64!==null)return base64;
  const bytes=new Uint8Array(await file.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.subarray(i,i+8192));base64=btoa(bin);return base64;
 }
 const inspect=async()=>{
  if(!discard())return;
  const body={type:val(type),file:await encoded(),sheet:Number(val(sheet)),header_row:Number(val(header))},res=await api('import/inspect',body);
  const ss=sheet.querySelector('select');ss.replaceChildren(...res.sheets.map(x=>new Option(x.name,String(x.index))));ss.value=String(body.sheet);
  inspected=body;invalidate();const selectors=[];
  for(const f of res.fields){const ctrl=select('map_'+f.key,f.label+(f.required?' *':''),[['','— Не импортировать —'],...res.headers.map(x=>[String(x.col),x.name])]),n=ctrl.querySelector('select');n.value=f.col?String(f.col):'';n.required=f.required;n.addEventListener('change',invalidate);selectors.push([f.key,n]);}
  const fields=el('div',undefined,'row');fields.append(...selectors.map(([k,n])=>n.parentNode));
  host.replaceChildren(el('p','Сопоставьте колонки. Коды и табельные номера должны быть текстом; ссылки — кодами справочников.'),fields,button('Предварительная проверка',async()=>{
   const mapping=Object.fromEntries(selectors.filter(([,n])=>n.value).map(([k,n])=>[k,Number(n.value)])),body={...inspected,mapping,allow_updates:updates.checked};
   const result=await api('import/preview',body);preview=result.can_commit?{...body,token:result.token}:null;
   const labels={create:'Создать',update:'Обновить',same:'Без изменений',error:'Конфликт / ошибка'};
   const controls=el('div');if(preview)controls.append(button('Подтвердить импорт',async()=>{
    if(!preview||!confirm('Подтвердить создание/обновление '+(result.counts.create+result.counts.update)+' записей? Все изменения будут сохранены одним пакетом.'))return;
    const r=await api('import/commit',preview);preview=null;host.replaceChildren();out.replaceChildren(el('p','Импорт подтверждён сервером: создано '+r.counts.create+', обновлено '+r.counts.update+', без изменений '+r.counts.same));note('Импорт XLSX сохранён');
   },'primary'));
   out.replaceChildren(el('p',Object.entries(result.counts).map(([k,v])=>labels[k]+': '+v).join(' · ')),table(['Строка','Результат','Проверка','Изменения (было → станет)'],result.results.map(r=>[r.row,labels[r.status],r.message,r.changes.map(c=>c.field+': '+(c.before??'—')+' → '+(c.after??'—')).join(' ; ')])),controls);
  },'primary'));
 };
 return panel('Импорт справочников XLSX',el('p','Создание и явно разрешённое обновление записей. До 200 строк за пакет. Формулы, макросы, внешние ссылки и неизвестные ключи отклоняются. Кадровые перемещения, бизнес-роли, права доступа и исторические оценки здесь не импортируются.'),type,file,sheet,header,ul,button('Прочитать заголовки',inspect),host,out);
}

assistantUI=createAssistantUI({api,button,panel,table,el,input,select,note,openLinked,permitted:()=>!!user?.permissions.includes('assistant.read')});
mobileUI=createMobileAuditUI({api,button,panel,table,el,input,select,form,value,note,discard});
finalUI=createFinalUI({api,button,panel,table,el,input,select,note,discard,openLinked});
trainingUI=createTrainingUI({api,run,button,panel,table,el,input,select,form,value,note,render,discard,check,openLinked,downloadForm,assistant:(ctx,label)=>assistantUI.contextButton(ctx,label),mobilePanel:()=>mobileUI.panel(),personCalendar:(mode,id)=>centerUI.calendar(mode,id),twiReport:context=>finalUI.twiReport(context),openFamiliarization});
centerUI=createCenterUI({api,run,button,panel,table,el,input,select,form,value,note,render,discard,check,openLinked,assistant:(ctx,label)=>assistantUI.contextButton(ctx,label),goMetric:async(id,scope,fallback)=>{
 if(!user?.workspace_actions.includes('metrics.read'))return fallback();
 if(!discard())return;centerUI.focusMetric(id,scope);page='metrics.read';await render();
}});
async function openLinked(host,r){
 if(!discard())return;
 if(r.type==='rc1_history')return finalUI.historyDetail(host,r.id);
 if(r.type==='frv_report')return finalUI.frvDetail(host,r.id);
 if(['sop_evaluation','weighted_sop'].includes(r.type))return trainingUI.sopEvaluationCard(host,r.type,r.id);
 if(['schedule','roi'].includes(r.type))return centerUI.open(host,r.type,r.id);
 if(r.type==='sop')return libraryUI.card(host,r.id);
 if(r.type==='sop_approval')return approvalUI.detail(host,r.id,r.round_id,null,false);
 if(r.type==='familiarization')return openFamiliarization(host,{kind:'visible',revision_id:r.id,...(r.person_id?{person_id:r.person_id}:{})});
 if(r.type==='frv'){
  const action='frv.read',result=await api('resources?action='+encodeURIComponent(action));
  const matches=result.items.filter(x=>x.id===r.id);
  if(!matches.length)throw Error('Источник больше недоступен');
  host.replaceChildren(libraryUI.frv(matches));host.scrollIntoView({block:'nearest'});return;
 }
 if(r.type==='person'&&!user.permissions.includes('person.read_card')){
  const action=user.permissions.includes('person.read_directory')?'person.read_directory':'person.read_basic',result=await api('resources?action='+encodeURIComponent(action)),person=result.items.find(x=>x.id===r.id);
  if(!person)throw Error('Сотрудник недоступен');host.replaceChildren(panel('Сотрудник',el('p',person.display_name)));return;
 }
 return trainingUI.openRecord(host,r.type,r.id);
}
const assistantSections=Object.freeze({
 'person.read_basic':['person'],'person.read_directory':['person'],'mentoring.view':['person'],'training.read':['training'],'instruction.view':['training'],'journal.view':['training'],'retraining.view':['training'],'matrix.read':['matrix'],'program.read':['program'],'internship.view':['enrollment','program'],'training.enrollment.read':['enrollment'],'preparation.read':['preparation'],'audit.read':['audit'],'self.read':['self'],'assessment.read':['assessment'],'development.read':['development'],'task.read':['task'],'sop.read_effective':['sop'],'sop.read_history':['sop'],'sop.read_steps':['sop'],'sop.read_twi':['sop'],'sop.read_linked_frv':['sop'],'sop.constructor':['sop'],'frv.read':['frv'],'sop.evaluation.read':['sop_evaluation','weighted_sop'],'roi.read':['roi'],'plan.read':['training','enrollment','task','development'],'calendar.read':['training','audit','self','assessment']
});
function buildNav(){
 const nav=$('nav');if(navAccount===user.id){for(const group of nav.querySelectorAll('details[data-group]'))navOpen.set(group.dataset.group,group.open)}else{navAccount=user.id;navOpen.clear()}
 nav.replaceChildren();const available=new Set((user.workspace_actions||[]).filter(k=>k==='admin'&&user.admin||Object.hasOwn(actions,k)));
 const selected=[];
 if(user.admin){
  const group=el('details',undefined,'nav-section');group.dataset.group='Администрирование';group.open=navOpen.get(group.dataset.group)??true;group.append(el('summary','Администрирование','navgroup'));
  for(const act of Object.keys(adminPages)){available.add(act);selected.push(act);group.append(navButton(act,available))}nav.append(group);
 }
 const groupFor=act=>isAdminPage(act)?'Администрирование':navGroups.find(([,keys])=>keys.some(k=>(pageActions[k]||[]).includes(act)))?.[0]||'Рабочие разделы';
 for(const [name,keys] of navGroups){
  const list=keys.flatMap(k=>pageActions[k]||[]).filter(a=>available.has(a)&&!selected.includes(a));
  if(!list.length)continue;
  const group=el('details',undefined,'nav-section');group.dataset.group=name;group.open=navOpen.get(name)??(list.includes(page)||!user.admin&&['Ежедневная работа','Люди и компетенции','Управление центром'].includes(name));group.append(el('summary',name,'navgroup'));
  for(const act of list){selected.push(act);group.append(navButton(act,available))}
  nav.append(group);
 }
 for(const act of available)if(!selected.includes(act)){selected.push(act);nav.append(navButton(act,available))}
 if(!available.has(page))page=user.admin?'admin':available.has('person.read_directory')?'person.read_directory':available.has('sop.constructor')?'sop.constructor':selected[0]||'';
 const wait=el('p','Выполняется операция. Переходы временно недоступны.','lc81-nav-wait');wait.id='lc81-nav-wait';wait.hidden=true;nav.prepend(wait);
 const current=nav.querySelector('[data-action="'+page+'"]');if(current){current.classList.add('active');current.setAttribute('aria-current','page');if(current.closest('details'))current.closest('details').open=true}
 const head=$('page-heading'),left=el('div');left.append(el('div',groupFor(page),'eyebrow'),el('h1',titleFor(page)));const tools=el('div',undefined,'row');if(user.permissions.includes('assistant.read')&&assistantSections[page])tools.append(button('ИИ-помощник раздела',()=>assistantUI.section(assistantSections[page])));tools.append(el('span','Подтверждение сервером','pill'));head.replaceChildren(left,tools);refreshIndicator();
}
// Only page keys in history, no personal identifiers or content. Back/Forward
// reauthorize through render() just like menu navigation.
function rememberPage(){
 const state={lc81Page:page};
 if(!navigationStarted||historyReplay){history.replaceState(state,'');navigationStarted=true;historyReplay=false}
 else if(history.state?.lc81Page!==page)history.pushState(state,'');
}
window.addEventListener('popstate',e=>{
 if(!user)return;
 const target=e.state?.lc81Page;
 if(!target||target===page)return;
 if(busy||document.documentElement.classList.contains('lc81-access-check')||!discard()){
  history.pushState({lc81Page:page},'');return;
 }
 historyReplay=true;page=target;void run(()=>render());
});
function setMobileMenu(open,returnFocus=false){
 $('nav').classList.toggle('lc53-menu-open',open);$('menu').setAttribute('aria-expanded',String(open));
 if(returnFocus&&$('menu').getClientRects().length)$('menu').focus();
}
function navButton(act,available){
 const n=button(titleFor(act),async()=>{
  if(!discard())return;
  const mobile=$('nav').classList.contains('lc53-menu-open');page=act;setMobileMenu(false);
  await render();
  if(mobile&&user){const h=$('page-heading').querySelector('h1');if(h){h.tabIndex=-1;h.focus({preventScroll:true})}}
 },'nav');
 n.dataset.action=act;n.disabled=busy||checking||document.documentElement.classList.contains('lc81-access-check');return n;
}
async function render(){
 const serial=++sequence,oldStatus=statusVersion,clearOldError=$('status').classList.contains('error')&&!saveFailed;let succeeded=false;checking=true;refreshIndicator();
 try{
  const fresh=await api('session');if(serial!==sequence)return;
  if(user&&user.access_stamp!==fresh.user.access_stamp){authGeneration++;closeProtectedViews();}
  user=fresh.user;succeeded=true;
  const version=document.querySelector('.header-meta .version');if(version&&/^[a-f0-9]{40}$/.test(fresh.sourceCommit||'')){version.textContent='LC8.1 · QA · '+fresh.sourceCommit.slice(0,7);version.title='Исходный коммит: '+fresh.sourceCommit;}
  buildNav();rememberPage();$('content').replaceChildren(); // do not retain stale authorized rows
  if(isAdminPage(page)&&user.admin){if(page==='admin.notifications'){const v=await api('admin/notification-background');if(serial===sequence)$('content').replaceChildren(notificationAdminPanel(v));return}const data=await api('admin');if(serial===sequence)$('content').replaceChildren(...adminPanel(data));return}
  if(!page){$('content').replaceChildren(panel('Личное рабочее пространство',el('p','Вам пока не назначены права на рабочие разделы. Обратитесь к администратору.')));return}
  if(page==='instruction.view'){
   const d=await api('resources?action=training.read');if(serial===sequence)$('content').replaceChildren(trainingUI.training(d.items,user,'instruction'));return;
  }
  if(page==='internship.view'){
   const root=el('div');
   for(const action of ['program.read','training.enrollment.read'])if(user.workspace_actions.includes(action)){
    const d=await api('resources?action='+action);root.append(trainingUI.programPanel(action,d.items,user,'internship'));
   }
   if(serial===sequence)$('content').replaceChildren(root);return;
  }
  if(page==='mentoring.view'){
   const d=await api('mentor/workspace'),host=el('div'),root=panel('Наставники и внутренние тренеры',el('p','Роли, документы, полномочия и открытые обучения по доступным данным. Количества не включают скрытые записи.'),
    table(['Сотрудник','Подразделение','Доступные роли','Документы подготовки','Приказы','Действующие права обучать','Открытые обучения','Действия'],d.items.map(x=>[x.name,x.unit,x.roles.join(', '),x.credentials,x.appointments,x.authorizations.filter(r=>r.valid).length,x.training,x.can_card?button('Карточка сотрудника',()=>trainingUI.card(host,x.id)):'—'])),host);
   const links=el('div',undefined,'row');
   for(const [action,label] of [['authorization.read','Полномочия по операциям'],['credential.read','Сертификация'],['appointment.read','Назначения'],['role_assignment.read','Роли сотрудников']])if(user.permissions.includes(action))links.append(button(label,async()=>{if(!discard())return;page=action;await render()}));
   root.append(links);if(serial===sequence)$('content').replaceChildren(root);return;
  }
  if(page==='audit.history.read'){const n=await finalUI.history();if(serial===sequence)$('content').replaceChildren(n);return}
  if(page==='assistant.read'){const n=await assistantUI.workspace();if(serial===sequence)$('content').replaceChildren(n);return}
  if(page==='sop.approvals'){const n=await approvalUI.list();if(serial===sequence)$('content').replaceChildren(n);return}
  if(page==='sop.constructor'){
   const info=await api('library/info?kind=sop');
   if(serial===sequence){const n=libraryUI.createPanel('sop',info);if(!user.admin&&!user.permissions.length)n.prepend(el('p','У вас базовый доступ сотрудника. Для управления центром администратор должен подтвердить назначение роли и область доступа.','muted'));$('content').replaceChildren(n)}return;
  }
  if(['sop.read_twi','sop.read_linked_frv'].includes(page)){
   const data=await api('resources?action=sop.read_effective');if(serial===sequence)$('content').replaceChildren(libraryUI.linked(data.items,page));return;
  }
  if(['center.read','analytics.read','metrics.read'].includes(page)){
   const content=await centerUI.report(page);if(page==='analytics.read')content.firstElementChild.after(await finalUI.analytics(content.lc81ReportScope));
   if(page==='center.read'&&user.permissions.includes('operation.create')&&user.workspace_actions.includes('sop.constructor')){
    const info=await api('library/info?kind=sop');
    if(!info.operations.length){
     const links=el('div',undefined,'row'),start=panel('Начало работы в центре',el('p','Пока нет доступных операций. Добавьте сотрудников и производственные операции или начните с первого СОП — операцию можно создать при сохранении.'),links);
     for(const [act,label] of [['org.read','Структура предприятия'],['person.read_directory','Сотрудники'],['import.view','Импорт XLSX'],['operation.read','Операции'],['sop.constructor','Новый СОП'],['frv.read','Новое ФРВ']])if(user.workspace_actions.includes(act))links.append(button(label,async()=>{if(!discard())return;page=act;await render()}));
     content.prepend(start);
    }
   }
   if(serial===sequence)$('content').replaceChildren(content);return;
  }
  if(['calendar.read','plan.read'].includes(page)){
   const content=await centerUI.calendar(page==='plan.read'?'plan':'calendar');if(serial===sequence)$('content').replaceChildren(content);return;
  }
  if(['journal.view','retraining.view'].includes(page)){const n=await trainingUI.registerPanel(page==='journal.view'?'journal':'retraining');if(serial===sequence)$('content').replaceChildren(n);return}
   if(page==='sop.evaluation.read'){const n=await trainingUI.sopEvaluationPanel();if(serial===sequence)$('content').replaceChildren(n);return}
   if(page==='import.view'){const n=await importPanel();if(serial===sequence)$('content').replaceChildren(n);return}
   if(page==='forms.read'){const d=await api('forms');if(serial===sequence)$('content').replaceChildren(formsPanel(d));return}
  const data=await api('resources?action='+encodeURIComponent(page)+(page==='person.read_directory'?'&page=1&limit=50':''));if(serial!==sequence)return;
  if(['employment.read','role_assignment.read'].includes(page)){$('content').replaceChildren(trainingUI.personnelPanel(page,data.items));return}
  if(page==='roi.read'){$('content').replaceChildren(centerUI.roiPanel(data.items,user));return}
  if(['development.read','audit.read','self.read','bank.read'].includes(page)||page==='task.read'&&(user.permissions.includes('task.detail')||user.permissions.includes('task.create'))){
   $('content').replaceChildren(trainingUI.qualityPanel(page,data.items,user));return;
  }
  if(['order.read','supplement.read'].includes(page)){
   $('content').replaceChildren(trainingUI.mentorWorkflow(page,data.items,user));return;
  }
  if(['program.read','training.enrollment.read','preparation.read'].includes(page)){
   $('content').replaceChildren(trainingUI.programPanel(page,data.items,user));return;
  }
  if(['credential.read','appointment.read','authorization.read'].includes(page)){
   const kind=page.split('.')[0],info=user.person_id&&user.permissions.includes(kind+'.register')?await api('mentor/options?kind='+kind):null;
   if(serial===sequence)$('content').replaceChildren(trainingUI.mentor(kind,data.items,info));return;
  }
  if(['skill.read','requirement.read','coverage.read','assessment.read'].includes(page)){
   $('content').replaceChildren(trainingUI.competencyPanel(page,data.items,user));return;
  }
  if(page==='training.read'||page==='matrix.read'){
   $('content').replaceChildren(page==='training.read'?trainingUI.training(data.items,user):trainingUI.matrices(data.items,user));return;
  }
  if(page==='person.read_basic'){
   const host=el('div'),content=panel('Сотрудники',data.items.length?table(['Сотрудник','Действия'],data.items.map(r=>[r.display_name,r.can_card?button('Карточка',()=>trainingUI.card(host,r.id)):'Только чтение'])):el('p','Нет доступных записей'),host);
   $('content').replaceChildren(content);return;
  }
  if(page==='sop.read_effective'){$('content').replaceChildren(libraryUI.effective(data.items));return;}
   if(page==='sop.read_history'||page==='frv.read'){
   const kind=page==='sop.read_history'?'sop':'frv',info=await api('library/info?kind='+kind);
   if(serial!==sequence)return;
   $('content').replaceChildren(libraryUI.createPanel(kind,info),kind==='sop'?libraryUI.history(data.items):libraryUI.frv(data.items));return;
  }
  if(directoryActions[page]){
   const info=await api('directory/info?type='+encodeURIComponent(directoryActions[page]));if(serial!==sequence)return;
   $('content').replaceChildren(directoryPanel(info,data.items,page==='person.read_directory'?data:null));return;
  }
  $('content').replaceChildren(resourcePanel(data.items));
 }catch(e){succeeded=false;if(serial===sequence)$('content').replaceChildren();throw e}finally{if(serial===sequence){checking=false;if(succeeded&&clearOldError&&oldStatus===statusVersion&&!saveFailed)note('');refreshIndicator()}}
}
// Hide cached protected views while a returning tab is being checked.
// A successful unchanged check preserves dirty forms and local editor state.
function maskAccess(on){
 on=on||!!user&&document.visibilityState==='hidden';
 document.documentElement.classList.toggle('lc81-access-check',on);
 $('access-check-notice').hidden=!on;refreshIndicator();
}
async function checkAccess(mask=false){
 if(!user)return;
 if(mask)maskAccess(true);
 if(accessCheck)return accessCheck;
 const generation=authGeneration,account=user.id;
 accessCheck=(async()=>{
  try{
   const r=await fetch('/api/lc81/session',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(8000)});
   const data=await r.json();
   if(generation!==authGeneration||user?.id!==account){if(user?.id===account)accessRefreshPending=true;return}
   if(r.status===401){showLogin();note('Сеанс завершён. Для доступа войдите снова.',true);return}
   if(!r.ok||!data.user||typeof data.user.access_stamp!=='string')throw Error('Проверка доступа недоступна');
   networkFailed=false;
   const fresh=data.user;
   if(fresh.id!==account||fresh.credential_revision!==user.credential_revision){showLogin();note('Учётная запись изменилась. Войдите снова.',true);return}
   if(fresh.access_stamp!==user.access_stamp||JSON.stringify(fresh.workspace_actions)!==JSON.stringify(user.workspace_actions)){
    const unsaved=dirty()||saving||saveFailed||!$('issued').hidden;
    authGeneration++;sequence++;closeProtectedViews();checking=false;saving=false;saveFailed=false;
    user=fresh;buildNav();accessRefreshPending=true;
    maskAccess(false);
    note(unsaved?'Полномочия изменились. Прежние данные и неподтверждённые формы закрыты. Проверьте результаты сохранения в разрешённых разделах.':'Полномочия изменились. Прежние данные закрыты.');
    if(!busy){accessRefreshPending=false;try{await render()}catch(e){if(e.status===401)showLogin();if(e.name!=='AbortError')note(e.message||'Ошибка',true)}}
   }else if(accessRefreshPending&&!busy){
    accessRefreshPending=false;maskAccess(false);try{await render()}catch(e){if(e.status===401)showLogin();if(e.name!=='AbortError')note(e.message||'Ошибка',true)}
   }else{if(!accessRefreshPending)maskAccess(false);refreshIndicator()}
  }catch(e){
   if(generation!==authGeneration||user?.id!==account)return;
   networkFailed=true;maskAccess(true);refreshIndicator();
   // Keep unsaved data in memory, but do not display or allow interaction
   // until the same live session has been verified.
   $('access-check-notice').textContent='Не удалось подтвердить права доступа. Данные скрыты до восстановления связи.';
  }
 })();
 try{await accessCheck}finally{accessCheck=null;if(accessRefreshPending&&user&&!busy)queueMicrotask(()=>{if(!accessCheck&&!busy&&accessRefreshPending)void checkAccess(true)});if(!accessRefreshPending&&user&&!document.documentElement.classList.contains('lc81-access-check')){$('access-check-notice').textContent='Проверка действующих прав доступа…';void refreshNoticeCounter()}}
}

$('menu').addEventListener('click',()=>setMobileMenu(!$('nav').classList.contains('lc53-menu-open'),$('nav').classList.contains('lc53-menu-open')));
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&$('nav').classList.contains('lc53-menu-open')&&!document.querySelector('dialog[open]')){e.preventDefault();setMobileMenu(false,true)}
});
$('content').addEventListener('input',refreshIndicator,true);$('content').addEventListener('change',refreshIndicator,true);
window.addEventListener('offline',()=>{if(user)maskAccess(true);refreshIndicator()});window.addEventListener('online',()=>{if(user)void checkAccess(true);else refreshIndicator()});
// Timers in background tabs may be throttled. Visibility/focus and BFCache
// restoration always trigger verification before cached data become visible.
setInterval(()=>{if(user)void checkAccess()},10000);
document.addEventListener('visibilitychange',()=>{if(!user)return;if(document.visibilityState==='hidden')maskAccess(true);else void checkAccess(true)});
window.addEventListener('focus',()=>{if(user)void checkAccess(true)});
window.addEventListener('pagehide',()=>{if(user)maskAccess(true)});
window.addEventListener('pageshow',e=>{if(e.persisted&&user)void checkAccess(true)});
window.addEventListener('beforeunload',e=>{if(user&&(dirty()||saving||!$('issued').hidden)){e.preventDefault();e.returnValue=''}});
$('login').addEventListener('submit',e=>{e.preventDefault();run(async()=>{const f=e.currentTarget;const b=await api('login',{login:value(f,'login'),password:value(f,'password')});f.reset();showUser(b.user);page=landingPage(b.user);provisionManager=false;note('Вход выполнен');await render()})});
run(async()=>{try{const b=await api('session');showUser(b.user);page=landingPage(b.user);provisionManager=false;await render()}catch(e){if(e.status!==401)throw e;showLogin()}});
