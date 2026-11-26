import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {fixture} from './lc4-fixture.mjs';
import {cloudRequest,CENTER_PROXY,CENTER_MODELS} from '../src/modules/assistant/cloud.js';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC7 assistant ')),file=path.join(tmp,'qa.leanbackup');
const f=await fixture(),title='QA закрытая информация по мероприятию';
await f.save('action_item',{response_id:null,title,owner_id:f.mentor,subject_id:null,due_on:'2026-01-21',kind:'corrective',priority:'normal'});
const expectedPending=f.w.pending.length;
await fs.writeFile(file,JSON.stringify(await f.backupBundle()));f.w.close();
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1366,height:900},timezoneId:'Asia/Novokuznetsk'}),page=await ctx.newPage(),errors=[],posts=[],unexpected=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 let mode='ok';
 const advice='<img src="https://example.invalid/qa"> Проверить фактические причины.';
 await ctx.route(/^https?:/,async route=>{
  const r=route.request();if(r.url()!==CENTER_PROXY){unexpected.push(r.url());return route.abort()}
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type, accept','content-type':'application/json'};
  if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
  posts.push(r.postDataJSON());if(mode==='offline')return route.abort('failed');
  if(mode==='http')return route.fulfill({status:403,headers,body:'{}'});
  return route.fulfill({status:200,headers,body:JSON.stringify({...(mode==='unknown-model'?{}:{model:mode==='mismatch'?'yandexgpt-lite/latest':CENTER_MODELS[r.postDataJSON().model].route}),choices:[{message:{content:JSON.stringify({recommendations:[{id:mode==='bad'?'unknown':'action_overdue',text:advice}]})}}]})})
 });
 const btn=name=>page.locator('main').getByRole('button',{name,exact:true}),heading=name=>page.getByRole('heading',{name,exact:true,level:1}).waitFor();
 const nav=async name=>{const n=page.locator('.sidebar .nav').filter({has:page.getByText(name,{exact:true})});assert.equal(await n.count(),1);if(!await n.isVisible())await n.locator('xpath=ancestor::details[1]/summary').click();await n.click()};
 const group=()=>page.locator('[name=lc7_group]'),consent=()=>page.locator('[name=lc7_cloud_consent]'),send=()=>btn('Запросить рекомендации ИИ'),model=()=>page.locator('[name=lc7_cloud_model]');
 const card=id=>page.locator('[data-lc7-rule="'+id+'"]');
 await page.clock.setFixedTime(new Date('2026-01-22T12:00:00Z'));
 await page.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await heading('Дашборд');
 await btn('ИИ-помощник · рекомендации по данным').click();await heading('ИИ-помощник');
 await page.getByText('Нет активных сотрудников. Заполните справочники и назначения.',{exact:true}).waitFor();
 await card('bank_unregistered').waitFor();await group().selectOption('roi');assert.equal(await card('bank_unregistered').count(),0);assert(await send().isDisabled());assert.equal(posts.length,0);
 await nav('Настройки и обмен');const fc=page.waitForEvent('filechooser');await btn('Восстановить копию').click();await (await fc).setFiles(file);await page.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await nav('Дашборд');const attention=page.locator('.attention-row').filter({hasText:'Просрочено мероприятий'});assert.equal(await attention.locator('strong').textContent(),'1');
 await btn('ИИ-помощник · рекомендации по данным').click();await group().selectOption('actions');await card('action_overdue').waitFor();assert.equal(await card('action_overdue').locator('strong').textContent(),'1');
 assert(await send().isDisabled());assert.equal(posts.length,0);
 await page.getByText('Посмотреть точное содержимое запроса',{exact:true}).click();
 const preview=JSON.parse(await page.locator('.lc7-preview').textContent());assert.deepEqual(preview,cloudRequest(['action_overdue']));assert(!JSON.stringify(preview).includes(title));assert(!JSON.stringify(preview).includes('LC4-002'));
 // Consent is per request and is lost when changing scope.
 await consent().check();assert(await send().isEnabled());await group().selectOption('roi');await group().selectOption('actions');assert(!(await consent().isChecked()));assert(await send().isDisabled());assert.equal(posts.length,0);
 const request=async m=>{mode=m;await consent().check();await send().click()};
 await request('ok');await page.getByText(advice,{exact:true}).waitFor();assert.deepEqual(posts[0],cloudRequest(['action_overdue']));assert.equal(await page.locator('img[src="https://example.invalid/qa"]').count(),0);assert(await send().isDisabled());assert(!(await consent().isChecked()));
 await fs.mkdir('artifacts/lc7',{recursive:true});await page.screenshot({path:'artifacts/lc7/assistant-cloud.png',fullPage:true});
 await consent().check();await model().selectOption('yandexgpt');assert(!(await consent().isChecked()));assert(await send().isDisabled());assert.deepEqual(JSON.parse(await page.locator('.lc7-preview').textContent()),cloudRequest(['action_overdue'],'yandexgpt'));
 await request('ok');await page.getByText(/Прокси подтвердил маршрут: YandexGPT 5 Pro/).waitFor();assert.deepEqual(posts.at(-1),cloudRequest(['action_overdue'],'yandexgpt'));
 await model().selectOption('yandexgpt-5');await request('ok');await page.getByText(/Прокси подтвердил маршрут: YandexGPT 5.1/).waitFor();assert.deepEqual(posts.at(-1),cloudRequest(['action_overdue'],'yandexgpt-5'));
 await request('mismatch');await page.getByText(/Прокси сообщил другой маршрут: YandexGPT Lite/).waitFor();
 await request('unknown-model');await page.getByText(/Прокси не подтвердил маршрут модели/).waitFor();
 await request('bad');await page.getByText(/ИИ вернул неизвестную/).waitFor();await card('action_overdue').waitFor();
 await request('http');await page.getByText(/Облачная модель недоступна \(HTTP 403\)/).waitFor();await card('action_overdue').waitFor();
 await request('offline');await page.getByText(/Облачный сервис недоступен/).waitFor();await card('action_overdue').waitFor();
 assert.equal(posts.length,8);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
 await card('action_overdue').getByRole('button',{name:'Открыть источник',exact:true}).click();await heading('Задачи и мероприятия');assert.equal(await page.locator('[name=lc5_action_filter]').inputValue(),'overdue');await page.getByText(title,{exact:true}).first().waitFor();
 await page.getByText('Локальная база · '+expectedPending+' ожидающих изменений',{exact:true}).waitFor();
 await nav('ИИ-помощник');await group().selectOption('actions');assert.equal(await card('action_overdue').locator('strong').textContent(),'1');assert.equal(posts.length,8);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/lc7/assistant-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true);
 await ctx.close();console.log('LC7.1 browser PASS: shared dashboard counts, source navigation, empty state, explicit consent, exact outbound data, cloud model routes, mismatch and unconfirmed metadata, cloud failures, read-only and mobile');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
