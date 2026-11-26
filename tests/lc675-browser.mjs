import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {fixture} from './lc4-fixture.mjs';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC675 work forms ')),f=await fixture(),file=path.join(tmp,'qa.leanbackup');
await fs.writeFile(file,JSON.stringify(await f.backupBundle()));const ownerId=f.mentor,subjectId=f.trainee;f.w.close();
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext({offline:true,acceptDownloads:true,timezoneId:'Asia/Novokuznetsk'}),p=await ctx.newPage(),errors=[],prompts=[];
 let accept=true;p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>{prompts.push({type:d.type(),text:d.message()});return accept?d.accept():d.dismiss()});
 await p.clock.setFixedTime(new Date('2026-11-26T12:00:00Z'));
 const btn=label=>p.getByRole('button',{name:label,exact:true});
 const input=name=>p.locator('main [name="'+name+'"]');
 const nav=async label=>{const n=p.locator('.sidebar .nav').filter({has:p.getByText(label,{exact:true})});if(!await n.isVisible())await n.locator('xpath=ancestor::details[1]/summary').click();await n.click()};
 const heading=label=>p.getByRole('heading',{name:label,exact:true}).waitFor();
 const choose=async(label,code)=>{await btn('Выбрать: '+label).click();await p.getByRole('searchbox',{name:'Поиск сотрудника'}).fill(code);await p.locator('.lc-picker-popup .lc-person-option').click()};
 const actionNew=async()=>{await nav('Задачи и мероприятия');await btn('Новое мероприятие').click();await heading('Новая задача / мероприятие')};
 const dialogCount=type=>prompts.filter(x=>x.type===type).length;
 const expectConfirm=async(fn)=>{const n=dialogCount('confirm');await fn();assert.equal(dialogCount('confirm'),n+1);assert.match(prompts.filter(x=>x.type==='confirm').at(-1).text,/несохранённые изменения/)};
 const actionValues=async()=>({title:await input('lc5_action_title').inputValue(),due:await input('lc5_action_due').inputValue(),priority:await input('lc5_action_priority').inputValue(),owner:await input('lc5_action_owner').getAttribute('data-person-id'),subject:await input('lc5_action_subject').getAttribute('data-person-id')});
 await p.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await heading('Дашборд');await nav('Настройки и обмен');const fc=p.waitForEvent('filechooser');await btn('Восстановить копию').click();await (await fc).setFiles(file);await p.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await fs.mkdir('artifacts/lc675',{recursive:true});
 // A clean form and ordinary filters must never generate a false prompt.
 await actionNew();let n=prompts.length;await btn('К списку').click();assert.equal(prompts.length,n);await input('lc5_action_filter').selectOption('overdue');await nav('Дашборд');assert.equal(prompts.length,n);
 await actionNew();const defaults=await actionValues();
 await input('lc5_action_title').fill('QA незаписанное мероприятие');await input('lc5_action_due').fill('2026-12-10');await input('lc5_action_priority').selectOption('major');await choose('Ответственный','LC4-002');await choose('К кому относится','LC4-001');
 const draft=await actionValues();assert.equal(draft.owner,ownerId);assert.equal(draft.subject,subjectId);assert.equal(draft.due,'2026-12-10');
 accept=false;await expectConfirm(()=>nav('Дашборд'));assert.deepEqual(await actionValues(),draft);
 await expectConfirm(()=>btn('К списку').click());assert.deepEqual(await actionValues(),draft);
 // App Back and native browser Back each retain the same DOM and selection on refusal.
 const routeId=await p.evaluate(()=>history.state.lcNav);
 for(const trigger of [()=>btn('← Назад').click(),()=>p.evaluate(()=>{history.back()})]){
  const dialog=p.waitForEvent('dialog');await trigger();const d=await dialog;assert.equal(d.type(),'confirm');assert.match(d.message(),/несохранённые изменения/);
  await p.waitForFunction(id=>history.state.lcNav===id,routeId);assert.deepEqual(await actionValues(),draft);
 }
 // A dismissed reload does not destroy the form.
 const unload=p.waitForEvent('dialog');await p.evaluate(()=>{setTimeout(()=>location.reload(),0)});assert.equal((await unload).type(),'beforeunload');assert.deepEqual(await actionValues(),draft);
 await p.screenshot({path:'artifacts/lc675/action-retained.png',fullPage:true});
 // Confirmed discard: browser Back returns to a fresh form, not a saved draft.
 accept=true;await expectConfirm(()=>nav('Дашборд'));await heading('Дашборд');await p.evaluate(()=>{history.back()});await heading('Новая задача / мероприятие');assert.deepEqual(await actionValues(),defaults);
 // Person-only edit is detected even though the picker lives outside the form.
 await choose('Ответственный','LC4-002');accept=false;await expectConfirm(()=>nav('Дашборд'));assert.equal((await actionValues()).owner,ownerId);
 // Accepted F5 discards the unsaved data; nothing was written to the database.
 accept=true;const before=dialogCount('beforeunload');await p.reload();await heading('Дашборд');assert.equal(dialogCount('beforeunload'),before+1);await actionNew();assert.deepEqual(await actionValues(),defaults);
 // Failed validation still preserves the input, then successful save clears protection.
 await input('lc5_action_title').fill('QA сохранённое мероприятие');await input('lc5_action_due').fill('2026-12-10');await choose('К кому относится','LC4-001');await btn('Создать мероприятие').click();await p.locator('#status.error').waitFor();assert.equal((await actionValues()).title,'QA сохранённое мероприятие');assert.equal((await actionValues()).subject,subjectId);
 await choose('Ответственный','LC4-002');n=prompts.length;await btn('Создать мероприятие').click();await p.getByText('Запись сохранена. Ожидает публикации базы.',{exact:true}).waitFor();await heading('QA сохранённое мероприятие');assert.equal(prompts.length,n);
 // Additional existing-action form: unsaved result is protected.
 await input('lc5_action_result').fill('QA незаписанный результат');accept=false;await expectConfirm(()=>nav('Дашборд'));assert.equal(await input('lc5_action_result').inputValue(),'QA незаписанный результат');accept=true;await btn('Зафиксировать выполнение').click();await p.getByText('Запись сохранена. Ожидает публикации базы.',{exact:true}).waitFor();n=prompts.length;await nav('Дашборд');assert.equal(prompts.length,n);
 await nav('Задачи и мероприятия');await p.getByRole('cell',{name:'QA сохранённое мероприятие',exact:true}).waitFor();assert.equal(await p.getByRole('cell',{name:'QA сохранённое мероприятие',exact:true}).count(),1);
 // Separate long forms. Exercise real named inputs and ensure the same guard
 // retains them on a refused leave, while accepted leave really resets them.
 for(const [section,create,field] of [
  ['Сертификация','Зарегистрировать документ','credential_number'],
  ['Планы развития','Создать план развития','development_title'],
  ['Подготовка сотрудников','Создать комплект подготовки','prep_new_note'],
  ['Банк вопросов','Зарегистрировать исходную редакцию','bank_note'],
  ['План производственного обучения','Назначить обучение','training_reason'],
  ['Ввод в профессию','Создать программу','program_title'],
  ['ROI-модель','Создать карточку эффекта','lc6_title']
 ]){
  await nav(section);await btn(create).click();await input(field).fill('QA несохранённое поле');accept=false;await expectConfirm(()=>nav('Дашборд'));assert.equal(await input(field).inputValue(),'QA несохранённое поле');accept=true;await expectConfirm(()=>nav('Дашборд'));await heading('Дашборд');
 }
 // Reverting to original values is not a dirty form.
 await actionNew();await input('lc5_action_title').fill('QA отменённый текст');await input('lc5_action_title').fill(defaults.title);n=prompts.length;await nav('Дашборд');assert.equal(prompts.length,n);
 assert.deepEqual(errors,[]);await ctx.close();console.log('LC6.7.5 work forms PASS: menu, local and browser Back, F5, owner/subject, discard, failed/successful write, clean filters and seven long forms');
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
