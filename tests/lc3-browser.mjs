import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC3 library ')),browser=await chromium.launch({headless:true,...(process.env.RUNNER_OS==='Windows'?{channel:'msedge'}:{})});
const install=path.join(tmp,'Сетевая папка # учебная');await fs.cp('dist/LeanCenter',install,{recursive:true});
const entry=pathToFileURL(path.join(install,'index.html')).href;
const img='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4jkAAAAASUVORK5CYII=';
const p={schemaVersion:2,document:{id:'SOP-qa',status:'Опубликован',number:'15.1.2026 1',version:1},constructor:{schemaVersion:4,meta:{operation:'Проверить учебный стенд'},steps:[{id:1,action:'Проверить',keyMoments:['Безопасность','Качество','Производительность','Затраты','Специальная методика'],reason:'Проверка',durationSeconds:15,hasPhoto:true,imageExt:'png',photoAnnotations:[]}],twi:{enabled:false}},photoAssets:{'1':{original:img,rendered:null,ext:'png',annotations:[]}}};
const raw=JSON.stringify({...p,integrity:{algorithm:'SHA-256',sha256:createHash('sha256').update(JSON.stringify(p)).digest('hex')}},null,2);
try{
 const ctx=await browser.newContext({offline:true,acceptDownloads:true}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 // All HTTP(S) is intercepted: verify the real browser CSP + Stage43 transport
 // with a synthetic response, never send test or corporate content to the cloud.
 const proxy='https://functions.yandexcloud.net/d4ehdpoue3sve6s0f92b',aiTasks=[],unexpected=[];
 const mockPlan={prepare:{purpose:'Учебная цель ИИ',known:'Уточнить опыт',prep:'Подготовить место',interest:'Объяснить цель'},present:{round1:'Показать работу',round2:'Показать ключевые моменты',round3:'Объяснить причины'},tryOut:{perform:'Повторить работу',explain:'Назвать действия',check:'Проверить результат',correct:'Исправить ошибки'},followUp:{help:'Назначить наставника',control:'Уточнить сроки',observe:'Наблюдать выполнение',close:'Зафиксировать результат'}};
 await ctx.route(/^https?:/,async route=>{
  const req=route.request();
  if(req.url()!==proxy){unexpected.push(req.url());return route.abort()}
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type, accept','content-type':'application/json'};
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(req.method(),'POST');const payload=req.postDataJSON();aiTasks.push(payload.task);
  const content=payload.task==='twi_generate'?JSON.stringify(mockPlan):'OK';
  return route.fulfill({status:200,headers,body:JSON.stringify({choices:[{message:{content}}]})});
 });
 await page.addInitScript(()=>{window.open=()=>{throw Error('Unexpected popup: editor must not call window.open')}});
 let popups=0;page.on('popup',()=>popups++);
 async function editorFrame(){const frame=page.locator('#lc-editor-frame');await frame.waitFor();const editor=await (await frame.elementHandle()).contentFrame();assert(editor);await editor.locator('#lc-editor-status').waitFor({timeout:30000});await editor.waitForFunction(()=>{const t=document.getElementById('lc-editor-status')?.textContent||'';return t.includes('Рабочая копия готова')||t.includes('Ошибка загрузки:')},{},{timeout:30000});assert.match(await editor.locator('#lc-editor-status').textContent(),/Рабочая копия готова/);await page.getByText('Редактор готов',{exact:true}).waitFor();return editor}
 async function checkEditorNotifications(frame,label){
  await frame.locator('#lc-editor-ai #aiTestBtn').waitFor({state:'visible'});
  await frame.waitForFunction(()=>{const b=document.getElementById('aiTestBtn'),r=b.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))});
  await frame.evaluate(msg=>toast(msg,'error'),label);
  await frame.waitForFunction(msg=>{const bar=document.getElementById('lc-editor-bar').getBoundingClientRect(),n=[...document.querySelectorAll('#toastContainer .toast')].find(x=>x.textContent.includes(msg));if(!n)return false;const r=n.getBoundingClientRect();return r.top>=bar.bottom+8&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&getComputedStyle(n).opacity==='1'},label);
 }
 await page.goto(entry);await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();
 await page.getByRole('button',{name:'Сотрудники',exact:true}).first().click();
 await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await page.locator('input[name=employee_code]').fill('QA-001');
 await page.locator('input[name=display_name]').fill('Учебный оценщик');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByText('Запись сохранена локально. Изменение ожидает публикации.',{exact:true}).waitFor();
 // Actual active directory roles, with a second person to prove role filtering.
 await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await page.locator('input[name=employee_code]').fill('QA-002');
 await page.locator('input[name=display_name]').fill('Учебный обучаемый');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByText('Запись сохранена локально. Изменение ожидает публикации.',{exact:true}).waitFor();
 const refs=page.locator('.nav-section').filter({has:page.locator('summary',{hasText:'Справочники'})});if(!(await refs.evaluate(x=>x.open)))await refs.locator('summary').click();
 for(const [code,name] of [['INSTRUCTOR','Инструктор'],['TRAINEE','Обучаемый']]){
  await page.getByRole('button',{name:'Роли сотрудников',exact:true}).click();await page.getByRole('button',{name:'Добавить',exact:true}).click();
  await page.locator('input[name=code]').fill(code);await page.locator('input[name=name]').fill(name);
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Запись сохранена локально. Изменение ожидает публикации.',{exact:true}).waitFor();
 }
 for(const [person,role] of [['QA-001 — Учебный оценщик','INSTRUCTOR — Инструктор'],['QA-002 — Учебный обучаемый','TRAINEE — Обучаемый']]){
  await page.getByRole('button',{name:'Назначения ролей',exact:true}).click();await page.getByRole('button',{name:'Добавить',exact:true}).click();
  await page.locator('select[name=person_id]').selectOption({label:person});await page.locator('select[name=role_id]').selectOption({label:role});
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Запись сохранена локально. Изменение ожидает публикации.',{exact:true}).waitFor();
 }
 await page.getByRole('button',{name:'Конструктор СОП',exact:true}).first().click();
 await page.getByRole('button',{name:'Создать СОП',exact:true}).click();
 const emptyEditor=await editorFrame();
 assert.equal(await page.locator('.sidebar').isVisible(),true);assert.equal(await page.locator('.sidebar .nav.active').textContent(),'Конструктор СОП');
 assert.equal(aiTasks.length,0,'No automatic AI requests');
 await ctx.setOffline(false);
 await emptyEditor.locator('#aiTestBtn').click();
 await emptyEditor.getByText('AI: доступен',{exact:true}).waitFor();
 assert.deepEqual(aiTasks,['healthcheck']);
 await emptyEditor.locator('#toastContainer').getByText('AI proxy отвечает',{exact:true}).waitFor();
 await checkEditorNotifications(emptyEditor,'Учебное уведомление СОП');
 const normalViewport=page.viewportSize();await page.setViewportSize({width:900,height:650});
 await checkEditorNotifications(emptyEditor,'Учебное уведомление после изменения ширины');
 await page.setViewportSize(normalViewport);
 await fs.mkdir('artifacts/lc3',{recursive:true});
 await page.screenshot({path:'artifacts/lc3/sop-ai-toolbar-notification.png',fullPage:true});
 const violations=await emptyEditor.evaluate(async()=>{
  const seen=[];const record=e=>{if(e.violatedDirective==='connect-src')seen.push(e.blockedURI)};
  document.addEventListener('securitypolicyviolation',record);
  for(const url of ['https://example.invalid/lc-probe','https://functions.yandexcloud.net/lc-not-allowed']){
   try{await fetch(url)}catch{}
  }
  await new Promise(r=>setTimeout(r,100));document.removeEventListener('securitypolicyviolation',record);return seen
 });
 assert.equal(violations.length,2,'CSP must block unrelated host and proxy path');assert.deepEqual(unexpected,[]);
 await ctx.setOffline(true);
 await emptyEditor.locator('#meta-operation').fill('Черновик проверки нового редактора');
 await page.getByRole('button',{name:'К библиотеке',exact:true}).click();
 await page.getByRole('button',{name:'Вернуться в редактор',exact:true}).click();
 assert.equal(await emptyEditor.locator('#meta-operation').inputValue(),'Черновик проверки нового редактора');
 await fs.mkdir('artifacts/lc3',{recursive:true});await page.screenshot({path:'artifacts/lc3/new-sop-editor.png',fullPage:true});
 await page.getByRole('button',{name:'Закрыть редактор',exact:true}).click();
 await page.locator('#lc-editor-host').waitFor({state:'detached'});
 // Missing asset must be an explicit error, not a success banner or blank window.
 await page.evaluate(()=>{window.__savedEditorTemplate=window.LC_EDITOR_HTML;window.LC_EDITOR_HTML=undefined});
 await page.getByRole('button',{name:'Создать СОП в редакторе',exact:true}).click();
 await page.getByText('Файл редактора не загружен.',{exact:false}).waitFor();
 assert.equal(await page.locator('#lc-editor-host').count(),0);
 await page.evaluate(()=>{window.LC_EDITOR_HTML=window.__savedEditorTemplate;delete window.__savedEditorTemplate});
 const f=path.join(tmp,'sop.json');await fs.writeFile(f,raw);const choose=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Импорт JSON Stage43'}).click();await (await choose).setFiles(f);
 await page.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();await page.locator('input[name=library_code]').fill('QA-SOP');
 await page.getByRole('button',{name:'Сохранить новый черновик'}).click();await page.getByRole('heading',{name:'QA-SOP · Проверить учебный стенд'}).waitFor();
 await fs.mkdir('artifacts/lc3',{recursive:true});await page.screenshot({path:'artifacts/lc3/sop-library.png',fullPage:true});
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON',exact:true}).click();const d=await dl;await d.saveAs(path.join(tmp,'readback.json'));assert.equal(await fs.readFile(path.join(tmp,'readback.json'),'utf8'),raw);
 await page.getByRole('button',{name:'Открыть редактор',exact:true}).click();const editor=await editorFrame();
 assert.equal(await editor.locator('#meta-operation').inputValue(),'Проверить учебный стенд');assert.equal(await editor.locator('[data-step-field=action]').first().inputValue(),'Проверить');
 assert.equal(await editor.locator('[data-km]').count(),5);
 assert.equal(await editor.evaluate(()=>state.steps[0].hasPhoto&&!!state.steps[0].imageData),true);
 // Inspect the real XLSX generated by the integrated pinned editor, not a mock.
 await editor.evaluate(()=>{window.__lcOriginalSteps=state.steps.slice()});
 for(const orientation of ['portrait','landscape']){
  const count=orientation==='portrait'?9:12;
  await editor.evaluate(n=>{state.steps=[...window.__lcOriginalSteps,...Array.from({length:n-1},(_,i)=>{const s=createEmptyStep();s.action='Учебный шаг '+(i+2);s.durationSeconds=i+2;s.keyMoments=['КМ'];s.reason='Причина';return s})];stateToHtml();htmlFieldToState()},count);
  await editor.locator('#stage43EditorExportFormat [data-stage43-export-format="'+orientation+'"]').click();
  const dl=page.waitForEvent('download',{timeout:85000});await editor.locator('#generateBtn').click();const d=await dl;const file=path.join(tmp,orientation+'.xlsx');await d.saveAs(file);
  const data=await fs.readFile(file);
  const result=await editor.evaluate(async a=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));const sh=w.getWorksheet('СОП');const total=sh.getCell(sh.pageSetup.orientation==='portrait'?'G5':'F3').value;return {names:w.worksheets.map(x=>x.name),orientation:sh.pageSetup.orientation,paperSize:sh.pageSetup.paperSize,images:sh.getImages().length,total:total.result instanceof Date?(total.result.getTime()-Date.UTC(1899,11,30))/86400000:total.result,formula:total.formula,last:sh.getCell(sh.pageSetup.orientation==='portrait'?'J24':'K18').text}},Array.from(data));
  assert.deepEqual(result.names,['СОП','ФРВ','Чек-лист оценки СОП']);assert.equal(result.orientation,orientation);assert.equal(result.paperSize,8);assert(result.images>=1);assert.equal(Math.round(result.total*86400),15+(count*(count+1)/2-1));assert.match(result.last,new RegExp('Учебный шаг '+count));if(orientation==='landscape')for(const cell of ['D18','H18','J18','M18'])assert(result.formula.includes(cell));
 }
 await editor.evaluate(()=>{state.steps=window.__lcOriginalSteps;stateToHtml();htmlFieldToState()});
 assert.equal(await editor.locator('[data-step-field=action]').first().inputValue(),'Проверить');

 await editor.locator('[data-step-field=action]').first().fill('Проверить повторно');
 async function choosePerson(frame,label,query='QA-001'){await frame.getByRole('button',{name:'Выбрать: '+label,exact:true}).first().click();await frame.getByRole('searchbox',{name:'Поиск сотрудника'}).fill(query);await frame.locator('.lc-picker-popup .lc-person-option').click()}
 await choosePerson(editor,'Утверждающий');assert.equal(await editor.locator('#meta-approver-name').inputValue(),'Учебный оценщик');
 await choosePerson(editor,'Участник рабочей группы');assert.equal(await editor.locator('[data-resp]').first().inputValue(),'Учебный оценщик');
 await editor.locator('[data-tab="frv"]').click();await editor.locator('[data-frv="m1"]').first().fill('3');await editor.locator('[data-frv="vdc"]').first().check();
 await editor.locator('[data-tab="twi"]').click();
 await ctx.setOffline(false);
 await editor.locator('#lc-generate-twi-ai').click();
 await editor.waitForFunction(()=>document.getElementById('twi-purpose')?.value==='Учебная цель ИИ');
 assert(aiTasks.includes('twi_generate'));assert.deepEqual(unexpected,[]);
 await editor.locator('#clearTwiBtn').click();
 await ctx.setOffline(true);
 const callsBeforeLocal=aiTasks.length;
 await editor.locator('#generateTwiBtn').click();await editor.waitForFunction(()=>!!document.getElementById('twi-purpose')?.value);
 assert.equal(aiTasks.length,callsBeforeLocal,'Local TWI must not use cloud');
 const initialPlan=await editor.evaluate(()=>({signature:state.twi.sourceSignature,prep:state.twi.prepare.prep}));
 await editor.locator('#twi-known').fill('Учебная ручная правка');
 await editor.locator('[data-tab="editor"]').click();await editor.locator('#meta-tools').fill('Учебный инструмент');await editor.locator('#meta-material').fill('Учебный материал');await editor.locator('[data-step-field=action]').first().fill('Проверить ещё раз');
 await editor.locator('[data-tab="twi"]').click();
 assert.equal(await editor.evaluate(()=>state.twi.sourceSignature!==twiSourceSignature()),true);
 const preview=editor.locator('#twiGenerationPreview');
 await editor.locator('#generateTwiBtn').click();await preview.waitFor();
 for(const choice of await preview.locator('[data-twi-choice]').all())await choice.uncheck();
 await preview.locator('[data-twi-preview-apply]').click();await editor.waitForFunction(()=>!document.getElementById('generateTwiBtn').disabled);
 assert.deepEqual(await editor.evaluate(()=>({signature:state.twi.sourceSignature,prep:state.twi.prepare.prep})),initialPlan);
 await editor.locator('#generateTwiBtn').click();await preview.waitFor();
 const prepChoice=preview.locator('label').filter({hasText:'Подготовка / Подготовка рабочего места'}).locator('input');
 await prepChoice.uncheck();await preview.locator('[data-twi-preview-apply]').click();await editor.waitForFunction(()=>!document.getElementById('generateTwiBtn').disabled);
 assert.equal(await editor.evaluate(()=>state.twi.sourceSignature!==twiSourceSignature()),true);
 await editor.locator('#generateTwiBtn').click();await preview.waitFor();assert.equal(await prepChoice.isChecked(),true);
 await preview.locator('[data-twi-preview-apply]').click();await editor.waitForFunction(()=>!document.getElementById('generateTwiBtn').disabled);
 assert.equal(await editor.evaluate(()=>state.twi.sourceSignature===twiSourceSignature()),true);
 assert.match(await editor.locator('#twi-prep').inputValue(),/Учебный материал/);assert.equal(await editor.locator('#twi-known').inputValue(),'Учебная ручная правка');
 // Restore the existing fixture's action and refresh before saving.
 await editor.locator('[data-tab="editor"]').click();await editor.locator('[data-step-field=action]').first().fill('Проверить повторно');await editor.locator('[data-tab="twi"]').click();
 await editor.locator('#generateTwiBtn').click();await preview.waitFor();await preview.locator('[data-twi-preview-apply]').click();await editor.waitForFunction(()=>!document.getElementById('generateTwiBtn').disabled);
 assert.equal(await editor.evaluate(()=>state.twi.sourceSignature===twiSourceSignature()),true);
 assert.equal(aiTasks.length,callsBeforeLocal);
 await editor.getByRole('button',{name:'Выбрать: Инструктор / наставник',exact:true}).click();
 await editor.getByRole('searchbox',{name:'Поиск сотрудника'}).fill('Уч');
 assert.equal(await editor.locator('.lc-picker-popup .lc-person-option').count(),1);
 assert.match(await editor.locator('.lc-picker-popup .lc-person-option').textContent(),/Учебный оценщик/);
 await editor.getByRole('combobox',{name:'Роль сотрудника'}).selectOption('mentor');assert.equal(await editor.locator('.lc-picker-popup .lc-person-option').count(),0);
 await editor.getByRole('combobox',{name:'Роль сотрудника'}).selectOption('instructor');await editor.locator('.lc-picker-popup .lc-person-option').click();
 assert.equal(await editor.locator('#twi-trainer').inputValue(),'Учебный оценщик');
 await choosePerson(editor,'Обучаемый','Уч обу');assert.equal(await editor.locator('#twi-trainee').inputValue(),'Учебный обучаемый');
 await page.screenshot({path:'artifacts/lc3/twi-editor.png',fullPage:true});
 await editor.locator('[data-tab="checklist"]').click();await editor.locator('[data-score="1"]').selectOption('0.7');await editor.locator('[data-comment="1"]').fill('Учебный комментарий из конструктора');
 await editor.locator('#lc-editor-send').click();await page.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();await page.getByRole('button',{name:'Сохранить изменения черновика'}).click();await page.getByText('Черновик сохранён. Ожидает общей публикации базы.',{exact:true}).waitFor();
 await page.locator('#lc-editor-host').waitFor({state:'detached'});
 await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await page.getByRole('button',{name:'Каталог СОП',exact:true}).first().click();await page.getByRole('button',{name:'Открыть',exact:true}).click();await page.getByRole('heading',{name:'QA-SOP · Проверить учебный стенд'}).waitFor();
 const dl2=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON',exact:true}).click();await (await dl2).saveAs(path.join(tmp,'edited.json'));const edited=JSON.parse(await fs.readFile(path.join(tmp,'edited.json'),'utf8'));assert.equal(edited.constructor.steps[0].action,'Проверить повторно');assert(edited.photoAssets['1'].original.startsWith('data:image/'));assert.equal(edited.constructor.leanCenterPeople.length,4);assert.equal(edited.constructor.leanCenterPeople[0].display_name,'Учебный оценщик');assert.match(edited.constructor.leanCenterPeople[0].person_id,/^[0-9a-f-]{36}$/);assert.equal(edited.constructor.twi.trainer,'Учебный оценщик');assert(edited.constructor.twi.prepare.purpose);assert.equal(Number(edited.constructor.steps[0].frv.m1),3);

 // Linked FRV and TWI must be exposed from the same SOP version.
 await page.locator('.library-tabs').getByRole('button',{name:'ФРВ',exact:true}).click();await page.getByRole('button',{name:'Показать ФРВ по СОП',exact:true}).click();
 await page.getByText('Расчёт по шагам СОП, версия 1. Это не самостоятельные фактические замеры.',{exact:true}).waitFor();
 await page.locator('.library-tabs').getByRole('button',{name:'План TWI',exact:true}).click();await page.getByRole('button',{name:'Показать план инструктажа TWI',exact:true}).click();
 await page.getByText('Инструктор: Учебный оценщик · Обучаемый: Учебный обучаемый',{exact:true}).waitFor();
 const group=page.locator('.nav-section').filter({has:page.locator('summary',{hasText:'Производственное обучение'})});if(!(await group.evaluate(x=>x.open)))await group.locator('summary').click();
 await page.getByRole('button',{name:'Планы инструктажа TWI',exact:true}).first().click();await page.getByRole('heading',{name:'Реестр планов инструктажа TWI'}).waitFor();
 await page.getByRole('button',{name:'Открыть',exact:true}).click();await page.getByRole('button',{name:'Показать план инструктажа TWI',exact:true}).click();
 await page.getByText('Инструктор: Учебный оценщик · Обучаемый: Учебный обучаемый',{exact:true}).waitFor();
 await page.getByText('Статус: Сформирован · 15 из 15 полей. План связан с версией 1 и не является назначением обучения.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Карточка СОП',exact:true}).click();
 await page.getByRole('button',{name:'Все версии СОП',exact:true}).waitFor();assert.equal(await page.locator('[data-revision-id]').count(),1);
 // The weighted checklist is immediately available in the assessment registry.
 await page.getByRole('button',{name:'Оценка СОП',exact:true}).first().click();
 await page.getByRole('heading',{name:'Реестр оценок СОП'}).waitFor();
 assert.equal(await page.locator('select[name=stage43_score_1]').count(),0,'Registry must not open assessment automatically');
 await page.locator('input[name=evaluation_search]').fill('Нет совпадений');await page.getByText('Нет СОП по заданному поиску.',{exact:true}).waitFor();
 await page.locator('input[name=evaluation_search]').fill('QA-SOP');
 await page.getByRole('button',{name:'Открыть',exact:true}).click();
 await page.locator('select[name=stage43_score_1]').waitFor();
 assert.equal(await page.locator('select[name=stage43_score_1]').inputValue(),'0.7');
 assert.equal(await page.locator('input[name=stage43_note_1]').inputValue(),'Учебный комментарий из конструктора');
 await page.locator('select[name=stage43_score_1]').selectOption('1');
 await page.locator('input[name=stage43_note_1]').fill('Уточнено в центре');
 await choosePerson(page,'Оценщик чек-листа','Уч оц');
 await page.getByRole('button',{name:'Сохранить чек-лист СОП',exact:true}).click();
 await page.getByText('Чек-лист СОП сохранён. Ожидает публикации.',{exact:true}).waitFor();
 await page.locator('select[name=stage43_score_1]').waitFor();assert.equal(await page.locator('select[name=stage43_score_1]').inputValue(),'1');
 await page.getByRole('button',{name:'К списку оценок',exact:true}).click();assert.equal(await page.locator('select[name=stage43_score_1]').count(),0);
 await page.reload();await page.getByRole('button',{name:'Оценка СОП',exact:true}).first().click();
 await page.getByRole('button',{name:'Открыть',exact:true}).click();
 await page.locator('input[name=stage43_note_1]').waitFor();assert.equal(await page.locator('input[name=stage43_note_1]').inputValue(),'Уточнено в центре');
 await page.screenshot({path:'artifacts/lc3/stage43-checklist-registry.png',fullPage:true});
 const wd=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать чек-лист XLSX',exact:true}).click();const wf=path.join(tmp,'weighted.xlsx');await (await wd).saveAs(wf);
 const weighted=await page.evaluate(async a=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));const s=w.getWorksheet('Чек-лист Stage43');return {score:s.getCell('C5').value,note:s.getCell('F5').value,formula:s.getCell('C19').value.formula}},Array.from(await fs.readFile(wf)));
 assert.deepEqual(weighted,{score:1,note:'Уточнено в центре',formula:'E18/D18'});
 // New corporate SOP assessment is distinct from Stage43 weighted checklist.
 const method={format:'lean-sop-checklist-v1',title:'Учебная методика',source_sha256:'a'.repeat(64),criteria:Array.from({length:20},(_,i)=>({code:i+1,question:'Учебное требование '+(i+1)}))};
 const mf=path.join(tmp,'method.json');await fs.writeFile(mf,JSON.stringify(method));
 await page.locator('details.evaluation-methods > summary').click();
 const mc=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Загрузить методику JSON'}).click();await (await mc).setFiles(mf);
 await page.getByText('Методика добавлена, ожидает публикации.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Каталог СОП',exact:true}).first().click();await page.getByRole('button',{name:'Открыть',exact:true}).click();
 await page.locator('.library-tabs').getByRole('button',{name:'Оценка СОП',exact:true}).click();
 await page.locator('input[name=stage43_note_1]').waitFor();assert.equal(await page.locator('input[name=stage43_note_1]').inputValue(),'Уточнено в центре');
 await page.getByRole('button',{name:'Корпоративская оценка (20 критериев)',exact:true}).click();
 await choosePerson(page,'Оценщик','Уч оц');
 await page.locator('input[name=eval_place]').fill('Учебное место');
 const saveEval=page.getByRole('button',{name:'Зафиксировать оценку'});assert.equal(await saveEval.isDisabled(),true);
 for(let i=1;i<=20;i++)await page.locator('select[name=criterion_'+i+']').selectOption(i<=17?'1':'0');
 assert.equal(await saveEval.isDisabled(),false);await saveEval.click();
 await page.getByText('Оценка СОП сохранена. Ожидает публикации.',{exact:true}).waitFor();
 await page.locator('.library-tabs').getByRole('button',{name:'Оценка СОП',exact:true}).click();
 await page.getByRole('button',{name:'Корпоративская оценка (20 критериев)',exact:true}).click();
 await page.getByText('17/20 · 85%',{exact:true}).waitFor();
 const reportDl=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать XLSX',exact:true}).click();
 const report=await reportDl,rf=path.join(tmp,'evaluation.xlsx');await report.saveAs(rf);
 const reportData=await page.evaluate(async a=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));const s=w.getWorksheet('Оценка СОП');return {last:s.getCell('A25').value,formula:s.getCell('C26').value.formula,result:s.getCell('C26').value.result}},Array.from(await fs.readFile(rf)));
 assert.deepEqual(reportData,{last:20,formula:'SUM(C6:C25)/20',result:.85});
 await page.screenshot({path:'artifacts/lc3/sop-evaluation.png',fullPage:true});
 await page.getByRole('button',{name:'ФРВ',exact:true}).first().click();const frv=path.join(tmp,'frv.json');await fs.writeFile(frv,JSON.stringify({schemaVersion:'FRV-1.3',study:{studyId:'FRV-QA',operationId:'Исследование QA'},cycles:[{id:'c1',cycleNo:1,phase:'baseline',observations:[{id:'o1',actionRaw:'Действие',durationSec:10,valueType:'VA'}]}]}));
 const cf=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Импорт JSON Stage43'}).click();await (await cf).setFiles(frv);await page.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();await page.locator('input[name=library_observed]').fill('2026-11-20');await page.getByRole('button',{name:'Сохранить новый черновик'}).click();await page.getByRole('heading',{name:'Исследование QA',exact:true}).waitFor();
 await page.getByRole('button',{name:'Открыть редактор',exact:true}).click();const frvEditor=await editorFrame();await frvEditor.locator('#frvs-studyId').waitFor({state:'visible'});assert.equal(await frvEditor.locator('#frvs-studyId').inputValue(),'FRV-QA');
 await ctx.setOffline(false);await frvEditor.locator('#aiTestBtn').click();
 await frvEditor.getByText('AI: доступен',{exact:true}).waitFor();
 await checkEditorNotifications(frvEditor,'Учебное уведомление ФРВ');
 await frvEditor.evaluate(()=>window.scrollTo(0,300));
 await checkEditorNotifications(frvEditor,'Учебное уведомление ФРВ после прокрутки');
 await page.screenshot({path:'artifacts/lc3/frv-ai-toolbar-notification.png',fullPage:true});
 await frvEditor.evaluate(()=>window.scrollTo(0,0));await ctx.setOffline(true);
 await frvEditor.locator('#frvs-operationId').fill('Исследование QA — уточнение');await choosePerson(frvEditor,'Наблюдатель');assert.equal(await frvEditor.locator('#frvs-observer').inputValue(),'Учебный оценщик');
 await frvEditor.locator('#lc-editor-send').click();
 await page.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();
 await page.getByRole('button',{name:'Сохранить изменения черновика'}).click();
 await page.getByText('Черновик сохранён. Ожидает общей публикации базы.',{exact:true}).waitFor();
 await page.locator('#lc-editor-host').waitFor({state:'detached'});assert.equal(popups,0);
 const fd=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON',exact:true}).click();await (await fd).saveAs(path.join(tmp,'frv-edited.json'));
 const frvEdited=JSON.parse(await fs.readFile(path.join(tmp,'frv-edited.json'),'utf8'));assert.equal(frvEdited.study.operationId,'Исследование QA — уточнение');assert.equal(frvEdited.cycles[0].observations[0].durationSec,10);assert.equal(frvEdited.study.leanCenterPeople[0].slot,'observer');assert.equal(frvEdited.study.leanCenterPeople[0].person_id,edited.constructor.leanCenterPeople[0].person_id);await page.getByRole('heading',{name:'ФРВ по СОП',exact:true}).waitFor();
 await page.screenshot({path:'artifacts/lc3/frv-library.png',fullPage:true});
 await page.getByRole('button',{name:'Настройки и обмен',exact:true}).click();const bdl=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать резервную копию',exact:true}).click();const bp=path.join(tmp,'full.leanbackup');await (await bdl).saveAs(bp);const backup=JSON.parse(await fs.readFile(bp,'utf8'));assert.equal(backup.format,'lean-content-bundle-v1');assert.equal(backup.contents.length,4);
 await ctx.close();const c2=await browser.newContext({offline:true,acceptDownloads:true}),p2=await c2.newPage();p2.on('dialog',d=>d.accept());await p2.goto(entry);await p2.getByRole('button',{name:'Настройки и обмен',exact:true}).click();const bc=p2.waitForEvent('filechooser');await p2.getByRole('button',{name:'Восстановить копию',exact:true}).click();await (await bc).setFiles(bp);await p2.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();await p2.getByRole('button',{name:'Каталог СОП',exact:true}).first().click();await p2.getByRole('button',{name:'Открыть',exact:true}).click();await p2.getByRole('heading',{name:'QA-SOP · Проверить учебный стенд'}).waitFor();
 const rdl=p2.waitForEvent('download');await p2.getByRole('button',{name:'Скачать JSON',exact:true}).click();await (await rdl).saveAs(path.join(tmp,'restored.json'));assert.equal(JSON.parse(await fs.readFile(path.join(tmp,'restored.json'),'utf8')).constructor.steps[0].action,'Проверить повторно');assert.deepEqual(errors,[]);await c2.close();
 console.log('LC3 browser PASS: exact SOP source, original photo, Stage43 embedded frame roundtrip (new/edit, no popups, explicit missing asset error), independent FRV, full backup/restore');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
