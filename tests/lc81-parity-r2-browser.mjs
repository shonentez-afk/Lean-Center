import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fixture,SQL,date} from './lc4-fixture.mjs';
import {prepareSnapshot,one,rows,uuid} from '../src/core/db.js';
import {RC1_CRITERIA} from '../src/modules/training/builtin-forms.js';
import {openSecureQA} from '../server/lc81/store.mjs';
import {createSecureQAServer} from '../server/lc81/http.mjs';
import {copyPilotCheckpoint} from '../server/lc74-store.mjs';
import {migratePilotCopy} from '../server/lc81/maintenance.mjs';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'lc81-parity-r2-'));
let f,store,server,proxy,browser;
const close=s=>s?.listening?new Promise(resolve=>s.close(resolve)):Promise.resolve();
try{
 f=await fixture();
 const site=f.w.edit('org_unit',null,{code:'QA-SITE-R2',name:'Учебное предприятие R2',kind:'Предприятие',parent_id:null});
 f.w.edit('org_unit',f.unit,{code:'QA',name:'Учебный участок',kind:'Участок',parent_id:site});
 const managerRole=f.w.edit('business_role',null,{code:'QA-MANAGER-R2',name:'Управляющий центром TWI'});
 const adminRole=f.w.edit('business_role',null,{code:'QA-ADMIN-R2',name:'Администратор'});
 const managerAssignment=f.w.edit('role_assignment',null,{person_id:f.actor,role_id:managerRole,valid_from:'2020-01-01',valid_to:null});
 const trainerRole=f.w.edit('business_role',null,{code:'INTERNAL_TRAINER',name:'Внутренний тренер'});
 f.w.edit('role_assignment',null,{person_id:f.actor,role_id:trainerRole,valid_from:'2020-01-01',valid_to:null});
 const assignment=await f.addAssignment();
 await f.approve(assignment);
 await f.stage(assignment,'prepare');
 const method=(await f.save('checklist_version',{format:'lean-audit-checklist-v1',title:'QA RC1 R2',source_sha256:'a'.repeat(64),criteria:RC1_CRITERIA.map(({rc1_id,...q})=>q)})).entity_id;
 const sess=one(f.w.working,'SELECT id FROM training_session WHERE assignment_id=?',[assignment]);
 const criteria=rows(f.w.working,'SELECT id FROM checklist_criterion WHERE version_id=? ORDER BY position',[method]);
 await f.save('audit_session',{assignment_id:assignment,assignment_rev:f.getAssignment(assignment).rev,method_id:method,auditor_id:f.actor,session_id:sess.id,observed_on:date,responses:criteria.map(q=>({criterion_id:q.id,value:1,note:''})),feedback:'QA'});
 await f.save('action_item',{response_id:null,title:'Просроченная учебная задача R2',owner_id:f.trainee,subject_id:null,due_on:'2026-01-31',kind:'corrective',priority:'normal'});
 const generalSkill=f.w.edit('skill',null,{category_id:one(f.w.working,'SELECT category_id FROM skill WHERE id=?',[f.skill]).category_id,operation_id:null,name:'Учебный общий навык R2'});
 await f.w.acceptOwn(f.readContent);
 const snapshot=await prepareSnapshot(f.w);
 const source=path.join(root,'legacy'),target=path.join(root,'secure');
 await copyPilotCheckpoint({SQL,snapshot,readSource:f.readContent,target:source});
 const password=randomBytes(24).toString('hex');
 await migratePilotCopy({source,target,siteId:site,adminRoleId:adminRole,managerRoleId:managerRole,login:'admin',password});
 store=await openSecureQA({dataDir:target});
 const admin=store.authenticate('admin',password);
 const manager=await store.createAccount(admin.id,{person_id:f.actor,login:'manager',password,generate:false});
 await store.grant(admin.id,{account_id:manager.id,assignment_id:managerAssignment,scope:{kind:'unit_tree',unit_id:site},valid_to:null});
 const siteDay=store.adminData(admin.id).clock.day;
 assert(siteDay>'2026-01-31','Fixture needs a day after January 2026');
 const ctx=(kind,command,operation_id,id=null,revision_id=null,origin_id=null,origin_revision=null)=>({kind,command,operation_id,id,revision_id,origin_id,origin_revision});
 const req=(context,expected_revision,title,code,observed_at,text)=>({request_id:uuid(),context,expected_revision,title,code,observed_at,text});
 const raw={schemaVersion:'FRV-1.3',study:{studyId:'QA-R2-FRV',operationId:'Учебная операция',status:'Draft'},cycles:[{id:'c1',cycleNo:1,phase:'baseline',observations:[{id:'o1',actionRaw:'Учебный замер',valueType:'VA',durationSec:12,standardCandidate:true}]}],standard:{outdated:false,steps:[{action:'Учебный замер',plannedTimeSec:10,sourceObservationIds:['o1'],keyMoment:'КМ',reason:'Причина',valueType:'VA'}]}};
 const frv=await store.saveLibrary(manager.id,1,req(ctx('frv','create',f.operation),0,'Учебный источник ФРВ R2',null,date,JSON.stringify(raw)));
 const originCtx=ctx('sop','create',f.operation,null,null,frv.id,frv.rev);
 const origin=await store.openLibrary(manager.id,1,originCtx);
 await store.saveLibrary(manager.id,1,req(originCtx,0,'Учебный СОП из ФРВ R2','QA-R2-FRV-SOP',null,origin.text));
 raw.cycles[0].observations[0].durationSec=24;
 await store.saveLibrary(manager.id,1,req(ctx('frv','save',f.operation,frv.id),frv.rev,'Учебный источник ФРВ R2',null,date,JSON.stringify(raw)));
 const assess=(person,state,level,assessed_on,valid_until,previous_assessment_id=null)=>store.competencyChange(manager.id,1,{command:'assessment.general',fields:{person_id:person,skill_id:generalSkill,scale_id:f.scale,assessed_on,observation_state:state,level,valid_until,evidence:'Учебное подтверждение',feedback:'Учебная обратная связь',previous_assessment_id}});
 const prior=await assess(f.trainee,'rated',2,date,null);
 await assess(f.trainee,'not_observed',null,siteDay,null,prior.id);
 await assess(f.other,'rated',2,date,date);
 await assess(f.mentor,'not_applicable',null,siteDay,null);
 const key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=localhost','-days','1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 proxy=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(cert)},(req,res)=>{
  const upstream=http.request({hostname:'127.0.0.1',port:server.address().port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream);
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const url='https://127.0.0.1:'+proxy.address().port;
 server=createSecureQAServer({store,origin:url});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});
 const p=await context.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(String(e)));p.on('dialog',d=>d.dismiss());
 await p.goto(url);
 await p.locator('#login input[name=login]').fill('manager');
 await p.locator('#login input[name=password]').fill(password);
 await p.getByRole('button',{name:'Войти',exact:true}).click();
 await p.locator('#workspace').waitFor();
 const content=p.locator('#content');
 const button=name=>content.getByRole('button',{name,exact:true});
 const heading=name=>content.getByRole('heading',{name,exact:true});
 const ready=async()=>{await p.locator('#save-indicator[data-kind="saved"]').waitFor();assert.equal(await p.locator('#status.error').count(),0)};
 const go=async action=>{
  await p.bringToFront();
  await ready();
  const nav=p.locator('#nav [data-action="'+action+'"]'),group=nav.locator('xpath=ancestor::details');
  await nav.waitFor({state:'attached'});
  // Navigation can be rebuilt by the live access check. Re-read the current
  // group after it has settled, and use the actual menu summary (no forced click).
  for(let attempt=0;attempt<5;attempt++){
   await p.locator('html:not(.lc81-access-check) #nav').waitFor();
   if(await p.locator('#menu').isVisible()&&await p.locator('#menu').getAttribute('aria-expanded')!=='true')await p.locator('#menu').click();
   if(await group.count()&&!await group.evaluate(e=>e.open))await group.locator('summary').click();
   try{await nav.click({timeout:3000});await p.locator('#nav [data-action="'+action+'"][aria-current="page"]').waitFor({timeout:3000});await ready();return}catch(e){
    if(attempt===4)throw e;
   }
  }
 };
 const rowWith=(scope,value)=>scope.getByRole('row').filter({has:p.getByRole('cell',{name:value,exact:true})});
 await go('center.read');
 await content.locator('select[name=unit_id]').selectOption(f.unit);
 for(const [name,value] of [['from','2026-01-15'],['to','2026-02-10']]){
  const field=content.locator('input[name='+name+']');await field.fill(value);await field.dispatchEvent('change');
 }
 await button('Обновить').click();await ready();
 for(const [title,link] of [['Назначения обучения по месяцам когорты','Открыть обучение'],['Факты аудита L1','Открыть аудит']]){
  const section=heading(title).locator('xpath=..');
  await rowWith(section,'2026-01').getByRole('button').first().click();
  await button(link).waitFor();
  await content.getByText('Период основания: 2026-01-15 — 2026-01-31',{exact:false}).last().waitFor();
 }
 await button('Открыть аудит').click();
 await content.getByRole('heading',{name:/^Аудит · /}).waitFor();
 await ready();
 console.log('PARITY_R2_DASHBOARD_OK');

 await go('person.read_directory');
 await rowWith(content,'LC4-001').getByRole('button',{name:'Карточка',exact:true}).click();
 await button('План сотрудника').click();
 const plan=heading('План работы сотрудника').locator('xpath=..');
 await plan.waitFor();
 await plan.locator('select[name=filter]').selectOption('late');
 const overdue=rowWith(plan,'Просроченная учебная задача R2');
 await overdue.waitFor();
 assert((await overdue.innerText()).includes('2026-01-31'));
 assert((await overdue.innerText()).includes('Просрочено'));
 await button('Календарь сотрудника').click();
 const calendar=content.getByRole('heading',{name:/^Календарь сотрудника · /}).locator('xpath=..');
 await calendar.locator('.lc81-calendar').waitFor();
 assert.equal(await rowWith(calendar,'Просроченная учебная задача R2').count(),0);
 await ready();
 console.log('PARITY_R2_OVERDUE_PLAN_OK');

 await go('sop.read_history');
 await rowWith(content,'QA-R2-FRV-SOP').getByRole('button',{name:'Карточка СОП',exact:true}).click();
 await content.locator('.lc81-card-tabs [data-tab=frv]').click();
 const saved=heading('Сохранённый снимок исходного ФРВ').locator('xpath=..');
 await saved.waitFor();
 assert((await saved.innerText()).includes('Исследование изменилось после создания этой редакции'));
 await saved.getByRole('cell',{name:'12',exact:true}).waitFor();
 await saved.getByRole('button',{name:'Открыть текущие замеры исследования',exact:true}).click();
 await saved.getByRole('cell',{name:'24',exact:true}).waitFor();
 assert.equal(await saved.getByRole('cell',{name:'12',exact:true}).count(),1);
 await ready();
 console.log('PARITY_R2_FRV_SNAPSHOT_OK');
 await go('sop.read_effective');
 await rowWith(content,'QA-LC4').getByRole('button',{name:'Открыть СОП',exact:true}).click();
 await button('Внедрение новой операции / редакции').click();
 await content.getByRole('heading',{name:/^Внедрение новой операции · /}).waitFor();
 await content.getByText('Отчёт по этой редакции ещё не создан.',{exact:false}).waitFor();
 await button('Сформировать отчёт о внедрении').click();
 await content.getByRole('heading',{name:'Состав и основания внедрения',exact:true}).waitFor();
 await content.getByRole('cell',{name:'Ученик Тестовый',exact:true}).waitFor();
 await content.locator('select[name=skill_id]').waitFor();
 await button('← К СОП').click();await content.locator('.lc81-card-tabs').waitFor();
 await ready();console.log('TWI03_R4_ROLLOUT_FORM_OK');

 await go('matrix.read');await button('Общая матрица всех навыков').click();
 for(const state of ['none','not_observed','not_applicable','expired'])await content.locator('[data-assessment-state='+state+']').first().waitFor();
 await content.locator('button[data-assessment-state=not_observed]').click();
 const history=heading('История оценок навыка').locator('xpath=..');
 await history.waitFor();
 await history.getByRole('cell',{name:'Не наблюдалось',exact:true}).waitFor();
 await history.getByRole('cell',{name:'2',exact:true}).waitFor();
 assert.equal(await history.getByRole('button',{name:'Открыть оценку',exact:true}).count(),2);
 await rowWith(history,'2').getByRole('button',{name:'Открыть оценку',exact:true}).click();
 const assessment=content.getByRole('heading',{name:/^Общий навык · /}).locator('xpath=..');
 await assessment.waitFor();await assessment.getByRole('cell',{name:'2',exact:true}).waitFor();
 await ready();
 assert.deepEqual(errors,[]);
 console.log('PARITY_R2_MATRIX_HISTORY_OK');
}finally{
 await browser?.close();
 await close(proxy);await close(server);await store?.close();
 f?.w.close();
 await fs.rm(root,{recursive:true,force:true});
}
