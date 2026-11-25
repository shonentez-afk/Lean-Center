import {frvSummary,draftFromFrv} from './modules/library/frv-summary.js';
import {validateChecklist,sopMethods,sopCriteria,evaluationResult} from './modules/library/sop-review.js';
import {inspectSource,MAX_CONTENT,refsForDb,refsForEvents,unionRefs,DOMAIN_TYPES} from './modules/library/domain.js';
import {ContentStore,makeTransfer,unpackTransfer,restoreContents,MAX_TRANSFER} from './modules/library/content.js';
import {MAX_XLSX,loadWorkbook,sheetHeaders,sheetRows,importFields,fieldLabel,autoMap,planImport,commitImport,makeTemplate} from './modules/master-data/import-xlsx.js';
import {registryCountChart} from './analytics/palette.js';
import {configureMigrations,recordPayload,createDb,openDb,Workspace,definitions,list,rows,one,meta,uuid,canonical,prepareSnapshot,readSnapshot,backup,restore,encode,decode,invariant,MAX_PACKAGE} from './core/db.js';
import * as local from './storage/local.js';
import * as net from './storage/network.js';
const root=document.getElementById('app');
let SQL,ws,cache,folder,generation=0,busy=false,master=false,page='home',theme=false,status='Готово',error=false,chart=null,edit=null,query='',incoming=[],importState=null,historyPerson=null,archiveFilter='active',libraryDraft=null,editorSession=null,libraryFilter='all';
const contentStore=new ContentStore(()=>cache,()=>folder),readContent=ref=>contentStore.get(ref);
const sourceRefs=()=>unionRefs(refsForDb(ws.base),refsForEvents(ws.pending));
const planned={sop:'Каталог СОП',frv:'ФРВ',sop_evaluation:'Оценка СОП',my_plan:'Мой план',twi:'План производственного обучения',programs:'Ввод в профессию',internship:'Программы стажировки',instruction:'Инструктажи TWI',retraining:'Переобучение',journal:'Журнал заданий',skills:'Матрица компетенций',practical:'Практические оценки',development:'Планы развития',mentoring:'Наставники и ВТ',self_eval:'Самооценка',certification:'Сертификация',appointments:'Назначения',audit:'Аудиты 1-го уровня',calendar:'Календарь',actions:'Мероприятия',analytics:'Аналитика центра',metrics:'Дерево метрик',roi:'ROI-модель',ai:'ИИ-помощник'};
const labels={home:'Дашборд',...Object.fromEntries(Object.entries(definitions).map(([k,v])=>[k,v.label])),...planned,org_unit:'Структура предприятия',import_xlsx:'Импорт данных',storage:'Настройки и обмен'};
const navGroups=[
 ['Ежедневная работа',['home','my_plan','calendar','actions']],
 ['Стандартизация и улучшения',['sop','frv','sop_evaluation']],
 ['Производственное обучение',['twi','programs','internship','instruction','retraining','journal']],
 ['Люди и компетенции',['person','workplace','skills','practical','development']],
 ['Наставники и ВТ',['mentoring','self_eval','certification','appointments','audit']],
 ['Аналитика',['analytics','metrics','roi']],
 ['Управление центром',['org_unit','import_xlsx','storage']],
 ['Справочники',['profession','position','work_shift','equipment','operation','person_assignment','business_role','role_assignment','skill_category','skill','rating_scale']]
];
const implemented=new Set(['home','sop','frv','sop_evaluation','storage','import_xlsx',...Object.keys(definitions)]);
const collapsedNav=new Set(['Производственное обучение','Наставники и ВТ','Аналитика','Справочники']);
let librarySelected=null;
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
function add(parent,...children){parent.append(...children);return parent}
function btn(label,fn,cls='',disabled=false){const n=el('button',label,cls);n.type='button';n.disabled=disabled||busy;n.addEventListener('click',fn);return n}
function pane(title,...children){return add(el('section',undefined,'panel'),el('h2',title),...children)}
function message(s,bad=false){status=s;error=bad;const n=document.getElementById('status');if(n){n.textContent=s;n.className='status'+(bad?' error':'')}}
function navigate(p){page=p;edit=null;query='';historyPerson=null;archiveFilter='active';libraryFilter='all';librarySelected=null;render()}
function openImport(type){importState={type,book:null,sheet:0,header:1,mapping:{},allowUpdates:false,plan:null,file:''};navigate('import_xlsx')}
function openHistory(id){navigate('person_assignment');historyPerson=id;archiveFilter='all';render()}
async function persist(){if(cache)generation=await local.saveWorkspace(cache,generation,ws.state())}
function replace(newWs){ws?.close();ws=newWs}
async function run(fn,{save=true}={}){if(busy)return;const prev=ws.state();busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);message('Выполняется…');try{const m=await fn();if(save)await persist();message(m||'Готово')}catch(e){console.error(e);replace(new Workspace(SQL,openDb(SQL,prev.base),prev));message(e.message,true)}finally{busy=false;render()}}
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
 main.append(needs);
 main.append(sectionHeading('Справочники предприятия','Активные записи'));
 const g=el('div',undefined,'kpi-grid');
 const counts=Object.fromEntries(Object.keys(definitions).map(k=>[k,list(ws.working,k).filter(x=>activeRecord(definitions[k],x)).length]));
 for(const k of ['org_unit','person','workplace','equipment','operation','profession']){const d=definitions[k],n=btn('',()=>navigate(k),'tile');n.setAttribute('aria-label',d.label+': '+counts[k]);add(n,add(el('div',undefined,'tile-head'),el('span',d.label,'muted'),icon(k,'tile-icon')),el('b',String(counts[k])),el('span','Открыть справочник →','tile-link'));g.append(n)}
 main.append(g);main.append(add(el('div',undefined,'row registry-shortcuts'),btn('Импорт справочников из Excel',()=>openImport('person'),'primary'),btn('Назначения сотрудников',()=>navigate('person_assignment')),btn('Шкалы оценивания',()=>navigate('rating_scale'))));
 const c=el('div',undefined,'chart');c.style.height=Math.max(290,Object.keys(definitions).length*29)+'px';main.append(pane('Структура справочников',c));
 if(window.echarts){chart=echarts.init(c,theme?'dark':null);chart.setOption(registryCountChart(Object.values(definitions).map(x=>x.label),Object.keys(definitions).map(k=>counts[k]),theme))}
 const links=el('div',undefined,'workspace-grid');for(const [k,n] of Object.entries(planned).filter(([k])=>implemented.has(k))){const b=btn('',()=>navigate(k),'workspace-link');b.append(icon(k),el('span',n));links.append(b)}
 main.append(pane('Рабочие модули',el('p','СОП, ФРВ, TWI, компетенции, наставничество и аудит — равноправные модули центра. Доступны база, справочники, библиотека СОП и ФРВ. Остальные функциональные модули будут подключаться последовательно.','muted'),links))
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
function registry(main,type){
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
  const t=el('table'),head=el('tr');for(const [,f] of fields)head.append(el('th',f.label));head.append(el('th','Версия / статус'),el('th','Действия'));t.append(add(el('thead'),head));
  const body=el('tbody');for(const v of data){const tr=el('tr',undefined,!activeRecord(d,v)?'archive':'');for(const [k,f] of fields)tr.append(el('td',String(showVal(k,f,v)),f.multiline?'multiline-cell':''));
   const state=v.archived?'Архив':d.history?(v.valid_from>today()?'Будущее':v.valid_to&&v.valid_to<today()?'Завершено':'Действует'):'Активно';
   tr.append(el('td',state+' · v'+v.rev));const a=el('td');
   if(!v.archived){if(!d.immutable&&(!d.history||!v.valid_to))a.append(btn(d.history?'Закрыть / изменить':'Изменить',()=>{edit=v;render()},'',!!ws.conflicts.length));if(d.immutable)a.append(btn('Новая версия',()=>{edit={name:v.name,version_no:String(Math.max(...items.filter(x=>x.name===v.name).map(x=>x.version_no))+1),levels:v.levels};render()},'',!!ws.conflicts.length));
    if(!d.history)a.append(btn('Архив',()=>{if(confirm('Архивировать запись? История сохранится.'))run(async()=>{ws.edit(type,v.id,null,'archive');return 'Запись архивирована'})},'danger',!!ws.conflicts.length));
    if(type==='person'){a.append(btn('Назначения',()=>openHistory(v.id)));a.append(btn('Роли',()=>{navigate('role_assignment');historyPerson=v.id;archiveFilter='all';render()}))}
   }tr.append(a);body.append(tr)
  }t.append(body);wrap.append(t)
 }
 search.oninput=()=>{query=search.value;draw()};filter.onchange=()=>{archiveFilter=filter.value;draw()};draw();
 if(type==='org_unit')orgTree(panel,items)
}
function downloadBytes(name,bytes){const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function updateMapping(s){s.plan=null;s.mapping=s.book?autoMap(s.type,sheetHeaders(s.book.worksheets[s.sheet],s.header)):{}}
function importScreen(main){
 const s=importState||(importState={type:'person',book:null,sheet:0,header:1,mapping:{},allowUpdates:false,plan:null,file:''});
 const kind=el('select');kind.name='import_type';for(const [key,d] of Object.entries(definitions)){const o=el('option',d.label);o.value=key;kind.append(o)}kind.value=s.type;kind.onchange=()=>{s.type=kind.value;try{updateMapping(s)}catch(e){message(e.message,true);s.mapping={}}render()};
 const load=el('input');load.type='file';load.accept='.xlsx';load.name='import_file';
 load.onchange=()=>{const f=load.files?.[0];if(!f)return;run(async()=>{invariant(/\.xlsx$/i.test(f.name)&&f.size<=MAX_XLSX,'Выберите XLSX до 20 МБ');const book=await loadWorkbook(window.ExcelJS,await f.arrayBuffer());s.book=book;s.file=f.name;s.sheet=0;s.header=1;updateMapping(s);return 'Excel открыт. Настройте соответствие колонок.'},{save:false})};
 const setup=pane('1. Выбор справочника и файла',add(el('div',undefined,'formgrid'),add(el('label',undefined,'field'),el('span','Справочник'),kind),add(el('label',undefined,'field'),el('span','Excel (.xlsx)'),load)),add(el('div',undefined,'row'),btn('Скачать шаблон XLSX',()=>run(async()=>{downloadBytes('LeanCenter-'+s.type+'.xlsx',await makeTemplate(window.ExcelJS,s.type));return 'Шаблон сформирован'},{save:false})),btn('Очистить импорт',()=>openImport(s.type))),el('p',s.file?'Открыт файл: '+s.file:'Сначала выберите файл. Данные не изменятся до подтверждения импорта.','muted'));main.append(setup);
 if(!s.book)return;
 const select=el('select');select.name='import_sheet';for(const [i,sheet] of s.book.worksheets.entries()){const o=el('option',sheet.name);o.value=String(i);select.append(o)}select.value=String(s.sheet);select.onchange=()=>{s.sheet=Number(select.value);try{updateMapping(s)}catch(e){message(e.message,true);s.mapping={}}render()};
 const hdr=el('input');hdr.type='number';hdr.name='header_row';hdr.min=1;hdr.max=20;hdr.value=s.header;hdr.onchange=()=>{const v=Number(hdr.value);if(Number.isInteger(v)&&v>=1&&v<=20){s.header=v;try{updateMapping(s)}catch(e){message(e.message,true);s.mapping={}}render()}};
 const updates=el('input');updates.type='checkbox';updates.name='allow_updates';updates.checked=s.allowUpdates;updates.onchange=()=>{s.allowUpdates=updates.checked;s.plan=null;render()};
 const mapPanel=pane('2. Лист и соответствие колонок',add(el('div',undefined,'formgrid'),add(el('label',undefined,'field'),el('span','Лист'),select),add(el('label',undefined,'field'),el('span','Строка заголовков (1–20)'),hdr)),el('p','Коды должны быть текстом в Excel. Ссылки — по кодам, не по ФИО. Для операций допустимо подразделение/код. Неназначенные колонки при обновлении сохраняют прежнее значение. Пустая назначенная колонка очищает необязательное поле.','muted'));
 main.append(mapPanel);let headers;try{headers=sheetHeaders(s.book.worksheets[s.sheet],s.header)}catch(e){mapPanel.append(el('p',e.message,'bad'));return}
 const grid=el('div',undefined,'formgrid');for(const [key,f] of importFields(s.type)){const input=el('select');input.name='map_'+key;const blank=el('option','— Не импортировать —');blank.value='';input.append(blank);for(const h of headers){const o=el('option',h.col+' · '+h.name);o.value=String(h.col);input.append(o)}input.value=String(s.mapping[key]||'');input.onchange=()=>{s.mapping[key]=Number(input.value)||null;s.plan=null;render()};grid.append(add(el('label',undefined,'field'),el('span',fieldLabel(s.type,key)+(f.required?' *':'')),input))}
 mapPanel.append(grid,add(el('label',undefined,'row'),updates,el('span','Разрешить обновление совпадающих ключей (после предпросмотра)')),btn('Предварительная проверка',()=>run(async()=>{const cols=Object.values(s.mapping).filter(Boolean);invariant(cols.length>0&&new Set(cols).size===cols.length,'Назначьте каждой колонке только одно поле');s.plan=planImport(ws,s.type,sheetRows(s.book.worksheets[s.sheet],s.header,s.mapping),{allowUpdates:s.allowUpdates});return 'Предпросмотр готов. Запись в базу ещё не выполнена.'},{save:false}),'primary'));
 if(!s.plan)return;
 const p=s.plan,c=p.counts;
 const report=pane('3. Результат проверки',add(el('div',undefined,'row'),el('span','Создать: '+c.create,'pill'),el('span','Обновить: '+c.update,'pill'),el('span','Без изменений: '+c.same,'pill'),el('span','Ошибки: '+c.error,c.error?'bad':'pill')));
 const t=el('table'),head=el('tr');for(const h of ['Строка Excel','Решение','Проверка / изменения'])head.append(el('th',h));t.append(add(el('thead'),head));const body=el('tbody');
 for(const v of p.results){const details=el('div');details.append(el('div',v.message,v.status==='error'?'bad':'muted'));for(const ch of v.changes){details.append(el('div',ch.field+': '+(ch.before??'—')+' → '+(ch.after??'—'),'preview-detail'))}body.append(add(el('tr'),el('td',String(v.row)),el('td',({create:'Создать',update:'Обновить',same:'Без изменений',error:'Ошибка'})[v.status]),add(el('td'),details)))}t.append(body);
 report.append(add(el('div',undefined,'tablewrap'),t),el('p',c.error?'Импорт заблокирован. Исправьте все ошибки и повторите проверку.':'Будут записаны только проверенные изменения, одной транзакцией.','muted'),btn('Импортировать '+p.events.length+' изменений',()=>{if(confirm('Записать проверенные изменения в локальную базу?'))run(async()=>{const n=commitImport(ws,p);s.plan=null;return 'Импортировано изменений: '+n})},'primary',!!c.error||!p.events.length||!!ws.conflicts.length));main.append(report)
}
const revisionLabels={draft:'Черновик',review:'На согласовании',approved:'Согласован',effective:'Действует',superseded:'Заменён',withdrawn:'Выведен из действия',final:'Завершено',archived:'Архив'};
function inputField(label,input){return add(el('label',undefined,'field'),el('span',label),input)}
function fieldInput(name,value='',type='text'){const n=el('input');n.name=name;n.type=type;n.value=value??'';return n}
function selectRef(type,name,id=null,optional=true){
 const s=el('select');s.name=name;if(optional){const o=el('option','— Не выбрано —');o.value='';s.append(o)}
 for(const v of list(ws.working,type).filter(x=>!x.archived||x.id===id)){const o=el('option',refOption(type,v));o.value=v.id;s.append(o)}s.value=id||'';return s
}
function downloadRaw(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function contentEvent(type,payload){return {id:uuid(),entity_type:type,entity_id:uuid(),operation:'create',expected_revision:0,payload,occurred_at:new Date().toISOString()}}
function tableOf(headers,data){
 const t=el('table'),h=el('tr');headers.forEach(v=>h.append(el('th',v)));t.append(add(el('thead'),h));const body=el('tbody');
 for(const r of data){const tr=el('tr');for(const v of r)tr.append(v instanceof Node?add(el('td'),v):el('td',String(v??'—')));body.append(tr)}t.append(body);return add(el('div',undefined,'tablewrap detail-table'),t)
}
function evaluationForm(revision,source){
 const methods=sopMethods(ws.working).filter(m=>m.state==='active');if(!methods.length)return add(el('div'),el('p','Сначала загрузите корпоративскую методику оценки СОП в разделе «Оценка СОП».','muted'),btn('Перейти к оценке СОП',()=>navigate('sop_evaluation')));
 const panel=el('div'),select=el('select');for(const m of methods){const o=el('option','Методика v'+m.version_no);o.value=m.id;select.append(o)}
 const actor=selectRef('person','eval_actor'),day=fieldInput('eval_date',today(),'date'),place=fieldInput('eval_place',revision.workplace_name||''),content=el('div');
 panel.append(add(el('div',undefined,'formgrid'),inputField('Версия методики',select),inputField('Оценщик',actor),inputField('Дата',day),inputField('Место',place)),content);
 function draw(){
  content.replaceChildren();const criteria=sopCriteria(ws.working,select.value),values=criteria.map(c=>{const choice=el('select');choice.name='criterion_'+c.position;for(const [v,n] of [['','Не оценено'],['1','1 — выполнено'],['0','0 — не выполнено']]){const o=el('option',n);o.value=v;choice.append(o)}const note=fieldInput('note_'+c.position);note.maxLength=2000;return {c,choice,note}});
  const progress=el('p','Оценено: 0 из 20','muted'),save=btn('Зафиксировать оценку',()=>run(async()=>{const payload={revision_id:revision.id,method_id:select.value,actor_id:actor.value,evaluated_on:day.value,place:place.value,source_sha256:source.sha256,responses:values.map(v=>({criterion_id:v.c.id,value:v.choice.value===''?null:Number(v.choice.value),note:v.note.value}))};await ws.applyContentEvents([contentEvent('sop_evaluation',payload)]);return 'Оценка СОП сохранена. Ожидает публикации.'}),'primary',true);
  function update(){const result=evaluationResult(values.map(x=>({value:x.choice.value===''?null:Number(x.choice.value)})));progress.textContent='Оценено: '+result.rated+' из 20 · '+(result.fraction===null?'итог пока не рассчитан':(result.fraction*100).toFixed(0)+'%');save.disabled=busy||result.rated!==20||!!ws.conflicts.length}
  values.forEach(v=>v.choice.onchange=update);
  content.append(tableOf(['№','Проверяемое требование','Оценка','Комментарий'],values.map(v=>[v.c.position,v.c.question,v.choice,v.note])),progress,el('p','Результат — выполненные требования / 20. Порог зачёта не установлен; оценка не утверждает СОП автоматически.','muted'),save)
 }
 select.onchange=()=>{if(!confirm('Сменить версию методики? Незавершённые ответы будут очищены.')){select.value=select.dataset.previous;return}select.dataset.previous=select.value;draw()};select.dataset.previous=select.value;draw();return panel
}
async function evaluationXlsx(id){
 const e=one(ws.working,'SELECT * FROM sop_evaluation WHERE id=?',[id]),v=one(ws.working,'SELECT * FROM document_revision WHERE id=?',[e.revision_id]),doc=one(ws.working,'SELECT * FROM document WHERE id=?',[v.document_id]);
 const responses=rows(ws.working,'SELECT c.position,c.question,r.value,r.note FROM sop_evaluation_response r JOIN checklist_criterion c ON c.id=r.criterion_id WHERE r.evaluation_id=? ORDER BY c.position',[id]);const method=one(ws.working,'SELECT version_no FROM checklist_version WHERE id=?',[e.method_id]);
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('Оценка СОП',{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 s.columns=[{width:7},{width:105},{width:13},{width:48}];s.mergeCells('A1:D1');s.getCell('A1').value='Чек-лист оценки СОП';s.getCell('A1').font={bold:true,size:16};s.mergeCells('A2:D2');s.getCell('A2').value=doc.code+' · '+doc.title+' · версия '+v.version_no;s.mergeCells('A3:D3');s.getCell('A3').value='Место: '+e.place+'    Дата: '+e.evaluated_on+'    Оценщик: '+e.actor_name+'    Методика v'+method.version_no;s.mergeCells('A4:D4');s.getCell('A4').value='Исходный SHA-256: '+e.source_sha256;
 s.addRow(['№ п/п','Проверяемые требования','Оценка','Комментарий']);s.getRow(5).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(5).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF242E40'}};
 for(const x of responses){const row=s.addRow([x.position,x.question,x.value,x.note]);row.alignment={vertical:'top',wrapText:true};row.height=Math.max(28,15*Math.ceil(Math.max(x.question.length/100,(x.note||'').length/43)))}
 const result=evaluationResult(responses),row=s.addRow(['','ИТОГО',{formula:'SUM(C6:C25)/20',result:result.fraction},'']);row.getCell(3).numFmt='0%';s.pageSetup.printArea='A1:D26';downloadBytes('Оценка-СОП-'+doc.code+'-v'+v.version_no+'.xlsx',await w.xlsx.writeBuffer());
}
function evaluationHistory(revision,source){
 const data=rows(ws.working,'SELECT e.*,m.version_no AS method_version FROM sop_evaluation e JOIN checklist_version m ON m.id=e.method_id WHERE e.revision_id=? ORDER BY e.evaluated_on DESC,e.recorded_at DESC',[revision.id]);
 const out=el('div');if(!data.length)out.append(el('p','Оценок этой версии ещё нет.','muted'));
 else out.append(tableOf(['Дата','Оценщик','Методика','Результат','Исходник','Отчёт'],data.map(e=>{const r=evaluationResult(rows(ws.working,'SELECT value FROM sop_evaluation_response WHERE evaluation_id=?',[e.id]));return [e.evaluated_on,e.actor_name,'v'+e.method_version,r.yes+'/20 · '+(r.fraction*100).toFixed(0)+'%',e.source_sha256===source.sha256?'Текущий':'Предыдущий черновик',btn('Скачать XLSX',()=>run(async()=>{await evaluationXlsx(e.id);return 'Отчёт сформирован'},{save:false}))]})));return out
}
function sopEvaluationScreen(main){
 const p=pane('Методики оценки СОП',el('p','Загрузите приватный JSON из корпоративского приложения 4. Оценка СОП — отдельная форма из 20 пунктов, не аудит инструктора L1 и не 13-пунктный чек-лист Stage43.','muted'));
 p.append(btn('Загрузить методику JSON',()=>{const i=el('input');i.type='file';i.accept='.json';i.onchange=()=>{if(!i.files?.[0])return;run(async()=>{invariant(i.files[0].size<=128000,'Слишком большой файл методики');const m=validateChecklist(JSON.parse(await i.files[0].text()));if(!confirm(m.title+'\n20 критериев. Добавить неизменяемую версию методики?'))return 'Импорт отменён';await ws.applyContentEvents([contentEvent('checklist_version',m)]);return 'Методика добавлена, ожидает публикации.'})};i.click()},'primary',!!ws.conflicts.length));
 for(const m of sopMethods(ws.working)){const data=JSON.parse(m.methodology_json),d=el('details');d.append(el('summary','Версия '+m.version_no+' · '+data.title+' · '+(m.state==='active'?'Действует':'Архив')),el('p','SHA-256 исходного документа: '+data.source_sha256,'source-hash'),tableOf(['№','Требование'],sopCriteria(ws.working,m.id).map(q=>[q.position,q.question])));p.append(d)}
 main.append(p,pane('Оценивание конкретной версии',el('p','Откройте документ в каталоге СОП, вкладку «Оценка СОП». Результаты привязаны к версии и хэшу исходника.','muted'),btn('Каталог СОП',()=>navigate('sop'),'primary')))
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
function frvAnalysisPanel(v,data){
 const panel=el('div'),button=btn('Показать измерения и анализ',async()=>{button.disabled=true;try{const raw=JSON.parse(await readContent(data.source)),s=frvSummary(raw),n=x=>x===null?'—':Number(x.toFixed(2)).toLocaleString('ru-RU');
 panel.replaceChildren(tableOf(['Категория','Секунды','Минуты'],Object.entries(s.totals).map(([k,x])=>[({VA:'ВДЦ',NVA_Necessary:'М2',NVA_Waste:'М1',WAIT:'Ожидание',BREAK:'Перерыв',OTHER:'Не классифицировано'})[k],n(x),n(x/60)])),tableOf(['Группа','Полных циклов','Среднее, сек'],[['До',s.baselineCount,n(s.before)],['После',s.improvedCount,n(s.after)]]),el('p','Неполных строк: '+s.missing+' · '+(s.comparable?'Подтверждено сравнение: разница '+n(s.delta)+' сек ('+n(s.percent)+'%)':'Эффект не рассчитан: требуется сопоставимость и полные циклы до/после.'),'muted'),tableOf(['Цикл','Группа','Измерено, сек','Полнота'],s.cycles.map(x=>[x.index,x.phase,n(x.seconds),x.complete?'Полный':'Неполный'])));
 }catch(e){panel.append(el('p',e.message,'bad'));button.disabled=false}});
 const transfer=btn('Создать проект СОП из сохранённого ФРВ',()=>run(async()=>{invariant(!libraryDraft,'Сначала завершите текущий предпросмотр');const d=await draftFromFrv(await readContent(data.source));libraryDraft={ctx:{...libraryContext('sop'),operation_id:v.operation_id},...d,editor:false,origin:{study_id:v.id,source_sha256:data.source.sha256}};page='sop';return 'Подготовлен новый проект СОП. Проверьте проектное время, заполните паспорт и визуализацию.'},{save:false}),'primary',!!ws.conflicts.length);
 return add(el('div'),panel,add(el('div',undefined,'row'),button,...(v.state!=='archived'?[transfer]:[])))
}
function libraryContext(kind,id=null,revisionId=null){
 const row=id?one(ws.working,'SELECT * FROM '+(kind==='sop'?'document':'frv_study')+' WHERE id=?',[id]):null;
 const revision=kind==='sop'&&revisionId?one(ws.working,'SELECT * FROM document_revision WHERE id=? AND document_id=?',[revisionId,id]):null;
 invariant(!id||row,'Запись не найдена');invariant(!revisionId||revision,'Версия не найдена');
 return {kind,id,revisionId,expected:row?.rev||0,database:meta(ws.base,'database_id'),title:row?.title||'',code:row?.code||'',operation_id:row?.operation_id||null,observed_at:row?.observed_at||'',command:!id?'create':kind==='frv'?'save':revision?.state==='draft'?'save':'revise',source:revision?JSON.parse(revision.payload_json).source:kind==='frv'&&row?JSON.parse(row.context_json).source:null};
}
function assertContext(c){invariant(c.database===meta(ws.base,'database_id'),'Открыта другая база. Исходный JSON можно сохранить отдельно.');if(c.id){const row=one(ws.working,'SELECT * FROM '+(c.kind==='sop'?'document':'frv_study')+' WHERE id=?',[c.id]);invariant(row&&row.rev===c.expected,'Запись изменена после открытия. Не перезаписывайте её; сохраните JSON и откройте актуальную версию.')}}
function libraryEvent(c,payload,operation=c.id?'update':'create'){assertContext(c);return {id:uuid(),entity_type:c.kind==='sop'?'document':'frv_study',entity_id:c.id||uuid(),operation,expected_revision:c.expected,payload,occurred_at:new Date().toISOString()}}
async function chooseLibraryFile(kind,ctx=libraryContext(kind)){
 if(libraryDraft){message('Сначала завершите или отмените текущий предпросмотр.',true);return}
 const i=el('input');i.type='file';i.accept='.json,application/json';i.onchange=()=>{const file=i.files?.[0];if(file)run(async()=>{invariant(file.size<=MAX_CONTENT,'JSON до 30 МБ');const text=await file.text(),inspected=await inspectSource(text,kind);assertContext(ctx);libraryDraft={ctx,text,...inspected,editor:false};page=kind==='sop'?'sop':'frv';return 'Исходный файл проверен. Укажите связи и подтвердите запись.'},{save:false})};i.click()
}
// The editor is a trusted pinned local HTML payload loaded in an in-page frame.
 // No window.open, network fetch, file URL query or cross-window navigation.
function editorStatus(s,text,bad=false){if(editorSession!==s)return;s.note.textContent=text;s.note.classList.toggle('bad',bad)}
function showEditor(s){if(editorSession!==s)return;s.host.hidden=false;root.inert=true;document.body.classList.add('editor-active');s.close.focus()}
function hideEditor(s){if(editorSession!==s)return;s.host.hidden=true;root.inert=false;document.body.classList.remove('editor-active')}
function disposeEditor(s,confirmed=false){
 if(editorSession!==s)return false;
 if(!confirmed&&!window.confirm('Закрыть рабочую копию редактора? Непереданные изменения могут быть потеряны. Сначала скачайте JSON или передайте в Lean Center.'))return false;
 clearTimeout(s.timeout);hideEditor(s);s.host.remove();editorSession=null;return true
}
function launchEditor(ctx){
 if(libraryDraft){message('Сначала завершите или отмените текущий предпросмотр.',true);return}
 if(editorSession){showEditor(editorSession);message('Возвращение к открытой рабочей копии редактора.');return}
 try{
  assertContext(ctx);
  const template=window.LC_EDITOR_HTML,marker='window.LC_EDITOR_CONTEXT=null;/* LC_EMBED_CONTEXT */';
  invariant(typeof template==='string'&&template.split(marker).length===2,'Файл редактора не загружен. Распакуйте весь ZIP: index.html и папка versions должны находиться рядом.');
  const session=uuid(),host=el('section',undefined,'editor-host'),bar=el('div',undefined,'editor-host-bar'),frame=el('iframe'),note=el('span','Загрузка конструктора…','editor-host-note');
  host.id='lc-editor-host';host.setAttribute('aria-label','Рабочая область редактора');host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');
  frame.id='lc-editor-frame';frame.title=ctx.kind==='sop'?'Редактор СОП и TWI':'Редактор ФРВ';
  const s={session,host,frame,note,ctx,loading:false,loaded:false,timeout:null,close:null};
  const back=btn('К библиотеке',()=>{hideEditor(s);render()});
  const close=btn('Закрыть редактор',()=>{if(disposeEditor(s)){message('Редактор закрыт. База не изменена.');render()}});
  s.close=close;
  bar.append(el('strong',frame.title),note,back,close);host.append(bar,frame);
  editorSession=s;document.body.append(host);showEditor(s);
  s.timeout=setTimeout(()=>{if(!s.loaded){editorStatus(s,'Редактор не подтвердил загрузку. Закройте его и проверьте комплект файлов и ограничения браузера.',true);message('Редактор не подтвердил готовность. Данные не изменены.',true)}},30000);
  frame.srcdoc=template.replace(marker,()=> 'window.LC_EDITOR_CONTEXT='+JSON.stringify({session,kind:ctx.kind})+';/* LC_EMBED_CONTEXT */');
  message('Загрузка конструктора. Ожидание подтверждения готовности.');
 }catch(e){if(editorSession)disposeEditor(editorSession,true);message(e.message,true)}
}
window.addEventListener('message',async e=>{
 const s=editorSession,m=e.data;
 if(!s||e.source!==s.frame.contentWindow||m?.protocol!=='lean-editor-v1'||m.session!==s.session)return;
 const reply=message=>{if(editorSession===s)s.frame.contentWindow?.postMessage({protocol:'lean-editor-v1',session:s.session,type:'result',message},'*')};
 if(m.type==='ready'&&!s.loading&&!s.loaded){
  s.loading=true;
  try{assertContext(s.ctx);const text=s.ctx.source?await readContent(s.ctx.source):null;if(editorSession!==s)return;const op=s.ctx.operation_id?one(ws.working,'SELECT * FROM operation WHERE id=?',[s.ctx.operation_id]):null;s.frame.contentWindow.postMessage({protocol:'lean-editor-v1',session:s.session,type:'load',text,defaults:{operation:op?.name||'',unit:op?refName('org_unit',op.unit_id):''}},'*');editorStatus(s,'Подготовка рабочей копии…')}
  catch(err){clearTimeout(s.timeout);reply(err.message);editorStatus(s,err.message,true);message(err.message,true)}finally{s.loading=false}
 }else if(m.type==='loaded'){
  clearTimeout(s.timeout);s.loaded=true;editorStatus(s,'Редактор готов');message('Редактор готов. Сохранение в библиотеку — после подтверждения.');
 }else if(m.type==='source'){
  if(!s.loaded){reply('Редактор ещё не готов.');return}
  if(busy){reply('Центр занят. Повторите передачу или скачайте JSON.');return}
  if(m.kind!==s.ctx.kind||typeof m.text!=='string'||m.text.length>MAX_CONTENT){reply('Неверный исходный файл');return}
  if(libraryDraft){reply('В центре уже есть неподтверждённый исходный файл. Завершите его сохранение или отмените предпросмотр.');return}
  await run(async()=>{assertContext(s.ctx);const inspected=await inspectSource(m.text,s.ctx.kind);invariant(editorSession===s,'Редактор закрыт');libraryDraft={ctx:s.ctx,text:m.text,...inspected,editor:true};page=s.ctx.kind==='sop'?'sop':'frv';return 'Редактор передал исходный файл. Подтвердите сохранение в библиотеку.'},{save:false});
  if(error)reply(status);else{reply('Предпросмотр готов. Подтвердите сохранение в Lean Center.');hideEditor(s)}
 }else if(m.type==='error'){clearTimeout(s.timeout);editorStatus(s,'Ошибка: '+String(m.message||'ошибка'),true);message('Редактор: '+String(m.message||'ошибка'),true)}
});
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
   libraryDraft=null;librarySelected=ev.entity_id;if(d.editor&&editorSession)disposeEditor(editorSession,true);
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
 const controls=add(el('div',undefined,'row'),btn(kind==='sop'?'Создать СОП в редакторе':'Создать исследование в редакторе',()=>launchEditor(libraryContext(kind)),'primary',!!ws.conflicts.length),btn('Импорт JSON Stage43',()=>chooseLibraryFile(kind),'',!!ws.conflicts.length),search,filter);
 const p=pane(kind==='sop'?'Общая библиотека СОП':'Общая библиотека ФРВ',el('p','Редактор Stage43 открывается внутри Lean Center, без всплывающих окон. Печать, фотографии, TWI и прежние форматы XLSX сохранены в его исходном механизме. ИИ в интегрированном редакторе пока отключён; согласование и общая публикация выполняются в Lean Center.','muted'),controls);main.append(p);libraryPreview(main,kind);
 const out=el('div',undefined,'stack');main.append(out);return {search,filter,out}
}
function libraryScreen(main,kind){
 const {search,filter,out}=libraryHeader(main,kind);
 function draw(){
  out.replaceChildren();const items=rows(ws.working,kind==='sop'?'SELECT * FROM document ORDER BY code':'SELECT * FROM frv_study ORDER BY observed_at DESC,title');
  const filtered=items.filter(v=>{const a=kind==='sop'?!!v.archived:v.state==='archived';let visible=libraryFilter==='all'||(libraryFilter==='active'&&!a)||(libraryFilter==='archive'&&a);
   if(kind==='sop'&&!a&&libraryFilter==='overdue')visible=!!one(ws.working,"SELECT id FROM document_revision WHERE document_id=? AND state='effective' AND review_due<?",[v.id,today()]);
   if(kind==='sop'&&!a&&libraryFilter==='missing_passport')visible=!!one(ws.working,"SELECT id FROM document_revision WHERE document_id=? AND state='draft' AND (print_format IS NULL OR workplace_id IS NULL)",[v.id]);
   return visible&&[v.title,v.code,refName('operation',v.operation_id)].some(x=>String(x||'').toLowerCase().includes(query.toLowerCase()))});
  if(!filtered.length){out.append(pane('Нет записей',el('p','Создайте документ в редакторе или импортируйте переносимый JSON Stage43.','muted')));return}
  if(!filtered.some(x=>x.id===librarySelected))librarySelected=null;
  if(!librarySelected){out.append(pane(kind==='sop'?'Каталог документов':'Журнал исследований',tableOf(['Код / дата','Название','Операция','Статус',''],filtered.map(v=>{const rev=kind==='sop'?one(ws.working,"SELECT * FROM document_revision WHERE document_id=? ORDER BY CASE WHEN state='effective' THEN 0 ELSE 1 END,version_no DESC LIMIT 1",[v.id]):null;return [v.code||v.observed_at,v.title,refName('operation',v.operation_id),v.archived?'Архив':revisionLabels[rev?.state||v.state]||'—',btn('Открыть',()=>{librarySelected=v.id;draw()},'primary')]}))));return}
  out.append(add(el('div',undefined,'row'),btn('К списку',()=>{librarySelected=null;draw()})));
  for(const v of filtered.filter(x=>x.id===librarySelected)){
   const p=pane((kind==='sop'?v.code+' · ':'')+v.title,el('p','Операция: '+refName('operation',v.operation_id)+' · Ревизия записи: '+v.rev,'muted'));
   if(kind==='sop'){
    const versions=rows(ws.working,'SELECT * FROM document_revision WHERE document_id=? ORDER BY version_no DESC',[v.id]);
    for(const revision of versions){
     const data=JSON.parse(revision.payload_json),c=libraryContext(kind,v.id,revision.id),section=el('div',undefined,'library-version');
     const header=add(el('div',undefined,'row'),el('strong','Версия '+revision.version_no),el('span',revisionLabels[revision.state]||revision.state,'pill'),el('span',revision.created_at.slice(0,10),'muted'));
     section.append(header,el('p',sourceSummary(data),'muted'),el('p','Пересмотр: '+(revision.review_due||'дата не задана')+' · '+(revision.print_format==='portrait'?'А3 книжный':revision.print_format==='landscape'?'А3 альбомный':'формат не выбран')+' · Рабочее место: '+(revision.workplace_name||'не определено'),revision.review_due&&revision.review_due<today()&&revision.state==='effective'?'bad':'muted'),sourceDetails(data));
     const tabs=el('div',undefined,'library-tabs'),body=el('div',undefined,'library-tab-body');
     const steps=()=>tableOf(['№','Действие','Сек','Ключевые моменты','Почему важно'],data.projection.steps.map((s,i)=>[i+1,s.action,s.seconds,s.key_points.join('\n'),s.reason]));
     const passport=()=>add(el('div'),el('p','Рабочее место: '+(revision.workplace_name||'—')+' · Оборудование: '+(revision.equipment_name||'—')+' · Дата изменения: '+(revision.changed_on||'—')),sourcePassport(data),...(!v.archived&&revision.state==='draft'?[passportForm(c,revision)]:[]));
     const assessments=()=>add(el('div'),evaluationHistory(revision,data.source),...(!v.archived?[evaluationForm(revision,data.source)]:[]));
     const materials=()=>materialsPanel(data);
     const history=()=>{const origin=one(ws.working,'SELECT * FROM sop_frv_origin WHERE revision_id=?',[revision.id]);return add(el('div'),tableOf(['Версия','Статус','Создана','Пересмотр'],versions.map(x=>[x.version_no,revisionLabels[x.state]||x.state,x.created_at.slice(0,10),x.review_due])),...(origin?[el('p','Создано из исследования ФРВ: '+origin.study_id+' · SHA-256 '+origin.source_sha256,'source-hash')]:[]))};
     const stages=el('div',undefined,'lifecycle');for(const [k,n] of [['draft','Черновик'],['review','На согласовании'],['approved','Согласован'],['effective','Действует']])stages.append(el('span',n,'life-stage'+(revision.state===k?' current':'')));
     section.append(stages);
     for(const [name,make] of [['Шаги и ключевые моменты',steps],['Паспорт документа',passport],['Версии',history],['Оценка СОП',assessments],['Материалы',materials]]){const tab=btn(name,()=>{for(const t of tabs.children)t.classList.remove('selected');tab.classList.add('selected');body.replaceChildren(make())},'library-tab');tabs.append(tab)}tabs.firstChild.classList.add('selected');body.append(steps());section.append(tabs,body);
     const buttons=add(el('div',undefined,'row'),rawButton(data.source,'SOP-'+v.code+'-v'+revision.version_no+'.json'));
     const open=versions.some(x=>['draft','review','approved'].includes(x.state));
     if(!v.archived&&(revision.state==='draft'||(!open&&['effective','withdrawn','superseded'].includes(revision.state)))){
      buttons.append(btn(revision.state==='draft'?'Открыть редактор':'Создать версию в редакторе',()=>launchEditor(c),'primary',!!ws.conflicts.length),btn('Импорт изменений JSON',()=>chooseLibraryFile(kind,c),'',!!ws.conflicts.length))
     }
     section.append(buttons);
     const actions=revision.state==='draft'?[['submit','На согласование']]:revision.state==='review'?[['approve','Согласовать'],['return','Вернуть в черновик']]:revision.state==='approved'?[['effect','Ввести в действие']]:revision.state==='effective'?[['withdraw','Вывести из действия']]:[];
     if(!v.archived)for(const [cmd,label] of actions){const det=el('details');det.append(el('summary',label),libraryAction(c,cmd,label));section.append(det)}
     const decisions=rows(ws.working,'SELECT * FROM document_approval WHERE revision_id=? ORDER BY decided_at',[revision.id]);for(const a of decisions)section.append(el('p',(a.decision==='approved'?'Согласовал: ':'Вернул: ')+refName('person',a.actor_id)+' · '+a.decided_at.slice(0,10)+(a.note?' · '+a.note:''),'muted'));
     p.append(section)
    }
    if(!v.archived&&versions.length&&versions.every(x=>['superseded','withdrawn'].includes(x.state)))p.append(btn('Архивировать СОП',()=>{if(confirm('Архивировать документ без удаления истории?'))run(async()=>{await ws.applyContentEvents([libraryEvent(libraryContext(kind,v.id),null,'archive')],readContent);return 'Документ в архиве'})},'danger',!!ws.conflicts.length))
   }else{
    const data=JSON.parse(v.context_json),c=libraryContext(kind,v.id);p.append(el('p',revisionLabels[v.state]+' · Дата наблюдения: '+v.observed_at),el('p',sourceSummary(data),'muted'),sourceDetails(data),frvAnalysisPanel(v,data));
    const buttons=add(el('div',undefined,'row'),rawButton(data.source,'FRV-'+v.id+'.json'));if(v.state==='draft'){buttons.append(btn('Открыть редактор',()=>launchEditor(c),'primary',!!ws.conflicts.length),btn('Импорт изменений JSON',()=>chooseLibraryFile(kind,c),'',!!ws.conflicts.length));const det=el('details');det.append(el('summary','Завершить исследование'),libraryAction(c,'finalize','Завершить исследование'));p.append(det)}
    if(v.state!=='archived')buttons.append(btn('Архивировать',()=>{if(confirm('Архивировать исследование без удаления измерений?'))run(async()=>{await ws.applyContentEvents([libraryEvent(c,null,'archive')],readContent);return 'Исследование в архиве'})},'danger',!!ws.conflicts.length));p.append(buttons)
   }out.append(p)
  }
 }
 search.oninput=()=>{query=search.value;draw()};filter.onchange=()=>{libraryFilter=filter.value;draw()};draw()
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
 chart?.dispose();chart=null;document.documentElement.classList.toggle('dark',theme);
 const header=el('header',undefined,'corp-header');
 const brand=add(el('div',undefined,'brand-lockup'),el('div',undefined,'brand-mark'),add(el('div'),el('div','LEAN CENTER','brand'),el('div','Обучение на рабочем месте · TWI','brand-sub')));
 const metaPanel=add(el('div',undefined,'header-meta'),el('span',window.LC_BUILD.version||'lc3.2','version'),btn(theme?'Светлая тема':'Тёмная тема',()=>{theme=!theme;render()}),btn('Хранение',()=>navigate('storage')));
 if(editorSession&&editorSession.host.hidden&&!libraryDraft)metaPanel.append(btn('Вернуться в редактор',()=>showEditor(editorSession),'primary'));header.append(brand,metaPanel);
 const side=el('aside',undefined,'sidebar');side.setAttribute('aria-label','Навигация');
 const group=(name,keys)=>{side.append(el('div',name,'navgroup'));for(const k of keys)side.append(navButton(k))};
 for(const [name,keys] of navGroups){const d=el('details',undefined,'nav-section');d.open=!collapsedNav.has(name)||keys.includes(page);d.append(el('summary',name,'navgroup'));for(const k of keys)d.append(navButton(k));d.addEventListener('toggle',()=>{if(d.open)collapsedNav.delete(name);else collapsedNav.add(name)});side.append(d)}
 side.append(el('p','●  Запланированные разделы','nav-hint'));
 const main=el('main',undefined,'main');
 const section=navGroups.find(([,keys])=>keys.includes(page))?.[0]||'Рабочее пространство';
 const top=add(el('div',undefined,'top'),add(el('div'),el('div',section,'eyebrow'),el('h1',labels[page]),el('div','Локальная база · '+ws.pending.length+' ожидающих изменений','muted')),el('span',folder?'Сетевая папка выбрана':'Локальная рабочая копия','pill'));
 main.append(top);const stat=el('div',status,'status'+(error?' error':''));stat.id='status';stat.setAttribute('role','status');main.append(stat);
 if(!cache)main.append(el('p','IndexedDB недоступен. Изменения только в памяти — скачивайте резервную копию до закрытия.','bad'));
 if(ws.conflicts.length)main.append(el('p','Есть конфликты локальных изменений. Откройте «База и обмен».','bad'));
 if(ws.dirty)main.append(el('p','Принятые изменения ещё не опубликованы.','warn'));
 root.replaceChildren(add(el('div',undefined,'shell'),header,side,main));root.inert=!!editorSession&&!editorSession.host.hidden;
 if(page==='home')home(main);else if(page==='storage')storage(main);else if(page==='import_xlsx')importScreen(main);else if(page==='sop'||page==='frv')libraryScreen(main,page);else if(page==='sop_evaluation')sopEvaluationScreen(main);else if(Object.hasOwn(definitions,page))registry(main,page);else if(page==='twi')main.append(pane('TWI в составе СОП',el('p','План TWI сохраняется вместе с версией СОП и доступен в редакторе Stage43. Назначения обучения и практические оценки будут реализованы на LC4.','muted'),btn('Открыть библиотеку СОП',()=>navigate('sop'),'primary')));else main.append(pane(labels[page],el('p','Модуль запланирован на следующие этапы. В этой сборке готовится единая база и рабочая оболочка.','muted')));
 main.append(el('p','LC3.2 · автономная рабочая копия · общий сетевой обмен','foot'))
}
window.addEventListener('resize',()=>chart?.resize());
async function init(){configureMigrations(LC_BUILD.migration3,LC_BUILD.migration4,LC_BUILD.migration5);SQL=await window.initSqlJs({wasmBinary:decode(window.LC_BUILD.wasm)});try{cache=await local.openCache();const s=await local.load(cache,'workspace');generation=s?.generation||0;folder=await local.load(cache,'folder');ws=s?new Workspace(SQL,openDb(SQL,s.state.base),s.state):new Workspace(SQL,createDb(SQL,LC_BUILD.schema,LC_BUILD.migration));if(!s)await persist();if(folder&&await net.permission(folder,false)){const prev=ws.state();try{const remote=await net.latestSnapshot(folder,SQL);if(remote){await useSnapshot(remote.db);await persist();message(ws.conflicts.length?'База обновлена, есть конфликты':'База обновлена из сетевой папки')}}catch(e){replace(new Workspace(SQL,openDb(SQL,prev.base),prev));message('Сетевая база не обновлена: '+e.message,true)}}}catch(e){if(!cache){ws=new Workspace(SQL,createDb(SQL,LC_BUILD.schema,LC_BUILD.migration));message('IndexedDB недоступен, ручной режим: '+e.message,true)}else if(ws){message('Локальная копия не записана: '+e.message,true);cache=null}else throw e}render()}
init().catch(e=>{console.error(e);root.replaceChildren(el('h1','Не удалось открыть Lean Center'),el('p',e.message),el('p','Существующие локальные данные не удалены. Проверьте браузер или восстановите проверенную копию.'))});
