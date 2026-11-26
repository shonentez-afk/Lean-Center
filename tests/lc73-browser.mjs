import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './lc4-fixture.mjs';
import {matrixData} from '../src/modules/training/domain.js';
import {uuid} from '../src/core/db.js';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC73 ')),file=path.join(tmp,'qa.leanbackup'),f=await fixture();
await f.save('role_requirement',{profession_id:f.profession,skill_id:f.skill,scale_id:f.scale,required_level:3,criticality:'important',valid_from:'2026-01-01',valid_to:null});
const assignment=await f.addAssignment({due_on:'2026-01-21'});await f.approve(assignment);
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
 await btn('Помощник').click();const panel=p.locator('dialog.lc72-context-dialog');await panel.waitFor();await panel.getByText('Компетенции и обеспеченность',{exact:true}).waitFor();assert.equal(await panel.getByText(/Не удалось вычислить контекст/).count(),0);await panel.getByRole('button',{name:'Закрыть помощник',exact:true}).click();
 await nav('Дашборд');await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('.lc73-kpis .tile').count(),6);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
 await fs.mkdir('artifacts/lc73',{recursive:true});await p.screenshot({path:'artifacts/lc73/dashboard-mobile.png',fullPage:true});await p.setViewportSize({width:1366,height:900});await nav('Настройки и обмен');const fc2=p.waitForEvent('filechooser');await btn('Восстановить копию').click();await (await fc2).setFiles(largeFile);await p.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();await nav('Дашборд');await p.locator('.lc73-kpis .tile').filter({hasText:'Компетенции'}).click();await heading('Дерево метрик');const largeRows=p.getByText('Подтверждающие строки · '+(expected.length+5000),{exact:true}).first();await largeRows.click();await p.getByText('1–50 / '+(expected.length+5000),{exact:true}).waitFor();assert.equal(await p.locator('main tbody tr').count(),50);await btn('Следующие строки').first().click();await p.getByText('51–100 / '+(expected.length+5000),{exact:true}).waitFor();assert.equal(await p.locator('main tbody tr').count(),50);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await ctx.close();
 console.log('LC7.3A dashboard, metric evidence and report context smoke PASS');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
