import {REVISION_TITLE_SQL,documentTitle} from './modules/library/revision-title.js';
import {assessmentAnalysis,renderAssessmentAnalysis} from './ui/assessment-analysis.js';
import {comparisonIndicators} from './modules/training/center-overview.js';
import {scheduleKind} from './modules/training/center-planning.js';
import {frvRegistry} from './modules/library/frv-effect.js';
import {assessmentIndicators} from './modules/training/assessment-review.js';
import {centerAuditIndicators,pctText} from './modules/training/audit-analytics.js';
import {employeeRelations,employeeSourceLinks} from './modules/master-data/employee-records.js';
import {sopCriteriaFromDocx} from './modules/training/local-docx.js';
import {BUILTIN_SOP,previewCriteria} from './modules/training/builtin-forms.js';
import {TRAINING_PAGES,trainingScreen,resetTrainingRoute,setTrainingRoute,getTrainingRoute} from './modules/training/screens.js';
import {directoryPeople} from './modules/master-data/people-directory.js';
import {openPeopleDropdown,closePeopleDropdown} from './ui/people-picker.js';
import {weightedHistory,corporateEvaluations} from './modules/library/sop-assessment-review.js';
import {stage43Checklist,weightedResult,stage43Checks} from './modules/library/stage43-checklist.js';
import {linkedFrv,linkedTwi} from './modules/library/linked-materials.js';
import {frvSummary,draftFromFrv} from './modules/library/frv-summary.js';
import {validateChecklist,sopMethods,sopCriteria,evaluationResult} from './modules/library/sop-review.js';
import {inspectSource,MAX_CONTENT,refsForDb,refsForEvents,unionRefs,DOMAIN_TYPES,frvOriginSnapshot} from './modules/library/domain.js';
import {ContentStore,makeTransfer,unpackTransfer,restoreContents,MAX_TRANSFER} from './modules/library/content.js';
import {MAX_XLSX,loadWorkbook,sheetHeaders,sheetRows,importFields,fieldLabel,autoMap,planImport,commitImport,makeTemplate} from './modules/master-data/import-xlsx.js';
import {registryCountChart} from './analytics/palette.js';
import {configureMigrations,recordPayload,createDb,openDb,Workspace,definitions,list,rows,one,meta,uuid,canonical,sha256,prepareSnapshot,readSnapshot,backup,restore,encode,decode,invariant,MAX_PACKAGE} from './core/db.js';
import * as local from './storage/local.js';
import * as net from './storage/network.js';
const root=document.getElementById('app');
let SQL,ws,cache,folder,generation=0,busy=false,master=false,page='home',theme=false,status='Готово',error=false,chart=null,edit=null,query='',incoming=[],importState=null,historyPerson=null,archiveFilter='active',libraryDraft=null,editorSession=null,libraryFilter='all';
const contentStore=new ContentStore(()=>cache,()=>folder),readContent=ref=>contentStore.get(ref);
const sourceRefs=()=>unionRefs(refsForDb(ws.base),refsForEvents(ws.pending));
const planned={forms:'Бланки и методики',sop:'Каталог СОП',sop_constructor:'Конструктор СОП',frv:'ФРВ',twi_plans:'Планы инструктажа TWI',sop_evaluation:'Оценка СОП',my_plan:'Мой план',twi:'План производственного обучения',programs:'Ввод в профессию',internship:'Программы стажировки',instruction:'Инструктажи TWI',retraining:'Переобучение',journal:'Журнал заданий',skills:'Матрица компетенций',practical:'Практические оценки',development:'Планы развития',mentoring:'Наставники и ВТ',self_eval:'Самооценка',certification:'Сертификация',appointments:'Назначения',audit:'Аудиты 1-го уровня',calendar:'Календарь',actions:'Задачи и мероприятия',analytics:'Аналитика центра',metrics:'Дерево метрик',roi:'ROI-модель',ai:'ИИ-помощник',audit_import:'Импорт аудитов RC1',sop_review:'Сохранённая оценка СОП'};
const labels={home:'Дашборд',...Object.fromEntries(Object.entries(definitions).map(([k,v])=>[k,v.label])),...planned,org_unit:'Структура предприятия',import_xlsx:'Импорт данных',storage:'Настройки и обмен'};
const navGroups=[
 ['Ежедневная работа',['home','my_plan','calendar','actions']],
 ['Стандартизация и улучшения',['sop','sop_constructor','frv','sop_evaluation']],
 ['Производственное обучение',['twi_plans','twi','programs','internship','instruction','retraining','journal']],
 ['Люди и компетенции',['person','workplace','skills','practical','development']],
 ['Наставники и ВТ',['mentoring','self_eval','certification','appointments','audit']],
 ['Аналитика',['analytics','metrics','roi']],
 ['Управление центром',['org_unit','forms','import_xlsx','storage']],
 ['Справочники',['profession','position','work_shift','equipment','operation','person_assignment','business_role','role_assignment','skill_category','skill','rating_scale']]
];
const implemented=new Set(['home','sop','sop_constructor','frv','twi_plans','sop_evaluation','storage','import_xlsx',...TRAINING_PAGES,...Object.keys(definitions)]);
const collapsedNav=new Set(['Производственное обучение','Наставники и ВТ','Аналитика','Справочники']);
let librarySelected=null,libraryRevisionSelected=null,evaluationSelected=null,evaluationTab='weighted',evaluationSearch='',employeeSelected=null,employeeTab='overview',employeeReturn=null,employeeSources=null;
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
function add(parent,...children){parent.append(...children);return parent}
function btn(label,fn,cls='',disabled=false){const n=el('button',label,cls);n.type='button';n.disabled=disabled||busy;n.addEventListener('click',fn);return n}
function pane(title,...children){return add(el('section',undefined,'panel'),el('h2',title),...children)}
function message(s,bad=false){status=s;error=bad;const n=document.getElementById('status');if(n){n.textContent=s;n.className='status'+(bad?' error':'')}}
// Navigation snapshots stay in memory; the browser stores only an opaque history ID.
let mobileMenu=false,navSerial=0,navCurrent=null,navParent=null,navSupported=true,restoringNav=false;
const navSnapshots=new Map();
try{theme=localStorage.getItem('lean-center-theme')==='dark'}catch{}
function initNav(){if(navCurrent!==null)return;navCurrent=++navSerial;try{history.scrollRestoration='manual';history.replaceState({lcNav:navCurrent,parent:null},'')}catch{navSupported=false}}
const filterName=n=>!!n&&(/_filter_|^lc5_analytics_|^lc51_analytics_|^lc52_(analytics|metrics|frv|sop|retrain|calendar_unit|action_unit)|^compare_|^lc5_calendar_(month|person|type)$/.test(n));
function navSnapshot(){
 const controls=[...document.querySelectorAll('main input[name],main select[name],main button.lc-directory-trigger[name]')].filter(e=>filterName(e.name)).map(e=>({name:e.name,value:e.dataset.personId??e.value,person:typeof e.lcRestorePerson==='function'}));
 return {parent:navParent,page,route:getTrainingRoute(),employeeSelected,employeeTab,employeeReturn,query,archiveFilter,libraryFilter,librarySelected,libraryRevisionSelected,evaluationSelected,evaluationTab,evaluationSearch,historyPerson,scroll:window.scrollY,controls};
}
function rememberNavigation(){
 if(restoringNav||!ws)return;initNav();navSnapshots.set(navCurrent,navSnapshot());const previous=navCurrent;navCurrent=++navSerial;navParent=previous;try{if(navSupported)history.pushState({lcNav:navCurrent,parent:previous},'')}catch{navSupported=false}mobileMenu=false;
}
function restoreNavigation(id,parent){
 const snap=navSnapshots.get(id);if(!snap||busy||editorSession&&!editorSession.host.hidden)return false;
 navSnapshots.set(navCurrent,navSnapshot());navCurrent=id;navParent=parent;restoringNav=true;
 try{
  closePeopleDropdown();({page,employeeSelected,employeeTab,employeeReturn,query,archiveFilter,libraryFilter,librarySelected,libraryRevisionSelected,evaluationSelected,evaluationTab,evaluationSearch,historyPerson}=snap);employeeSources=null;edit=null;mobileMenu=false;setTrainingRoute(page,snap.route);render();
  const find=name=>[...document.querySelectorAll('main [name]')].find(e=>e.name===name);
  for(const v of snap.controls.filter(x=>x.person))find(v.name)?.lcRestorePerson?.(v.value);
  const changed=[];for(const v of snap.controls.filter(x=>!x.person)){const e=find(v.name);if(e&&e.value!==v.value&&(!e.options||[...e.options].some(o=>o.value===v.value))){e.value=v.value;changed.push(e)}}
  for(const e of changed)if(e.isConnected)e.dispatchEvent(new Event('change'));
  requestAnimationFrame(()=>window.scrollTo(0,snap.scroll||0));return true
 }finally{restoringNav=false}
}
function navigationBack(){if(busy||navParent===null)return;if(navSupported){history.back();return}restoreNavigation(navParent,navSnapshots.get(navParent)?.parent??null)}
window.addEventListener('popstate',e=>{if(e.state?.lcNav&&navSnapshots.has(e.state.lcNav)){if(!restoreNavigation(e.state.lcNav,e.state.parent??null)&&navSupported)history.forward()}});
function navigate(p,{retainEmployee=false}={}){
 if(busy)return;
 if(editorSession&&!editorSession.host.hidden)hideEditor(editorSession);
 rememberNavigation();
 closePeopleDropdown();resetTrainingRoute();if(!retainEmployee){employeeSelected=null;employeeReturn=null;employeeTab='overview';employeeSources=null}page=p;edit=null;query='';historyPerson=null;archiveFilter='active';libraryFilter='all';librarySelected=null;libraryRevisionSelected=null;if(p==='sop_evaluation'){evaluationSelected=null;evaluationTab='weighted';evaluationSearch=''}render()
}
function goTraining(p,options={}){navigate(p,{retainEmployee:!!employeeReturn});setTrainingRoute(p,options);render()}
function openImport(type){importState={type,book:null,sheet:0,header:1,mapping:{},allowUpdates:false,plan:null,file:''};navigate('import_xlsx')}
function openHistory(id){navigate('person_assignment',{retainEmployee:!!employeeReturn});historyPerson=id;archiveFilter='all';render()}
async function persist(){if(cache)generation=await local.saveWorkspace(cache,generation,ws.state())}
function replace(newWs){ws?.close();ws=newWs}
function formControls(){return [...document.querySelectorAll('main input[name]:not([type=file]),main select[name],main textarea[name],main button.lc-directory-trigger[name]')]}
function captureRejectedForm(){
 const fields=formControls(),details=[...document.querySelectorAll('main details')];
 return {page,route:getTrainingRoute(),scroll:window.scrollY,fields:fields.map(e=>({name:e.name,tag:e.tagName,type:e.type,person:typeof e.lcRestorePerson==='function',value:e.dataset.personId??e.value,checked:e.checked})),details:details.map(e=>({label:e.querySelector('summary')?.textContent||'',open:e.open}))}
}
function restoreRejectedForm(s){
 if(!s||s.page!==page)return;
 const fields=formControls(),seen=new Map(),changed=[],people=[];
 for(const v of s.fields){const key=v.name+'|'+v.tag+'|'+v.type,idx=seen.get(key)||0;seen.set(key,idx+1);const e=fields.filter(x=>x.name===v.name&&x.tagName===v.tag&&x.type===v.type)[idx];if(!e)continue;
  if(v.person){people.push([e,v.value]);continue}
  if(e.type==='checkbox'||e.type==='radio'){if(e.checked!==v.checked){e.checked=v.checked;changed.push(e)}}
  else if(e.value!==v.value&&(!e.options||[...e.options].some(o=>o.value===v.value))){e.value=v.value;changed.push(e)}
 }
 for(const [e,v] of people)if(e.isConnected)e.lcRestorePerson?.(v);
 for(const e of changed)if(e.isConnected)e.dispatchEvent(new Event('change',{bubbles:true}));
 const details=[...document.querySelectorAll('main details')];s.details.forEach((v,i)=>{const e=details[i];if(e&&(e.querySelector('summary')?.textContent||'')===v.label)e.open=v.open});
 requestAnimationFrame(()=>window.scrollTo(0,s.scroll||0));
}
async function run(fn,{save=true,retainForm=false}={}){if(busy)return;const prev=ws.state(),form=retainForm?captureRejectedForm():null;let failure=null;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);message('Выполняется…');try{const m=await fn();if(save)await persist();message(m||'Готово')}catch(e){console.error(e);replace(new Workspace(SQL,openDb(SQL,prev.base),prev));failure=e.message;if(form&&page===form.page)setTrainingRoute(page,form.route);message(e.message,true)}finally{busy=false;render();if(failure&&form){restoreRejectedForm(form);message(failure,true)}}}
function download(name,body){const url=URL.createObjectURL(new Blob([canonical(body)],{type:'application/json'}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function pick(accept,fn,max=150*1024*1024){const i=el('input');i.type='file';i.accept=accept;i.onchange=()=>{const f=i.files?.[0];if(f)run(async()=>{invariant(f.size<=max,'Файл слишком большой');return await fn(JSON.parse(await f.text()))})};i.click()}
const empty=()=>!ws.pending.length&&!ws.dirty&&!meta(ws.base,'publication_id')&&Object.keys(definitions).every(t=>list(ws.base,t).length===0)&&!one(ws.base,'SELECT id FROM document LIMIT 1')&&!one(ws.base,'SELECT id FROM frv_study LIMIT 1');
function refName(type,id){if(!id)return '—';const v=one(ws.working,'SELECT * FROM '+type+' WHERE id=?',[id]);return v?.display_name||v?.name||id}
function refOption(type,v){return (v.employee_code||v.code? (v.employee_code||v.code)+' — ':'')+(v.display_name||v.name||v.id)+(v.unit_id?' · '+refName('org_unit',v.unit_id):'')+(v.archived?' (архив)':'')}
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
function activeRecord(d,v){return !v.archived&&(!d.history||(v.valid_from<=today()&&(!v.valid_to||v.valid_to>=today())))}
function showVal(k,f,v){if(f.ref)return k==='shift_id'&&!v[k]&&v.shift_code?v.shift_code+' (LC1)':refName(f.ref,v[k]);if(k==='criticality')return ({normal:'Обычная',important:'Важная',critical:'Критическая'})[v[k]]||v[k];return v[k]??'—'}

// Original, simple line icons for application navigation (not corporate logo).
const ICON_PATHS={
 home:['M3 10 12 3l9 7v10H3z','M9 20v-6h6v6'],
 sop:['M6 3h9l4 4v14H6z','M14 3v5h5','M9 12h7M9 16h7'],
 frv:['M12 5a7 7 0 1 0 7 7 7 7 0 0 0-7-7z','M12 8v4l3 2M9 2h6'],
 twi:['M3 5h7l2 2 2-2h7v15h-7l-2 1-2-1H3z','M12 7v14'],
 skills:['M3 4h18v16H3z','M3 9h18M3 14h18M9 4v16M15 4v16'],
 mentoring:['M9 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z','M3 20v-3c0-3 12-3 12 0v3','M16 6h5M18.5 3.5v5'],
 audit:['M5 4h14v17H5z','M9 4V2h6v2','m8 10 2 2 4-4','M8 16h8'],
 calendar:['M3 6h18v15H3z','M7 3v6M17 3v6M3 10h18','M7 14h3M14 14h3'],
 actions:['M4 5h16v15H4z','m7 11 3 3 6-6'],
 analytics:['M4 3v17h17','M8 16v-5M13 16V7M18 16V4'],
 ai:['m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'],
 org_unit:['M8 3h8v5H8z','M12 8v5M4 13h16M4 13v3M20 13v3','M2 16h5v5H2zM17 16h5v5h-5z'],
 person:['M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z','M4 21v-3c0-6 16-6 16 0v3'],
 profession:['M3 7h18v13H3z','M8 7V4h8v3M3 12h18M10 12v3h4v-3'],
 equipment:['M3 21V9l6 4V8l6 5V4h5v17z','M6 17h2M11 17h2M16 17h2'],
 operation:['M4 3h16v5H4zM4 16h16v5H4z','M12 8v8m-3-3 3 3 3-3'],
 person_assignment:['M3 4h18v16H3z','M7 8h4M7 12h4M7 16h4','m14 13 2 2 4-5'],
 storage:['M4 7c0-4 16-4 16 0v10c0 4-16 4-16 0z','M4 7c0 4 16 4 16 0M4 12c0 4 16 4 16 0']
};
function icon(key,cls='nav-icon'){
 if(key==='sop_constructor')key='sop';if(key==='twi_plans')key='twi';
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.65','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:cls}))svg.setAttribute(k,v);
 for(const d of ICON_PATHS[key]||ICON_PATHS.home){const p=document.createElementNS(ns,'path');p.setAttribute('d',d);svg.append(p)}
 return svg
}
function navButton(k){const n=btn('',()=>navigate(k),'nav'+(page===k?' active':'')+(!implemented.has(k)?' nav-planned':''));n.append(icon(k),el('span',labels[k]));if(page===k)n.setAttribute('aria-current','page');if(!implemented.has(k)){n.title='Запланировано на следующие этапы';const dot=el('span','', 'planned-dot');dot.setAttribute('aria-hidden','true');n.append(dot)}return n}
function sectionHeading(title,caption){return add(el('div',undefined,'section-heading'),el('h2',title),el('span',caption,'muted'))}
function home(main){
 const todayIso=today(),overdue=one(ws.working,"SELECT count(*) n FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='effective' AND d.archived=0 AND r.review_due<?",[todayIso]).n;
 const without=one(ws.working,"SELECT count(*) n FROM document_revision r JOIN document d ON d.id=r.document_id WHERE r.state='draft' AND d.archived=0 AND (r.print_format IS NULL OR r.workplace_id IS NULL)").n;
 const needs=pane('Требует внимания',add(el('div',undefined,'attention-row'),el('strong',String(overdue),overdue?'bad':'muted'),el('span','Просроченный пересмотр действующих СОП'),btn('Открыть',()=>{navigate('sop');libraryFilter='overdue';render()})),add(el('div',undefined,'attention-row'),el('strong',String(without),without?'warn':'muted'),el('span','Черновики без подтверждённого паспорта'),btn('Открыть',()=>{navigate('sop');libraryFilter='missing_passport';render()})));
 const overdueTraining=one(ws.working,"SELECT count(*) n FROM training_assignment WHERE source_sha256 IS NOT NULL AND state IN('planned','in_progress') AND due_on<?",[todayIso]).n;
 const revisedTraining=one(ws.working,"SELECT count(*) n FROM training_assignment a JOIN document_revision r ON r.id=a.sop_revision_id JOIN document d ON d.id=r.document_id WHERE a.source_sha256 IS NOT NULL AND a.state<>'cancelled' AND (r.state<>'effective' OR d.archived=1)").n;
 needs.append(add(el('div',undefined,'attention-row'),el('strong',String(overdueTraining),overdueTraining?'warn':'muted'),el('span','Просроченные назначения обучения'),btn('Открыть',()=>goTraining('twi',{filter:'overdue'}))),add(el('div',undefined,'attention-row'),el('strong',String(revisedTraining),revisedTraining?'warn':'muted'),el('span','Обучение по прежним редакциям СОП'),btn('Открыть',()=>goTraining('retraining'))));
 const ai=centerAuditIndicators(ws.working,todayIso),ass=assessmentIndicators(ws.working,todayIso),cmp=comparisonIndicators(ws.working,todayIso),plans=rows(ws.working,"SELECT * FROM schedule_event WHERE state='planned'");
 const auditAttention=[['Просрочено мероприятий',ai.overdue,'actions',{filter:'overdue'}],['Ожидают проверки эффективности',ai.verification,'actions',{filter:'implemented'}],['Потребности в переобучении',ai.retraining,'retraining',{}],['Запланировано аудитов',ai.scheduled,'calendar',{month:'',plannedOnly:true}]];
 auditAttention.push(['Практические оценки: требуется решение',ass.needs,'practical',{filter:'needs'}],['Запланировано практических оценок',plans.filter(x=>scheduleKind(x)==='practical').length,'calendar',{month:'',scheduleType:'practical'}],['Запланировано самооценок',plans.filter(x=>scheduleKind(x)==='self_eval').length,'calendar',{month:'',scheduleType:'self_eval'}],['Инструкторы: самооценка и наблюдения требуют обсуждения',cmp.people,'analytics',{assessmentType:'comparison',discussionOnly:true}]);
 for(const [label,count,dest,options] of auditAttention)needs.append(add(el('div',undefined,'attention-row'),el('strong',String(count),count?'warn':'muted'),el('span',label),btn('Открыть',()=>goTraining(dest,options))));
 main.append(needs,pane('Аудит L1 · текущий месяц',add(el('div',undefined,'kpi-grid'),...[[String(ai.auditCount),'Проведено аудитов','audit',{from:todayIso.slice(0,7)+'-01',to:todayIso,state:'final'}],[ai.month?pctText(ai.month.stats.pct):'—','Доля положительных наблюдений','analytics',{versionId:ai.versionId,from:todayIso.slice(0,7)+'-01',to:todayIso}],[ai.repeated===null?'—':String(ai.repeated),'Повторяющиеся отклонения','analytics',{versionId:ai.versionId,from:todayIso.slice(0,7)+'-01',to:todayIso}]].map(([value,label,dest,options])=>{const b=btn('',()=>goTraining(dest,options),'tile');b.append(el('span',label,'muted'),el('b',value));return b})),el('p',ai.methodCount>1?'В месяце несколько версий методики: общего среднего нет.':'Результаты учитывают только наблюдавшиеся критерии.','muted')));
 const assessmentTiles=[[String(ass.practical),'Практических оценок','practical',{from:todayIso.slice(0,7)+'-01',to:todayIso}],[String(ass.negative),'Заключение «Не соответствует»','practical',{filter:'not_meet',from:todayIso.slice(0,7)+'-01',to:todayIso}],[String(ass.self),'Самооценок наставников','self_eval',{from:todayIso.slice(0,7)+'-01',to:todayIso}]];
 main.append(pane('Практика и самооценка · текущий месяц',add(el('div',undefined,'kpi-grid'),...assessmentTiles.map(([value,label,dest,options])=>{const b=btn('',()=>goTraining(dest,options),'tile');b.append(el('span',label,'muted'),el('b',value));return b})),btn('Аналитика практических оценок',()=>goTraining('analytics',{assessmentType:'practical',from:todayIso.slice(0,7)+'-01',to:todayIso})),btn('Аналитика самооценок',()=>goTraining('analytics',{assessmentType:'self_eval',from:todayIso.slice(0,7)+'-01',to:todayIso}))));
 const month=todayIso.slice(0,7),inMonth=date=>date.slice(0,7)===month&&date.slice(0,10)<=todayIso,frvs=frvRegistry(ws.working).filter(x=>x.state==='final'&&inMonth(x.observed_at)),sopEval=corporateEvaluations(ws.working).filter(x=>inMonth(x.date)),weighted=weightedHistory(ws.working).filter(x=>inMonth(x.date));
 main.append(pane('СОП и ФРВ · текущий месяц',add(el('div',undefined,'kpi-grid'),...[[sopEval.length,'Корпоративские оценки СОП','analytics',{assessmentType:'sop',sopKind:'sop_evaluation',from:month+'-01',to:todayIso}],[weighted.length,'Снимки взвешенных оценок','analytics',{assessmentType:'sop',sopKind:'weighted_sop',from:month+'-01',to:todayIso}],[frvs.length,'Завершённые ФРВ','analytics',{assessmentType:'frv',from:month+'-01',to:todayIso}]].map(([value,label,dest,options])=>{const b=btn('',()=>goTraining(dest,options),'tile');b.append(el('span',label,'muted'),el('b',String(value)));return b})),add(el('div',undefined,'row'),btn('Дерево метрик',()=>goTraining('metrics')),btn('ROI-модель',()=>goTraining('roi')))));
 main.append(sectionHeading('Справочники предприятия','Активные записи'));
 const g=el('div',undefined,'kpi-grid');
 const counts=Object.fromEntries(Object.keys(definitions).map(k=>[k,list(ws.working,k).filter(x=>activeRecord(definitions[k],x)).length]));
 for(const k of ['org_unit','person','workplace','equipment','operation','profession']){const d=definitions[k],n=btn('',()=>navigate(k),'tile');n.setAttribute('aria-label',d.label+': '+counts[k]);add(n,add(el('div',undefined,'tile-head'),el('span',d.label,'muted'),icon(k,'tile-icon')),el('b',String(counts[k])),el('span','Открыть справочник →','tile-link'));g.append(n)}
 main.append(g);main.append(add(el('div',undefined,'row registry-shortcuts'),btn('Импорт справочников из Excel',()=>openImport('person'),'primary'),btn('Назначения сотрудников',()=>navigate('person_assignment')),btn('Шкалы оценивания',()=>navigate('rating_scale'))));
 const c=el('div',undefined,'chart');c.style.height=Math.max(290,Object.keys(definitions).length*29)+'px';main.append(pane('Структура справочников',c));
 if(window.echarts){chart=echarts.init(c,theme?'dark':null);chart.setOption(registryCountChart(Object.values(definitions).map(x=>x.label),Object.keys(definitions).map(k=>counts[k]),theme))}
 const links=el('div',undefined,'workspace-grid');for(const [k,n] of Object.entries(planned).filter(([k])=>implemented.has(k))){const b=btn('',()=>navigate(k),'workspace-link');b.append(icon(k),el('span',n));links.append(b)}
 main.append(pane('Рабочие модули',el('p','СОП, ФРВ, TWI, компетенции, наставничество и аудит — равноправные модули центра. Доступны база, справочники, библиотека СОП, ФРВ, обучение, компетенции и наставники. Аудит L1 связан с общими мероприятиями, календарём, аналитикой и карточками сотрудников.','muted'),links))
}
function form(type,v){
 const d=definitions[type],f=el('form'),grid=el('div',undefined,'formgrid'),controls={};
 for(const [k,x] of Object.entries(d.fields)){
  let input;const initial=v?.[k]??(k==='criticality'?'normal':k==='kind'?'Участок':k==='valid_from'?today():k==='version_no'?'1':'');
  if(x.legacy){input=el('input');input.type='hidden';input.name=k;input.value=initial;controls[k]=input;grid.append(input);if(initial)grid.append(add(el('div',undefined,'field'),el('span',x.label),el('p',initial,'muted')));continue}
  if(x.ref||x.options){
   input=el('select');const option=el('option','—');option.value='';input.append(option);
   const opts=x.ref?list(ws.working,x.ref).filter(y=>!y.archived||v?.[k]===y.id).map(y=>[y.id,refOption(x.ref,y)]):x.options.map(y=>[y,y==='normal'?'Обычная':y==='important'?'Важная':y==='critical'?'Критическая':y]);
   for(const [value,label] of opts){const o=el('option',label);o.value=value;input.append(o)}
  }else if(x.multiline){input=el('textarea');input.rows=5;input.maxLength=5000;input.placeholder='0: Название уровня\n1: Название уровня'}
  else{input=el('input');input.type=x.date?'date':x.integer?'number':'text';input.maxLength=500;if(x.integer){input.min='1';input.step='1'}}
  input.name=k;input.required=!!x.required;input.value=initial;controls[k]=input;
  if(d.history&&v?.id&&k!=='valid_to')input.disabled=true;
  if(d.history&&v?.valid_to&&k==='valid_to')input.disabled=true;
  grid.append(add(el('label',undefined,'field'),el('span',x.label),input));
 }
 const submit=el('button','Сохранить','primary');submit.type='submit';submit.disabled=busy;
 f.onsubmit=e=>{e.preventDefault();const payload=Object.fromEntries(Object.entries(controls).map(([k,n])=>[k,n.value||null]));run(async()=>{ws.edit(type,v?.id||null,payload);edit=null;return 'Запись сохранена локально. Изменение ожидает публикации.'})};
 if(d.history&&v?.id)f.append(el('p','История неизменяема: можно только закрыть открытое назначение датой окончания. Для перевода создайте новое назначение после закрытия.','muted'));
 if(type==='rating_scale')f.append(el('p','После сохранения шкала неизменяема. Для новой методики создайте следующую версию. Уровни задаются пользователем; корпоративские пороги не предустановлены.','muted'));
 return add(f,grid,add(el('div',undefined,'row'),submit,btn('Отмена',()=>{edit=null;render()})))
}
function orgTree(panel,items){
 const box=el('div',undefined,'org-tree'),children=new Map();
 for(const v of items){const k=v.parent_id||'';if(!children.has(k))children.set(k,[]);children.get(k).push(v)}
 const seen=new Set();
 function walk(id,depth){for(const v of children.get(id)||[]){if(seen.has(v.id))continue;seen.add(v.id);const line=add(el('div',undefined,'org-node'),el('span',v.code,'pill'),el('span',v.name),el('span',v.kind+(v.archived?' · Архив':''),'muted'));line.style.paddingLeft=Math.min(depth,8)*17+'px';box.append(line);walk(v.id,depth+1)}}
 walk('',0);for(const v of items.filter(x=>!seen.has(x.id)))box.append(el('p',v.code+' — '+v.name+' (неразрешённый родитель)','warn'));
 if(items.length)panel.append(pane('Иерархия предприятия',box));
}
const employeeTabs=[['overview','Обзор'],['matrices','Матрицы компетенций'],['training','Обучение'],['assessments','Оценки и допуски'],['mentoring','Наставничество'],['documents','СОП и ФРВ'],['development','Планы и мероприятия'],['history','Назначения и роли']];
const employeeStates={active:'Действует',retired:'Предыдущая версия',planned:'Запланировано',in_progress:'В процессе',completed:'Завершено',cancelled:'Отменено',confirmed:'Подтверждено',void:'Аннулировано',registered:'Зарегистрировано',revoked:'Отозвано',closed:'Закрыто',granted:'Допуск выдан',denied:'Не допущен',final:'Зафиксировано',draft:'Черновик',pass:'Пройдено',fail:'Не пройдено',incomplete:'Не завершено',effective:'Действует',superseded:'Заменено',withdrawn:'Выведено из действия',open:'Открыто',implemented:'Ожидает проверки',verified:'Эффект подтверждён',ineffective:'Эффект не подтверждён',done:'Выполнено',needs_replan:'Требует перепланирования',replanned:'Перепланировано',review:'На согласовании',approved:'Согласовано',archived:'Архив'};
function openEmployee(id,{restore=false}={}){
 if(!id||!one(ws.working,'SELECT id FROM person WHERE id=?',[id]))return;
 const keep=restore&&employeeReturn===id,tab=keep?employeeTab:'overview';navigate('person',{retainEmployee:keep});employeeSelected=id;employeeReturn=id;employeeTab=tab;employeeSources=null;render()
}
function employeeDestination(id,d){
 if(!d)return;employeeReturn=id;const p=d.page,o=d.options||{};
 if(p==='sop'){goDocument(o.documentId,o.revisionId);return}
 if(p==='frv'){goResearch(o.studyId);return}
 if(p==='sop_evaluation'){navigate(p,{retainEmployee:true});evaluationSelected=o.revisionId;evaluationTab=o.tab||'corporate';render();return}
 if(p==='person_assignment'||p==='role_assignment'){navigate(p,{retainEmployee:true});historyPerson=id;archiveFilter='all';render();return}
 goTraining(p,o)
}
function employeeCard(main,id){
 const db=ws.working,p=one(db,'SELECT * FROM person WHERE id=?',[id]);if(!p){employeeSelected=null;return registry(main,'person')}
 const cur=one(db,"SELECT * FROM person_assignment WHERE person_id=? AND valid_from<=? AND coalesce(valid_to,'9999-12-31')>=? ORDER BY valid_from DESC,id LIMIT 1",[id,today(),today()]);
 const roles=rows(db,"SELECT b.name FROM role_assignment a JOIN business_role b ON b.id=a.role_id WHERE a.person_id=? AND b.archived=0 AND a.valid_from<=? AND coalesce(a.valid_to,'9999-12-31')>=? ORDER BY b.name",[id,today(),today()]);
 const groups=employeeRelations(db,id);
 const top=pane(p.display_name,add(el('div',undefined,'row'),btn('← Список сотрудников',()=>navigate('person')),btn('История назначений',()=>employeeDestination(id,{page:'person_assignment'})),btn('Роли',()=>employeeDestination(id,{page:'role_assignment'}))),add(el('div',undefined,'employee-meta'),...[
  ['Табельный номер',p.employee_code],['Подразделение',refName('org_unit',cur?.unit_id)],['Должность',refName(cur?.position_id?'position':'profession',cur?.position_id||cur?.profession_id)],['Смена',cur?.shift_id?refName('work_shift',cur.shift_id):cur?.shift_code||'—'],['Роли',roles.map(r=>r.name).join(', ')||'—'],['Статус',p.archived?'Архив':'Активен']
 ].map(([key,value])=>add(el('div'),el('span',key,'muted'),el('strong',value)))));
 main.append(top);
 const nav=el('div',undefined,'library-tabs employee-tabs'),body=el('div');
 function show(key){
  employeeTab=key;for(const b of nav.children)b.classList.toggle('selected',b.dataset.tab===key);
  body.replaceChildren();
  if(key==='overview'){
   body.append(pane('Рабочие записи сотрудника',add(el('div',undefined,'row'),btn('Мой план',()=>employeeDestination(id,{page:'my_plan',options:{personId:id}})),btn('Метрики сотрудника',()=>employeeDestination(id,{page:'metrics',options:{personId:id}})),btn('Календарь',()=>employeeDestination(id,{page:'calendar',options:{personId:id,month:''}})),btn('Мероприятия',()=>employeeDestination(id,{page:'actions',options:{personId:id}})),btn('Самооценка и аудиты',()=>employeeDestination(id,{page:'analytics',options:{assessmentType:'comparison',personId:id}})))));
   body.append(pane('Связанные данные',el('p','Все сведения берутся из общей базы по идентификатору сотрудника. Для исходных СОП и ФРВ предусмотрен отдельный поиск сохранённых ссылок.','muted'),add(el('div',undefined,'employee-overview'),...employeeTabs.slice(1).map(([k,label])=>btn(label+' · '+groups[k].length,()=>show(k),'employee-section-button')))));
   const open=groups.training.filter(x=>['active','planned','in_progress'].includes(x.state));if(open.length)body.append(pane('Действующее обучение',recordsTable(open.slice(0,10))));
   const active=groups.matrices.filter(x=>x.state==='active');if(active.length)body.append(pane('Действующие матрицы',recordsTable(active)));return
  }
  const title=employeeTabs.find(x=>x[0]===key)?.[1]||key,items=groups[key],section=pane(title);
  const search=fieldInput('employee_related_search','','search');search.placeholder='Поиск по названию, роли, дате';const out=el('div');
  const draw=()=>{const q=search.value.trim().toLocaleLowerCase('ru-RU'),list=items.filter(r=>[r.title,r.role,r.date,employeeStates[r.state]||r.state,r.extra].join(' ').toLocaleLowerCase('ru-RU').includes(q));out.replaceChildren(list.length?recordsTable(list):el('p','Нет связанных записей по выбранным условиям.','muted'))};search.oninput=draw;section.append(search,out);draw();
  if(key==='matrices'&&!p.archived)section.append(btn('Создать матрицу с сотрудником',()=>employeeDestination(id,{page:'skills',options:{mode:'builder',personId:id}}),'primary'));
  if(key==='training'&&!p.archived)section.append(btn('Назначить обучение',()=>employeeDestination(id,{page:'twi',options:{mode:'new',traineeId:id}}),'primary'));
  if(key==='assessments')section.append(btn('Журнал практических оценок',()=>employeeDestination(id,{page:'practical',options:{personId:id}})),...(!p.archived?[btn('Новая практическая оценка',()=>employeeDestination(id,{page:'practical',options:{mode:'new',personId:id}}),'primary')]:[]));
  if(key==='mentoring')section.append(btn('Аудиты L1',()=>employeeDestination(id,{page:'audit',options:{personId:id}})),btn('Самооценки',()=>employeeDestination(id,{page:'self_eval',options:{personId:id}})),btn('Сопоставление с аудитами',()=>employeeDestination(id,{page:'analytics',options:{assessmentType:'comparison',personId:id}})),...(!p.archived?[btn('Новая самооценка',()=>employeeDestination(id,{page:'self_eval',options:{mode:'new',personId:id}}))]:[]));
  if(key==='development'&&!p.archived)section.append(btn('Создать план развития',()=>employeeDestination(id,{page:'development',options:{mode:'new',personId:id}}),'primary'));
  if(key==='documents'){
   const sourceOut=el('div'),searchSources=btn('Найти связи в оригиналах СОП и ФРВ',async()=>{searchSources.disabled=true;sourceOut.replaceChildren(el('p','Проверяются ссылки в исходных файлах…','muted'));try{
    const result=await employeeSourceLinks(db,id,readContent,(done,total)=>{sourceOut.replaceChildren(el('p','Проверено '+done+' из '+total,'muted'))});
    if(employeeSelected!==id)return;employeeSources={id,result};drawSources(result)
   }catch(e){sourceOut.replaceChildren(el('p',e.message,'bad'))}finally{searchSources.disabled=false}});
   function drawSources(result){sourceOut.replaceChildren(el('p','Проверено исходников: '+result.scanned+'. Найдено связанных: '+result.items.length+'.','muted'));if(result.items.length)sourceOut.append(recordsTable(result.items));if(result.errors.length){const details=el('details');details.append(el('summary','Не удалось проверить: '+result.errors.length),...result.errors.map(e=>el('p',e,'warn')));sourceOut.append(details)}}
   section.append(pane('Сотрудник в полях исходных документов',el('p','Поиск по сохранённым идентификаторам: рабочая группа, согласующие, утверждающие, инструктор, обучаемый, исполнитель и наблюдатель ФРВ. Старые поля только с ФИО не связываются автоматически.','muted'),searchSources,sourceOut));if(employeeSources?.id===id)drawSources(employeeSources.result)
  }
  body.append(section)
 }
 function recordsTable(items){return tableOf(['Запись','Роль сотрудника','Дата','Состояние','Сведения',''],items.map(r=>[r.title,r.role,r.date,employeeStates[r.state]||r.state||'—',r.extra,r.dest?btn('Открыть',()=>employeeDestination(id,r.dest),'primary'):'—']))}
 for(const [key,title] of employeeTabs){const b=btn(title+(key==='overview'?'':' ('+groups[key].length+')'),()=>show(key),'library-tab');b.dataset.tab=key;nav.append(b)}
 main.append(nav,body);show(employeeTab)
}
function registry(main,type){
 if(type==='person'&&employeeSelected){employeeCard(main,employeeSelected);return}
 const d=definitions[type],items=list(ws.working,type),search=el('input');search.type='search';search.placeholder='Поиск по справочнику';search.value=query;
 const filter=el('select');for(const [value,label] of [['active',d.history?'Действующие':'Активные'],['all','Все записи'],['inactive',d.history?'История / будущие':'Архив']]){const o=el('option',label);o.value=value;filter.append(o)}filter.value=archiveFilter;
 const panel=pane(d.label,add(el('div',undefined,'row'),search,filter,btn('Добавить',()=>{edit=historyPerson?{person_id:historyPerson}:{};render()},'primary',!!ws.conflicts.length),btn('Импорт Excel',()=>openImport(type))));
 main.append(panel);
 if(historyPerson)panel.append(add(el('div',undefined,'row'),el('span','История сотрудника: '+refName('person',historyPerson),'pill'),btn('Все сотрудники',()=>{historyPerson=null;render()})));
 if(edit!==null)panel.append(pane(edit.id?'Редактирование':'Новая запись',form(type,edit)));
 const wrap=el('div',undefined,'tablewrap');panel.append(wrap);
 function draw(){
  wrap.replaceChildren();
  const data=items.filter(v=>(!historyPerson||v.person_id===historyPerson)&&(archiveFilter==='all'||(archiveFilter==='active'?activeRecord(d,v):!activeRecord(d,v)))&&Object.entries(d.fields).some(([k,f])=>String(showVal(k,f,v)).toLowerCase().includes(query.toLowerCase())));
  if(!data.length){wrap.append(el('p','Нет записей','empty'));return}
  const fields=Object.entries(d.fields).filter(([,f])=>!f.legacy);
  const t=el('table'),head=el('tr');for(const [,f] of fields)head.append(el('th',f.label));if(type==='person')head.append(el('th','Подразделение'),el('th','Должность'));head.append(el('th','Версия / статус'),el('th','Действия'));t.append(add(el('thead'),head));
  const body=el('tbody'),directory=type==='person'?new Map(directoryPeople(ws.working,today()).map(p=>[p.id,p])):null;for(const v of data){const tr=el('tr',undefined,!activeRecord(d,v)?'archive':'');for(const [k,f] of fields)tr.append(type==='person'&&k==='display_name'?add(el('td'),btn(v.display_name,()=>openEmployee(v.id),'employee-name-link')):el('td',String(showVal(k,f,v)),f.multiline?'multiline-cell':''));if(type==='person'){const p=directory.get(v.id);tr.append(el('td',p?.unit||'—'),el('td',p?.position||'—'))}
   const state=v.archived?'Архив':d.history?(v.valid_from>today()?'Будущее':v.valid_to&&v.valid_to<today()?'Завершено':'Действует'):'Активно';
   tr.append(el('td',state+' · v'+v.rev));const a=el('td');if(type==='person')a.append(btn('Карточка',()=>openEmployee(v.id),'primary'));
   if(!v.archived){if(!d.immutable&&(!d.history||!v.valid_to))a.append(btn(d.history?'Закрыть / изменить':'Изменить',()=>{edit=v;render()},'',!!ws.conflicts.length));if(d.immutable)a.append(btn('Новая версия',()=>{edit={name:v.name,version_no:String(Math.max(...items.filter(x=>x.name===v.name).map(x=>x.version_no))+1),levels:v.levels};render()},'',!!ws.conflicts.length));
    if(!d.history)a.append(btn('Архив',()=>{if(confirm('Архивировать запись? История сохранится.'))run(async()=>{ws.edit(type,v.id,null,'archive');return 'Запись архивирована'})},'danger',!!ws.conflicts.length));
    // All employee-related sections are opened from the dossier.
   }tr.append(a);body.append(tr)
  }t.append(body);wrap.append(t)
 }
 search.oninput=()=>{query=search.value;draw()};filter.onchange=()=>{archiveFilter=filter.value;draw()};draw();
 if(type==='org_unit')orgTree(panel,items)
}
function downloadBytes(name,bytes){const url=URL.createObjectURL(new Blob([bytes],{type:name.endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function updateMapping(s){s.plan=null;s.mapping=s.book?autoMap(s.type,sheetHeaders(s.book.worksheets[s.sheet],s.header)):{}}
function importScreen(main){
 main.append(pane('Импорт RC1 и мобильных аудитов',btn('Открыть импорт аудитов',()=>goTraining('audit_import'),'primary')));
 const s=importState||(importState={type:'person',book:null,sheet:0,header:1,mapping:{},allowUpdates:false,plan:null,file:''});
 const kind=el('select');kind.name='import_type';for(const [key,d] of Object.entries(definitions)){const o=el('option',d.label);o.value=key;kind.append(o)}kind.value=s.type;kind.onchange=()=>{s.type=kind.value;try{updateMapping(s)}catch(e){message(e.message,true);s.mapping={}}render()};
 const load=el('input');load.type='file';load.accept='.xlsx';load.name='import_file';
 load.onchange=()=>{const f=load.files?.[0];if(!f)return;if(busy){load.value='';return}
  // Invalidate the old workbook AND preview before any asynchronous parsing.
  Object.assign(s,{book:null,plan:null,file:'',sheet:0,header:1,mapping:{}});
  run(async()=>{invariant(/\.xlsx$/i.test(f.name)&&f.size<=MAX_XLSX,'Выберите XLSX до 20 МБ');const book=await loadWorkbook(window.ExcelJS,await f.arrayBuffer());const mapping=autoMap(s.type,sheetHeaders(book.worksheets[0],1));Object.assign(s,{book,file:f.name,sheet:0,header:1,mapping});return 'Excel открыт. Настройте соответствие колонок.'},{save:false})
 };
 const setup=pane('1. Выбор справочника и файла',add(el('div',undefined,'formgrid'),add(el('label',undefined,'field'),el('span','Справочник'),kind),add(el('label',undefined,'field'),el('span','Excel (.xlsx)'),load)),add(el('div',undefined,'row'),btn('Скачать шаблон XLSX',()=>run(async()=>{downloadBytes('LeanCenter-'+s.type+'.xlsx',await makeTemplate(window.ExcelJS,s.type));return 'Шаблон сформирован'},{save:false})),btn('Очистить импорт',()=>openImport(s.type))),el('p',s.file?'Открыт файл: '+s.file:'Сначала выберите файл. Данные не изменятся до подтверждения импорта.','muted'));main.append(setup);
 if(!s.book)return;
 const select=el('select');select.name='import_sheet';for(const [i,sheet] of s.book.worksheets.entries()){const o=el('option',sheet.name);o.value=String(i);select.append(o)}select.value=String(s.sheet);select.onchange=()=>{s.sheet=Number(select.value);try{updateMapping(s)}catch(e){message(e.message,true);s.mapping={}}render()};
 const hdr=el('input');hdr.type='number';hdr.name='header_row';hdr.min=1;hdr.max=20;hdr.value=s.header;hdr.onchange=()=>{const v=Number(hdr.value);if(Number.isInteger(v)&&v>=1&&v<=20){s.header=v;try{updateMapping(s)}catch(e){message(e.message,true);s.mapping={}}render()}};
 const updates=el('input');updates.type='checkbox';updates.name='allow_updates';updates.checked=s.allowUpdates;updates.onchange=()=>{s.allowUpdates=updates.checked;s.plan=null;render()};
 const mapPanel=pane('2. Лист и соответствие колонок',add(el('div',undefined,'formgrid'),add(el('label',undefined,'field'),el('span','Лист'),select),add(el('label',undefined,'field'),el('span','Строка заголовков (1–20)'),hdr)),el('p','Коды должны быть текстом в Excel. Ссылки — по кодам, не по ФИО. Для операций допустимо подразделение/код. Неназначенные колонки при обновлении сохраняют прежнее значение. Пустая назначенная колонка очищает необязательное поле.','muted'));
 main.append(mapPanel);let headers;try{headers=sheetHeaders(s.book.worksheets[s.sheet],s.header)}catch(e){mapPanel.append(el('p',e.message,'bad'));return}
 const grid=el('div',undefined,'formgrid');for(const [key,f] of importFields(s.type)){const input=el('select');input.name='map_'+key;const blank=el('option','— Не импортировать —');blank.value='';input.append(blank);for(const h of headers){const o=el('option',h.col+' · '+h.name);o.value=String(h.col);input.append(o)}input.value=String(s.mapping[key]||'');input.onchange=()=>{s.mapping[key]=Number(input.value)||null;s.plan=null;render()};grid.append(add(el('label',undefined,'field'),el('span',fieldLabel(s.type,key)+(f.required?' *':'')),input))}
 mapPanel.append(grid,add(el('label',undefined,'row'),updates,el('span','Разрешить обновление совпадающих ключей (после предпросмотра)')),btn('Предварительная проверка',()=>run(async()=>{s.plan=null;const cols=Object.values(s.mapping).filter(Boolean);invariant(cols.length>0&&new Set(cols).size===cols.length,'Назначьте каждой колонке только одно поле');s.plan=planImport(ws,s.type,sheetRows(s.book.worksheets[s.sheet],s.header,s.mapping),{allowUpdates:s.allowUpdates});return 'Предпросмотр готов. Запись в базу ещё не выполнена.'},{save:false}),'primary'));
 if(!s.plan)return;
 const p=s.plan,c=p.counts;
 const report=pane('3. Результат проверки',el('p','Файл: '+s.file+' · Лист: '+s.book.worksheets[s.sheet].name,'muted'),add(el('div',undefined,'row'),el('span','Создать: '+c.create,'pill'),el('span','Обновить: '+c.update,'pill'),el('span','Без изменений: '+c.same,'pill'),el('span','Ошибки: '+c.error,c.error?'bad':'pill')));
 const t=el('table'),head=el('tr');for(const h of ['Строка Excel','Решение','Проверка / изменения'])head.append(el('th',h));t.append(add(el('thead'),head));const body=el('tbody');
 for(const v of p.results){const details=el('div');details.append(el('div',v.message,v.status==='error'?'bad':'muted'));for(const ch of v.changes){details.append(el('div',ch.field+': '+(ch.before??'—')+' → '+(ch.after??'—'),'preview-detail'))}body.append(add(el('tr'),el('td',String(v.row)),el('td',({create:'Создать',update:'Обновить',same:'Без изменений',error:'Ошибка'})[v.status]),add(el('td'),details)))}t.append(body);
 report.append(add(el('div',undefined,'tablewrap'),t),el('p',c.error?'Импорт заблокирован. Исправьте все ошибки и повторите проверку.':'Будут записаны только проверенные изменения, одной транзакцией.','muted'),btn('Импортировать '+p.events.length+' изменений',()=>{if(confirm('Записать проверенные изменения в локальную базу?'))run(async()=>{invariant(s.plan===p&&s.book,'Предпросмотр устарел; выберите файл и повторите проверку');const n=commitImport(ws,p);s.plan=null;return 'Импортировано изменений: '+n})},'primary',!!c.error||!p.events.length||!!ws.conflicts.length));main.append(report)
}
const revisionLabels={draft:'Черновик',review:'На согласовании',approved:'Согласован',effective:'Действует',superseded:'Заменён',withdrawn:'Выведен из действия',final:'Завершено',archived:'Архив'};
function inputField(label,input){return add(el('label',undefined,'field'),el('span',label),input)}
function fieldInput(name,value='',type='text'){const n=el('input');n.name=name;n.type=type;n.value=value??'';return n}
function selectRef(type,name,id=null,optional=true){
 const s=el('select');s.name=name;if(optional){const o=el('option','— Не выбрано —');o.value='';s.append(o)}
 for(const v of list(ws.working,type).filter(x=>!x.archived||x.id===id)){const o=el('option',refOption(type,v));o.value=v.id;s.append(o)}s.value=id||'';return s
}
function personPickerField(name,label,id=null,{optional=true,historicalName='',allowed=null}={}){
 const wrap=el('div'),trigger=btn('Выбрать сотрудника ▾',()=>openPeopleDropdown(trigger,{people:editorPeople,allowed,optional,selectedId:value,label,onChoose:p=>{value=p?.id||'';selectedName=p?.display_name||'';update()}}),'lc-directory-trigger');
 trigger.name=name;trigger.setAttribute('aria-label','Выбрать: '+label);trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
 let value=id||'',selectedName=id?(one(ws.working,'SELECT display_name FROM person WHERE id=?',[id])?.display_name||historicalName):'';
 function update(){trigger.textContent=(selectedName||'Выбрать сотрудника')+' ▾'}
 Object.defineProperties(wrap,{value:{get:()=>value},selectedName:{get:()=>selectedName},disabled:{get:()=>trigger.disabled,set:v=>{trigger.disabled=!!v}}});wrap.append(trigger);update();return wrap
}
function personInputField(label,picker){return add(el('div',undefined,'field'),el('span',label),picker)}
function downloadRaw(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function contentEvent(type,payload){return {id:uuid(),entity_type:type,entity_id:uuid(),operation:'create',expected_revision:0,payload,occurred_at:new Date().toISOString()}}
function tableOf(headers,data){
 const t=el('table'),h=el('tr');headers.forEach(v=>h.append(el('th',v)));t.append(add(el('thead'),h));const body=el('tbody');
 for(const r of data){const tr=el('tr');for(const v of r)tr.append(v instanceof Node?add(el('td'),v):el('td',String(v??'—')));body.append(tr)}t.append(body);return add(el('div',undefined,'tablewrap detail-table'),t)
}
function evaluationForm(revision,source){
 const methods=sopMethods(ws.working).filter(m=>m.state==='active'),builtin=methods.length?null:contentEvent('checklist_version',BUILTIN_SOP);
 if(builtin)methods.push({id:builtin.entity_id,version_no:1,builtin:true});
 const panel=el('div'),select=el('select');for(const m of methods){const o=el('option',m.builtin?'Встроенная форма · Приложение 4':'Методика v'+m.version_no);o.value=m.id;select.append(o)}
 const actor=personPickerField('eval_actor','Оценщик',null,{optional:false}),day=fieldInput('eval_date',today(),'date'),place=fieldInput('eval_place',revision.workplace_name||''),content=el('div');
 panel.append(add(el('div',undefined,'formgrid'),inputField('Версия методики',select),personInputField('Оценщик',actor),inputField('Дата',day),inputField('Место',place)),content);
 function draw(){
  content.replaceChildren();const criteria=builtin?previewCriteria(BUILTIN_SOP,builtin.entity_id):sopCriteria(ws.working,select.value),total=criteria.length,values=criteria.map(c=>{const choice=el('select');choice.name='criterion_'+c.position;for(const [v,n] of [['','Не оценено'],['1','1 — выполнено'],['0','0 — не выполнено']]){const o=el('option',n);o.value=v;choice.append(o)}const note=fieldInput('note_'+c.position);note.maxLength=2000;return {c,choice,note}});
  const analysis=el('div',undefined,'panel lc53-analysis'),progress=el('p','Оценено: 0 из '+total,'muted'),save=btn('Зафиксировать оценку',()=>run(async()=>{const payload={revision_id:revision.id,method_id:select.value,actor_id:actor.value,evaluated_on:day.value,place:place.value,source_sha256:source.sha256,responses:values.map(v=>({criterion_id:v.c.id,value:v.choice.value===''?null:Number(v.choice.value),note:v.note.value}))};await ws.applyContentEvents([...(builtin?[builtin]:[]),contentEvent('sop_evaluation',payload)]);return 'Оценка СОП сохранена. Ожидает публикации.'}),'primary',true);
  function update(){const result=evaluationResult(values.map(x=>({value:x.choice.value===''?null:Number(x.choice.value)})),total);progress.textContent='Оценено: '+result.rated+' из '+total+' · '+(result.fraction===null?'итог пока не рассчитан':(result.fraction*100).toFixed(0)+'%');save.disabled=busy||result.rated!==total||!!ws.conflicts.length;renderAssessmentAnalysis(analysis,assessmentAnalysis(criteria,values.map(x=>({criterion_id:x.c.id,value:x.choice.value===''?null:Number(x.choice.value),note:x.note.value})),'sop_evaluation'),{onMissing:q=>values.find(x=>x.c.id===q.id)?.choice.focus()})}
  values.forEach(v=>v.choice.onchange=update);update();
  content.append(tableOf(['№','Проверяемое требование','Оценка','Комментарий'],values.map(v=>[v.c.position,v.c.question,v.choice,v.note])),progress,analysis,el('p','Результат — выполненные требования / '+total+'. Порог зачёта не установлен; оценка не утверждает СОП автоматически.','muted'),save)
 }
 select.onchange=()=>{if(!confirm('Сменить версию методики? Незавершённые ответы будут очищены.')){select.value=select.dataset.previous;return}select.dataset.previous=select.value;draw()};select.dataset.previous=select.value;draw();return panel
}
async function evaluationXlsx(id){
 const e=one(ws.working,'SELECT * FROM sop_evaluation WHERE id=?',[id]),v=one(ws.working,'SELECT * FROM document_revision WHERE id=?',[e.revision_id]),doc={...one(ws.working,'SELECT * FROM document WHERE id=?',[v.document_id]),title:documentTitle(ws.working,v.document_id,v.id)};
 const responses=rows(ws.working,'SELECT c.position,c.question,r.value,r.note FROM sop_evaluation_response r JOIN checklist_criterion c ON c.id=r.criterion_id WHERE r.evaluation_id=? ORDER BY c.position',[id]);const method=one(ws.working,'SELECT version_no FROM checklist_version WHERE id=?',[e.method_id]);
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('Оценка СОП',{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 s.columns=[{width:7},{width:105},{width:13},{width:48}];s.mergeCells('A1:D1');s.getCell('A1').value='Чек-лист оценки СОП';s.getCell('A1').font={bold:true,size:16};s.mergeCells('A2:D2');s.getCell('A2').value=doc.code+' · '+doc.title+' · версия '+v.version_no;s.mergeCells('A3:D3');s.getCell('A3').value='Место: '+e.place+'    Дата: '+e.evaluated_on+'    Оценщик: '+e.actor_name+'    Методика v'+method.version_no;s.mergeCells('A4:D4');s.getCell('A4').value='Исходный SHA-256: '+e.source_sha256;
 s.addRow(['№ п/п','Проверяемые требования','Оценка','Комментарий']);s.getRow(5).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF242E40'}};
 for(const x of responses){const row=s.addRow([x.position,x.question,x.value,x.note]);row.alignment={vertical:'top',wrapText:true};row.height=Math.max(28,15*Math.ceil(Math.max(x.question.length/100,(x.note||'').length/43)))}
 const total=sopCriteria(ws.working,e.method_id).length,result=evaluationResult(responses,total),row=s.addRow(['','ИТОГО',{formula:'SUM(C6:C'+(5+total)+')/'+total,result:result.fraction},'']);row.getCell(3).numFmt='0%';s.pageSetup.printArea='A1:D'+(6+total);downloadBytes('Оценка-СОП-'+doc.code+'-v'+v.version_no+'.xlsx',await w.xlsx.writeBuffer());
}
function evaluationHistory(revision,source){
 const data=rows(ws.working,'SELECT e.*,m.version_no AS method_version FROM sop_evaluation e JOIN checklist_version m ON m.id=e.method_id WHERE e.revision_id=? ORDER BY e.evaluated_on DESC,e.recorded_at DESC',[revision.id]);
 const out=el('div');if(!data.length)out.append(el('p','Оценок этой версии ещё нет.','muted'));
 else out.append(tableOf(['Дата','Оценщик','Методика','Результат','Исходник','Отчёт',''],data.map(e=>{const r=evaluationResult(rows(ws.working,'SELECT value FROM sop_evaluation_response WHERE evaluation_id=?',[e.id]),sopCriteria(ws.working,e.method_id).length);return [e.evaluated_on,e.actor_name,'v'+e.method_version,r.yes+'/'+r.total+' · '+(r.fraction*100).toFixed(0)+'%',e.source_sha256===source.sha256?'Текущий':'Предыдущий черновик',btn('Скачать XLSX',()=>run(async()=>{await evaluationXlsx(e.id);return 'Отчёт сформирован'},{save:false})),btn('Открыть оценку',()=>goTraining('sop_review',{kind:'sop_evaluation',id:e.id}))]})));return out
}
function goEvaluation(id){navigate('sop_evaluation');evaluationSelected=id;render()}
const stage43SourceLabels={seed:'Стартовое значение',auto:'Автоматически',manual:'Вручную',legacy:'Из исходника'};
const weightedLabel=data=>{const x=weightedResult(data);return 'Взвешенный результат: '+(x.fraction===null?'—':(x.fraction*100).toFixed(1)+'%')+' ('+x.points.toFixed(2)+' / '+x.weight.toFixed(2)+')'+(x.seed?' · Стартовых оценок: '+x.seed+'; результат предварительный':'')};
async function stage43Xlsx(doc,revision,source,data,actorName){
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('Чек-лист Stage43',{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 s.columns=[{width:7},{width:84},{width:12},{width:10},{width:12},{width:48},{width:23}];
 s.mergeCells('A1:G1');s.getCell('A1').value='Чек-лист оценки СОП — Stage43 (13 критериев)';s.getCell('A1').font={bold:true,size:15};
 s.mergeCells('A2:G2');s.getCell('A2').value=doc.code+' · '+doc.title+' · версия '+revision.version_no;
 s.mergeCells('A3:G3');s.getCell('A3').value='SHA-256: '+source.sha256+' · '+(actorName||'Оценщик не указан');
 s.addRow(['№','Требование','Оценка','Вес','Балл','Комментарий','Источник']);s.getRow(4).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(4).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF242E40'}};
 data.forEach((x,i)=>{const n=i+5,row=s.addRow([x.id,x.req,x.score,x.weight,{formula:'C'+n+'*D'+n,result:x.score*x.weight},x.comment,stage43SourceLabels[x.scoreSource]]);row.alignment={vertical:'top',wrapText:true};row.height=Math.max(28,15*Math.ceil(Math.max(x.req.length/75,x.comment.length/43)))});
 const r=weightedResult(data),total=s.addRow(['','ИТОГО','',{formula:'SUM(D5:D17)',result:r.weight},{formula:'SUM(E5:E17)',result:r.points},'','']);total.font={bold:true};
 const result=s.addRow(['','Взвешенный результат',{formula:'E18/D18',result:r.fraction},'','','','']);result.getCell(3).numFmt='0.0%';
 s.mergeCells('A20:G20');s.getCell('A20').value=r.seed?'Стартовые оценки не подтверждены: '+r.seed+'; результат предварительный.':'Отдельная методика Stage43; не корпоративская бинарная оценка.';
 s.pageSetup.printArea='A1:G20';downloadBytes('Чек-лист-Stage43-'+doc.code+'-v'+revision.version_no+'.xlsx',await w.xlsx.writeBuffer())
}
function stage43Panel(doc,revision,source){
 const panel=pane('Чек-лист конструктора СОП · 13 критериев',el('p','Загрузка сохранённого чек-листа…','muted'));
 void(async()=>{try{
  const raw=JSON.parse(await readContent(source)),original=stage43Checklist(raw.constructor);
  if(!panel.isConnected)return;
  panel.replaceChildren(el('h2','Чек-лист конструктора СОП · 13 критериев'),el('p','Привязан к точному исходнику версии '+revision.version_no+'. Шкала 0 / 0,3 / 0,7 / 1 и веса сохранены. Не является 20-пунктной корпоративской оценкой.','muted'));
  const records=stage43Checks(ws.working,revision.id),old=records.find(x=>x.source_sha256===source.sha256);
  if(!original.length){panel.append(el('p','В исходном JSON нет чек-листа. Сохраните СОП из конструктора с чек-листом.','muted'));appendHistory();return}
  const data=old?JSON.parse(old.rows_json):original,items=[],analysis=el('div',undefined,'panel lc53-analysis'),progress=el('p',weightedLabel(data),'muted'),actor=personPickerField('stage43_actor','Оценщик чек-листа',old?.actor_id||null,{historicalName:old?.actor_name||''}),editable=!doc.archived&&!ws.conflicts.length;
  panel.append(el('p',old?'Сохранённая правка центра · '+old.updated_at.slice(0,10)+' · '+(old.actor_name||'оценщик не указан'):'Автоматически загружен из конструктора. Изменения ещё не сохранялись в центре.','muted'));
  const table=tableOf(['№','Требование','Оценка','Вес','Балл','Комментарий','Источник'],data.map(x=>{
   const select=el('select');select.name='stage43_score_'+x.id;
   for(const v of [0,.3,.7,1]){const o=el('option',String(v).replace('.',','));o.value=String(v);select.append(o)}select.value=String(x.score);select.disabled=!editable;
   const note=fieldInput('stage43_note_'+x.id,x.comment);note.maxLength=2000;note.disabled=!editable;
   const cell=el('span',(x.score*x.weight).toFixed(2)),origin=el('span',stage43SourceLabels[x.scoreSource],'muted'),item={x,select,note,cell,origin,changed:false};items.push(item);
   select.onchange=()=>{item.changed=true;refresh()};note.oninput=refresh;return [x.id,x.req,select,x.weight,cell,note,origin]
  }));
  const current=()=>items.map(({x,select,note,changed})=>({...x,score:Number(select.value),comment:note.value,scoreSource:changed?'manual':x.scoreSource}));
  function refresh(){const value=current();value.forEach((x,i)=>{items[i].cell.textContent=(x.score*x.weight).toFixed(2);items[i].origin.textContent=stage43SourceLabels[x.scoreSource]});progress.textContent=weightedLabel(value);renderAssessmentAnalysis(analysis,assessmentAnalysis(value.map(x=>({...x,position:x.id,question:x.req,section_code:'Взвешенные требования'})),value.map(x=>({criterion_id:x.id,value:x.score,note:x.comment})),'weighted'))}
  const save=btn('Сохранить чек-лист СОП',()=>run(async()=>{const payload={revision_id:revision.id,source,rows:current(),actor_id:actor.value||null};const e=old?{...contentEvent('sop_stage43_checklist',payload),entity_id:old.id,operation:'update',expected_revision:old.rev}:contentEvent('sop_stage43_checklist',payload);await ws.applyContentEvents([e],readContent);evaluationSelected=revision.id;evaluationTab='weighted';page='sop_evaluation';return 'Чек-лист СОП сохранён. Ожидает публикации.'}),'primary',!editable);
  refresh();actor.disabled=!editable;panel.append(personInputField('Оценщик (необязательно)',actor),table,progress,analysis,el('p','Правки оценки не изменяют исходный СОП, его паспорт или статус. Для актуального печатного чек-листа скачайте отчёт здесь; исходный XLSX Stage43 сохраняет первоначальную оценку.','muted'),add(el('div',undefined,'row'),save,btn('Скачать чек-лист XLSX',()=>run(async()=>{await stage43Xlsx(doc,revision,source,current(),actor.selectedName);return 'Чек-лист XLSX сформирован'},{save:false}))));
  appendHistory();
  function appendHistory(){
   const snapshots=weightedHistory(ws.working,revision.id);if(snapshots.length)panel.append(pane('История сохранённых оценок (включая правки)',tableOf(['Дата','Оценщик','Результат',''],snapshots.map(x=>[x.date,refName('person',x.actor_id),pctText(x.score.fraction===null?null:x.score.fraction*100),btn('Открыть оценку',()=>goTraining('sop_review',{kind:'weighted_sop',id:x.id}))]))));
   const previous=records.filter(x=>x.source_sha256!==source.sha256);
   for(const x of previous){const data=JSON.parse(x.rows_json),d=el('details');d.append(el('summary','История · прежний исходник · '+x.updated_at.slice(0,10)),el('p',weightedLabel(data)+' · '+(x.actor_name||'оценщик не указан'),'muted'),el('p','SHA-256: '+x.source_sha256,'source-hash'),tableOf(['№','Требование','Оценка','Вес','Комментарий'],data.map(y=>[y.id,y.req,y.score,y.weight,y.comment])));panel.append(d)}
  }
 }catch(e){if(panel.isConnected)panel.replaceChildren(el('h2','Чек-лист конструктора СОП'),el('p',e.message,'bad'))}})();
 return panel
}
function evaluationDetail(doc,v,source,{registry=false}={}){
 const active=sopMethods(ws.working).find(m=>m.state==='active'),count=active?sopCriteria(ws.working,active.id).length:BUILTIN_SOP.criteria.length;
 const root=el('div'),tabs=el('div',undefined,'library-tabs evaluation-tabs'),content=el('div',undefined,'evaluation-content'),panels=new Map(),buttons=new Map();
 function show(kind){
  if(registry)evaluationTab=kind;
  if(!panels.has(kind)){const body=kind==='weighted'?stage43Panel(doc,v,source):pane('Корпоративская оценка · '+count+' критериев',evaluationHistory(v,source),...(!v.archived?[evaluationForm(v,source)]:[]));panels.set(kind,body);content.append(body)}
  for(const [k,body] of panels)body.hidden=k!==kind;
  for(const [k,b] of buttons){b.classList.toggle('selected',k===kind);b.setAttribute('aria-pressed',String(k===kind))}
 }
 for(const [kind,name] of [['weighted','Чек-лист (13 критериев)'],['corporate','Корпоративская оценка ('+count+' критериев)']]){const b=btn(name,()=>show(kind),'library-tab');buttons.set(kind,b);tabs.append(b)}
 root.append(tabs,content);show(registry?evaluationTab:'weighted');return root
}
function evaluationRegistry(){
 const p=pane('Реестр оценок СОП'),options=relatedRevisions(),v=options.find(x=>x.id===evaluationSelected);
 if(v){
  const doc={...v,id:v.doc_id},source=JSON.parse(v.payload_json).source;
  p.append(add(el('div',undefined,'row'),btn('К списку оценок',()=>{evaluationSelected=null;evaluationTab='weighted';render()}),btn('Карточка СОП',()=>goDocument(doc.id,v.id))),el('h2',v.code+' · '+v.title+' · версия '+v.version_no),el('p','Операция: '+refName('operation',v.operation_id)+' · '+(v.archived?'Архив':revisionLabels[v.state]||v.state),'muted'),evaluationDetail(doc,v,source,{registry:true}));const evals=rows(ws.working,'SELECT id,evaluated_on FROM sop_evaluation WHERE revision_id=? ORDER BY evaluated_on DESC',[v.id]);if(evals.length)p.append(pane('Мероприятия по сохранённым оценкам',...evals.map(e=>btn('Создать мероприятие · '+e.evaluated_on,()=>goTraining('actions',{mode:'new',sourceKind:'sop_evaluation',sourceId:e.id})))));return p
 }
 const search=fieldInput('evaluation_search',evaluationSearch,'search'),out=el('div');search.placeholder='Поиск по коду, названию или операции';
 p.append(el('p','Откройте нужную редакцию СОП. Чек-лист конструктора и корпоративская оценка ведутся отдельно.','muted'),search,out);
 let generation=0;
 function draw(){
  const epoch=++generation,q=search.value.trim().toLocaleLowerCase('ru-RU');evaluationSearch=search.value;
  const list=options.filter(x=>[x.code,x.title,refName('operation',x.operation_id)].some(s=>String(s||'').toLocaleLowerCase('ru-RU').includes(q))),entries=[];
  if(!list.length){out.replaceChildren(el('p',options.length?'Нет СОП по заданному поиску.':'Сохраните СОП в каталоге, чтобы оценивать его версии.','muted'));return}
  const t=tableOf(['СОП','Операция','Версия','Статус СОП','Чек-лист (13)','Корпоративская оценка',''],list.map(v=>{
   const source=JSON.parse(v.payload_json).source,cell=el('span','Проверяется…','muted');
   const latest=one(ws.working,'SELECT * FROM sop_evaluation WHERE revision_id=? AND source_sha256=? ORDER BY evaluated_on DESC,recorded_at DESC LIMIT 1',[v.id,source.sha256]);
   const old=latest?null:one(ws.working,'SELECT id FROM sop_evaluation WHERE revision_id=? LIMIT 1',[v.id]);
   const result=latest?evaluationResult(rows(ws.working,'SELECT value FROM sop_evaluation_response WHERE evaluation_id=?',[latest.id]),sopCriteria(ws.working,latest.method_id).length):null;
   const corporate=latest?result.yes+'/'+result.total+' · '+(result.fraction*100).toFixed(0)+'%':old?'Только прежний исходник':'Не оценён';
   entries.push({v,source,cell});
   return [v.code+' · '+v.title,refName('operation',v.operation_id),v.version_no,v.archived?'Архив':revisionLabels[v.state]||v.state,cell,corporate,btn('Открыть',()=>{evaluationSelected=v.id;evaluationTab='weighted';render()},'primary')]
  }));
  out.replaceChildren(t);
  void(async()=>{for(const {v,source,cell} of entries){
   if(epoch!==generation||!out.isConnected)break;
   try{
    const saved=stage43Checks(ws.working,v.id).find(x=>x.source_sha256===source.sha256);
    const data=saved?JSON.parse(saved.rows_json):stage43Checklist(JSON.parse(await readContent(source)).constructor);
    if(epoch!==generation||!cell.isConnected)break;
    if(!data.length){cell.textContent='Нет чек-листа';continue}
    const result=weightedResult(data);cell.textContent=(result.fraction*100).toFixed(1)+'% · '+(result.seed?'Предварительно':saved?'Сохранён':'Из конструктора');
   }catch(e){cell.textContent='Исходник недоступен';cell.className='bad'}
  }})()
 }
 search.oninput=draw;draw();return p
}
function sopEvaluationScreen(main){
 const p=pane('Методики оценки СОП',el('p','Приложение 4 встроено и автоматически регистрируется при первой оценке. Можно загрузить новую версию из DOCX или JSON (1–100 критериев формата lean-sop-checklist-v2); прошлые результаты сохраняются.','muted'));
 p.append(btn('Импорт методики DOCX',()=>{const i=el('input');i.type='file';i.accept='.docx';i.onchange=()=>{const file=i.files?.[0];if(!file)return;run(async()=>{invariant(file.size<=12*1024*1024,'Файл слишком большой');const bytes=new Uint8Array(await file.arrayBuffer()),criteria=await sopCriteriaFromDocx(bytes),m=validateChecklist({format:criteria.length===20?'lean-sop-checklist-v1':'lean-sop-checklist-v2',title:file.name.slice(0,200),source_sha256:await sha256(bytes),criteria});if(!confirm(m.title+'\n'+criteria.length+' критериев. Добавить версию?\n\n'+criteria.map(x=>x.code+'. '+x.question).join('\n')))return 'Импорт отменён';await ws.applyContentEvents([contentEvent('checklist_version',m)]);return 'Методика добавлена, ожидает публикации.'})};i.click()},'primary',!!ws.conflicts.length));
 p.append(btn('Загрузить методику JSON',()=>{const i=el('input');i.type='file';i.accept='.json';i.onchange=()=>{if(!i.files?.[0])return;run(async()=>{invariant(i.files[0].size<=128000,'Слишком большой файл методики');const m=validateChecklist(JSON.parse(await i.files[0].text()));if(!confirm(m.title+'\n'+m.criteria.length+' критериев. Добавить неизменяемую версию методики?'))return 'Импорт отменён';await ws.applyContentEvents([contentEvent('checklist_version',m)]);return 'Методика добавлена, ожидает публикации.'})};i.click()},'primary',!!ws.conflicts.length));
 if(!sopMethods(ws.working).length)p.append(tableOf(['№','Требование'],BUILTIN_SOP.criteria.map(q=>[q.code,q.question])));
 for(const m of sopMethods(ws.working)){const data=JSON.parse(m.methodology_json),d=el('details');d.append(el('summary','Версия '+m.version_no+' · '+data.title+' · '+(m.state==='active'?'Действует':'Архив')),el('p','SHA-256 исходного документа: '+data.source_sha256,'source-hash'),tableOf(['№','Требование'],sopCriteria(ws.working,m.id).map(q=>[q.position,q.question])));p.append(d)}
 const methods=el('details',undefined,'panel evaluation-methods');methods.append(el('summary','Методики оценки СОП'),p);main.append(pane('Оценки и мероприятия',btn('Аналитика оценок СОП',()=>goTraining('analytics',{assessmentType:'sop'}))),evaluationRegistry(),methods)
}
function passportForm(c,revision){
 const form=el('form'),format=el('select');format.name='print_format';for(const [v,n] of [['','— Выберите —'],['portrait','А3 книжный (9 шагов)'],['landscape','А3 альбомный (12 шагов)']]){const o=el('option',n);o.value=v;format.append(o)}format.value=revision.print_format||'';
 const changed=fieldInput('changed_on',revision.changed_on||'','date');changed.required=true;format.required=true;const save=el('button','Сохранить паспорт','primary');save.type='submit';save.disabled=busy||!!ws.conflicts.length;
 form.onsubmit=e=>{e.preventDefault();run(async()=>{await ws.applyContentEvents([libraryEvent(c,{command:'passport',revision_id:revision.id,print_format:format.value,changed_on:changed.value})]);return 'Паспорт сохранён: срок пересмотра рассчитан от даты изменения.'})};
 form.append(add(el('div',undefined,'formgrid'),inputField('Формат печати',format),inputField('Фактическая дата изменения',changed)),el('p','Рабочее место и оборудование берутся из операции. Изменение исходника требует повторного подтверждения паспорта.','muted'),save);return form
}
function sourcePassport(data){
 const panel=el('div'),open=btn('Прочитать паспорт исходника',async()=>{open.disabled=true;try{const p=JSON.parse(await readContent(data.source)),s=p.constructor,m=s.meta||{};panel.replaceChildren(tableOf(['Реквизит','Значение'],[['Филиал',m.branch],['Подразделение',m.department],['Рабочее место',m.workplace],['Исполнители',m.executor],['Операция',m.operation],['Номер',m.sopNumber],['Дата',m.date],['Безопасность / СИЗ',m.safety],['Инструменты',m.tools],['Материалы',m.material],['Рабочая группа',(s.responsibles||[]).join('; ')],['Согласующие',(s.agreedList||[]).map(x=>[x.post,x.name].filter(Boolean).join(' ')).join('; ')],['Утверждающий',[m.approverPost,m.approverName].filter(Boolean).join(' ')]]))}catch(e){panel.append(el('p',e.message,'bad'));open.disabled=false}});
 panel.append(open);return panel
}
function materialsPanel(data){
 const panel=el('div'),button=btn('Показать фотографии шагов',async()=>{button.disabled=true;try{const p=JSON.parse(await readContent(data.source));const grid=el('div',undefined,'material-grid');for(const [i,s] of p.constructor.steps.entries()){const a=p.photoAssets[String(s.id)];if(!a)continue;const img=el('img');img.alt='Визуализация шага '+(i+1);img.loading='lazy';img.src=a.rendered||a.original;grid.append(add(el('figure'),img,el('figcaption',(i+1)+'. '+s.action)))}panel.replaceChildren(grid,el('p','В исходном JSON сохраняются оригиналы и разметка.','muted'))}catch(e){panel.append(el('p',e.message,'bad'));button.disabled=false}});panel.append(button);return panel
}
function constructorScreen(main){
 main.append(pane('Создание СОП',el('p','Создайте новый СОП или откройте существующий черновик из каталога. Импорт Excel и предпросмотр доступны в конструкторе.','muted'),btn('Создать СОП',()=>launchEditor(libraryContext('sop')),'primary',!!ws.conflicts.length),btn('Каталог СОП',()=>navigate('sop'))));
 if(editorSession&&editorSession.host.hidden)main.append(el('p','Открытая рабочая копия доступна через кнопку на верхней панели.','muted'))
}
function editableRevision(doc,rev){
 return !doc.archived&&(rev.state==='draft'||(['effective','superseded','withdrawn'].includes(rev.state)&&!one(ws.working,"SELECT id FROM document_revision WHERE document_id=? AND state IN ('draft','review','approved')",[doc.id])))
}
function relatedRevisions(){
 return rows(ws.working,`SELECT r.*,d.id doc_id,d.code,${REVISION_TITLE_SQL} title,d.archived,d.operation_id FROM document_revision r JOIN document d ON d.id=r.document_id WHERE d.kind='sop' ORDER BY d.code,r.version_no DESC`)
}
function frvOriginPanel(revision){
 const origin=frvOriginSnapshot(ws.working,revision.id),panel=el('div');
 if(!origin)return panel;
 const out=el('div'),open=btn('Показать исходные замеры ФРВ',async()=>{
  open.disabled=true;try{
   const raw=JSON.parse(await readContent(origin.source)),s=frvSummary(raw);
   out.replaceChildren(el('p','Сохранённое исследование: '+(raw.study.studyId||origin.title)+' · '+(raw.study.operationId||'')+' · '+(origin.current?'Текущий исходник':'Исторический исходник на момент передачи в СОП'),'muted'),
    tableOf(['Цикл','Группа','Измерено, сек','Полнота'],s.cycles.map(c=>[c.index,c.phase,c.seconds,c.complete?'Полный':'Неполный'])),
    el('p','Строк без измерения / действия: '+s.missing,'muted'));
  }catch(e){out.replaceChildren(el('p',e.message,'bad'));open.disabled=false}
 });
 panel.append(el('p','Источник СОП: '+origin.title+' · '+(origin.current?'Текущие замеры':'Исторические замеры; исследование изменялось после создания СОП'),'muted'),el('p','SHA-256 исходных замеров: '+origin.source.sha256,'source-hash'),add(el('div',undefined,'row'),open,btn('Скачать исходные замеры JSON',()=>run(async()=>{downloadRaw('FRV-исходник-'+origin.source.sha256.slice(0,12)+'.json',await readContent(origin.source));return 'Исходные замеры сформированы'},{save:false})),btn('Открыть текущее исследование ФРВ',()=>goResearch(origin.study_id))),out);
 return panel
}
function relatedPanel(doc,rev,kind){
 const data=JSON.parse(rev.payload_json),c=libraryContext('sop',doc.id,rev.id),out=el('div'),open=btn(kind==='frv'?'Показать ФРВ по СОП':'Показать план инструктажа TWI',async()=>{
  open.disabled=true;
  try{
   const raw=JSON.parse(await readContent(data.source)),source=raw.constructor;
   if(kind==='frv'){
    const x=linkedFrv(source),t=x.totals,n=v=>v===null?'—':Number(v.toFixed(2)).toLocaleString('ru-RU');
    out.replaceChildren(el('p','Расчёт по шагам СОП, версия '+rev.version_no+'. Это не самостоятельные фактические замеры.','muted'),
     tableOf(['Время, сек','ВДЦ, сек','М1, сек','М2, сек','Не распределено, сек','Перемещение, м'],[[n(t.seconds),n(t.vdc),n(t.m1),n(t.m2),n(t.unclassified),n(t.distance)]]),
     ...(x.invalid?[el('p','Некорректных строк: '+x.invalid+'. Их категории не включены в сумму.','bad')]:[]),
     tableOf(['№','Действие','Начало, сек','Время, сек','ВДЦ','М1','М2','Не распределено','Перемещение, м','Комментарий'],x.rows.map(q=>[q.position,q.action,n(q.start),n(q.seconds),n(q.vdc),n(q.m1),n(q.m2),n(q.unclassified),n(q.distance),q.valid?q.comment:'Проверьте исходные значения: '+q.comment])),
     el('p','Наблюдали: '+(x.meta.observers||'не указано'),'muted'));
    out.append(frvOriginPanel(rev));
   }else{
    const x=linkedTwi(source);
    out.replaceChildren(el('p','Статус: '+x.status+' · '+x.filled+' из 15 полей. План связан с версией '+rev.version_no+' и не является назначением обучения.',x.outdated?'warn':'muted'));
    if(x.exists)out.append(el('p','Инструктор: '+(x.trainer||'не указан')+' · Обучаемый: '+(x.trainee||'не указан'),'muted'),tableOf(['Раздел','Поле','Содержание'],x.fields.map(q=>[({prepare:'Подготовка',present:'Представление работы',tryOut:'Пробное выполнение',followUp:'Сопровождение'})[q.section],q.label,q.value||'—'])));
    else out.append(el('p','План ещё не создан. Сформируйте его из шагов СОП в редакторе.','muted'))
   }
  }catch(e){out.replaceChildren(el('p',e.message,'bad'));open.disabled=false}
 });
 const buttons=add(el('div',undefined,'row'),open,btn('Карточка СОП',()=>goDocument(doc.id,rev.id)));
 if(kind==='twi'&&rev.state==='effective'&&!doc.archived)buttons.append(btn('Назначить обучение',()=>goTraining('twi',{mode:'new',revisionId:rev.id}),'primary',!!ws.conflicts.length));
 if(editableRevision(doc,rev))buttons.append(btn(rev.state==='draft'?(kind==='frv'?'Редактировать ФРВ по СОП':'Открыть план TWI'):'Создать новую редакцию СОП',()=>openRelated(c,kind),'primary',!!ws.conflicts.length));
 return add(el('div'),buttons,out)
}
function linkedRegistry(main,kind){
 const filter=fieldInput('linked_search','','search');filter.placeholder='Поиск по коду, названию, операции';
 const out=el('div'),info=el('p',kind==='frv'?'ФРВ по СОП — расчёт по шагам, не результаты самостоятельных наблюдений.':'Планы привязаны к точной версии СОП. Отсутствующий план можно сформировать из черновика.', 'muted');
 main.append(pane(kind==='frv'?'ФРВ по СОП':'Реестр планов инструктажа TWI',info,filter,out));
 let drawGeneration=0;
 function draw(){
  const epoch=++drawGeneration,q=filter.value.trim().toLowerCase(),data=relatedRevisions().filter(v=>[v.code,v.title,refName('operation',v.operation_id)].some(x=>String(x||'').toLowerCase().includes(q)));
  if(!data.length){out.replaceChildren(el('p','Нет связанных редакций СОП.','muted'));return}
  const body=el('div'),entries=[];
  const t=tableOf(['СОП','Операция','Версия','Статус СОП',kind==='frv'?'Источник':'План',''],data.map(v=>{
   const cell=el('span',kind==='frv'?'Шаги СОП':'Проверяется…','muted');
   entries.push({v,cell});
   return [v.code+' · '+v.title,refName('operation',v.operation_id),v.version_no,v.archived?'Архив':revisionLabels[v.state]||v.state,cell,btn('Открыть',()=>{body.replaceChildren(pane(v.code+' · '+v.title+' · v'+v.version_no,relatedPanel({...v,id:v.doc_id},v,kind)))},'primary')]
  }));
  out.replaceChildren(t,body);
  if(kind==='twi')void(async()=>{
   for(const {v,cell} of entries){
    if(epoch!==drawGeneration||!out.isConnected)break;
    try{const raw=JSON.parse(await readContent(JSON.parse(v.payload_json).source));cell.textContent=linkedTwi(raw.constructor).status}catch(e){cell.textContent='Исходник недоступен';cell.className='bad'}
   }
  })()
 }
 filter.oninput=draw;draw()
}
function twiPlansScreen(main){linkedRegistry(main,'twi')}
function frvAnalysisPanel(v,data){
 const panel=el('div'),button=btn('Показать измерения и анализ',async()=>{button.disabled=true;try{const raw=JSON.parse(await readContent(data.source)),s=frvSummary(raw),n=x=>x===null?'—':Number(x.toFixed(2)).toLocaleString('ru-RU');
 panel.replaceChildren(tableOf(['Категория','Секунды','Минуты'],Object.entries(s.totals).map(([k,x])=>[({VA:'ВДЦ',NVA_Necessary:'М2',NVA_Waste:'М1',WAIT:'Ожидание',BREAK:'Перерыв',OTHER:'Не классифицировано'})[k],n(x),n(x/60)])),tableOf(['Группа','Полных циклов','Среднее, сек'],[['До',s.baselineCount,n(s.before)],['После',s.improvedCount,n(s.after)]]),el('p','Неполных строк: '+s.missing+' · '+(s.comparable?'Подтверждено сравнение: разница '+n(s.delta)+' сек ('+n(s.percent)+'%)':'Эффект не рассчитан: требуется сопоставимость и полные циклы до/после.'),'muted'),tableOf(['Цикл','Группа','Измерено, сек','Полнота'],s.cycles.map(x=>[x.index,x.phase,n(x.seconds),x.complete?'Полный':'Неполный'])));
 }catch(e){panel.append(el('p',e.message,'bad'));button.disabled=false}});
 const transfer=btn('Создать проект СОП из сохранённого ФРВ',async()=>{
  if(busy)return;
  transfer.disabled=true;
  try{invariant(!libraryDraft,'Сначала завершите текущий предпросмотр');const d=await draftFromFrv(await readContent(data.source));launchEditor({...libraryContext('sop'),operation_id:v.operation_id,seedText:d.text,origin:{study_id:v.id,source_sha256:data.source.sha256}})}
  catch(e){message(e.message,true)}finally{transfer.disabled=false}
 },'primary',!!ws.conflicts.length);
 return add(el('div'),panel,add(el('div',undefined,'row'),button,...(v.state!=='archived'?[transfer]:[])))
}
function libraryContext(kind,id=null,revisionId=null){
 const row=id?one(ws.working,'SELECT * FROM '+(kind==='sop'?'document':'frv_study')+' WHERE id=?',[id]):null;
 const revision=kind==='sop'&&revisionId?one(ws.working,'SELECT * FROM document_revision WHERE id=? AND document_id=?',[revisionId,id]):null;
 invariant(!id||row,'Запись не найдена');invariant(!revisionId||revision,'Версия не найдена');
 return {kind,id,revisionId,expected:row?.rev||0,database:meta(ws.base,'database_id'),title:kind==='sop'&&row?documentTitle(ws.working,id,revisionId):row?.title||'',code:row?.code||'',operation_id:row?.operation_id||null,observed_at:row?.observed_at||'',command:!id?'create':kind==='frv'?'save':revision?.state==='draft'?'save':'revise',source:revision?JSON.parse(revision.payload_json).source:kind==='frv'&&row?JSON.parse(row.context_json).source:null};
}
// Current directory entries, with historical print snapshots saved in the editor source.
function editorPeople(){return directoryPeople(ws.working,today())}
function assertContext(c){invariant(c.database===meta(ws.base,'database_id'),'Открыта другая база. Исходный JSON можно сохранить отдельно.');if(c.id){const row=one(ws.working,'SELECT * FROM '+(c.kind==='sop'?'document':'frv_study')+' WHERE id=?',[c.id]);invariant(row&&row.rev===c.expected,'Запись изменена после открытия. Не перезаписывайте её; сохраните JSON и откройте актуальную версию.')}}
function libraryEvent(c,payload,operation=c.id?'update':'create'){assertContext(c);return {id:uuid(),entity_type:c.kind==='sop'?'document':'frv_study',entity_id:c.id||uuid(),operation,expected_revision:c.expected,payload,occurred_at:new Date().toISOString()}}
async function chooseLibraryFile(kind,ctx=libraryContext(kind)){
 if(libraryDraft){message('Сначала завершите или отмените текущий предпросмотр.',true);return}
 const i=el('input');i.type='file';i.accept='.json,application/json';i.onchange=()=>{const file=i.files?.[0];if(file)run(async()=>{invariant(file.size<=MAX_CONTENT,'JSON до 30 МБ');const text=await file.text(),inspected=await inspectSource(text,kind);assertContext(ctx);libraryDraft={ctx,text,...inspected,editor:false};page=kind==='sop'?'sop':'frv';return 'Исходный файл проверен. Укажите связи и подтвердите запись.'},{save:false})};i.click()
}
// The editor is a trusted pinned local HTML payload loaded in an in-page frame.
 // No window.open, network fetch, file URL query or cross-window navigation.
function editorStatus(s,text,bad=false){if(editorSession!==s)return;s.note.textContent=text;s.note.classList.toggle('bad',bad)}
function editorRoute(c){return c.kind==='frv'||c.editorTab==='frv'?'frv':c.editorTab==='twi'?'twi_plans':'sop_constructor'}
function showEditor(s){if(editorSession!==s)return;page=editorRoute(s.ctx);s.host.hidden=false;document.body.classList.add('editor-active');render();s.close.focus();if(s.loaded)s.frame.contentWindow.postMessage({protocol:'lean-editor-v1',session:s.session,type:'directory',people:editorPeople(),theme:theme?'dark':'light'},'*')}
function hideEditor(s){if(editorSession!==s)return;s.host.hidden=true;document.body.classList.remove('editor-active');root.querySelector('main')?.removeAttribute('inert')}
function goDocument(id,revisionId=null){navigate('sop',{retainEmployee:!!employeeReturn});libraryFilter='all';librarySelected=id;libraryRevisionSelected=revisionId;render()}
function goResearch(id){navigate('frv',{retainEmployee:!!employeeReturn});libraryFilter='all';librarySelected=id;render()}
function openRelated(c,tab){launchEditor({...c,editorTab:tab})}

function disposeEditor(s,confirmed=false){
 if(editorSession!==s)return false;
 if(!confirmed&&!window.confirm('Закрыть рабочую копию редактора? Непереданные изменения могут быть потеряны. Сначала скачайте JSON или передайте в Lean Center.'))return false;
 clearTimeout(s.timeout);hideEditor(s);s.host.remove();editorSession=null;return true
}
function launchEditor(ctx){
 if(libraryDraft){message('Сначала завершите или отмените текущий предпросмотр.',true);return}
 if(editorSession){
  const old=editorSession.ctx;
  if(old.kind===ctx.kind&&old.id===ctx.id&&old.revisionId===ctx.revisionId&&old.editorTab===ctx.editorTab&&!ctx.seedText){showEditor(editorSession);message('Возвращение к открытой рабочей копии редактора.');return}
  if(!disposeEditor(editorSession))return
 }
 try{
  assertContext(ctx);
  const template=window.LC_EDITOR_HTML,marker='window.LC_EDITOR_CONTEXT=null;/* LC_EMBED_CONTEXT */';
  invariant(typeof template==='string'&&template.split(marker).length===2,'Файл редактора не загружен. Распакуйте весь ZIP: index.html и папка versions должны находиться рядом.');
  const session=uuid(),host=el('section',undefined,'editor-host'),bar=el('div',undefined,'editor-host-bar'),frame=el('iframe'),note=el('span','Загрузка конструктора…','editor-host-note');
  host.id='lc-editor-host';host.setAttribute('aria-label','Рабочая область редактора');host.setAttribute('role','region');
  frame.id='lc-editor-frame';frame.title=ctx.kind==='frv'?'Редактор ФРВ':ctx.editorTab==='twi'?'План инструктажа TWI':ctx.editorTab==='frv'?'ФРВ по СОП':'Конструктор СОП';
  const draftKey=ctx.kind==='frv'?'lean-frv-recovery-v1:'+ctx.database+':'+(ctx.id||'new')+':'+ctx.expected:null;
  const s={session,host,frame,note,ctx,draftKey,loading:false,loaded:false,timeout:null,close:null};
  const back=btn('К библиотеке',()=>{hideEditor(s);navigate(s.ctx.kind==='frv'?'frv':'sop')});
  const close=btn('Закрыть редактор',()=>{if(disposeEditor(s)){message('Редактор закрыт. База не изменена.');navigate(s.ctx.kind==='frv'?'frv':'sop')}});
  s.close=close;
  bar.append(el('strong',frame.title),note,back,close);host.append(bar,frame);
  editorSession=s;document.body.append(host);showEditor(s);
  s.timeout=setTimeout(()=>{if(!s.loaded){editorStatus(s,'Редактор не подтвердил загрузку. Закройте его и проверьте комплект файлов и ограничения браузера.',true);message('Редактор не подтвердил готовность. Данные не изменены.',true)}},30000);
  frame.srcdoc=template.replace(marker,()=> 'window.LC_EDITOR_CONTEXT='+JSON.stringify({session,kind:ctx.kind,tab:ctx.editorTab||null,draftKey})+';/* LC_EMBED_CONTEXT */');
  message('Загрузка конструктора. Ожидание подтверждения готовности.');
 }catch(e){if(editorSession)disposeEditor(editorSession,true);message(e.message,true)}
}
window.addEventListener('message',async e=>{
 const s=editorSession,m=e.data;
 if(!s||e.source!==s.frame.contentWindow||m?.protocol!=='lean-editor-v1'||m.session!==s.session)return;
 const reply=message=>{if(editorSession===s)s.frame.contentWindow?.postMessage({protocol:'lean-editor-v1',session:s.session,type:'result',message},'*')};
 if(m.type==='ready'&&!s.loading&&!s.loaded){
  s.loading=true;
  try{assertContext(s.ctx);const text=s.ctx.seedText??(s.ctx.source?await readContent(s.ctx.source):null);if(editorSession!==s)return;const op=s.ctx.operation_id?one(ws.working,'SELECT * FROM operation WHERE id=?',[s.ctx.operation_id]):null;s.frame.contentWindow.postMessage({protocol:'lean-editor-v1',session:s.session,type:'load',text,defaults:{operation:op?.name||'',unit:op?refName('org_unit',op.unit_id):'',people:editorPeople(),theme:theme?'dark':'light'}},'*');editorStatus(s,'Подготовка рабочей копии…')}
  catch(err){clearTimeout(s.timeout);reply(err.message);editorStatus(s,err.message,true);message(err.message,true)}finally{s.loading=false}
 }else if(m.type==='loaded'){
  clearTimeout(s.timeout);s.loaded=true;editorStatus(s,'Редактор готов');message('Редактор готов. Сохранение в библиотеку — после подтверждения.');
 }else if(m.type==='modal'){s.host.querySelector('.editor-host-bar').inert=m.open===true;
 }else if(m.type==='source'){
  if(!s.loaded){reply('Редактор ещё не готов.');return}
  if(busy){reply('Центр занят. Повторите передачу или скачайте JSON.');return}
  if(m.kind!==s.ctx.kind||typeof m.text!=='string'||m.text.length>MAX_CONTENT){reply('Неверный исходный файл');return}
  if(libraryDraft){reply('В центре уже есть неподтверждённый исходный файл. Завершите его сохранение или отмените предпросмотр.');return}
  await run(async()=>{assertContext(s.ctx);const inspected=await inspectSource(m.text,s.ctx.kind);invariant(editorSession===s,'Редактор закрыт');libraryDraft={ctx:s.ctx,text:m.text,...inspected,editor:true,origin:s.ctx.origin||null};page=s.ctx.kind==='sop'?'sop':'frv';return 'Документ подготовлен к сохранению. Укажите реквизиты и подтвердите запись.'},{save:false});
  if(error){reply(status);showEditor(s)}else{reply('Документ подготовлен к сохранению в Lean Center.');hideEditor(s);render()}
 }else if(m.type==='error'){clearTimeout(s.timeout);editorStatus(s,'Ошибка: '+String(m.message||'ошибка'),true);message('Редактор: '+String(m.message||'ошибка'),true)}
});
window.addEventListener('beforeunload',e=>{if(editorSession||libraryDraft){e.preventDefault();e.returnValue=''}});
function sourceSummary(d){
 const p=d.projection;return d.source.kind==='sop'?'Шагов: '+p.steps.length+' · Фото: '+p.photos+' · TWI: '+(p.twi?'есть':'нет'):'Циклов: '+p.cycles+' · Полных: '+p.complete+' · Измерений: '+p.measurements.length+' · Без измерения/действия: '+p.unmeasured
}
function libraryPreview(main,kind){
 if(!libraryDraft||libraryDraft.ctx.kind!==kind)return;
 const d=libraryDraft,c=d.ctx,p=d.projection,form=el('form');
 const code=fieldInput('library_code',c.code||((p.number&&p.number!=='Черновик')?p.number:''));code.required=kind==='sop'&&!c.id;
 const title=fieldInput('library_title',c.title||p.title);title.required=true;title.maxLength=500;
 const op=selectRef('operation','library_operation',c.operation_id);
 const observed=fieldInput('library_observed',c.observed_at,'date');observed.required=kind==='frv';
 const grid=el('div',undefined,'formgrid');if(kind==='sop'){if(c.id)grid.append(el('p','Код документа: '+c.code,'muted'));else grid.append(inputField('Код документа в Lean Center',code))}grid.append(inputField('Название',title),inputField('Операция (для согласования обязательна)',op));if(kind==='frv')grid.append(inputField('Фактическая дата наблюдения',observed));
 const confirm=el('button',c.command==='create'?'Сохранить новый черновик':c.command==='revise'?'Создать новую версию':'Сохранить изменения черновика','primary');confirm.type='submit';confirm.disabled=busy||!!ws.conflicts.length;
 form.onsubmit=e=>{e.preventDefault();run(async()=>{assertContext(c);const payload={command:c.command,title:title.value.trim(),operation_id:op.value||null,source:d.source,projection:p};if(kind==='sop'){if(c.command==='create')payload.code=code.value.trim();else payload.revision_id=c.command==='save'?c.revisionId:null}else payload.observed_at=observed.value;
   // The complete original content is durable before its reference is written.
   await contentStore.put(d.source,d.text);const ev=libraryEvent(c,payload);const events=[ev];if(d.origin){invariant(c.command==='create','Проект из ФРВ должен быть новым документом');events.push({id:uuid(),entity_type:'document',entity_id:ev.entity_id,operation:'update',expected_revision:1,payload:{command:'origin',revision_id:ev.id,...d.origin},occurred_at:new Date().toISOString()})}await ws.applyContentEvents(events,readContent);await persist();
   libraryDraft=null;librarySelected=ev.entity_id;if(kind==='sop')libraryRevisionSelected=c.command==='save'?c.revisionId:ev.id;if(d.editor&&editorSession){try{editorSession.frame.contentWindow.lc54ClearCommittedRecovery?.(d.text)}catch{}disposeEditor(editorSession,true);}
   return 'Черновик сохранён. Ожидает общей публикации базы.';
 },{save:false})};
 main.append(pane('Проверенный исходный файл',el('p',sourceSummary(d)),el('p','Исходный статус Stage43: '+(p.legacy_status||'не указан')+' · Номер: '+(p.number||'не указан')+' · '+Math.ceil(d.source.size/1024)+' КБ','muted'),el('p','Исходный статус не считается согласованием в Lean Center. Содержимое и фотографии сохраняются полностью; исходный JSON хранится отдельно по SHA-256.','muted'),add(form,grid,add(el('div',undefined,'row'),confirm,btn('Скачать исходный JSON',()=>downloadRaw('Stage43-'+kind+'.json',d.text)),btn('Отменить предпросмотр',()=>{if(window.confirm('Отменить неподтверждённый импорт? Исходный файл не изменится.')){libraryDraft=null;render()}})))));
}
function libraryAction(c,command,label){
 const panel=el('div',undefined,'library-action'),actor=selectRef('person','decision_actor',null),note=fieldInput('decision_note');note.maxLength=2000;
 const ok=btn(label,()=>run(async()=>{const payload=c.kind==='sop'?{command,revision_id:c.revisionId,actor_id:actor.value||null,note:note.value}:{command,actor_id:actor.value||null,note:note.value};await ws.applyContentEvents([libraryEvent(c,payload)],readContent);return 'Статус изменён. Ожидает публикации базы.'}),'primary',!!ws.conflicts.length);
 panel.append(inputField('Ответственный сотрудник',actor),inputField('Примечание / причина',note),ok);return panel
}
function rawButton(source,name){return btn('Скачать JSON',()=>run(async()=>{downloadRaw(name,await readContent(source));return 'Исходный JSON сформирован'},{save:false}))}
function sourceDetails(data){const details=el('details'),summary=el('summary','Сведения об исходнике'),p=data.projection;details.append(summary,el('p',sourceSummary(data),'muted'),el('p','SHA-256: '+data.source.sha256,'source-hash'),el('p','Stage43: '+(p.legacy_id||'без ID')+' / '+(p.legacy_version||'—')+' / '+(p.legacy_status||'—'),'muted'));return details}
function libraryHeader(main,kind){
 const search=fieldInput('library_search',query,'search');search.placeholder='Поиск по названию, коду, операции';
 const filter=el('select');filter.name='library_filter';for(const [v,n] of [['all','Все записи'],['active','Без архива'],['archive','Архив'],...(kind==='sop'?[['overdue','Просрочен пересмотр'],['missing_passport','Нет паспорта']]:[])]){const o=el('option',n);o.value=v;filter.append(o)}filter.value=libraryFilter;
 const controls=add(el('div',undefined,'row'),btn(kind==='sop'?'Создать СОП в редакторе':'Создать ФРВ',()=>launchEditor(libraryContext(kind)),'primary',!!ws.conflicts.length),btn('Импорт JSON Stage43',()=>chooseLibraryFile(kind),'',!!ws.conflicts.length),search,filter);
 const p=pane(kind==='sop'?'Общая библиотека СОП':'Общая библиотека ФРВ',el('p','Создавайте документы в соответствующих редакторах. Исходники, связанные материалы и версии сохраняются в общей библиотеке. Печатные формы и фотографии сохранены. ИИ использует существующий прокси Yandex Cloud только по команде; локальные функции доступны без сети.','muted'),controls);main.append(p);libraryPreview(main,kind);
 const out=el('div',undefined,'stack');main.append(out);return {search,filter,out}
}
function libraryScreen(main,kind){
 const {search,filter,out}=libraryHeader(main,kind);
 function draw(){
  out.replaceChildren();const items=rows(ws.working,kind==='sop'?'SELECT * FROM document ORDER BY code':'SELECT * FROM frv_study ORDER BY observed_at DESC,title').map(v=>kind==='sop'?{...v,title:documentTitle(ws.working,v.id,librarySelected===v.id?libraryRevisionSelected:null)||v.title}:v);
  const filtered=items.filter(v=>{const a=kind==='sop'?!!v.archived:v.state==='archived';let visible=libraryFilter==='all'||(libraryFilter==='active'&&!a)||(libraryFilter==='archive'&&a);
   if(kind==='sop'&&!a&&libraryFilter==='overdue')visible=!!one(ws.working,"SELECT id FROM document_revision WHERE document_id=? AND state='effective' AND review_due<?",[v.id,today()]);
   if(kind==='sop'&&!a&&libraryFilter==='missing_passport')visible=!!one(ws.working,"SELECT id FROM document_revision WHERE document_id=? AND state='draft' AND (print_format IS NULL OR workplace_id IS NULL)",[v.id]);
   return visible&&[v.title,v.code,refName('operation',v.operation_id)].some(x=>String(x||'').toLowerCase().includes(query.toLowerCase()))});
  if(!filtered.length){out.append(pane('Нет записей',el('p','Создайте документ в редакторе или импортируйте переносимый JSON Stage43.','muted')));return}
  if(!filtered.some(x=>x.id===librarySelected)){librarySelected=null;libraryRevisionSelected=null}
  if(!librarySelected){out.append(pane(kind==='sop'?'Каталог документов':'Журнал исследований',tableOf(['Код / дата','Название','Операция','Статус',''],filtered.map(v=>{const rev=kind==='sop'?one(ws.working,"SELECT * FROM document_revision WHERE document_id=? ORDER BY CASE WHEN state='effective' THEN 0 ELSE 1 END,version_no DESC LIMIT 1",[v.id]):null;return [v.code||v.observed_at,v.title,refName('operation',v.operation_id),v.archived?'Архив':revisionLabels[rev?.state||v.state]||'—',btn('Открыть',()=>{librarySelected=v.id;libraryRevisionSelected=null;draw()},'primary')]}))));return}
  out.append(add(el('div',undefined,'row'),btn('К списку',()=>{librarySelected=null;libraryRevisionSelected=null;draw()})));
  for(const v of filtered.filter(x=>x.id===librarySelected)){
   const p=pane((kind==='sop'?v.code+' · ':'')+v.title,el('p','Операция: '+refName('operation',v.operation_id)+' · Ревизия записи: '+v.rev,'muted'));
   if(kind==='sop'){
    const versions=rows(ws.working,'SELECT * FROM document_revision WHERE document_id=? ORDER BY version_no DESC',[v.id]);
    if(libraryRevisionSelected&&!versions.some(x=>x.id===libraryRevisionSelected))libraryRevisionSelected=null;
    if(libraryRevisionSelected)p.append(btn('Все версии СОП',()=>{libraryRevisionSelected=null;draw()}),el('p','Открыта редакция по связи из другого раздела.','muted'));
    for(const revision of versions.filter(x=>!libraryRevisionSelected||x.id===libraryRevisionSelected)){
     const data=JSON.parse(revision.payload_json),c=libraryContext(kind,v.id,revision.id),section=el('div',undefined,'library-version');section.dataset.revisionId=revision.id;
     const header=add(el('div',undefined,'row'),el('strong','Версия '+revision.version_no),el('span',documentTitle(ws.working,v.id,revision.id)),el('span',revisionLabels[revision.state]||revision.state,'pill'),el('span',revision.created_at.slice(0,10),'muted'));
     section.append(header,el('p',sourceSummary(data),'muted'),el('p','Пересмотр: '+(revision.review_due||'дата не задана')+' · '+(revision.print_format==='portrait'?'А3 книжный':revision.print_format==='landscape'?'А3 альбомный':'формат не выбран')+' · Рабочее место: '+(revision.workplace_name||'не определено'),revision.review_due&&revision.review_due<today()&&revision.state==='effective'?'bad':'muted'),sourceDetails(data));
     const tabs=el('div',undefined,'library-tabs'),body=el('div',undefined,'library-tab-body');
     const steps=()=>tableOf(['№','Действие','Сек','Ключевые моменты','Почему важно'],data.projection.steps.map((s,i)=>[i+1,s.action,s.seconds,s.key_points.join('\n'),s.reason]));
     const passport=()=>add(el('div'),el('p','Рабочее место: '+(revision.workplace_name||'—')+' · Оборудование: '+(revision.equipment_name||'—')+' · Дата изменения: '+(revision.changed_on||'—')),sourcePassport(data),...(!v.archived&&revision.state==='draft'?[passportForm(c,revision)]:[]));
     const revDoc={...v,title:documentTitle(ws.working,v.id,revision.id)};
     const assessments=()=>add(el('div'),btn('Перейти в реестр оценок СОП',()=>goEvaluation(revision.id)),evaluationDetail(revDoc,revision,data.source));
     const materials=()=>materialsPanel(data);
     const history=()=>add(el('div'),tableOf(['Версия','Статус','Создана','Пересмотр'],versions.map(x=>[x.version_no,revisionLabels[x.state]||x.state,x.created_at.slice(0,10),x.review_due])),frvOriginPanel(revision));
     const stages=el('div',undefined,'lifecycle');for(const [k,n] of [['draft','Черновик'],['review','На согласовании'],['approved','Согласован'],['effective','Действует']])stages.append(el('span',n,'life-stage'+(revision.state===k?' current':'')));
     section.append(stages);
     for(const [name,make] of [['Шаги и ключевые моменты',steps],['Паспорт документа',passport],['Версии',history],['ФРВ',()=>relatedPanel(revDoc,revision,'frv')],['План TWI',()=>relatedPanel(revDoc,revision,'twi')],['Оценка СОП',assessments],['Материалы',materials]]){const tab=btn(name,()=>{for(const t of tabs.children)t.classList.remove('selected');tab.classList.add('selected');body.replaceChildren(make())},'library-tab');tabs.append(tab)}tabs.firstChild.classList.add('selected');body.append(steps());section.append(tabs,body);
     const buttons=add(el('div',undefined,'row'),rawButton(data.source,'SOP-'+v.code+'-v'+revision.version_no+'.json'));
     const open=versions.some(x=>['draft','review','approved'].includes(x.state));
     if(!v.archived&&(revision.state==='draft'||(!open&&['effective','withdrawn','superseded'].includes(revision.state)))){
      buttons.append(btn(revision.state==='draft'?'Открыть редактор':'Создать версию в редакторе',()=>launchEditor(c),'primary',!!ws.conflicts.length),btn('Импорт изменений JSON',()=>chooseLibraryFile(kind,c),'',!!ws.conflicts.length))
     }
     section.append(buttons,btn('Создать мероприятие по СОП',()=>goTraining('actions',{mode:'new',sourceKind:'document_revision',sourceId:revision.id})));
     const actions=revision.state==='draft'?[['submit','На согласование']]:revision.state==='review'?[['approve','Согласовать'],['return','Вернуть в черновик']]:revision.state==='approved'?[['effect','Ввести в действие']]:revision.state==='effective'?[['withdraw','Вывести из действия']]:[];
     if(!v.archived)for(const [cmd,label] of actions){const det=el('details');det.append(el('summary',label),libraryAction(c,cmd,label));section.append(det)}
     const decisions=rows(ws.working,'SELECT * FROM document_approval WHERE revision_id=? ORDER BY decided_at',[revision.id]);for(const a of decisions)section.append(el('p',(a.decision==='approved'?'Согласовал: ':'Вернул: ')+refName('person',a.actor_id)+' · '+a.decided_at.slice(0,10)+(a.note?' · '+a.note:''),'muted'));
     p.append(section)
    }
    if(!v.archived&&versions.length&&versions.every(x=>['superseded','withdrawn'].includes(x.state)))p.append(btn('Архивировать СОП',()=>{if(confirm('Архивировать документ без удаления истории?'))run(async()=>{await ws.applyContentEvents([libraryEvent(libraryContext(kind,v.id),null,'archive')],readContent);return 'Документ в архиве'})},'danger',!!ws.conflicts.length))
   }else{
    const data=JSON.parse(v.context_json),c=libraryContext(kind,v.id);p.append(el('p',revisionLabels[v.state]+' · Дата наблюдения: '+v.observed_at),el('p',sourceSummary(data),'muted'),sourceDetails(data),frvAnalysisPanel(v,data),btn('Создать мероприятие по ФРВ',()=>goTraining('actions',{mode:'new',sourceKind:'frv_study',sourceId:v.id})),btn('Аналитика ФРВ',()=>goTraining('analytics',{assessmentType:'frv'})),btn('ROI-модель',()=>goTraining('roi',{studyId:v.id})));
    for(const link of rows(ws.working,`SELECT d.id,d.code,${REVISION_TITLE_SQL} title,r.id revision_id,r.version_no,o.source_sha256 FROM sop_frv_origin o JOIN document_revision r ON r.id=o.revision_id JOIN document d ON d.id=r.document_id WHERE o.study_id=?`,[v.id]))p.append(add(el('div',undefined,'row'),el('span',link.code+' · v'+link.version_no+' · '+(link.source_sha256===data.source.sha256?'Текущий исходник':'Ранее сохранённые замеры'),'muted'),btn('Открыть СОП',()=>goDocument(link.id,link.revision_id))));
    const buttons=add(el('div',undefined,'row'),rawButton(data.source,'FRV-'+v.id+'.json'));if(v.state==='draft'){buttons.append(btn('Открыть редактор',()=>launchEditor(c),'primary',!!ws.conflicts.length),btn('Импорт изменений JSON',()=>chooseLibraryFile(kind,c),'',!!ws.conflicts.length));const det=el('details');det.append(el('summary','Завершить исследование'),libraryAction(c,'finalize','Завершить исследование'));p.append(det)}
    if(v.state!=='archived')buttons.append(btn('Архивировать',()=>{if(confirm('Архивировать исследование без удаления измерений?'))run(async()=>{await ws.applyContentEvents([libraryEvent(c,null,'archive')],readContent);return 'Исследование в архиве'})},'danger',!!ws.conflicts.length));p.append(buttons)
   }out.append(p)
  }
 }
 search.oninput=()=>{query=search.value;draw()};filter.onchange=()=>{libraryFilter=filter.value;draw()};draw();if(kind==='frv')linkedRegistry(main,'frv')
}
async function backupTransfer(){return makeTransfer('backup',await backup(ws),sourceRefs(),readContent)}
async function restoreBackupTransfer(value){
 const {payload,contents}=unpackTransfer(value,'backup');const db=openDb(SQL,decode(payload.base));let refs;try{refs=unionRefs(refsForDb(db),refsForEvents(payload.pending))}finally{db.close()}
 await restoreContents(contents,refs,(r,t)=>contentStore.put(r,t));return restore(SQL,payload,readContent)
}
async function acceptManualTransfer(value){
 const {payload,contents}=unpackTransfer(value,'package');await restoreContents(contents,refsForEvents(payload.events),(r,t)=>contentStore.put(r,t));return ws.accept(payload,readContent)
}
async function snapshotTransfer(s){return makeTransfer('snapshot',{manifest:s.manifest,base:encode(s.bytes)},refsForDb(ws.base),readContent)}
async function openSnapshotTransfer(value){const {payload,contents}=unpackTransfer(value,'snapshot'),db=await readSnapshot(SQL,payload.manifest,decode(payload.base));try{await restoreContents(contents,refsForDb(db),(r,t)=>contentStore.put(r,t))}catch(e){db.close();throw e}await useSnapshot(db)}

async function useSnapshot(db){if(meta(db,'database_id')===meta(ws.base,'database_id')){ws.replaceBase(db);return}if(!empty()){db.close();throw new Error('Это другая база. Сохраните резервную копию и восстановите её отдельно.')}replace(new Workspace(SQL,db))}
async function refresh(){invariant(folder,'Сначала выберите папку');invariant(await net.permission(folder,true),'Нет разрешения');const s=await net.latestSnapshot(folder,SQL);invariant(s,'В папке нет опубликованной базы');await useSnapshot(s.db);return ws.conflicts.length?'Обновлено; есть конфликты локальных изменений':'Загружена опубликованная база'}
async function publish(){invariant(master,'Включите режим издателя');invariant(folder,'Сначала выберите папку');invariant(await net.permission(folder,true),'Нет разрешения');const snapshot=await prepareSnapshot(ws);await net.publishSnapshot(folder,SQL,snapshot,readContent);const db=await readSnapshot(SQL,snapshot.manifest,snapshot.bytes);replace(new Workspace(SQL,db,{device:ws.device}));return 'База опубликована и проверена по SHA-256'}
function storage(main){const mode=el('input');mode.type='checkbox';mode.checked=master;mode.onchange=()=>{master=mode.checked;render()};const summary=pane('Рабочая копия',el('p','ID базы: '+meta(ws.base,'database_id'),'muted'),el('p','Публикация: '+(meta(ws.base,'publication_id')||'ещё нет'),'muted'),el('p','Локальные изменения: '+ws.pending.length+' · Принято, но не опубликовано: '+(ws.dirty?'да':'нет')),add(el('label',undefined,'row'),mode,el('span','Режим единственного издателя (только уполномоченный сотрудник)')),el('p','Режим издателя — интерфейсный переключатель, не авторизация. Права папки настраиваются средствами предприятия.','muted'));main.append(summary);
const controls=add(el('div',undefined,'row'),btn('Выбрать сетевую папку',()=>run(async()=>{folder=await net.chooseFolder();if(cache)await local.save(cache,'folder',folder);return 'Выбрана папка: '+folder.name},{save:false}),'primary'),btn('Проверить доступ',()=>run(async()=>{invariant(folder,'Выберите папку');await net.testFolder(folder);return 'Чтение, запись и удаление тестового файла подтверждены'},{save:false}),'',!folder),btn('Обновить из папки',()=>run(refresh),'',!folder),btn('Отправить изменения',()=>run(async()=>{invariant(folder,'Выберите папку');await net.sendPackage(folder,await ws.package(),readContent);return 'Пакет отправлен. Изменения сохраняются до подтверждения опубликованной базой'},{save:false}),'',!folder||!ws.pending.length||!!ws.conflicts.length));main.append(pane('Сетевая папка',el('p',folder?'Папка: '+folder.name:'Не выбрана','muted'),controls));
const masterPanel=pane('Публикация и входящие изменения',el('p','Издатель принимает изменения и публикует новую проверенную версию. Исходные файлы не перезаписываются.','muted'),add(el('div',undefined,'row'),btn('Принять свои изменения',()=>run(async()=>{const n=await ws.acceptOwn(readContent);return 'Принято событий: '+n}),'',!master||!ws.pending.length||!!ws.conflicts.length),btn('Список входящих',()=>run(async()=>{invariant(await net.permission(folder,true),'Нет доступа');incoming=await net.listPackages(folder);return 'Найдено пакетов: '+incoming.length},{save:false}),'',!folder||!master),btn('Опубликовать базу',()=>run(publish),'primary',!folder||!master||!!ws.pending.length),btn('Импорт пакета вручную',()=>pick('.leanpkg,.json',async p=>{invariant(master,'Требуется режим издателя');const result=await acceptManualTransfer(p);return result.duplicate?'Пакет уже принят':'Принято событий: '+result.count},MAX_TRANSFER),'',!master)));for(const item of incoming){const p=item.p,known=p&&one(ws.base,'SELECT id FROM exchange_package WHERE id=?',[p.id]);masterPanel.append(add(el('div',undefined,'row'),el('span',item.name+' · '+(item.error|| (known?'принят':p.events?.length+' событий')),'muted'),btn('Принять',()=>run(async()=>{const x=await ws.accept(p,readContent);return x.duplicate?'Уже принято':'Принято: '+x.count}),'',!!known||!master||!p||!!ws.pending.length)))}main.append(masterPanel);
main.append(pane('Перенос и резервирование',add(el('div',undefined,'row'),btn('Скачать пакет изменений',()=>run(async()=>{const p=await ws.package();download('change-'+p.id+'.leanpkg',await makeTransfer('package',p,refsForEvents(p.events),readContent));return 'Пакет сформирован'},{save:false}),'',!ws.pending.length||!!ws.conflicts.length),btn('Скачать резервную копию',()=>run(async()=>{download('lean-'+uuid()+'.leanbackup',await backupTransfer());return 'Копия сформирована'},{save:false})),btn('Копия на сетевой диск',()=>run(async()=>{await net.saveBackup(folder,await backupTransfer());return 'Копия записана и проверена'},{save:false}),'',!folder),btn('Восстановить копию',()=>pick('.leanbackup,.json',async obj=>{const next=await restoreBackupTransfer(obj);if(!empty()&&!confirm('Заменить рабочую копию? Убедитесь, что скачали её резервную копию.')){next.close();return 'Отменено'}replace(next);return 'Копия восстановлена; проверьте ID базы'})),btn('Создать снимок для ручного обмена',()=>run(async()=>{invariant(master,'Требуется режим издателя');const s=await prepareSnapshot(ws);download('snapshot-'+s.manifest.id+'.leansnapshot',await snapshotTransfer(s));replace(new Workspace(SQL,await readSnapshot(SQL,s.manifest,s.bytes),{device:ws.device}));return 'Снимок сформирован. Сохраните скачанный файл; ручная публикация обновлена'}),'',!master||!!ws.pending.length||!!folder),btn('Открыть снимок',()=>pick('.leansnapshot,.json',async obj=>{await openSnapshotTransfer(obj);return 'Снимок проверен и открыт'})))));
if(ws.conflicts.length){const p=pane('Конфликты локальных изменений',el('p','Сохраните резервную копию. Конфликтующие события не применены; исходные данные не перезаписаны.','bad'));for(const c of ws.conflicts){p.append(el('p',c.error,'bad'));const v=one(ws.working,'SELECT * FROM '+c.event.entity_type+' WHERE id=?',[c.event.entity_id]);p.append(el('pre','Локальное: '+JSON.stringify(c.event.payload,null,2)+'\nТекущее: '+JSON.stringify(v,null,2),'muted'))}p.append(add(el('div',undefined,'row'),btn('Оставить опубликованное значение',()=>{if(confirm('Отменить конфликтующее локальное событие? Сохраните резервную копию.'))run(async()=>{ws.resolveConflict('discard');return 'Конфликтующее событие отменено'})},'danger'),btn('Повторить своё изменение',()=>{if(confirm('Применить ваше значение поверх текущей ревизии? Сохраните резервную копию.'))run(async()=>{ws.resolveConflict('reapply');return 'Создано новое локальное событие; оно ожидает публикации'})},'',Object.hasOwn(DOMAIN_TYPES,ws.conflicts[0].event.entity_type))));main.append(p)}
main.append(pane('Демонстрация',el('p','Только в пустой локальной базе. Не используйте демонстрационную папку как рабочую.','muted'),btn('Новая пустая база',()=>{if(confirm('Создать отдельную пустую базу вместо текущей? Сначала сохраните резервную копию.'))run(async()=>{replace(new Workspace(SQL,createDb(SQL,LC_BUILD.schema,LC_BUILD.migration)));folder=null;incoming=[];master=false;importState=null;libraryDraft=null;if(cache)await local.save(cache,'folder',null);return 'Новая пустая база создана'})},'danger'),btn('Заполнить демо-данными',()=>run(async()=>{invariant(empty(),'Демо допустимо только в пустой базе');const u=ws.edit('org_unit',null,{code:'DEMO',name:'Учебное предприятие',kind:'Предприятие',parent_id:null});const v=ws.edit('org_unit',null,{code:'DEMO-M',name:'Учебный участок',kind:'Участок',parent_id:u});const p=ws.edit('profession',null,{code:'DEMO-MECH',name:'Механик'});const a=ws.edit('person',null,{employee_code:'DEMO-001',display_name:'Учебный сотрудник 01'});const e=ws.edit('equipment',null,{unit_id:v,code:'DEMO-E',name:'Учебный стенд'});ws.edit('operation',null,{unit_id:v,equipment_id:e,code:'DEMO-O',name:'Проверка стенда',criticality:'normal'});ws.edit('person_assignment',null,{person_id:a,unit_id:v,profession_id:p,shift_code:'1',valid_from:'2026-11-25',valid_to:null});return 'Добавлены демонстрационные записи'}),'',!empty())))}
function render(){
 initNav();chart?.dispose();chart=null;document.documentElement.classList.toggle('dark',theme);
 const header=el('header',undefined,'corp-header');
 const brand=add(el('div',undefined,'brand-lockup'),el('div',undefined,'brand-mark'),add(el('div'),el('div','LEAN CENTER','brand'),el('div','Обучение на рабочем месте · TWI','brand-sub')));
 const metaPanel=add(el('div',undefined,'header-meta'),el('span',window.LC_BUILD.version||'lc3.7','version'),btn(theme?'Светлая тема':'Тёмная тема',()=>{theme=!theme;try{localStorage.setItem('lean-center-theme',theme?'dark':'light')}catch{}render()}),btn('Хранение',()=>navigate('storage')));
 if(editorSession&&editorSession.host.hidden&&!libraryDraft)metaPanel.append(btn('Вернуться в редактор',()=>showEditor(editorSession),'primary'));header.append(brand,metaPanel);
 const side=el('aside',undefined,'sidebar');side.id='lc53-sidebar';side.setAttribute('aria-label','Навигация');side.classList.toggle('lc53-menu-open',mobileMenu);const menu=btn(mobileMenu?'Закрыть меню':'Меню',()=>{mobileMenu=!mobileMenu;side.classList.toggle('lc53-menu-open',mobileMenu);menu.textContent=mobileMenu?'Закрыть меню':'Меню';menu.setAttribute('aria-expanded',String(mobileMenu))},'lc53-mobile-menu');menu.setAttribute('aria-controls',side.id);menu.setAttribute('aria-expanded',String(mobileMenu));header.append(menu);
 const group=(name,keys)=>{side.append(el('div',name,'navgroup'));for(const k of keys)side.append(navButton(k))};
 for(const [name,keys] of navGroups){const d=el('details',undefined,'nav-section');d.open=!collapsedNav.has(name)||keys.includes(page);d.append(el('summary',name,'navgroup'));for(const k of keys)d.append(navButton(k));d.addEventListener('toggle',()=>{if(d.open)collapsedNav.delete(name);else collapsedNav.add(name)});side.append(d)}
 side.append(el('p','●  Запланированные разделы','nav-hint'));
 const main=el('main',undefined,'main');
 const section=navGroups.find(([,keys])=>keys.includes(page))?.[0]||'Рабочее пространство';
 const top=add(el('div',undefined,'top'),add(el('div'),el('div',section,'eyebrow'),el('h1',labels[page]),el('div','Локальная база · '+ws.pending.length+' ожидающих изменений','muted')),el('span',folder?'Сетевая папка выбрана':'Локальная рабочая копия','pill'));
 main.append(top);if(navParent!==null)main.append(add(el('div',undefined,'row lc53-nav-return'),btn('← Назад',navigationBack)));const stat=el('div',status,'status'+(error?' error':''));stat.id='status';stat.setAttribute('role','status');main.append(stat);
 if(!cache)main.append(el('p','IndexedDB недоступен. Изменения только в памяти — скачивайте резервную копию до закрытия.','bad'));
 if(ws.conflicts.length)main.append(el('p','Есть конфликты локальных изменений. Откройте «База и обмен».','bad'));
 if(ws.dirty)main.append(el('p','Принятые изменения ещё не опубликованы.','warn'));
 if(employeeReturn&&page!=='person')main.append(add(el('div',undefined,'row employee-return'),btn('← К карточке сотрудника',()=>openEmployee(employeeReturn,{restore:true})),el('span',refName('person',employeeReturn),'muted')));
 root.replaceChildren(add(el('div',undefined,'shell'),header,side,main));main.inert=!!editorSession&&!editorSession.host.hidden;if(editorSession?.loaded)editorSession.frame.contentWindow.postMessage({protocol:'lean-editor-v1',session:editorSession.session,type:'theme',theme:theme?'dark':'light'},'*');
 if(page==='home')home(main);else if(page==='storage')storage(main);else if(page==='import_xlsx')importScreen(main);else if(page==='sop_constructor')constructorScreen(main);else if(page==='twi_plans')twiPlansScreen(main);else if(page==='sop'||page==='frv')libraryScreen(main,page);else if(page==='sop_evaluation')sopEvaluationScreen(main);else if(Object.hasOwn(definitions,page))registry(main,page);else if(TRAINING_PAGES.includes(page))trainingScreen(main,page,{ws,el,add,btn,pane,tableOf,inputField,fieldInput,refName,refOption,today,run,render,go:goTraining,goDocument,goResearch,readContent,pick,downloadBytes,notify:message,openEmployee,rememberNavigation});else main.append(pane(labels[page],el('p','Модуль запланирован на следующие этапы. В этой сборке готовится единая база и рабочая оболочка.','muted')));
 main.append(el('p',(LC_BUILD.version||'Lean Center')+' · автономная рабочая копия · общий сетевой обмен','foot'))
}
window.addEventListener('resize',()=>chart?.resize());
async function init(){configureMigrations(LC_BUILD.migration3,LC_BUILD.migration4,LC_BUILD.migration5,LC_BUILD.migration6,LC_BUILD.migration7,LC_BUILD.migration8,LC_BUILD.migration9,LC_BUILD.migration10,LC_BUILD.migration11,LC_BUILD.migration12,LC_BUILD.migration13);SQL=await window.initSqlJs({wasmBinary:decode(window.LC_BUILD.wasm)});try{cache=await local.openCache();const s=await local.load(cache,'workspace');generation=s?.generation||0;folder=await local.load(cache,'folder');ws=s?new Workspace(SQL,openDb(SQL,s.state.base),s.state):new Workspace(SQL,createDb(SQL,LC_BUILD.schema,LC_BUILD.migration));if(!s)await persist();if(folder&&await net.permission(folder,false)){const prev=ws.state();try{const remote=await net.latestSnapshot(folder,SQL);if(remote){await useSnapshot(remote.db);await persist();message(ws.conflicts.length?'База обновлена, есть конфликты':'База обновлена из сетевой папки')}}catch(e){replace(new Workspace(SQL,openDb(SQL,prev.base),prev));message('Сетевая база не обновлена: '+e.message,true)}}}catch(e){if(!cache){ws=new Workspace(SQL,createDb(SQL,LC_BUILD.schema,LC_BUILD.migration));message('IndexedDB недоступен, ручной режим: '+e.message,true)}else if(ws){message('Локальная копия не записана: '+e.message,true);cache=null}else throw e}render()}
init().catch(e=>{console.error(e);root.replaceChildren(el('h1','Не удалось открыть Lean Center'),el('p',e.message),el('p','Существующие локальные данные не удалены. Проверьте браузер или восстановите проверенную копию.'))});
