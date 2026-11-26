import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './lc4-fixture.mjs';
import {CENTER_PROXY} from '../src/modules/assistant/cloud.js';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC72 context ')),file=path.join(tmp,'qa.leanbackup'),f=await fixture();
await f.save('role_requirement',{profession_id:f.profession,skill_id:f.skill,scale_id:f.scale,required_level:3,criticality:'important',valid_from:'2026-01-01',valid_to:null});
const assignment=await f.addAssignment({due_on:'2026-01-21'});await f.approve(assignment);
const pending=f.w.pending.length,trainee=f.trainee;await fs.writeFile(file,JSON.stringify(await f.backupBundle()));f.w.close();
const ux=await fixture(),uxOld=ux.doc.id,uxNew=(await ux.revise()).revision,uxFile=path.join(tmp,'ux-qa.leanbackup');await ux.save('action_item',{response_id:null,title:'QA проверка той же карточки',owner_id:ux.mentor,subject_id:null,due_on:'2026-01-21',kind:'corrective',priority:'normal'});await fs.writeFile(uxFile,JSON.stringify(await ux.backupBundle()));ux.w.close();
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({offline:true,viewport:{width:1366,height:900},timezoneId:'Asia/Novokuznetsk'}),p=await ctx.newPage(),errors=[],posts=[];
 p.on('pageerror',e=>errors.push(e.message));let allow=true,dialogs=[];p.on('dialog',d=>{dialogs.push(d.message());return allow?d.accept():d.dismiss()});
 await ctx.route(/^https?:/,async route=>{const r=route.request();assert.equal(r.url(),CENTER_PROXY);const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type, accept','content-type':'application/json'};if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});const body=r.postDataJSON();posts.push(body);const raw=JSON.parse(body.messages[1].content),first=Array.isArray(raw)?raw[0]:raw.rules[0];return route.fulfill({status:200,headers,body:JSON.stringify({model:'yandexgpt-lite/latest',choices:[{message:{content:JSON.stringify({recommendations:[{id:first.id,text:'QA облачный совет'}]})}}]})})});
 const heading=name=>p.getByRole('heading',{name,exact:true,level:1}).waitFor(),btn=name=>p.locator('main').getByRole('button',{name,exact:true}),nav=async name=>{const n=p.locator('.sidebar .nav').filter({has:p.getByText(name,{exact:true})});if(!await n.isVisible())await n.locator('xpath=ancestor::details[1]/summary').click();await n.click()};
 const panel=p.locator('dialog.lc72-context-dialog'),open=async()=>{await p.locator('.lc72-helper-button').click();await panel.waitFor();assert.equal(await panel.getByText(/Не удалось вычислить контекст/).count(),0)},close=async()=>{await panel.getByRole('button',{name:'Закрыть помощник',exact:true}).click();await panel.waitFor({state:'detached'})},rule=id=>panel.locator('[data-lc72-rule="'+id+'"]'),count=id=>rule(id).locator('strong').textContent();
 await p.clock.setFixedTime(new Date('2026-01-22T12:00:00Z'));await p.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await heading('Дашборд');
 await nav('Настройки и обмен');const fc=p.waitForEvent('filechooser');await btn('Восстановить копию').click();await (await fc).setFiles(file);await p.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await nav('Сотрудники');await p.getByRole('row').filter({hasText:'LC4-001'}).getByRole('button',{name:'Карточка',exact:true}).click();await open();
 assert.equal(await count('ctx_gap'),'1');assert.equal(await count('training_overdue'),'1');
 const counts=panel.locator('[name=lc72_cloud_counts]'),consent=panel.locator('[name=lc7_cloud_consent]'),send=panel.getByRole('button',{name:'Запросить рекомендации ИИ',exact:true});
 assert(await send.isDisabled());assert.equal(posts.length,0);assert(!(await counts.isChecked()));
 await panel.getByText('Подробнее: модель и содержимое запроса',{exact:true}).click();await panel.getByText('Посмотреть точное содержимое запроса',{exact:true}).click();assert(Array.isArray(JSON.parse(JSON.parse(await panel.locator('.lc7-preview').textContent()).messages[1].content)));
 await consent.check();await counts.check();assert(!(await consent.isChecked()));assert(await send.isDisabled());
 const preview=JSON.parse(await panel.locator('.lc7-preview').textContent()),packet=JSON.parse(preview.messages[1].content);assert.equal(packet.context,'Сотрудник');assert(!JSON.stringify(preview).includes(trainee));assert(!JSON.stringify(preview).includes('Ученик Тестовый'));assert(!JSON.stringify(preview).includes('LC4-001'));
 await consent.check();await send.click();await panel.getByText('QA облачный совет',{exact:true}).waitFor();assert.deepEqual(posts[0],preview);
 await fs.mkdir('artifacts/lc72',{recursive:true});await p.screenshot({path:'artifacts/lc72/person-context.png',fullPage:true});
 await rule('ctx_gap').getByRole('button',{name:'Подготовить проект плана развития',exact:true}).click();await heading('Планы развития');assert.equal(await p.locator('[name=development_person]').getAttribute('data-person-id'),trainee);assert.match(await p.locator('[name=development_title]').inputValue(),/разрывов компетенций/);
 const title=p.locator('[name=development_title]');await title.fill('QA несохранённый план');const d0=dialogs.length;await open();await panel.getByText(/Есть незаписанный ввод/).waitFor();await close();assert.equal(await title.inputValue(),'QA несохранённый план');assert.equal(dialogs.length,d0);
 // Esc closes only the panel. Underlying draft remains untouched.
 await open();await p.keyboard.press('Escape');await panel.waitFor({state:'detached'});assert.equal(await title.inputValue(),'QA несохранённый план');assert.equal(dialogs.length,d0);
 allow=false;await nav('Дашборд');assert.equal(await title.inputValue(),'QA несохранённый план');assert.equal(dialogs.length,d0+1);
 allow=true;await nav('План производственного обучения');await heading('План производственного обучения');await p.getByRole('button',{name:'Открыть',exact:true}).first().click();await open();await rule('ctx_ji').waitFor();assert.equal(await count('ctx_admission'),'1');await close();
 await nav('Дерево метрик');await open();await panel.getByText(/Показатели и определения/).waitFor();await close();
 await nav('Сотрудники');await p.getByRole('row').filter({hasText:'LC4-001'}).getByRole('button',{name:'Карточка',exact:true}).click();
 await p.setViewportSize({width:390,height:844});await open();assert(await panel.evaluate(e=>e.getBoundingClientRect().width<=window.innerWidth));await p.screenshot({path:'artifacts/lc72/context-mobile.png',fullPage:true});await close();
 await p.getByText('Локальная база · '+pending+' ожидающих изменений',{exact:true}).waitFor();
 await p.setViewportSize({width:1366,height:900});await nav('Настройки и обмен');const uxChooser=p.waitForEvent('filechooser');await btn('Восстановить копию').click();await (await uxChooser).setFiles(uxFile);await p.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await nav('Каталог СОП');await btn('Открыть').first().click();await open();await panel.getByText(/редакция не выбрана/i).waitFor();await close();for(const [id,version] of [[uxOld,1],[uxNew,2]]){const card=p.locator('.library-version[data-revision-id="'+id+'"]');for(const tab of ['Паспорт документа','Шаги и ключевые моменты','Материалы']){await card.getByRole('button',{name:tab,exact:true}).click();await card.getByRole('button',{name:'Проверить эту редакцию',exact:true}).click();await panel.waitFor();assert((await panel.locator('.lc72-context-head').textContent()).includes('· v'+version));await close()}}
 await nav('Задачи и мероприятия');await btn('Открыть').first().click();await open();await panel.getByText(/Вы уже в нужной карточке/).first().waitFor();assert.equal(await panel.getByRole('button',{name:'Открыть мероприятие',exact:true}).count(),0);await close();
 await nav('Календарь');await open();await panel.getByText(/не проверяет выбранный месяц/).waitFor();await close();
 assert.deepEqual(errors,[]);assert.equal(posts.length,1);await ctx.close();console.log('LC7.2 browser PASS: person context, draft handoff, preserved unsaved input, scope consent and privacy, training, metrics and mobile');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
