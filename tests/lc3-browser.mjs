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
 // Test-only wire observation. Never record source content, IDs or session tokens in the report.
 const wireEvidence=[];
 await page.addInitScript(()=>{
  window.open=()=>{throw Error('Unexpected popup: editor must not call window.open')};
  if(window===window.parent){window.__lcWire=[];window.addEventListener('message',e=>{
   const m=e.data,f=document.getElementById('lc-editor-frame');if(m?.protocol!=='lean-editor-v1'||!f)return;
   const sameSource=e.source===f.contentWindow,sameSession=m.session===f.contentWindow.LC_EDITOR_CONTEXT?.session;
   if(['ready','loaded','source','modal'].includes(m.type))window.__lcWire.push({type:m.type,sameSource,sameSession,...(m.type==='modal'?{open:m.open===true}:{})})
  })}
 });
 const wire=()=>page.evaluate(()=>window.__lcWire.slice());
 const readKv=key=>page.evaluate(key=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('lean-center-lc1',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,t=db.transaction('kv','readonly'),r=t.objectStore('kv').get(key);let value;r.onsuccess=()=>{value=r.result};t.oncomplete=()=>{db.close();resolve(value??null)};t.onerror=()=>{db.close();reject(t.error)}}
 }),key);

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
 const handshake=(await wire()).filter(e=>e.sameSource&&e.sameSession).map(e=>e.type);
 assert(handshake.indexOf('ready')>=0&&handshake.indexOf('loaded')>handshake.indexOf('ready'));
 wireEvidence.push({id:'editor-handshake',observed:handshake.filter(t=>t==='ready'||t==='loaded'),assertion:'active iframe ready precedes loaded; host and editor show ready'});
 // Real messages from the active iframe with a wrong session and from the wrong window.
 await emptyEditor.evaluate(()=>parent.postMessage({protocol:'lean-editor-v1',session:'invalid-session',type:'modal',open:true},'*'));
 await page.waitForFunction(()=>window.__lcWire.some(e=>e.type==='modal'&&e.sameSource&&!e.sameSession));
 assert.equal(await page.locator('.editor-host-bar').evaluate(e=>e.inert),false);
 await page.evaluate(()=>window.postMessage({protocol:'lean-editor-v1',session:document.getElementById('lc-editor-frame').contentWindow.LC_EDITOR_CONTEXT.session,type:'modal',open:true},'*'));
 await page.waitForFunction(()=>window.__lcWire.some(e=>e.type==='modal'&&!e.sameSource&&e.sameSession));
 assert.equal(await page.locator('.editor-host-bar').evaluate(e=>e.inert),false);
 const denied=await page.evaluate(async()=>{
  const f=document.getElementById('lc-editor-frame').contentWindow,s=f.LC_EDITOR_CONTEXT.session;
  const denied=async(caller,session)=>{try{await window.LCSopRecovery(caller,session,'read');return false}catch(e){return /Редактор уже закрыт/.test(e.message)}};
  return [await denied(window,s),await denied(f,'invalid-session')]
 });
 assert.deepEqual(denied,[true,true]);wireEvidence.push({id:'editor-rejected-boundary',wrongSession:true,wrongWindow:true,rpcRejected:2});

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
 // LC5.4: exact real editor input and both Stage43 XLSX templates without photos.
 await emptyEditor.evaluate(()=>{state.steps=Array.from({length:2},(_,i)=>{const s=createEmptyStep();s.action=i?'Проверить метку учебной панели':'Открыть учебный кожух';s.keyMoments=['Ключевой момент'];s.reason='Причина';return s});state.safetyIconIds=[ICON_LIB.find(x=>x.id==='M004')?.id||ICON_LIB[0].id];stateToHtml()});
 // One add control per step at all counts, including the former 3/4 overlap.
 const kmCard=emptyEditor.locator('#stepsContainer .step-card').first(),kmFields=kmCard.locator('[data-km]'),kmAdd=kmCard.locator('[data-add-km],[data-stage42-add-more-km]');
 for(let count=1;count<=5;count++){
  assert.equal(await kmFields.count(),count);
  assert.equal(await kmAdd.count(),1,'exactly one add-KM control at '+count);
  assert.equal(await kmCard.locator('[data-add-km]').count(),1);
  await kmAdd.click();
  await emptyEditor.waitForFunction(n=>state.steps[0].keyMoments.length===n,count+1);
  await kmFields.last().fill('Учебный КМ '+(count+1));
 }
 assert.equal(await kmFields.count(),6);
 assert.equal(await kmAdd.count(),1);
 assert.deepEqual(await emptyEditor.evaluate(()=>state.steps[0].keyMoments),['Ключевой момент','Учебный КМ 2','Учебный КМ 3','Учебный КМ 4','Учебный КМ 5','Учебный КМ 6']);
 // Restore original photo/time fixture through the real remove controls.
 for(let count=6;count>1;count--){await kmCard.locator('[data-rm-km]').last().click();await emptyEditor.waitForFunction(n=>state.steps[0].keyMoments.length===n,count-1)}
 assert.equal(await kmFields.count(),1);
 assert.equal(await kmAdd.count(),1);
 const times=emptyEditor.locator('[data-step-field=duration]');
 await times.nth(0).fill('12');await times.nth(1).fill('00:23');assert.deepEqual(await emptyEditor.evaluate(()=>state.steps.map(s=>s.durationSeconds)),[12,23]);
 await times.nth(0).fill('12:99');assert.equal(await times.nth(0).getAttribute('aria-invalid'),'true');assert.equal(await emptyEditor.evaluate(()=>state.steps[0].durationSeconds),12);
 await emptyEditor.locator('#lc-editor-send').click();await emptyEditor.locator('#lc-editor-status').getByText(/Исправьте некорректное время шага/).waitFor();assert.equal(await page.getByRole('heading',{name:'Проверенный исходный файл'}).count(),0);
 await times.nth(0).fill('12');
 // Inspect serialized Excel bytes BEFORE the import wizard accesses cells.
 // Reading via getCell can allocate blank rows; the print range and actual
 // master cell, not the mutable rowCount, identify the printed final line.
 async function checkSopFooter(frame,file,orientation,tag){
  const bytes=await fs.readFile(file);
  await fs.mkdir('artifacts/lc3/export-qa',{recursive:true});
  await fs.copyFile(file,path.join('artifacts/lc3/export-qa',tag+'-'+orientation+'.xlsx'));
  const info=await frame.evaluate(async a=>{
   const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));
   const sh=w.getWorksheet('СОП'),phrase='Ответственность за поддержание в рабочем состоянии СОП возлагается на ДОЛЖНОСТЬ',hits=[],otherHits=[];
   let lastDataRow=0;
   for(const sheet of w.worksheets)sheet.eachRow(row=>row.eachCell(cell=>{
    if(cell.isMerged&&cell.master.address!==cell.address)return;
    if(sheet===sh&&cell.value!==null&&cell.value!==undefined&&cell.value!=='')lastDataRow=Math.max(lastDataRow,row.number);
    if(cell.value===phrase)(sheet===sh?hits:otherHits).push({address:cell.address,row:row.number,value:cell.value});
   }));
   const printArea=String(sh.pageSetup.printArea||'').replace(/\$/g,'');
   return {orientation:sh.pageSetup.orientation,printArea,lastDataRow,hits,otherHits,merges:sh.model.merges||[],lastNote:sh.getCell(Math.max(1,lastDataRow-1),sh.pageSetup.orientation==='portrait'?2:1).text};
  },Array.from(bytes));
  console.log('LC6.7.6 SOP footer QA',tag,orientation,JSON.stringify(info));
  assert.equal(info.orientation,orientation);assert.equal(info.hits.length,1,'Exactly one literal SOP footer');assert.deepEqual(info.otherHits,[]);
  const hit=info.hits[0],col=orientation==='portrait'?'B':'A',end=orientation==='portrait'?'L':'M';
  assert.equal(hit.value,'Ответственность за поддержание в рабочем состоянии СОП возлагается на ДОЛЖНОСТЬ');
  assert.equal(hit.address,col+hit.row);assert.equal(hit.row,info.lastDataRow);
  assert(info.merges.includes(col+hit.row+':'+end+hit.row),'Footer must span the template');
  assert.equal(info.printArea,'A1:M'+hit.row,'Footer must be included in the print area');
  assert.equal(info.lastNote,'! Время действия писать в формате: мм:сс','Footer follows existing template note');
 }
 async function exportAndInspect(frame,orientation,expectedPhotos,tag){
  await frame.locator('#stage43EditorExportFormat [data-stage43-export-format="'+orientation+'"]').click();
  const wait=page.waitForEvent('download',{timeout:85000});await frame.locator('#generateBtn').click();const file=path.join(tmp,tag+'-'+orientation+'.xlsx');await (await wait).saveAs(file);await checkSopFooter(frame,file,orientation,tag);
  const info=await frame.evaluate(async a=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));const sh=w.getWorksheet('СОП'),p=stage42ParseSelectedSheet(w,sh,'QA.xlsx');const output={photos:p.steps.map(s=>s.photoIndex>=0),seconds:p.steps.map(s=>s.durationSeconds),imageCount:sh.getImages().length,service:p.media.filter(m=>m.serviceImage).length};stage42ReleaseProposal(p);return output},Array.from(await fs.readFile(file)));
  assert.deepEqual(info.photos,expectedPhotos,tag+' '+orientation+' photo assignment');assert.deepEqual(info.seconds,[12,23]);assert(info.imageCount>=2,'Workbook must include logo and safety pictogram');assert(info.service>=2);
 }
 for(const orientation of ['portrait','landscape'])await exportAndInspect(emptyEditor,orientation,[false,false],'no-photos');
 // Synthetic photo; use the real photo load and annotation controls.
 await emptyEditor.locator('[data-tab="editor"]').click();
 const photoData=await emptyEditor.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=525;const g=c.getContext('2d');g.fillStyle='#cbd5e1';g.fillRect(0,0,900,525);g.fillStyle='#16a34a';g.fillRect(100,100,300,120);return c.toDataURL('image/png').split(',')[1]});
 await emptyEditor.locator('input[data-input]').first().setInputFiles({name:'synthetic-panel.png',mimeType:'image/png',buffer:Buffer.from(photoData,'base64')});
 await emptyEditor.waitForFunction(()=>state.steps[0].hasPhoto&&!!state.steps[0].imageData);
 await emptyEditor.locator('[data-edit-photo]').first().click();await emptyEditor.locator('#illClose').waitFor();
 for(const size of [{width:1440,height:970},{width:1024,height:768}]){await page.setViewportSize(size);await emptyEditor.waitForFunction(()=>{const b=document.getElementById('illClose'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))&&document.getElementById('lc-editor-bar').inert});await page.waitForFunction(()=>document.querySelector('.editor-host-bar')?.inert)}
 await page.setViewportSize({width:1440,height:970});
 const canvas=emptyEditor.locator('#illCanvas');await canvas.scrollIntoViewIfNeeded();await emptyEditor.locator('[data-ill-mode=label]').click();await emptyEditor.locator('#illTextInput').fill('Проверить зелёный индикатор');
 const clickPoint=async(x,y)=>{await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();await canvas.click({position:{x:b.width*x,y:b.height*y}})};
 await clickPoint(.10,.12);await emptyEditor.locator('[data-ill-mode=callout]').click();await emptyEditor.locator('#illTextInput').fill('Проверить кнопку');
 await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.65);await page.mouse.down();await page.mouse.move(box.x+box.width*.72,box.y+box.height*.23,{steps:8});await page.mouse.up();
 await emptyEditor.locator('#illSave').click();await emptyEditor.locator('#illustrationEditorOverlay').waitFor({state:'detached'});await page.waitForFunction(()=>!document.querySelector('.editor-host-bar').inert);
 const modalWire=(await wire()).filter(e=>e.type==='modal'&&e.sameSource&&e.sameSession).map(e=>e.open);assert(modalWire.includes(true)&&modalWire.lastIndexOf(false)>modalWire.indexOf(true));wireEvidence.push({id:'editor-modal',observed:modalWire,assertion:'host toolbar inert during actual modal, restored on close'});

 assert.deepEqual(await emptyEditor.evaluate(()=>state.steps[0].photoAnnotations.filter(x=>['label','callout'].includes(x.type)).map(x=>x.text)),['Проверить зелёный индикатор','Проверить кнопку']);
 await page.setViewportSize(normalViewport);
 for(const orientation of ['portrait','landscape'])await exportAndInspect(emptyEditor,orientation,[true,false],'with-photo');
 await emptyEditor.locator('[data-tab="editor"]').click();
 await page.getByRole('button',{name:'К библиотеке',exact:true}).click();
 await page.getByRole('button',{name:'Вернуться в редактор',exact:true}).click();
 assert.equal(await emptyEditor.locator('#meta-operation').inputValue(),'Черновик проверки нового редактора');
 await fs.mkdir('artifacts/lc3',{recursive:true});await page.screenshot({path:'artifacts/lc3/new-sop-editor.png',fullPage:true});
 // Full portable recovery includes original image and annotations, without catalog publication.
 await emptyEditor.waitForFunction(()=>document.getElementById('lc-sop-recovery-status')?.textContent.includes('Черновик СОП сохранён'));
 await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await page.getByRole('button',{name:'Конструктор СОП',exact:true}).first().click();await page.getByRole('button',{name:'Создать СОП',exact:true}).click();const recovered=await editorFrame();
 assert.equal(await recovered.locator('#meta-operation').inputValue(),'Черновик проверки нового редактора');assert.equal(await recovered.evaluate(()=>state.steps[0].hasPhoto&&!!state.steps[0].imageData),true);
 assert.deepEqual(await recovered.evaluate(()=>state.steps[0].photoAnnotations.filter(x=>['label','callout'].includes(x.type)).map(x=>x.text)),['Проверить зелёный индикатор','Проверить кнопку']);
 await recovered.locator('#lc-sop-discard-recovery').click();await recovered.waitForFunction(()=>document.getElementById('lc-sop-recovery-status')?.textContent.includes('Локальная копия удалена'));
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
  await checkSopFooter(editor,file,orientation,'multi-group');const data=await fs.readFile(file);
  const result=await editor.evaluate(async a=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));const sh=w.getWorksheet('СОП');const total=sh.getCell(sh.pageSetup.orientation==='portrait'?'G5':'F3').value;return {names:w.worksheets.map(x=>x.name),orientation:sh.pageSetup.orientation,paperSize:sh.pageSetup.paperSize,images:sh.getImages().length,total:total.result instanceof Date?(total.result.getTime()-Date.UTC(1899,11,30))/86400000:total.result,formula:total.formula,last:sh.getCell(sh.pageSetup.orientation==='portrait'?'J24':'K18').text}},Array.from(data));
  assert.deepEqual(result.names,['СОП','ФРВ','Чек-лист оценки СОП']);assert.equal(result.orientation,orientation);assert.equal(result.paperSize,8);assert(result.images>=1);assert.equal(Math.round(result.total*86400),15+(count*(count+1)/2-1));assert.match(result.last,new RegExp('Учебный шаг '+count));if(orientation==='landscape')for(const cell of ['D18','H18','J18','M18'])assert(result.formula.includes(cell));
 }
 await editor.evaluate(()=>{state.steps=window.__lcOriginalSteps;stateToHtml();htmlFieldToState()});
 assert.equal(await editor.locator('[data-step-field=action]').first().inputValue(),'Проверить');

 await editor.locator('[data-step-field=action]').first().fill('Проверить повторно');
 await editor.locator('#stepsContainer .step-card').first().locator('[data-add-km]').click();
 await editor.locator('[data-km]').last().fill('Шестой КМ — сохранить без потери');
 assert.equal(await editor.locator('[data-km]').count(),6);
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
 const oldKey=await editor.evaluate(()=>window.LC_EDITOR_CONTEXT.draftKey),oldGeneration=(await readKv('workspace')).generation;
 await editor.locator('#lc-editor-send').click();await page.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();
 assert((await wire()).some(e=>e.type==='source'&&e.sameSource&&e.sameSession));
 const checkpoint=await readKv(oldKey);assert(checkpoint?.token&&checkpoint.text);assert.equal(JSON.parse(checkpoint.text).constructor.steps[0].action,'Проверить повторно');assert.equal((await readKv('workspace')).generation,oldGeneration);
 // Inject a failure in the workspace transaction, not the content store or recovery write.
 await page.evaluate(()=>{window.__lcOldPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(k==='workspace')throw new DOMException('QA workspace quota','QuotaExceededError');return window.__lcOldPut.call(this,v,k)}});
 try{
  await page.getByRole('button',{name:'Сохранить изменения черновика'}).click();await page.getByText(/Локальная запись не выполнена. Изменения не записаны/).waitFor();
  await page.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();
  assert.equal((await readKv('workspace')).generation,oldGeneration);
  assert.deepEqual(await readKv(oldKey),checkpoint);
 }finally{await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__lcOldPut;delete window.__lcOldPut})}
 wireEvidence.push({id:'editor-transfer-and-rollback',sourceDelivered:true,previewNotCommitted:true,failedCommitPreservedCheckpoint:true});
 await page.getByRole('button',{name:'Сохранить изменения черновика'}).click();await page.getByText('Черновик сохранён. Ожидает общей публикации базы.',{exact:true}).waitFor();
 await page.locator('#lc-editor-host').waitFor({state:'detached'});
 assert.equal(await readKv(oldKey),null);assert.equal((await readKv('workspace')).generation,oldGeneration+1);
 wireEvidence.push({id:'editor-commit-clear',workspaceCommitted:true,matchingRecoveryRemoved:true});

 await page.locator('#lc-editor-host').waitFor({state:'detached'});
 await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await page.getByRole('button',{name:'Каталог СОП',exact:true}).first().click();await page.getByRole('button',{name:'Открыть',exact:true}).click();await page.getByRole('heading',{name:'QA-SOP · Проверить учебный стенд'}).waitFor();
 const dl2=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON',exact:true}).click();await (await dl2).saveAs(path.join(tmp,'edited.json'));const edited=JSON.parse(await fs.readFile(path.join(tmp,'edited.json'),'utf8'));assert.equal(edited.constructor.steps[0].action,'Проверить повторно');assert.equal(edited.constructor.steps[0].keyMoments.length,6);assert.equal(edited.constructor.steps[0].keyMoments[5],'Шестой КМ — сохранить без потери');assert(edited.photoAssets['1'].original.startsWith('data:image/'));assert.equal(edited.constructor.leanCenterPeople.length,4);assert.equal(edited.constructor.leanCenterPeople[0].display_name,'Учебный оценщик');assert.match(edited.constructor.leanCenterPeople[0].person_id,/^[0-9a-f-]{36}$/);assert.equal(edited.constructor.twi.trainer,'Учебный оценщик');assert(edited.constructor.twi.prepare.purpose);assert.equal(Number(edited.constructor.steps[0].frv.m1),3);

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
 // Reopen the saved six-KM revision after a full page reload.
 await page.getByRole('button',{name:'Открыть редактор',exact:true}).click();const reopenedKm=await editorFrame();assert.equal(await reopenedKm.locator('[data-km]').count(),6);assert.equal(await reopenedKm.locator('[data-km]').last().inputValue(),'Шестой КМ — сохранить без потери');await page.getByRole('button',{name:'Закрыть редактор',exact:true}).click();await page.locator('#lc-editor-host').waitFor({state:'detached'});
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
 await page.getByRole('button',{name:'Открыть редактор',exact:true}).click();let frvEditor=await editorFrame();await frvEditor.locator('#frvs-studyId').waitFor({state:'visible'});assert.equal(await frvEditor.locator('#frvs-studyId').inputValue(),'FRV-QA');
 await ctx.setOffline(false);await frvEditor.locator('#aiTestBtn').click();
 await frvEditor.getByText('AI: доступен',{exact:true}).waitFor();
 await checkEditorNotifications(frvEditor,'Учебное уведомление ФРВ');
 await frvEditor.evaluate(()=>window.scrollTo(0,300));
 await checkEditorNotifications(frvEditor,'Учебное уведомление ФРВ после прокрутки');
 await page.screenshot({path:'artifacts/lc3/frv-ai-toolbar-notification.png',fullPage:true});
 await frvEditor.evaluate(()=>window.scrollTo(0,0));await ctx.setOffline(true);
 await frvEditor.locator('#frvs-operationId').fill('Исследование QA — уточнение');await choosePerson(frvEditor,'Наблюдатель');assert.equal(await frvEditor.locator('#frvs-observer').inputValue(),'Учебный оценщик');
 // LC5.4: input -> live cycle/dashboard/passport, identity-preserving exports, F5 recovery.
 await frvEditor.locator('[data-fs=durationSec]').first().fill('12.5');
 await frvEditor.locator('[data-lc-cycle-summary]').filter({hasText:'12.5 сек'}).waitFor();await frvEditor.waitForFunction(()=>document.getElementById('lc-frv-live-summary')?.textContent.includes('12.5 сек'));
 await frvEditor.locator('#frvStudyValidateBtn').click();assert.equal(await frvEditor.locator('#frvs-status').inputValue(),'Validated');
 await frvEditor.locator('[data-fs=durationSec]').first().fill('13.5');assert.equal(await frvEditor.locator('#frvs-status').inputValue(),'Observed');
 await frvEditor.locator('[data-fs=durationSec]').first().fill('12.5');await frvEditor.locator('[data-fs=valueType]').first().selectOption('NVA_Waste');
 await frvEditor.locator('.frvs-more summary').first().click();await frvEditor.locator('[data-fs=lossCode]').first().selectOption('search_tool');await frvEditor.locator('[data-fs=causeCode]').first().fill('Инструмент вне места хранения');
 async function exportFrvJson(frame,selector,tag){
  const button=frame.locator(selector);
  // Open the native backup menu through its real UI before waiting for a file.
  if(selector==='#frvStudyDownloadBtn'){
   const menu=button.locator('xpath=ancestor::details[1]');
   if(!(await menu.evaluate(el=>el.open)))await menu.locator(':scope > summary').click();
  }
  await button.waitFor({state:'visible'});
  const [download]=await Promise.all([page.waitForEvent('download'),button.click()]);
  const file=path.join(tmp,tag+'.json');await download.saveAs(file);
  return JSON.parse(await fs.readFile(file,'utf8'));
 }
 const topJson=await exportFrvJson(frvEditor,'#lc-editor-download','frv-top');const nativeJson=await exportFrvJson(frvEditor,'#frvStudyDownloadBtn','frv-native');assert.deepEqual(nativeJson,topJson);assert.equal(topJson.study.leanCenterPeople[0].person_id,edited.constructor.leanCenterPeople[0].person_id);
 const xlsxWait=page.waitForEvent('download');await frvEditor.locator('#frvStudyExportXlsxBtn').click();const xlsxFile=path.join(tmp,'frv-causes.xlsx');await (await xlsxWait).saveAs(xlsxFile);
 const causes=await frvEditor.evaluate(async a=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));const s=w.getWorksheet('Наблюдения');return [s.getCell('K5').value,s.getCell('K6').value,s.getCell('E6').value]},Array.from(await fs.readFile(xlsxFile)));assert.deepEqual(causes,['Причина потери','Инструмент вне места хранения',12.5]);
 await frvEditor.waitForFunction(()=>document.getElementById('lc-frv-recovery-status')?.textContent.includes('Черновик ФРВ сохранён'));
 const draftKey=await frvEditor.evaluate(()=>window.LC_EDITOR_CONTEXT.draftKey);
 await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await page.getByRole('button',{name:'ФРВ',exact:true}).first().click();await page.getByRole('row').filter({hasText:'Исследование QA'}).getByRole('button',{name:'Открыть',exact:true}).click();await page.getByRole('heading',{name:'Исследование QA',exact:true}).waitFor();await page.getByRole('button',{name:'Открыть редактор',exact:true}).click();frvEditor=await editorFrame();
 assert.equal(await frvEditor.locator('#frvs-operationId').inputValue(),'Исследование QA — уточнение');assert.equal(await frvEditor.locator('[data-fs=durationSec]').first().inputValue(),'12.5');assert.equal(await frvEditor.evaluate(()=>frvStudyExport().study.leanCenterPeople[0].person_id),topJson.study.leanCenterPeople[0].person_id);
 await frvEditor.waitForFunction(()=>document.getElementById('lc-frv-recovery-status')?.textContent.includes('Черновик ФРВ сохранён'));
 await frvEditor.locator('#lc-editor-send').click();
 await page.getByRole('heading',{name:'Проверенный исходный файл'}).waitFor();
 await page.getByRole('button',{name:'Сохранить изменения черновика'}).click();
 await page.getByText('Черновик сохранён. Ожидает общей публикации базы.',{exact:true}).waitFor();
 await page.locator('#lc-editor-host').waitFor({state:'detached'});assert.equal(popups,0);
 const fd=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON',exact:true}).click();await (await fd).saveAs(path.join(tmp,'frv-edited.json'));
 const frvEdited=JSON.parse(await fs.readFile(path.join(tmp,'frv-edited.json'),'utf8'));assert.equal(frvEdited.study.operationId,'Исследование QA — уточнение');assert.equal(frvEdited.cycles[0].observations[0].durationSec,12.5);assert.equal(frvEdited.cycles[0].observations[0].causeCode,'Инструмент вне места хранения');assert.equal(await page.evaluate(k=>localStorage.getItem(k),draftKey),null);assert.equal(frvEdited.study.leanCenterPeople[0].slot,'observer');assert.equal(frvEdited.study.leanCenterPeople[0].person_id,edited.constructor.leanCenterPeople[0].person_id);await page.getByRole('heading',{name:'ФРВ по СОП',exact:true}).waitFor();
 await page.screenshot({path:'artifacts/lc3/frv-library.png',fullPage:true});
 // A completely new unregistered research must also survive reload, separately from catalog.
 await page.getByRole('button',{name:'Создать ФРВ',exact:true}).click();let fresh=await editorFrame();await fresh.locator('#frvs-operationId').fill('Не отправленный учебный черновик QA');await fresh.locator('[data-fs=actionRaw]').first().fill('Замер без публикации');await fresh.locator('[data-fs=durationSec]').first().fill('17.25');
 await fresh.waitForFunction(()=>document.getElementById('lc-frv-recovery-status')?.textContent.includes('Черновик ФРВ сохранён'));
 await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await page.getByRole('button',{name:'ФРВ',exact:true}).first().click();await page.getByRole('button',{name:'Создать ФРВ',exact:true}).click();fresh=await editorFrame();assert.equal(await fresh.locator('#frvs-operationId').inputValue(),'Не отправленный учебный черновик QA');assert.equal(await fresh.locator('[data-fs=durationSec]').first().inputValue(),'17.25');await fresh.locator('#lc-frv-discard-recovery').click();await page.getByRole('button',{name:'Закрыть редактор',exact:true}).click();await page.locator('#lc-editor-host').waitFor({state:'detached'});assert.equal(await page.getByText('Не отправленный учебный черновик QA',{exact:true}).count(),0);

 await page.getByRole('button',{name:'Настройки и обмен',exact:true}).click();const bdl=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать резервную копию',exact:true}).click();const bp=path.join(tmp,'full.leanbackup');await (await bdl).saveAs(bp);const backup=JSON.parse(await fs.readFile(bp,'utf8'));assert.equal(backup.format,'lean-content-bundle-v1');assert.equal(backup.contents.length,4);
 await ctx.close();const c2=await browser.newContext({offline:true,acceptDownloads:true}),p2=await c2.newPage();p2.on('dialog',d=>d.accept());await p2.goto(entry);await p2.getByRole('button',{name:'Настройки и обмен',exact:true}).click();const bc=p2.waitForEvent('filechooser');await p2.getByRole('button',{name:'Восстановить копию',exact:true}).click();await (await bc).setFiles(bp);await p2.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();await p2.getByRole('button',{name:'Каталог СОП',exact:true}).first().click();await p2.getByRole('button',{name:'Открыть',exact:true}).click();await p2.getByRole('heading',{name:'QA-SOP · Проверить учебный стенд'}).waitFor();
 const rdl=p2.waitForEvent('download');await p2.getByRole('button',{name:'Скачать JSON',exact:true}).click();await (await rdl).saveAs(path.join(tmp,'restored.json'));assert.equal(JSON.parse(await fs.readFile(path.join(tmp,'restored.json'),'utf8')).constructor.steps[0].action,'Проверить повторно');assert.deepEqual(errors,[]);await c2.close();
 await fs.mkdir('artifacts/lc73b-runtime',{recursive:true});await fs.writeFile('artifacts/lc73b-runtime/editor-wire.json',JSON.stringify({format:1,scope:'synthetic test-only observations; not a full runtime call graph',checks:wireEvidence},null,2)+'\n');
 console.log('LC3 browser PASS: exact SOP source, original photo, Stage43 embedded frame roundtrip (new/edit, no popups, explicit missing asset error), independent FRV, full backup/restore');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
