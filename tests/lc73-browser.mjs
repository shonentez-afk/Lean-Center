import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './lc4-fixture.mjs';
import {matrixData} from '../src/modules/training/domain.js';
import {uuid,one} from '../src/core/db.js';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC73 ')),file=path.join(tmp,'qa.leanbackup'),f=await fixture();
await f.save('role_requirement',{profession_id:f.profession,skill_id:f.skill,scale_id:f.scale,required_level:3,criticality:'important',valid_from:'2026-01-01',valid_to:null});
const assignment=await f.addAssignment({due_on:'2026-01-21'});await f.approve(assignment);
// Recorded offset from the author is persisted with the event. Synthetic fixture uses the exact local-month boundary.
const qaTask=async title=>(await f.save('action_item',{response_id:null,title,owner_id:f.mentor,subject_id:null,due_on:'2026-10-02',kind:'corrective',priority:'normal'})).entity_id;
const qaAt=async(id,occurred_at,payload)=>f.w.applyContentEvents([{id:uuid(),entity_type:'action_item',entity_id:id,operation:'update',expected_revision:one(f.w.working,'SELECT rev FROM action_item WHERE id=?',[id]).rev,payload,occurred_at}],f.readContent);
const monthFact=await qaTask('QA граница октября'),lateFact=await qaTask('QA срок и выполнение');
await qaAt(monthFact,'2026-09-30T17:30:00Z',{command:'implement',result:'QA',business_offset_minutes:420});await qaAt(monthFact,'2026-10-03T04:00:00Z',{command:'verify',verifier_id:f.actor,audit_id:null,outcome:'effective',evidence:'QA'});
await qaAt(lateFact,'2026-10-12T04:00:00Z',{command:'implement',result:'QA',business_offset_minutes:420});
const matrix=matrixData(f.w.working,'2026-01-22'),expected=matrix.people.flatMap(p=>matrix.skills.map(s=>matrix.cells.get(p.id+':'+s.id))).filter(c=>c.goal),covered=expected.filter(c=>!c.gap).length;
await fs.writeFile(file,JSON.stringify(await f.backupBundle()));
// An independent synthetic large fixture. Only a QA backup is written.
await f.w.acceptOwn(f.readContent);const db=f.w.base,largeFile=path.join(tmp,'qa-large.leanbackup');db.run('BEGIN');const insertPerson=db.prepare('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)'),insertAssignment=db.prepare('INSERT INTO person_assignment(id,person_id,unit_id,profession_id,valid_from,shift_id) VALUES(?,?,?,?,?,?)');try{for(let i=0;i<5000;i++){const id=uuid();insertPerson.run([id,'QA73-'+i,'QA '+i]);insertAssignment.run([uuid(),id,f.unit,f.profession,'2020-01-01',f.shift])}}finally{insertPerson.free();insertAssignment.free();db.run('COMMIT')}
await fs.writeFile(largeFile,JSON.stringify(await f.backupBundle()));f.w.close();
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({offline:true,viewport:{width:1366,height:900},timezoneId:'Asia/Novokuznetsk'}),p=await ctx.newPage(),errors=[],network=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await ctx.route(/^https?:/,r=>{network.push(r.request().url());return r.abort()});
 const heading=name=>p.getByRole('heading',{name,exact:true,level:1}).waitFor(),btn=name=>p.locator('main').getByRole('button',{name,exact:true}),nav=async name=>{const n=p.locator('.sidebar .nav').filter({has:p.getByText(name,{exact:true})});if(!await n.isVisible())await n.locator('xpath=ancestor::details[1]/summary').click();await n.click()};
 await p.clock.setFixedTime(new Date('2026-01-22T12:00:00Z'));await p.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await heading('Дашборд');
 await p.locator('.lc73-kpis .tile').first().waitFor();assert.equal(await p.locator('.lc73-kpis .tile').count(),6);assert.match(await p.locator('.lc73-kpis .tile').first().textContent(),/нет знаменателя/);
 await nav('Настройки и обмен');const fc=p.waitForEvent('filechooser');await btn('Восстановить копию').click();await (await fc).setFiles(file);await p.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await nav('Дашборд');await p.locator('[name=lc73_home_filter_unit]').selectOption(f.unit);await p.getByText(/Риски выбранного подразделения/).waitFor();await p.locator('[name=lc73_home_filter_unit]').selectOption('');const card=p.locator('.lc73-kpis .tile').filter({hasText:'Компетенции'});assert((await card.textContent()).includes(covered+' / '+expected.length));await card.click();
 await heading('Дерево метрик');await p.getByRole('heading',{name:'Декомпозиция показателя',exact:true}).waitFor();
 const rows=p.getByText('Подтверждающие строки · '+expected.length,{exact:true}).first();await rows.click();await p.getByRole('button',{name:'Связанная карточка',exact:true}).first().waitFor();
 await p.locator('[name=lc73_metrics_filter_mode]').selectOption('passport');await p.getByRole('heading',{name:'Паспорт метрики',exact:true}).waitFor();await p.getByRole('cell',{name:'skill_coverage',exact:true}).waitFor();await p.getByRole('heading',{name:'Связанные показатели',exact:true}).waitFor();
 await nav('Аналитика центра');await btn('Компетенции').click();await p.getByRole('heading',{name:'Покрытие по подразделениям',exact:true}).waitFor();const group=p.getByRole('heading',{name:'Покрытие по подразделениям',exact:true}).locator('xpath=ancestor::section[1]');await group.getByRole('button',{name:'Основания',exact:true}).first().click();await heading('Дерево метрик');await p.getByRole('heading',{name:'Выбранный разрез',exact:true}).waitFor();await p.goBack();await p.getByRole('heading',{name:'Покрытие по подразделениям',exact:true}).waitFor();
 await p.locator('.lc72-helper-button').click();const panel=p.locator('dialog.lc72-context-dialog');await panel.waitFor();await panel.getByText('Компетенции и обеспеченность',{exact:true}).waitFor();assert.equal(await panel.getByText(/Не удалось вычислить контекст/).count(),0);await panel.getByRole('button',{name:'Закрыть помощник',exact:true}).click();
 await nav('Дашборд');await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('.lc73-kpis .tile').count(),6);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
 await fs.mkdir('artifacts/lc73',{recursive:true});await p.screenshot({path:'artifacts/lc73/dashboard-mobile.png',fullPage:true});await p.setViewportSize({width:1366,height:900});
 // QA-05: real populated catalog/decomposition and TWI must contain wide tables locally.
 const narrow=async label=>{for(const width of [320,390,768]){
  await p.setViewportSize({width,height:844});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const sizes=await p.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('main *')].filter(x=>x.getBoundingClientRect().right>innerWidth+1&&!x.closest('.tablewrap')).slice(0,6).map(x=>x.tagName+'.'+x.className)}));assert(sizes.scroll<=width,label+' '+JSON.stringify(sizes));
  assert(await p.locator('.lc73-responsive-report .tablewrap').evaluateAll(xs=>xs.every(x=>x.scrollWidth<=x.clientWidth||['auto','scroll'].includes(getComputedStyle(x).overflowX))));
 }await p.setViewportSize({width:1366,height:900})};
 await nav('Дерево метрик');await narrow('QA-05 catalog');await p.locator('[name=lc73_metrics_filter_selected]').selectOption('skill_coverage');await p.locator('[name=lc73_metrics_filter_mode]').selectOption('evidence');await p.getByText('Подтверждающие строки · '+expected.length,{exact:true}).first().click();await narrow('QA-05 evidence');
 await nav('Аналитика центра');await btn('Эффективность TWI').click();await p.getByRole('heading',{name:'Эффективность производственного обучения TWI',exact:true}).waitFor();await narrow('QA-05 TWI');
 // QA-06: leave a dashboard open at midnight; update automatic dates but not manually selected range.
 await nav('Дашборд');await btn('Месяц').click();const start=p.locator('[name=lc73_home_filter_from]'),end=p.locator('[name=lc73_home_filter_to]');
 await p.clock.setFixedTime(new Date('2026-01-23T12:00:00Z'));await p.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await end.inputValue(),'2026-01-23');
 await nav('Аналитика центра');await p.clock.setFixedTime(new Date('2026-02-01T12:00:00Z'));await nav('Дашборд');assert.equal(await start.inputValue(),'2026-02-01');assert.equal(await end.inputValue(),'2026-02-01');
 await start.fill('2026-01-01');await end.fill('2026-01-22');await p.getByText('Период: Ручной диапазон · фиксированный',{exact:true}).waitFor();
 await p.clock.setFixedTime(new Date('2026-02-02T12:00:00Z'));await p.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await end.inputValue(),'2026-01-22');
 await p.reload();await heading('Дашборд');assert.equal(await start.inputValue(),'2026-01-01');assert.equal(await end.inputValue(),'2026-01-22');await btn('Месяц').click();assert.equal(await end.inputValue(),'2026-02-02');
 // QA-01/03: visible evidence, local helper and exported worksheet must use the same rows and date semantics.
 await p.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));await nav('Дерево метрик');const mf=p.locator('[name=lc52_metrics_from]'),mt=p.locator('[name=lc52_metrics_to]'),ms=p.locator('[name=lc73_metrics_filter_selected]'),mm=p.locator('[name=lc73_metrics_filter_mode]');await mf.fill('2026-10-01');await mt.fill('2026-10-31');await ms.selectOption('actions_verified');await mm.selectOption('evidence');await p.getByText('Подтверждающие строки · 2',{exact:true}).first().click();const factRow=p.getByRole('row').filter({hasText:'QA граница октября'});await factRow.getByRole('cell',{name:'2026-10-01',exact:true}).waitFor();await factRow.getByRole('cell',{name:/UTC\+07:00/}).waitFor();
 await p.locator('.lc72-helper-button').click();await panel.getByText(/1 \/ 2/).first().waitFor();await panel.getByRole('button',{name:'Закрыть помощник',exact:true}).click();
 await ms.selectOption('actions_overdue');await p.getByText('Подтверждающие строки · 1',{exact:true}).first().click();const lateRow=p.getByRole('row').filter({hasText:'QA срок и выполнение'});await lateRow.getByRole('cell',{name:'2026-10-02',exact:true}).waitFor();await lateRow.getByRole('cell',{name:'2026-10-12',exact:true}).waitFor();const overdueTable=lateRow.locator('xpath=ancestor::table[1]'),overdueHeaders=overdueTable.locator('thead th');assert.equal((await overdueHeaders.first().textContent()).trim(),'Срок');assert.equal((await overdueHeaders.nth(1).textContent()).trim(),'Дата выполнения');assert.equal(await overdueHeaders.first().getAttribute('scope'),'col');
 const dl=p.waitForEvent('download');await btn('Скачать XLSX').click();const xp=path.join(tmp,'qa-overdue.xlsx');await (await dl).saveAs(xp);const result=await p.evaluate(async bytes=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(bytes));const sheet=w.worksheets[0],headers=sheet.getRow(1).values,row=sheet.getRow(2).values;return {due:row[headers.indexOf('Срок')],implemented:row[headers.indexOf('Дата выполнения')]};},Array.from(await fs.readFile(xp)));assert.deepEqual(result,{due:'2026-10-02',implemented:'2026-10-12'});
 await p.clock.setFixedTime(new Date('2026-01-22T12:00:00Z'));await nav('Дашборд');await btn('Месяц').click();await nav('Настройки и обмен');const fc2=p.waitForEvent('filechooser');await btn('Восстановить копию').click();await (await fc2).setFiles(largeFile);await p.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();await nav('Дашборд');await p.locator('.lc73-kpis .tile').filter({hasText:'Компетенции'}).click();await heading('Дерево метрик');const largeRows=p.getByText('Подтверждающие строки · '+(expected.length+5000),{exact:true}).first();await largeRows.click();await p.getByText('1–50 / '+(expected.length+5000),{exact:true}).waitFor();assert.equal(await p.locator('main tbody tr').count(),50);await btn('Следующие строки').first().click();await p.getByText('51–100 / '+(expected.length+5000),{exact:true}).waitFor();assert.equal(await p.locator('main tbody tr').count(),50);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await ctx.close();
 console.log('LC7.3A dashboard, metric evidence and report context smoke PASS');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
