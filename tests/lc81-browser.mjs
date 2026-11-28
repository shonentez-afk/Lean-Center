import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {makeSop} from './lc4-fixture.mjs';
import {openSecureQA,MANAGER_ROLE} from '../server/lc81/store.mjs';
import {createSecureQAServer} from '../server/lc81/http.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-browser-'));
const pass=()=>randomBytes(24).toString('base64url'),adminPassword=pass(),managerPassword=pass(),readerPassword=pass();
const day=new Date().toISOString().slice(0,10);
let browser,server,proxy,store;
const close=s=>s?new Promise(resolve=>s.close(resolve)):Promise.resolve();
try{
 const key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=localhost','-days','1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 store=await openSecureQA({dataDir:path.join(root,'store'),initialize:true,password:adminPassword});
 const admin=store.authenticate('admin',adminPassword),site=store.adminData(admin.id).site;
 const ref=async(type,payload)=>(await store.createReference(admin.id,type,payload)).id;
 const a=await ref('org_unit',{code:'QA-A',name:'Учебный участок А',kind:'Участок',parent_id:site}),b=await ref('org_unit',{code:'QA-B',name:'Учебный участок Б',kind:'Участок',parent_id:site});
 const createPerson=async(unit,code,name)=>(await store.changeDirectory(admin.id,1,{type:'person',operation:'create',id:null,expected_revision:0,fields:{unit_id:unit,employee_code:code,display_name:name}})).id;
 const p1=await createPerson(a,'BROWSER-A','Учебный управляющий'),p2=await createPerson(b,'BROWSER-B','Учебный сотрудник Б');
 const am=await ref('role_assignment',{person_id:p1,role_id:MANAGER_ROLE,valid_from:day,valid_to:null}),readerRole=await ref('business_role',{code:'QA-READER',name:'Чтение участка'}),ar=await ref('role_assignment',{person_id:p2,role_id:readerRole,valid_from:day,valid_to:null});
 await store.setPolicy(admin.id,{role_id:readerRole,revision:0,permissions:['person.read_directory','org.read','audit.read','audit.detail','audit.history.read','forms.read','plan.read']});
 const manager=await store.createAccount(admin.id,{person_id:p1,login:'manager',password:managerPassword,generate:false}),reader=await store.createAccount(admin.id,{person_id:p2,login:'reader',password:readerPassword,generate:false});
 await store.grant(admin.id,{account_id:manager.id,assignment_id:am,scope:{kind:'unit_tree',unit_id:site},valid_to:null});
 const readerGrant=await store.grant(admin.id,{account_id:reader.id,assignment_id:ar,scope:{kind:'unit_tree',unit_id:b},valid_to:null});
 proxy=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(cert)},(req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:server.address().port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream);
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const url='https://127.0.0.1:'+proxy.address().port;
 const editorCalls=[];
 server=createSecureQAServer({store,origin:url,editorAiEnabled:true,cloudFetcher:async(url,options)=>{editorCalls.push({url,payload:JSON.parse(options.body)});return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}),{status:200})}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true});const errors=[];
 const button=(p,name)=>p.getByRole('button',{name,exact:true}),indicator=(p,kind)=>p.locator('#save-indicator[data-kind="'+kind+'"]');
 async function profile(login,password,viewport){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport}),p=await ctx.newPage();
  const initialErrors=errors.length;
  p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.dismiss());
  const checkPage=()=>assert.deepEqual(errors.slice(initialErrors),[], 'Browser script error during login: '+login);
  await p.goto(url);checkPage();
  try{
   await p.locator('#login input[name=login]').fill(login);await p.locator('#login input[name=password]').fill(password);
   await button(p,'Войти').click();await p.locator('#workspace').waitFor();await indicator(p,'saved').waitFor({timeout:30000});
   checkPage();
  }catch(e){
   checkPage();
   const status=await p.locator('#status').textContent().catch(()=>null);
   throw new Error('Browser login failed for '+login+'; status: '+(status||'—'),{cause:e});
  }
  return {ctx,p};
 }
 const m=await profile('manager',managerPassword,{width:1440,height:900});
 await m.p.locator('#nav [data-action="person.read_directory"]').click();
 await m.p.getByRole('cell',{name:'BROWSER-A',exact:true}).waitFor();
 await m.p.getByRole('cell',{name:'BROWSER-B',exact:true}).waitFor();
 await m.p.getByRole('row').filter({has:m.p.getByRole('cell',{name:'BROWSER-B',exact:true})}).getByRole('button',{name:'Карточка',exact:true}).click();
 await m.p.getByRole('heading',{name:'Карточка сотрудника · Учебный сотрудник Б',exact:true}).waitFor();
 await button(m.p,'Назначения и роли').click();
 await m.p.getByRole('heading',{name:'Кадровые назначения',exact:true}).waitFor();
 await m.p.locator('#page-heading').getByRole('button',{name:'ИИ-помощник раздела',exact:true}).click();
 const sectionAI=m.p.getByRole('dialog',{name:'ИИ-помощник раздела'});await sectionAI.waitFor();
 await sectionAI.locator('[name=assistant_record] option').first().waitFor({state:'attached'});
 assert((await sectionAI.locator('[name=assistant_record]').textContent()).includes('BROWSER')||await sectionAI.locator('[name=assistant_record] option').count()>=2);
 await sectionAI.getByRole('button',{name:'Проверить выбранную запись',exact:true}).click();
 await m.p.getByRole('dialog',{name:'Контекстный помощник'}).waitFor();
 await m.p.getByRole('dialog',{name:'Контекстный помощник'}).getByRole('button',{name:'Закрыть помощник',exact:true}).click();
 assert.equal(await m.p.locator('#nav [data-action=admin]').count(),0);
 await button(m.p,'Добавить').click();
 await m.p.locator('.lc81-editor input[name=employee_code]').fill('BROWSER-C');
 await m.p.locator('.lc81-editor input[name=display_name]').fill('Учебный созданный');
 await m.p.locator('.lc81-editor select[name=unit_id]').selectOption(a);
 await indicator(m.p,'dirty').waitFor();
 assert(await m.p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}));
 await button(m.p,'Сохранить').click();await m.p.getByRole('cell',{name:'BROWSER-C',exact:true}).waitFor();await indicator(m.p,'saved').waitFor();
 assert.equal(await m.p.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}),false);
 await m.p.getByRole('row').filter({has:m.p.getByRole('cell',{name:'BROWSER-C',exact:true})}).getByRole('button',{name:'Изменить',exact:true}).click();
 await m.p.locator('.lc81-editor input[name=display_name]').fill('Учебный исправленный');
 await button(m.p,'Сохранить').click();await m.p.getByRole('cell',{name:'Учебный исправленный',exact:true}).waitFor();
 // Register and revoke a real document through the protected HTTPS forms.
 const mentorNav=m.p.locator('#nav [data-action="credential.read"]'),mentorGroup=m.p.locator('#nav details').filter({has:m.p.locator('[data-action="credential.read"]')});
 if(!await mentorGroup.evaluate(e=>e.open))await mentorGroup.locator('summary').click();
 await mentorNav.click();
 await button(m.p,'Зарегистрировать документ').click();
 await m.p.locator('#content select[name=person_id]').selectOption(p2);
 await m.p.locator('#content select[name=kind]').selectOption('certificate');
 await m.p.locator('#content select[name=role]').selectOption('instructor');
 await m.p.locator('#content input[name=number]').fill('QA-BROWSER-CERT');
 await m.p.locator('#content input[name=issuer]').fill('Учебный центр');
 await m.p.locator('#content input[name=evidence]').fill('Учебный сертификат');
 await button(m.p,'Сохранить').click();
 await m.p.getByRole('cell',{name:'Зарегистрирован',exact:true}).waitFor();
 assert.equal(store.listResources(manager.id,'credential.read').length,1);
 await button(m.p,'Отозвать').click();
 await m.p.locator('#content input[name=reason]').fill('Учебный отзыв');
 await button(m.p,'Подтвердить отзыв').click();
 await m.p.getByRole('cell',{name:'Отозван',exact:true}).waitFor();
 assert(store.listResources(manager.id,'credential.read')[0].revoked_at);
 // Program constructor through the same protected portal.
 const programNav=m.p.locator('#nav [data-action="program.read"]'),programGroup=m.p.locator('#nav details').filter({has:m.p.locator('[data-action="program.read"]')});
 if(!await programGroup.evaluate(e=>e.open))await programGroup.locator('summary').click();
 await programNav.click();await button(m.p,'Создать шаблон').click();
 await m.p.locator('#content input[name=code]').fill('QA-BROWSER-PROG');
 await m.p.locator('#content input[name=title]').fill('Учебная программа');
 await m.p.locator('#content input[name=t1_title]').fill('Учебная тема');
 await m.p.locator('#content input[name=t1_hours]').fill('1');
 await button(m.p,'Создать шаблон').last().click();
 await m.p.getByRole('cell',{name:'QA-BROWSER-PROG',exact:true}).waitFor();
 await button(m.p,'Открыть шаблон').click();
 await m.p.getByRole('cell',{name:'Учебная тема',exact:true}).waitFor();
 assert.equal(store.listResources(manager.id,'program.read').length,1);
 const matrixNav=m.p.locator('#nav [data-action="matrix.read"]'),matrixGroup=m.p.locator('#nav details').filter({has:m.p.locator('[data-action="matrix.read"]')});
 if(!await matrixGroup.evaluate(e=>e.open))await matrixGroup.locator('summary').click();
 await matrixNav.click();await button(m.p,'Общая матрица всех навыков').click();
 await m.p.getByRole('heading',{name:'Общая матрица всех навыков',exact:true}).waitFor();
 await m.p.locator('#content input[name=q]').waitFor();
 await button(m.p,'Профили профессий').click();await m.p.getByRole('heading',{name:'Профили компетенций профессий',exact:true}).waitFor();
 await button(m.p,'Создать матрицу').click();
 await m.p.locator('#content select[name=shift_id]').waitFor();
 await m.p.locator('#content select[name=profession_id]').waitFor();
 await m.p.locator('#content select[name=category_id]').waitFor();
 await m.p.locator('#content select[name=workplace_id]').waitFor();
 // Development plan through the protected workspace.
 const developmentNav=m.p.locator('#nav [data-action="development.read"]'),developmentGroup=m.p.locator('#nav details').filter({has:m.p.locator('[data-action="development.read"]')});
 if(!await developmentGroup.evaluate(e=>e.open))await developmentGroup.locator('summary').click();
 await developmentNav.click();await button(m.p,'Создать план').click();
 await m.p.locator('#content select[name=person_id]').selectOption(p2);
 await m.p.locator('#content input[name=title]').fill('Учебный план развития');
 await m.p.locator('#content input[name=due_on]').fill(day);
 await button(m.p,'Создать план').last().click();
 await m.p.getByRole('cell',{name:'Учебный план развития',exact:true}).waitFor();
 await button(m.p,'Открыть план').click();
 await m.p.locator('#content details summary').filter({hasText:'Добавить цель'}).click();
 await m.p.locator('#content input[name=title]').fill('Учебная цель');
 await button(m.p,'Добавить цель').click();
 await m.p.locator('#content input[name=title]').waitFor({state:'detached'});
 await m.p.getByRole('cell',{name:'Учебный план развития',exact:true}).waitFor();
 const planId=store.listResources(manager.id,'development.read')[0].id;assert.equal(store.developmentDetail(manager.id,1,planId).goals[0].title,'Учебная цель');
 const skillNav=m.p.locator('#nav [data-action="skill.read"]'),skillGroup=m.p.locator('#nav details').filter({has:m.p.locator('[data-action="skill.read"]')});
 if(!await skillGroup.evaluate(e=>e.open))await skillGroup.locator('summary').click();
 await skillNav.click();await button(m.p,'Создать навыки').click();
 await m.p.locator('#content details summary').filter({hasText:'Новая категория'}).click();
 await m.p.locator('#content details').filter({has:m.p.getByText('Новая категория',{exact:true})}).locator('input[name=name]').fill('Учебная категория');
 await button(m.p,'Создать категорию').click();
 await m.p.locator('#content details summary').filter({hasText:'Новая категория'}).waitFor({state:'detached'});
 await button(m.p,'Создать навыки').click();
 await m.p.locator('#content details summary').filter({hasText:'Общий навык (без операции)'}).click();
 const newSkillForm=m.p.locator('#content details').filter({has:m.p.getByText('Общий навык (без операции)',{exact:true})});
 await newSkillForm.locator('select[name=category_id]').selectOption({label:'Учебная категория'});
 await newSkillForm.locator('input[name=name]').fill('Учебный общий навык');await button(m.p,'Создать навык').click();
 await m.p.getByRole('cell',{name:'Учебный общий навык',exact:true}).waitFor();
 // The protected calendar and report must boot using the new modules.
 const goSection=async action=>{
  const p=m.p,nav=p.locator('#nav [data-action="'+action+'"]'),group=nav.locator('xpath=ancestor::details');
  await p.bringToFront();
  // A click can be ignored while the previous protected action is still
  // finishing or the returning tab is verifying access. Only retry
  // idempotent navigation; never retry a write, bypass permissions or force clicks.
  for(let attempt=0;attempt<5;attempt++){
   await p.locator('html:not(.lc81-access-check) #nav').waitFor();
   await indicator(p,'saved').waitFor();
   await nav.waitFor({state:'attached'});
   if(await p.locator('#menu').isVisible()&&await p.locator('#menu').getAttribute('aria-expanded')!=='true')await p.locator('#menu').click();
   if(await group.count()&&!await group.evaluate(e=>e.open))await group.locator('summary').click();
   try{
    await nav.click({timeout:3000});
    await p.locator('#nav [data-action="'+action+'"][aria-current="page"]').waitFor({timeout:3000});
    await indicator(p,'saved').waitFor();
    assert.equal(await p.locator('#status.error').count(),0,'Navigation failed: '+action);
    return;
   }catch(e){if(attempt===4)throw new Error('Navigation did not settle: '+action+'; status: '+(await p.locator('#status').textContent()),{cause:e})}
  }
 };
 await goSection('profession.read');
 await button(m.p,'Добавить').click();
 await m.p.locator('.lc81-editor input[name=code]').fill('BROWSER-PROF');
 await m.p.locator('.lc81-editor input[name=name]').fill('Учебная профессия браузера');
 await button(m.p,'Сохранить').click();
 await m.p.getByRole('cell',{name:'Учебная профессия браузера',exact:true}).waitFor();
 await goSection('employment.read');
 const employeeRow=m.p.getByRole('row').filter({has:m.p.getByRole('cell',{name:'Учебный сотрудник Б',exact:true})});
 await employeeRow.getByRole('button',{name:'Изменить назначение',exact:true}).click();
 await m.p.locator('#content select[name=profession_id]').selectOption({label:'Учебная профессия браузера'});
 await button(m.p,'Оформить новое назначение').click();
 await m.p.getByRole('cell',{name:'Учебная профессия браузера',exact:true}).waitFor();
 await goSection('instruction.view');await m.p.getByRole('heading',{name:'Реестр инструктажей TWI',exact:true}).waitFor();
 await goSection('internship.view');await m.p.getByRole('heading',{name:'Шаблоны стажировки',exact:true}).waitFor();
 await goSection('mentoring.view');await m.p.getByRole('heading',{name:'Наставники и внутренние тренеры',exact:true}).waitFor();
 await goSection('journal.view');await m.p.getByRole('heading',{name:'Журнал заданий и проведённых инструктажей',exact:true}).waitFor();
 await goSection('retraining.view');await m.p.getByRole('heading',{name:'Единая очередь оснований для переобучения',exact:true}).waitFor();
 await goSection('sop.evaluation.read');await m.p.getByRole('heading',{name:'Оценки СОП',exact:true}).last().waitFor();
 await button(m.p,'Новая оценка СОП').click();await button(m.p,'Установить утверждённый чек-лист из 20 критериев').click();
 await m.p.getByText('Нужны доступная редакция СОП и действующая методика.',{exact:true}).waitFor();
 await goSection('audit.read');
 await button(m.p,'Мобильный аудит · выгрузка и приём').click();
 await m.p.getByRole('heading',{name:'Мобильный аудит L1 · RC1',exact:true}).waitFor();
 await m.p.getByRole('button',{name:'Предварительная проверка JSON',exact:true}).waitFor();
 await goSection('assistant.read');await m.p.locator('#content').getByRole('heading',{name:'ИИ-помощник',exact:true}).waitFor();
 await m.p.getByRole('heading',{name:'Что требует внимания',exact:true}).waitFor();
 await m.p.getByText('Внешний ИИ отключён настройкой сервера или не разрешён для этой области. Локальные рекомендации доступны.',{exact:true}).waitFor();
 await goSection('forms.read');
 const formRow=m.p.getByRole('row').filter({has:m.p.getByRole('cell',{name:'Аудит 1-го уровня',exact:true})});
 const downloaded=m.p.waitForEvent('download');await formRow.getByRole('button',{name:'Скачать XLSX',exact:true}).click();
 const document=await downloaded;assert.equal(document.suggestedFilename(),'TWI-03-13.xlsx');
 assert.equal((await fs.readFile(await document.path())).subarray(0,4).toString('hex'),'504b0304');
 await m.p.getByRole('heading',{name:'Пакетная выгрузка ZIP',exact:true}).waitFor();
 await m.p.locator('#content select[name=kind]').selectOption('entry');
 await button(m.p,'Показать записи').click();await m.p.locator('#content input[name=batch_filter]').waitFor();
 await m.p.getByText('Выбрано 0 / 20',{exact:true}).waitFor();
 const roleData=store.adminData(admin.id),instructorRole=roleData.rolePresets.find(r=>r.key==='instructor'&&r.status==='ready').role_id;
 await ref('role_assignment',{person_id:p2,role_id:instructorRole,valid_from:day,valid_to:null});
 await goSection('calendar.read');await m.p.locator('#content .lc81-calendar').waitFor();
 await button(m.p,'Запланировать самооценку').click();
 await m.p.locator('#content select[name=type]').selectOption('self_eval');
 await button(m.p,'Выбрать вид').click();
 await m.p.locator('#content select[name=source_id]').selectOption(p2);
 await button(m.p,'Выбрать источник').click();
 await m.p.locator('#content input[name=due_on]').fill(day);
 await button(m.p,'Запланировать').click();
 await m.p.getByRole('cell',{name:'Самооценка',exact:true}).waitFor();
 await button(m.p,'Открыть событие').click();
 await m.p.getByRole('heading',{name:'Самооценка · Учебный сотрудник Б',exact:true}).waitFor();
 await goSection('plan.read');await m.p.locator('#content').getByRole('heading',{name:'Мой план работы',exact:true}).waitFor();
 await goSection('center.read');await m.p.locator('#content').getByRole('heading',{name:'Оперативный обзор',exact:true}).waitFor();
 await button(m.p,'Квартал').click();
 await indicator(m.p,'saved').waitFor();
 const siteDay=store.adminData(admin.id).clock.day;
 const quarterStart=siteDay.slice(0,4)+'-'+String(Math.floor((Number(siteDay.slice(5,7))-1)/3)*3+1).padStart(2,'0')+'-01';
 assert.equal(await m.p.locator('#content input[name=from]').inputValue(),quarterStart);
 assert.equal(await m.p.locator('#content input[name=to]').inputValue(),siteDay);
 const analyticsGroup=m.p.locator('#nav details[data-group="Аналитика"]');
 if(!await analyticsGroup.evaluate(e=>e.open))await analyticsGroup.locator('summary').click();
 const prevDate=day.slice(0,4)+'-01-01';
 await m.p.locator('#content input[name=from]').fill(prevDate);await m.p.locator('#content input[name=from]').dispatchEvent('change');
 await button(m.p,'Обновить').click();await m.p.getByRole('heading',{name:'Оперативный обзор',exact:true}).waitFor();
 await goSection('sop.read_effective');await m.p.getByRole('heading',{name:'Каталог действующих СОП предприятия',exact:true}).waitFor();
 assert(await analyticsGroup.evaluate(e=>e.open),'Analytics menu group must stay open');
 await m.p.evaluate(()=>history.back());await m.p.getByRole('heading',{name:'Оперативный обзор',exact:true}).waitFor();assert.equal(await m.p.locator('#content input[name=from]').inputValue(),prevDate);
 await indicator(m.p,'saved').waitFor();
 await m.p.evaluate(()=>history.forward());await m.p.getByRole('heading',{name:'Каталог действующих СОП предприятия',exact:true}).waitFor();
 await indicator(m.p,'saved').waitFor();
 await m.p.evaluate(()=>history.back());await m.p.getByRole('heading',{name:'Оперативный обзор',exact:true}).waitFor();
 assert.equal(await m.p.locator('#content input[name=from]').inputValue(),prevDate);
 assert(await analyticsGroup.evaluate(e=>e.open),'Analytics menu group must survive back/forward');
 await indicator(m.p,'saved').waitFor();
 await button(m.p,'ИИ-помощник отчёта').click();await m.p.getByRole('dialog',{name:'Контекстный помощник'}).waitFor();await button(m.p,'Закрыть помощник').click();
 await goSection('analytics.read');await m.p.locator('#content').getByRole('heading',{name:'Аналитика за период',exact:true}).waitFor();
 await m.p.getByRole('heading',{name:'Расширенные отчёты LC7',exact:true}).waitFor();
 assert.equal(await m.p.locator('#content input[name=from]').count(),1);assert.equal(await m.p.locator('#content input[name=from]').inputValue(),prevDate);
 await button(m.p,'Компетенции и обеспеченность').click();await button(m.p,'Сформировать подробный отчёт').click();await m.p.getByRole('heading',{name:'Покрытие по подразделениям',exact:true}).waitFor();
 await button(m.p,'Подготовка сотрудников').click();
 await button(m.p,'Сформировать подробный отчёт').click();
 await button(m.p,'Скачать полный отчёт XLSX').waitFor();
 await goSection('audit.history.read');
 await m.p.getByRole('heading',{name:'Историческая база RC1',exact:true}).waitFor();
 await m.p.locator('input[name=rc1_history_file]').waitFor();
 assert(await m.p.evaluate(()=>typeof globalThis.echarts?.init==='function'));
 await goSection('metrics.read');await m.p.locator('#content').getByRole('heading',{name:'Дерево показателей',exact:true}).waitFor();
 const metricRow=m.p.getByRole('row').filter({has:m.p.getByRole('cell',{name:'Назначено обучения',exact:true})});
 await metricRow.getByRole('button',{name:'Раскрыть расчёт',exact:true}).click();
 await m.p.locator('#content').getByRole('heading',{name:'Назначено обучения',exact:true}).waitFor();
 await goSection('roi.read');await m.p.locator('#content').getByRole('heading',{name:'Экономический эффект',exact:true}).waitFor();
 // Real pinned Stage43 working copy in a sandboxed HTTPS iframe.
 const op=(await store.changeDirectory(admin.id,1,{type:'operation',operation:'create',id:null,expected_revision:0,fields:{unit_id:a,equipment_id:null,workplace_id:null,code:'QA-EDIT-SOP',name:'Учебная операция',criticality:'normal'}})).id;
 const source=await makeSop('Учебный шаг с фото');
 const group=m.p.locator('#nav details').filter({has:m.p.locator('[data-action="sop.constructor"]')});
 if(!await group.evaluate(e=>e.open))await group.locator('summary').click();
 await m.p.locator('#nav [data-action="sop.constructor"]').click();
 await m.p.locator('select[name=create_operation]').selectOption(op);
 await m.p.locator('#content input[type=file]').setInputFiles({name:'qa-sop.json',mimeType:'application/json',buffer:Buffer.from(source.text)});
 await m.p.getByRole('heading',{name:'Проверка исходного файла'}).waitFor();
 await m.p.locator('input[name=library_code]').fill('QA-BROWSER-SOP');
 await button(m.p,'Сохранить новый черновик').click();
 await m.p.locator('#lc81-library-host').waitFor({state:'detached'});
 await m.p.locator('#nav [data-action="sop.read_history"]').click();
 const docRow=m.p.getByRole('row').filter({has:m.p.getByRole('cell',{name:'QA-BROWSER-SOP',exact:true})});
 await docRow.getByRole('button',{name:'Карточка СОП',exact:true}).click();
 await m.p.getByRole('heading',{name:/Карточка СОП · QA-BROWSER-SOP/}).waitFor();
 await button(m.p,'Версии').click();await m.p.getByRole('heading',{name:'Версии',exact:true}).waitFor();
 await docRow.getByRole('button',{name:'Открыть редактор',exact:true}).click();
 const frame=await m.p.locator('#lc81-editor-frame').elementHandle();assert(frame);
 const editor=await frame.contentFrame();assert(editor);
 await editor.locator('#lc-editor-status').filter({hasText:'Рабочая копия готова'}).waitFor({timeout:40000});
 assert.equal(await editor.locator('#meta-operation').inputValue(),'Учебная операция');
 assert.equal(await editor.evaluate(()=>state.steps[0].hasPhoto&&!!state.steps[0].imageData),true);
 const isolation=await editor.evaluate(async()=>{
  let parentDenied=false,apiDenied=false;
  try{void parent.document.body}catch{parentDenied=true}
  try{await fetch('/api/lc81/admin')}catch{apiDenied=true}
  localStorage.setItem('lc81-ephemeral-test','working copy');
  return {parentDenied,apiDenied,opaque:window.origin==='null',memory:localStorage.getItem('lc81-ephemeral-test')};
 });
 assert.deepEqual(isolation,{parentDenied:true,apiDenied:true,opaque:true,memory:'working copy'});
 assert.equal(await m.p.evaluate(()=>localStorage.getItem('lc81-ephemeral-test')),null);
 await editor.locator('[data-step-field=action]').first().fill('Учебный шаг после редактирования');
 await editor.locator('[data-step-field=action]').first().blur();
 await editor.locator('#lc-editor-send').click();
 await m.p.getByRole('heading',{name:'Проверка исходного файла'}).waitFor();
 await button(m.p,'Сохранить изменения черновика').click();
 await m.p.locator('#lc81-library-host').waitFor({state:'detached'});
 const doc=store.listResources(manager.id,'sop.read_history').find(r=>r.code==='QA-BROWSER-SOP');
 const reopened=await store.openLibrary(manager.id,1,{kind:'sop',command:'save',id:doc.document_id,revision_id:doc.revision_id,operation_id:op,origin_id:null,origin_revision:null});
 const saved=JSON.parse(reopened.text);
 assert.equal(saved.constructor.steps[0].action,'Учебный шаг после редактирования');
 assert.equal(saved.constructor.steps[0].hasPhoto,true);
 assert(Object.keys(saved.photoAssets).length>0);
 assert.equal((await m.ctx.storageState({indexedDB:true})).origins.length,0,'no persistent editor storage');
 // Visit every exposed working destination under the enterprise manager.
 const destinations=await m.p.locator('#nav [data-action]').evaluateAll(ns=>ns.map(n=>n.dataset.action));
 for(const dest of destinations){
  await goSection(dest);await indicator(m.p,'saved').waitFor({timeout:30000});
  assert(await m.p.locator('#content').evaluate(e=>e.childElementCount>0),'Empty destination: '+dest);
  assert.equal(await m.p.locator('#status.error').count(),0,'Route failed: '+dest);
 }
 const r=await profile('reader',readerPassword,{width:390,height:844});await r.p.getByRole('cell',{name:'BROWSER-B',exact:true}).waitFor();
 assert.equal(await r.p.getByRole('cell',{name:'BROWSER-A',exact:true}).count(),0);assert.equal(await r.p.getByRole('cell',{name:'BROWSER-C',exact:true}).count(),0);
 assert.equal(await button(r.p,'Добавить').count(),0);assert.equal(await button(r.p,'Изменить').count(),0);
 await button(r.p,'Меню').click();await r.p.locator('#nav').waitFor();
 assert.equal(await r.p.locator('#nav [data-action=admin]').count(),0);
 assert.equal(await r.p.locator('#nav [data-action="sop.constructor"]').count(),1);
 assert.equal(await r.p.locator('#nav [data-action="sop.read_effective"]').count(),1);
 assert.equal(await r.p.locator('#nav [data-action="frv.read"]').count(),1);
 assert(await r.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile page overflow');
 const blocked=await r.p.evaluate(async()=>{const x=await fetch('/api/lc81/admin');return x.status});assert.equal(blocked,403);
 // QA-01: names of rights alone are insufficient to expose a workspace.
 assert.equal(await r.p.locator('#nav [data-action="audit.history.read"]').count(),0);
 assert.equal(await r.p.locator('#nav [data-action="forms.read"]').count(),0);
 assert.equal(await r.p.locator('#nav [data-action="plan.read"]').count(),1);
 // QA-04: inject one failed read, then open a working section. This tests
 // banner lifecycle without weakening the real server's policy decisions.
 const failUrl='**/api/lc81/resources?action=org.read';
 await r.p.route(failUrl,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'QA: отказ предыдущего раздела'})}),{times:1});
 const goReader=async(p,k)=>{if(await p.locator('#menu').isVisible()&&await p.locator('#menu').getAttribute('aria-expanded')!=='true')await button(p,'Меню').click();const nav=p.locator('#nav [data-action="'+k+'"]'),group=nav.locator('xpath=ancestor::details');if(await group.count()&&!await group.evaluate(e=>e.open))await group.locator('summary').click();await nav.click()};
 await goReader(r.p,'org.read');await r.p.locator('#status.error').filter({hasText:'QA: отказ предыдущего раздела'}).waitFor();
 await goReader(r.p,'person.read_directory');await r.p.getByRole('cell',{name:'BROWSER-B',exact:true}).waitFor();await r.p.locator('#status.error').waitFor({state:'detached'});
 // QA-03: no navigation/reload is needed to invalidate already shown data.
 const second=await r.ctx.newPage();second.on('pageerror',e=>errors.push(e.message));await second.goto(url);
 await second.getByRole('cell',{name:'BROWSER-B',exact:true}).waitFor();
 await store.revoke(admin.id,readerGrant.id);
 for(const p of [r.p,second]){
  await p.bringToFront();await p.getByRole('cell',{name:'BROWSER-B',exact:true}).waitFor({state:'detached',timeout:20000});
  await p.locator('#nav [data-action="person.read_directory"]').waitFor({state:'detached'});
  assert.equal(await p.locator('#nav [data-action="sop.constructor"]').count(),1);
 }
 await second.close();
 const aa=await profile('admin',adminPassword,{width:1440,height:900});
 await aa.p.getByRole('heading',{name:'Начало работы',exact:true}).waitFor();
 assert(await aa.p.locator('#nav [data-action=admin]').count());
 await aa.p.getByRole('heading',{name:'Настройка центра',exact:true}).waitFor();
 for(const [key,title] of [['admin.enterprise','Календарь предприятия'],['admin.access','Кадровая история и роли'],['admin.storage','Хранение и восстановление'],['admin.roles','Роли и права']]){
  await aa.p.locator('#nav [data-action="'+key+'"]').click();
  await aa.p.locator('#content').getByRole('heading',{name:title,exact:true}).waitFor();
 }
 await aa.p.locator('#nav [data-action=admin]').click();
 await aa.p.locator('#content').getByRole('button',{name:'Создать управляющего',exact:true}).click();
 const firstForm=aa.p.locator('#content form').first();
 await firstForm.locator('[name=employee_code]').fill('QA-UI-MANAGER');
 await firstForm.locator('[name=display_name]').fill('Управляющий из мастера');
 await firstForm.locator('[name=login]').fill('qa-ui-manager');
 assert.equal(await firstForm.locator('[name=access_mode]').inputValue(),'manager');
 await firstForm.locator('[name=generate]').uncheck();
 await firstForm.locator('[name=password]').fill(managerPassword);
 await firstForm.locator('[name=password_confirm]').fill(managerPassword);
 await firstForm.locator('[name=confirmed]').check();
 await button(aa.p,'Создать пользователя').click();
 await aa.p.getByRole('cell',{name:'qa-ui-manager',exact:true}).waitFor();
 const wizardManager=store.authenticate('qa-ui-manager',managerPassword);
 assert(wizardManager?.workspace_actions.includes('center.read'));assert(!wizardManager.admin);
 await aa.p.locator('#nav [data-action="admin.roles"]').click();
 await aa.p.getByRole('heading',{name:'Предустановленные роли TWI',exact:true}).waitFor();
 assert(await aa.p.getByRole('cell',{name:'Внутренний тренер',exact:true}).count()>0);
 assert(await aa.p.getByRole('cell',{name:'Наставник стажировки',exact:true}).count()>0);
 await button(aa.p,'Справочник ролей').click();
 await button(aa.p,'Создать роль').click();
 await aa.p.locator('.lc81-editor input[name=code]').fill('QA-UI-ROLE');
 await aa.p.locator('.lc81-editor input[name=name]').fill('Учебная роль из справочника');
 await button(aa.p,'Сохранить роль').click();
 await aa.p.getByRole('cell',{name:'QA-UI-ROLE',exact:true}).waitFor();
 const adminNav=aa.p.locator('#nav [data-action=admin]'),adminGroup=adminNav.locator('xpath=ancestor::details');
 if(await adminGroup.count()&&!await adminGroup.evaluate(e=>e.open))await adminGroup.locator('summary').click();
 await adminNav.click();
 await aa.p.locator('#content').getByRole('button',{name:'Конструктор СОП',exact:true}).click();
 await aa.p.locator('#content select[name=create_operation]').selectOption('');
 await button(aa.p,'Открыть конструктор').click();
 const blankFrame=await aa.p.locator('#lc81-editor-frame').elementHandle(),blankEditor=await blankFrame.contentFrame();
 await blankEditor.locator('#lc-editor-status').filter({hasText:'Рабочая копия готова'}).waitFor({timeout:40000});
 assert.equal(await blankEditor.locator('#meta-operation').inputValue(),'');
 // The accepted health button is unchanged. All provider calls are mocked;
 // no external service is contacted by CI or by the opaque iframe.
 await blankEditor.locator('#aiTestBtn').click();
 await blankEditor.locator('#aiConnectivityBadge').filter({hasText:'AI: доступен'}).waitFor();
 assert.equal(editorCalls.length,1);assert.equal(editorCalls[0].payload.task,'healthcheck');
 const ask=()=>blankEditor.evaluate(async()=>{try{return {text:await aiAsk('Учебное правило','Учебный текст',{task:'edit_action',model:'yandexgpt-lite',temperature:.2,maxTokens:400})}}catch(e){return {error:e.message}}});
 let pending=ask();
 const consent=aa.p.getByRole('dialog',{name:'Подтверждение запроса ИИ'});
 await consent.waitFor();assert((await consent.textContent()).includes('Учебный текст'));assert.equal(editorCalls.length,1);
 await consent.getByRole('button',{name:'Отмена',exact:true}).click();assert.match((await pending).error,/отменена/);assert.equal(editorCalls.length,1);
 pending=ask();await consent.waitFor();await consent.getByRole('button',{name:'Отправить запрос',exact:true}).click();
 assert.equal((await pending).text,'OK');assert.equal(editorCalls.length,2);assert.equal(editorCalls[1].payload.task,'edit_action');
 // Close the blank working copy via an explicit confirmed action.
 // Existing profile() installs a dismiss handler, so remove it for this one confirmation.
 aa.p.removeAllListeners('dialog');
 aa.p.once('dialog',d=>d.accept());
 await button(aa.p,'Закрыть редактор').click();
 await aa.p.locator('#lc81-library-host').waitFor({state:'detached'});
 aa.p.on('dialog',d=>d.dismiss());
 const firstSource=await makeSop('Учебный шаг новой операции');
 await aa.p.locator('#content input[type=file]').setInputFiles({name:'first-sop.json',mimeType:'application/json',buffer:Buffer.from(firstSource.text)});
 await aa.p.getByRole('heading',{name:'Проверка исходного файла'}).waitFor();
 await aa.p.locator('#lc81-library-host select[name=library_operation]').selectOption('new');
 await aa.p.locator('#lc81-library-host select[name=library_unit]').selectOption(site);
 await aa.p.locator('#lc81-library-host input[name=library_operation_code]').fill('QA-UI-FIRST-OP');
 await aa.p.locator('#lc81-library-host input[name=library_operation_name]').fill('Учебная новая операция');
 await aa.p.locator('#lc81-library-host input[name=library_title]').fill('Учебный СОП');
 await aa.p.locator('#lc81-library-host input[name=library_code]').fill('QA-UI-FIRST-SOP');
 await button(aa.p,'Сохранить новый черновик').click();
 await aa.p.locator('#lc81-library-host').waitFor({state:'detached'});
 assert(store.listResources(admin.id,'operation.read').some(x=>x.code==='QA-UI-FIRST-OP'));
 assert(store.listResources(admin.id,'sop.read_history').some(x=>x.code==='QA-UI-FIRST-SOP'));
 await adminNav.click();
 await aa.p.getByRole('heading',{name:'Настройка центра',exact:true}).waitFor();
 await button(aa.p,'Изменить пароль').click();await aa.p.getByRole('dialog',{name:'Изменение пароля'}).waitFor();await aa.p.getByRole('dialog').getByRole('button',{name:'Отмена',exact:true}).click();
 assert.equal(await aa.p.evaluate(()=>Object.keys(localStorage).length),0);
 const cookie=(await aa.ctx.cookies()).find(x=>x.name==='__Host-lc81');assert(cookie?.httpOnly&&cookie.secure&&cookie.sameSite==='Strict');
 for(const p of [m.p,r.p,aa.p])assert.equal(await p.evaluate(()=>document.querySelector('script[src*="sql"]')!==null),false);
 await store.setState(admin.id,reader.id,'blocked');
 await r.p.reload();await r.p.locator('#login-panel').waitFor();
 assert.equal(await r.p.locator('#workspace').isVisible(),false);

 // PARITY-R1: check every editable work-role profile in the actual HTTPS
 // portal. Unit-tree roles get one local unit; p2 in the other unit is a
 // negative control. Existing scenarios cover the two system roles.
 const rolePresets=store.adminData(admin.id).rolePresets;
 assert.equal(rolePresets.length,16);
 assert(rolePresets.every(x=>x.status==='ready'));
 const roleResults=[];
 for(const preset of rolePresets){
  const result={role:preset.key,scope:preset.scope,opened:[],failures:[],checks:[]};
  roleResults.push(result);
  let current;
  try{
   const login='parity-'+preset.key.replaceAll('_','-'),password=pass();
   const scopes=preset.scope==='unit_tree'?[{kind:'unit_tree',unit_id:a}]:preset.scope==='assigned'?[{kind:'assigned'},{kind:'self'}]:[{kind:'self'}];
   const saved=await store.provisionAccount(admin.id,{person_id:null,new_person:{employee_code:'PARITY-'+preset.key.toUpperCase(),display_name:'Учебный профиль '+preset.name,unit_id:a},login,password,generate:false,manager:false,access:{role_id:preset.role_id,scopes}});
   current=await profile(login,password,{width:1440,height:900});
   const {p}=current;
   await p.bringToFront();await p.locator('html:not(.lc81-access-check)').waitFor();
   const session=await p.evaluate(async()=>{const r=await fetch('/api/lc81/session',{cache:'no-store'});return {status:r.status,...await r.json()}});
   assert.equal(session.status,200);assert.equal(session.user.person_id,saved.person_id);assert.equal(session.user.admin,false);
   const actions=session.user.workspace_actions,permissions=session.user.permissions;
   const navActions=await p.locator('#nav [data-action]').evaluateAll(ns=>ns.map(n=>n.dataset.action));
   assert.equal(new Set(navActions).size,navActions.length,'Duplicate menu destinations');
   assert.deepEqual([...navActions].sort(),[...actions].sort(),'Menu differs from authorized workspaces');
   for(const action of ['sop.constructor','sop.read_effective','frv.read'])assert(navActions.includes(action),'Shared library missing: '+action);
   for(const action of ['admin','forms.read','audit.history.read','program.read'])assert(!navActions.includes(action),'Unapproved site-wide workspace: '+action);
   assert.equal(await p.locator('#status.error').count(),0,'Landing page failed');
   for(const action of navActions){
    try{
     await p.locator('html:not(.lc81-access-check)').waitFor({timeout:8000});
     const nav=p.locator('#nav [data-action="'+action+'"]'),group=nav.locator('xpath=ancestor::details');
     if(await group.count()&&!await group.evaluate(e=>e.open))await group.locator('summary').click({timeout:8000});
     await nav.click({timeout:8000});
     await p.locator('#nav [data-action="'+action+'"][aria-current="page"]').waitFor({timeout:8000});
     await indicator(p,'saved').waitFor({timeout:8000});
     assert(await p.locator('#content').evaluate(e=>e.childElementCount>0),'Empty destination');
     assert.equal(await p.locator('#status.error').count(),0,'Workspace error: '+(await p.locator('#status').textContent()));
     if(action==='internship.view'){
      assert.equal(await p.getByRole('heading',{name:'Шаблоны стажировки',exact:true}).count(),0,'Unauthorized site-wide template panel');
      await p.getByRole('heading',{name:'Персональные программы стажировки',exact:true}).waitFor({timeout:8000});
     }
     result.opened.push(action);
    }catch(e){result.failures.push({action,message:String(e.message||e).slice(0,400)})}
   }
   const statuses=await p.evaluate(async({own,foreign})=>{
    const get=async path=>(await fetch('/api/lc81/'+path,{cache:'no-store'})).status;
    return {admin:await get('admin'),forms:await get('forms'),foreignBasic:await get('resources?action=person.read_basic&id='+foreign),foreignDirectory:await get('resources?action=person.read_directory&id='+foreign),foreignCard:await get('person/card?id='+foreign),ownCard:await get('person/card?id='+own)};
   },{own:saved.person_id,foreign:p2});
   assert.equal(statuses.admin,403);assert.equal(statuses.forms,403);
   for(const key of ['foreignBasic','foreignDirectory','foreignCard'])assert.equal(statuses[key],404,key);
   assert.equal(statuses.ownCard,permissions.includes('person.read_card')?200:404,'Own card permission');
   result.checks.push('admin denied','site forms denied','foreign basic/directory/card denied','own card matches permission');
  }catch(e){result.failures.push({action:'profile',message:String(e.message||e).slice(0,600)})}
  finally{if(current){
   await current.p.evaluate(async()=>{await fetch('/api/lc81/logout',{method:'POST',headers:{'Content-Type':'application/json','X-LC81-Request':'1'},body:'{}'})}).catch(()=>{});
   await current.ctx.close();
  }}
 }
 await fs.mkdir('artifacts',{recursive:true});
 await fs.writeFile('artifacts/lc81-role-parity.json',JSON.stringify({kind:'synthetic role workspace regression',profiles:roleResults,notes:'16 configurable profiles; bootstrap and site manager covered by existing scenarios. Entry and record checks are not complete business-operation parity.'},null,2)+'\n');
 console.log('LC8.1 role parity '+JSON.stringify({profiles:roleResults.length,opened:roleResults.reduce((n,r)=>n+r.opened.length,0),failed:roleResults.flatMap(r=>r.failures.map(f=>({role:r.role,...f})))}));
 assert.equal(roleResults.flatMap(r=>r.failures).length,0,'Role workspace regression: see lc81-role-parity.json');
 assert.deepEqual(errors,[]);
 await fs.mkdir('artifacts',{recursive:true});
 await m.p.bringToFront();await m.p.locator('html:not(.lc81-access-check)').waitFor();
 await m.p.screenshot({path:'artifacts/lc81-manager.png',fullPage:true});
 await aa.p.bringToFront();await aa.p.locator('html:not(.lc81-access-check)').waitFor();
 await aa.p.screenshot({path:'artifacts/lc81-admin.png',fullPage:true});
 console.log('LC8.1 HTTPS browser: corporate shell, scoped UI edits, dirty guard, mobile and revocation PASS');
}finally{
 await browser?.close();await close(proxy);await close(server);await store?.close();await fs.rm(root,{recursive:true,force:true});
}
