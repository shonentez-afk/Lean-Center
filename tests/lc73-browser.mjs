import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './lc4-fixture.mjs';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC73 ')),file=path.join(tmp,'qa.leanbackup'),f=await fixture();
await f.save('role_requirement',{profession_id:f.profession,skill_id:f.skill,scale_id:f.scale,required_level:3,criticality:'important',valid_from:'2026-01-01',valid_to:null});
const assignment=await f.addAssignment({due_on:'2026-01-21'});await f.approve(assignment);
await fs.writeFile(file,JSON.stringify(await f.backupBundle()));f.w.close();
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({offline:true,viewport:{width:1366,height:900},timezoneId:'Asia/Novokuznetsk'}),p=await ctx.newPage(),errors=[],network=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await ctx.route(/^https?:/,r=>{network.push(r.request().url());return r.abort()});
 const heading=name=>p.getByRole('heading',{name,exact:true,level:1}).waitFor(),btn=name=>p.locator('main').getByRole('button',{name,exact:true}),nav=async name=>{const n=p.locator('.sidebar .nav').filter({has:p.getByText(name,{exact:true})});if(!await n.isVisible())await n.locator('xpath=ancestor::details[1]/summary').click();await n.click()};
 await p.clock.setFixedTime(new Date('2026-01-22T12:00:00Z'));await p.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await heading('Дашборд');
 await p.locator('.lc73-kpis .tile').first().waitFor();assert.equal(await p.locator('.lc73-kpis .tile').count(),6);assert.match(await p.locator('.lc73-kpis .tile').first().textContent(),/нет знаменателя/);
 await nav('Настройки и обмен');const fc=p.waitForEvent('filechooser');await btn('Восстановить копию').click();await (await fc).setFiles(file);await p.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await nav('Дашборд');await p.locator('[name=lc73_home_filter_unit]').selectOption(f.unit);await p.getByText(/Риски выбранного подразделения/).waitFor();await p.locator('[name=lc73_home_filter_unit]').selectOption('');const card=p.locator('.lc73-kpis .tile').filter({hasText:'Компетенции'});assert.match(await card.textContent(),/0 \/ 1/);await card.click();
 await heading('Дерево метрик');await p.getByRole('heading',{name:'Декомпозиция показателя',exact:true}).waitFor();
 const rows=p.getByText('Подтверждающие строки · 1',{exact:true}).first();await rows.click();await p.getByRole('button',{name:'Связанная карточка',exact:true}).first().waitFor();
 await p.locator('[name=lc73_metrics_filter_mode]').selectOption('passport');await p.getByRole('heading',{name:'Паспорт метрики',exact:true}).waitFor();await p.getByRole('cell',{name:'skill_coverage',exact:true}).waitFor();
 await nav('Аналитика центра');await btn('Компетенции').click();await p.getByRole('heading',{name:'Покрытие по подразделениям',exact:true}).waitFor();
 await btn('Помощник').click();const panel=p.locator('dialog.lc72-context-dialog');await panel.waitFor();await panel.getByText('Компетенции и обеспеченность',{exact:true}).waitFor();assert.equal(await panel.getByText(/Не удалось вычислить контекст/).count(),0);await panel.getByRole('button',{name:'Закрыть помощник',exact:true}).click();
 await nav('Дашборд');await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('.lc73-kpis .tile').count(),6);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
 await fs.mkdir('artifacts/lc73',{recursive:true});await p.screenshot({path:'artifacts/lc73/dashboard-mobile.png',fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await ctx.close();
 console.log('LC7.3A dashboard, metric evidence and report context smoke PASS');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
