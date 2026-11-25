import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {fixture,date} from './lc4-fixture.mjs';
import {one} from '../src/core/db.js';
import {draftDocx,readZip} from '../src/modules/training/local-docx.js';
import {SCALE_NAME,CORPORATE_LEVELS} from '../src/modules/training/corporate-forms.js';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC4 учебная база ')),f=await fixture({installMethod:false});
const vt=f.w.edit('business_role',null,{code:'internal_trainer',name:'Внутренний тренер'});f.w.edit('role_assignment',null,{person_id:f.actor,role_id:vt,valid_from:'2020-01-01',valid_to:null});
const pos=f.w.edit('position',null,{code:'QA-POS',name:'Учебная должность'}),pa=one(f.w.working,'SELECT * FROM person_assignment WHERE person_id=?',[f.mentor]);
const oldAssignment={person_id:pa.person_id,unit_id:pa.unit_id,profession_id:pa.profession_id,position_id:pa.position_id,shift_id:pa.shift_id,shift_code:pa.shift_code,valid_from:pa.valid_from,valid_to:pa.valid_to};
f.w.edit('person_assignment',pa.id,{...oldAssignment,valid_to:'2026-01-19'});f.w.edit('person_assignment',null,{...oldAssignment,position_id:pos,valid_from:date,valid_to:null});
const sample=Array(56).fill('');sample[1]='ОБРАЗЕЦ';sample[8]='ПРИКАЗ';sample[38]='Директор';for(const i of [20,21,22,27,28,29])sample[i]='ФИО, должность';const orderFile=path.join(tmp,'qa-order.docx');await fs.writeFile(orderFile,draftDocx(sample));
const corporateScale=f.w.edit('rating_scale',null,{name:SCALE_NAME,version_no:'1',levels:CORPORATE_LEVELS});
const file=path.join(tmp,'training.leanbackup');await fs.writeFile(file,JSON.stringify(await f.backupBundle()));
const ids={trainee:f.trainee,mentor:f.mentor,actor:f.actor,revision:f.doc.id,document:f.doc.entity_id,skill:f.skill,scale:corporateScale,shift:f.shift,certificate:f.certificate,unit:f.unit,profession:f.profession};f.w.close();
const browser=await chromium.launch({headless:true,...(process.env.RUNNER_OS==='Windows'?{channel:'msedge'}:{})});
try{
 const ctx=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1366,height:850}}),page=await ctx.newPage(),errors=[],http=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(/^https?:/.test(r.url()))http.push(r.url())});
 const nav=async name=>{const target=page.locator('.sidebar .nav').filter({has:page.getByText(name,{exact:true})});if(!(await target.isVisible())){const group=target.locator('xpath=ancestor::details[1]');await group.locator('summary').click()}await target.click()};
 async function choose(label,query){await page.getByRole('button',{name:'Выбрать: '+label,exact:true}).click();await page.getByRole('searchbox',{name:'Поиск сотрудника'}).fill(query);await page.locator('.lc-picker-popup .lc-person-option').click()}
 const saved=async label=>{await page.getByRole('button',{name:label,exact:true}).click();await page.getByText('Запись сохранена. Ожидает публикации базы.',{exact:true}).waitFor();assert.equal(await page.locator('#status').getAttribute('class'),'status')};
 try{
 await page.goto(pathToFileURL(path.resolve('dist/LeanCenter/index.html')).href);await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();
 await nav('Настройки и обмен');const restore=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Восстановить копию',exact:true}).click();await (await restore).setFiles(file);await page.getByText('Копия восстановлена; проверьте ID базы',{exact:true}).waitFor();
 await nav('Инструктажи TWI');await page.getByRole('button',{name:'Назначить обучение',exact:true}).click();
 await page.locator('select[name=training_revision]').selectOption(ids.revision);await page.locator('input[name=assigned_on]').fill(date);await page.locator('input[name=due_on]').fill('2027-01-31');await page.getByText('План TWI: Сформирован · 15/15 полей',{exact:true}).waitFor();
 await page.locator('input[name=plan_reviewed]').check();await choose('Обучаемый','LC4-001');await choose('Инструктор','LC4-002');await choose('Ответственный за назначение','LC4-003');
 await page.locator('select[name=training_skill]').selectOption(ids.skill);await page.locator('select[name=training_target_scale]').selectOption(ids.scale);await page.locator('select[name=training_target_level]').selectOption('2');await page.locator('select[name=training_shift]').selectOption(ids.shift);await page.locator('textarea[name=training_reason]').fill('Учебное назначение');
 await saved('Сохранить назначение');await choose('Ответственный за СОП (НР)','LC4-003');await choose('Руководитель подразделения','LC4-003');await page.locator('input[name=approved_on]').fill(date);await saved('Зафиксировать согласование');
 await page.locator('.library-tabs').getByRole('button',{name:'Инструктаж',exact:true}).click();await page.getByRole('button',{name:'Показать план TWI и шаги СОП'}).click();await page.getByText('Учебный КМ',{exact:true}).waitFor();
 // The form defaults to 15 minutes, not the 10-minute core fixture.
 // Enter distinct durations explicitly and independently verify every saved fact.
 const stages=['prepare','show1','show2','show3','try1','try2','try3','try4'];
 const stageMinutes=[15,5,10,20,7,8,12,13],totalMinutes=stageMinutes.reduce((a,b)=>a+b,0);
 assert.equal(totalMinutes,90);
 let elapsed=0;
 for(const [i,code] of stages.entries()){
  await page.locator('select[name=session_stage]').selectOption(code);
  const minutes=page.locator('input[name=session_minutes]');
  if(i===0)assert.equal(await minutes.inputValue(),'15');
  await minutes.fill(String(stageMinutes[i]));
  const hh=String(8+Math.floor(elapsed/60)).padStart(2,'0'),mm=String(elapsed%60).padStart(2,'0');
  await page.locator('input[name=session_when]').fill(date+'T'+hh+':'+mm);elapsed+=stageMinutes[i];
  await page.locator('textarea[name=session_notes]').fill('Учебное наблюдение '+code);await page.locator('input[name=mentor_ack]').check();await page.locator('input[name=trainee_ack]').check();await saved('Записать этап')
 }
 await fs.mkdir('artifacts/lc4',{recursive:true});await page.screenshot({path:'artifacts/lc4/instruction.png',fullPage:true});
 await page.locator('.library-tabs').getByRole('button',{name:'Практика и допуск',exact:true}).click();
 for(const [kind,label] of [['safety','ОТ'],['theory','теории']]){
  const summary=page.locator('summary').filter({hasText:'Зарегистрировать проверку '+label});await summary.click();
  await page.locator('button[name=verify_'+kind+'_actor]').click();await page.getByRole('searchbox',{name:'Поиск сотрудника'}).fill('LC4-003');await page.locator('.lc-picker-popup .lc-person-option').click();await page.locator('input[name=verify_'+kind+'_date]').fill(date);await page.locator('textarea[name=verify_'+kind+'_evidence]').fill('Учебное основание');await page.locator('textarea[name=verify_'+kind+'_feedback]').fill('Учебная обратная связь');await saved('Сохранить проверку '+label)
 }
 await page.getByText('Новая практическая оценка',{exact:true}).click();await page.getByText('Стажер использовал СОП?',{exact:true}).waitFor();await page.locator('button[name=practical_actor]').click();await page.getByRole('searchbox',{name:'Поиск сотрудника'}).fill('LC4-003');await page.locator('.lc-picker-popup .lc-person-option').click();await page.locator('input[name=practical_date]').fill(date);
 for(let i=1;i<=11;i++)await page.locator('select[name=practical_value_'+i+']').selectOption(i===11?'0':'1');
 await page.locator('select[name=practical_conclusion]').selectOption('basic');await page.locator('textarea[name=practical_feedback]').fill('Учебная обратная связь');await saved('Зафиксировать практическую оценку');
 await page.getByText('Подтвердить компетенцию',{exact:true}).click();await choose('Подтверждающий уровень','LC4-003');await page.locator('input[name=qualification_date]').fill(date);await page.locator('select[name=qualification_level]').selectOption('2');await page.locator('textarea[name=qualification_evidence]').fill('Учебное наблюдение');await page.locator('textarea[name=qualification_feedback]').fill('Учебная обратная связь');await saved('Сохранить подтверждение уровня');
 await page.getByText('Зарегистрировать решение о допуске',{exact:true}).click();await choose('Ответственный за решение о допуске','LC4-003');await page.locator('input[name=admission_date]').fill(date);await page.locator('select[name=admission_decision]').selectOption('granted');await page.locator('textarea[name=admission_evidence]').fill('Учебное основание');await page.locator('textarea[name=admission_feedback]').fill('Учебная обратная связь');await saved('Сохранить решение о допуске');await page.getByRole('cell',{name:'Допуск зарегистрирован',exact:true}).waitFor();await page.screenshot({path:'artifacts/lc4/admission.png',fullPage:true});
 await nav('Матрица компетенций');await page.getByRole('button',{name:'Общая матрица всех навыков',exact:true}).click();await page.getByRole('button',{name:/2 · Допуск зарегистрирован/}).waitFor();await page.screenshot({path:'artifacts/lc4/matrix.png',fullPage:true});await page.getByRole('button',{name:/2 · Допуск зарегистрирован/}).click();await page.getByRole('heading',{name:'Ученик Тестовый · Учебный навык',exact:true}).waitFor();
 await nav('Журнал заданий');await page.getByRole('cell',{name:'Подготовка',exact:true}).waitFor();
 const planDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать план / факт XLSX',exact:true}).click();const planFile=path.join(tmp,'plan.xlsx');await (await planDownload).saveAs(planFile);
 const planBytes=new Uint8Array(await fs.readFile(planFile));
 const exportedPlan=await page.evaluate(async a=>{
  const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(a));
  const s=w.getWorksheet('План и реализация'),d=w.getWorksheet('Назначения и факты'),cell=s.getCell('H7'),value=cell.value;
  return {title:s.getCell('A1').value,date:s.getCell('F7').value,start:s.getCell('G7').value,duration:value instanceof Date?(value.getTime()-Date.UTC(1899,11,30))/86400000:value,durationType:value instanceof Date?'Date':typeof value,format:cell.numFmt,signature:s.getCell('I7').value,traineeSignature:s.getCell('J7').value,detail:d.rowCount,minutes:Array.from({length:d.rowCount-1},(_,i)=>d.getCell(i+2,9).value),notes:Array.from({length:d.rowCount-1},(_,i)=>d.getCell(i+2,10).value)}
 },Array.from(planBytes));
 console.log('LC4.1 duration QA',JSON.stringify(exportedPlan));
 assert.equal(exportedPlan.date,date);assert.equal(exportedPlan.start,'08:00');assert.equal(exportedPlan.format,'[h]:mm');
 assert.equal(exportedPlan.detail,9);assert.deepEqual(exportedPlan.minutes,stageMinutes);
 assert.deepEqual(exportedPlan.notes,stages.map(code=>'Учебное наблюдение '+code));
 assert.equal(exportedPlan.minutes.reduce((a,b)=>a+b,0),totalMinutes);
 assert(Math.abs(exportedPlan.duration-totalMinutes/1440)<1e-8,'Duration roundtrip: '+JSON.stringify(exportedPlan));
 assert(!exportedPlan.signature);assert(!exportedPlan.traineeSignature);
 // Independently inspect the actual OOXML numeric value, not just ExcelJS's
 // interpretation of duration as a Date on a second read.
 const planParts=await readZip(planBytes),sheetXml=new TextDecoder().decode(planParts.find(x=>x.name==='xl/worksheets/sheet1.xml').bytes);
 const rawCell=sheetXml.match(/<c\b[^>]*\br="H7"[^>]*>\s*<v>([^<]+)<\/v>\s*<\/c>/);
 assert(rawCell,'Missing numeric duration H7 in XLSX XML');assert(Math.abs(Number(rawCell[1])-totalMinutes/1440)<1e-12,'Incorrect raw Excel duration: '+rawCell[1]);
 await page.screenshot({path:'artifacts/lc4/journal.png',fullPage:true});
 await nav('Бланки и методики');await page.getByRole('cell',{name:'Чек-лист оценки выполнения операций Стажером',exact:true}).waitFor();
 await nav('Самооценка');await page.getByRole('button',{name:'Новая самооценка',exact:true}).click();await page.locator('input[name=self_date]').fill(date);await choose('Инструктор / наставник','LC4-002');await page.locator('input[name=self_place]').fill('Учебный участок');for(let i=1;i<=20;i++)await page.locator('select[name=self_value_'+i+']').selectOption('3');await saved('Сохранить самооценку');await page.getByRole('heading',{name:'Самооценка · Инструктор Тестовый',exact:true}).waitFor();
 await nav('Аудиты 1-го уровня');await page.getByRole('button',{name:'Новый аудит',exact:true}).click();await page.locator('select[name=audit_assignment]').selectOption({index:1});await page.locator('select[name=audit_fact]').selectOption({index:1});await page.locator('input[name=audit_date]').fill(date);await choose('Внутренний тренер','LC4-003');for(let i=1;i<=20;i++)await page.locator('select[name=audit_value_'+i+']').selectOption('1');await page.locator('textarea[name=audit_feedback]').fill('Учебный аудит');await saved('Сохранить аудит');await page.getByRole('heading',{name:'Аудит 1-го уровня · Инструктор Тестовый',exact:true}).waitFor();await page.getByText('Результат: 20 / 20',{exact:true}).waitFor();
 await nav('Наставники и ВТ');await page.getByRole('cell',{name:'Инструктор Тестовый',exact:true}).waitFor();
 await nav('Назначения');await page.getByRole('button',{name:'Групповой приказ',exact:true}).click();
 await page.locator('input[name=order_organization]').fill('Учебная организация');await page.locator('input[name=order_city]').fill('Учебный город');await page.locator('input[name=order_number]').fill('QA-GROUP');await page.locator('input[name=order_on]').fill(date);await page.locator('input[name=order_start]').fill(date);await choose('Директор / утверждающий','LC4-003');
 const groupRole=page.locator('select[name=group_member_role]'),groupCertificate=page.locator('select[name=group_member_cert]');
 await groupRole.selectOption('instructor');await choose('Сертифицированный сотрудник','Инстр');
 assert.equal(await groupCertificate.inputValue(),ids.certificate,'Single matching certificate must remain selected after option replacement');
 await groupRole.selectOption('');assert.equal(await groupCertificate.inputValue(),ids.certificate,'Changing compatible filter must preserve selected certificate');
 await groupRole.selectOption('internal_trainer');assert.equal(await groupCertificate.inputValue(),'','Incompatible role must clear certificate');
 await groupRole.selectOption('instructor');await choose('Сертифицированный сотрудник','Инстр');assert.equal(await groupCertificate.inputValue(),ids.certificate);
 await page.locator('input[name=group_member_ack]').fill(date);
 await page.locator('input[name=order_pay_instructor]').fill('1000');await page.locator('input[name=order_pay_from]').fill(date);
 const builtDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Сформировать проект DOCX',exact:true}).click();const builtFile=path.join(tmp,'qa-built.docx');await (await builtDownload).saveAs(builtFile);const builtParts=await readZip(new Uint8Array(await fs.readFile(builtFile)));assert.match(new TextDecoder().decode(builtParts.find(x=>x.name==='word/document.xml').bytes),/Инструктор Тестовый, Учебная должность/);
 const draftButton=page.getByRole('button',{name:'Сформировать проект по оригиналу DOCX',exact:true});
 const invalidTemplate=path.join(tmp,'qa-invalid-order.docx');await fs.writeFile(invalidTemplate,draftDocx(['Несовместимый учебный шаблон']));
 let chooser=page.waitForEvent('filechooser');await draftButton.click();await (await chooser).setFiles(invalidTemplate);
 await page.locator('#status.error').filter({hasText:'Структура не совпадает'}).waitFor();
 assert.equal(await page.locator('input[name=order_number]').inputValue(),'QA-GROUP');assert.equal(await groupCertificate.inputValue(),ids.certificate);
 const output=path.join(tmp,'qa-draft.docx');
 // Capture errors reported by the application, rather than failing only with
 // a generic Playwright download timeout.
 chooser=page.waitForEvent('filechooser');
 const download=page.waitForEvent('download').then(value=>({value}),error=>({error}));
 await draftButton.click();await (await chooser).setFiles(orderFile);
 try{
  await page.waitForFunction(()=>{const s=document.getElementById('status');return s&&(s.classList.contains('error')||s.textContent==='Проект приказа сформирован без подписи')});
  const status=await page.locator('#status').textContent();assert.equal(status,'Проект приказа сформирован без подписи','DOCX export status: '+status);
  const result=await download;if(result.error)throw result.error;await result.value.saveAs(output)
 }catch(e){console.error('LC4.1 order export status',await page.locator('#status').textContent(),errors);await page.screenshot({path:'artifacts/lc4/group-order-error.png',fullPage:true});throw e}
 const parts=await readZip(new Uint8Array(await fs.readFile(output))),xml=new TextDecoder().decode(parts.find(x=>x.name==='word/document.xml').bytes);
 assert.match(xml,/Инструктор Тестовый, Учебная должность/);assert.match(xml,/QA-GROUP/);assert.match(xml,/ПРОЕКТ · БЕЗ ПОДПИСИ/);
 assert.equal(await page.locator('input[name=order_number]').inputValue(),'QA-GROUP');assert.equal(await groupCertificate.inputValue(),ids.certificate);
 await page.locator('textarea[name=group_order_evidence]').fill('Учебный подписанный приказ');await page.locator('input[name=group_order_confirm]').check();await saved('Зарегистрировать групповой приказ');await page.getByRole('heading',{name:'Групповой приказ QA-GROUP',exact:true}).waitFor();await page.getByRole('cell',{name:'Учебная должность',exact:true}).waitFor();await page.screenshot({path:'artifacts/lc4/group-order.png',fullPage:true});
 await nav('Сотрудники');await page.getByRole('button',{name:'Ученик Тестовый',exact:true}).click();await page.getByRole('heading',{name:'Ученик Тестовый',exact:true}).waitFor();
 await page.locator('.employee-tabs button').filter({hasText:'Матрицы компетенций'}).click();await page.getByRole('button',{name:'Создать матрицу с сотрудником',exact:true}).click();
 await page.locator('input[name=matrix_code]').fill('QA-MATRIX');await page.locator('input[name=matrix_title]').fill('Матрица QA');await choose('Разработал','LC4-003');await page.locator('select[name=matrix_scope]').selectOption(ids.unit);assert(await page.locator('input[name="matrix_person_'+ids.trainee+'"]').isChecked());await page.locator('input[name="matrix_person_'+ids.mentor+'"]').check();
 await page.locator('input[name="matrix_column_'+ids.skill+':'+ids.document+'"]').check();await page.locator('select[name=matrix_target_0]').selectOption('3');await page.getByRole('button',{name:'Предпросмотр',exact:true}).click();await page.getByRole('button',{name:'Сохранить матрицу',exact:true}).click();await page.getByRole('heading',{name:'Матрица QA',exact:true}).waitFor();await page.locator('.corporate-matrix').waitFor();assert.equal(await page.locator('.matrix-value.matrix-deficit').count(),2);assert.equal(await page.locator('.matrix-value.matrix-level-2').textContent(),'2');await page.screenshot({path:'artifacts/lc4/corporate-matrix.png',fullPage:true});
 const qualifiedCell=page.locator('.matrix-value.matrix-level-2');await qualifiedCell.click();await page.locator('.matrix-cell-drawer').getByRole('heading',{name:'История подтверждений',exact:true}).waitFor();await page.locator('.corporate-matrix').waitFor();await page.locator('.matrix-cell-drawer').getByRole('button',{name:'Закрыть',exact:true}).click();assert(!(await page.locator('.matrix-cell-drawer').isVisible()));
 await page.locator('input[name=matrix_saved_transpose]').check();await page.locator('.corporate-matrix.matrix-transposed').waitFor();await page.locator('input[name=matrix_saved_transpose]').uncheck();await page.locator('select[name=matrix_saved_metric]').selectOption('delta');assert.equal(await page.locator('.matrix-value').filter({hasText:/^0$/}).count(),1);await page.locator('select[name=matrix_saved_metric]').selectOption('actual');
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать матрицу XLSX',exact:true}).click();const matrixFile=path.join(tmp,'matrix.xlsx');await (await dl).saveAs(matrixFile);const matrixParts=await readZip(new Uint8Array(await fs.readFile(matrixFile)));assert(matrixParts.some(x=>x.name==='xl/worksheets/sheet5.xml'));const matrixRead=await page.evaluate(async bytes=>{const w=new ExcelJS.Workbook();await w.xlsx.load(Uint8Array.from(bytes));const s=w.getWorksheet('Матрица компетенций'),values=[];for(let i=7;i<=8;i++)values.push({name:s.getCell(i,2).value,actual:s.getCell(i,4).value,base:s.getCell(i,5).value,target:s.getCell(i,7).value,need:s.getCell(i,8).value});return values},Array.from(await fs.readFile(matrixFile)));const mRow=matrixRead.find(x=>x.name==='Ученик Тестовый');assert.equal(mRow.actual,2);assert.equal(mRow.base.result,2);assert.equal(mRow.target.result,3);assert.equal(mRow.need.result,1);
 await page.getByRole('button',{name:'← К карточке сотрудника',exact:true}).click();await page.locator('.employee-tabs button').filter({hasText:'Матрицы компетенций'}).click();await page.getByRole('cell',{name:'Матрица QA · v1',exact:true}).waitFor();await page.getByRole('button',{name:'Открыть',exact:true}).click();await page.getByRole('heading',{name:'Матрица QA',exact:true}).waitFor();assert.equal(await page.locator('.corporate-matrix tbody tr').count(),1);
 await page.getByRole('button',{name:'Ученик Тестовый',exact:true}).click();await page.locator('.employee-tabs button').filter({hasText:'Оценки и допуски'}).click();await page.getByRole('cell',{name:/Практическая оценка ·/}).waitFor();await page.screenshot({path:'artifacts/lc4/employee-card.png',fullPage:true});
 // Profile editor, auto mode, template mode and XLSX reconciliation all use
 // existing directory and skill IDs. Import must not overwrite qualifications.
 await nav('Матрица компетенций');await page.getByRole('button',{name:'Профили профессий',exact:true}).click();
 await page.locator('select[name=matrix_profile_profession]').selectOption(ids.profession);await page.getByRole('button',{name:'Открыть профиль',exact:true}).click();
 await page.locator('select[name="profile_level_'+ids.skill+'"]').selectOption('3');await page.getByRole('button',{name:'Сохранить профиль',exact:true}).click();await page.getByText('Профиль сохранён. Ожидает публикации.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Конструктор матрицы',exact:true}).click();await page.locator('select[name=matrix_scope]').selectOption(ids.unit);
 assert.equal(await page.locator('select[name=matrix_create_mode]').inputValue(),'auto');
 assert(await page.locator('input[name="matrix_column_'+ids.skill+':'+ids.document+'"]').isChecked());
 assert.equal(await page.locator('input[name^=matrix_person_]:checked').count(),4);
 await page.locator('select[name=matrix_create_mode]').selectOption('template');await page.locator('select[name=matrix_template]').selectOption({index:1});await page.getByRole('button',{name:'Применить образец',exact:true}).click();
 assert(await page.locator('input[name="matrix_column_'+ids.skill+':'+ids.document+'"]').isChecked());
 await page.getByText('Импорт существующей матрицы XLSX',{exact:true}).click();const matrixChooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Выбрать XLSX',exact:true}).click();await (await matrixChooser).setFiles(matrixFile);
 await page.locator('select[name=matrix_import_sheet]').waitFor();
 for(const [name,value] of Object.entries({headerRow:5,firstRow:7,lastRow:8,personCol:2,firstSkill:4,lastSkill:4}))await page.locator('input[name=matrix_import_'+name+']').fill(String(value));
 await page.getByRole('button',{name:'Сопоставить строки и столбцы',exact:true}).click();await page.getByRole('button',{name:'Применить состав и сверить оценки',exact:true}).click();
 assert.equal(await page.locator('input[name^=matrix_person_]:checked').count(),2);assert.equal(await page.locator('select[name=matrix_create_mode]').inputValue(),'manual');await page.getByText(/требуется проверка 0/).waitFor();await page.screenshot({path:'artifacts/lc4/matrix-import.png',fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'Дашборд',exact:true}).waitFor();await nav('Практические оценки');await page.getByRole('cell',{name:'Допуск зарегистрирован',exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(http,[]);await ctx.close();
 console.log('LC4 browser PASS: assignment, approval, eight intro facts, knowledge checks, practical, qualification, admission, matrix, journal, reload');
 }catch(e){console.error('LC4 browser failure',String(e),'status:',await page.locator('#status').textContent().catch(()=>''),'page errors:',errors);await page.screenshot({path:'artifacts/lc4/failure.png',fullPage:true}).catch(()=>{});throw e}
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
