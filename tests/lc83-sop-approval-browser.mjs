import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {setupApproval} from './lc83-approval-fixture.mjs';
import {createSecureQAServer} from '../server/lc81/http.mjs';
const x=await setupApproval();let browser,server,proxy;
const close=s=>s?.listening?new Promise(resolve=>s.close(resolve)):Promise.resolve();
// Poll an actual locator in the test runner. waitForFunction's internal eval
// is blocked by the application's CSP; do not use bypassCSP or unsafe-eval.
async function loadedImage(locator){
 await locator.waitFor({state:'visible'});
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  if(await locator.evaluate(img=>img.complete&&img.naturalWidth>0))return;
  await new Promise(resolve=>setTimeout(resolve,80));
 }
 throw Error('Authorized image did not load');
}
try{
 const d=await x.passport(await x.draft('Браузерная редакция LC83')),id=d.revision_id;
 const key=path.join(x.root,'key.pem'),cert=path.join(x.root,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=localhost','-days','1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 proxy=https.createServer({key:await fs.readFile(key),cert:await fs.readFile(cert)},(req,res)=>{
  const up=http.request({hostname:'127.0.0.1',port:server.address().port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  up.on('error',()=>{res.writeHead(502);res.end()});req.pipe(up);
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const url='https://127.0.0.1:'+proxy.address().port;
 server=createSecureQAServer({store:x.store,origin:url});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true});const errors=[];
 async function profile(name,mobile=false,fragment=''){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:mobile?{width:390,height:844}:{width:1440,height:900}}),p=await ctx.newPage();
  p.on('pageerror',e=>errors.push(String(e)));p.on('dialog',d=>d.dismiss());await p.goto(url+fragment);
  await p.locator('#login input[name=login]').fill(name);await p.locator('#login input[name=password]').fill(x.password);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.locator('#workspace').waitFor();
  const content=p.locator('#content'),button=name=>content.getByRole('button',{name,exact:true});
  const ready=async()=>{await p.bringToFront();await p.locator('html:not(.lc81-access-check)').waitFor();await p.locator('#nav[aria-busy="false"]').waitFor({state:'attached'});await p.locator('#save-indicator[data-kind="saved"]').waitFor();assert.equal(await p.locator('#status.error').count(),0)};
  const go=async action=>{await ready();const nav=p.locator('#nav [data-action="'+action+'"]'),group=nav.locator('xpath=ancestor::details');
   await nav.waitFor({state:'attached'});
   if(await p.locator('#menu').isVisible()&&await p.locator('#menu').getAttribute('aria-expanded')!=='true')await p.locator('#menu').click();
   if(await group.count()&&!await group.evaluate(e=>e.open))await group.locator('summary').click();
   await nav.click();await p.locator('#nav [data-action="'+action+'"][aria-current="page"]').waitFor({state:'attached'});await ready();
  };
  return {p,ctx,content,button,ready,go};
 }
 const a=await profile('author');await a.go('sop.read_history');
 const row=a.content.locator('tr').filter({hasText:'Браузерная редакция LC83'});
 await row.getByRole('button',{name:'Согласование СОП',exact:true}).click();
 await a.content.locator('select[name=account_safety]').waitFor();
 for(const [stage,name] of [['safety','safety'],['engineering','engineering'],['twi','twi'],['director','director'],['publish','director']]){
  await a.content.locator('select[name=account_'+stage+']').selectOption(x.users[name].id);
  await a.content.locator('input[name=due_'+stage+']').fill(x.day);
 }
 await a.content.locator('form').filter({has:a.p.locator('select[name=mode]')}).locator('textarea[name=note]').fill('Изменено действие, уточнено содержание для проверки');
 await a.button('Отправить на согласование').click();
 await a.content.getByText('На согласовании',{exact:true}).first().waitFor();await a.ready();
 assert.equal(x.detail('author',id).round.state,'review');await a.ctx.close();
 const outsider=await profile('observer');await outsider.go('sop.approvals');
 assert.equal(await outsider.button('Открыть согласование').count(),0);await outsider.ctx.close();
 for(const name of ['safety','engineering','twi','director']){
  const q=await profile(name,name==='safety');
  if(name==='safety'){
   await q.go('plan.read');await q.button('Открыть согласование').click();
   await q.content.getByRole('heading',{name:'Что изменилось и зачем',exact:true}).waitFor();
   await q.p.locator('#lc82-bell').click();
   const inbox=q.p.locator('dialog.lc82-notification-dialog');
   await inbox.getByRole('heading',{name:'СОП назначен на согласование',exact:true}).waitFor();
   await inbox.getByRole('button',{name:'Отметить прочитанным',exact:true}).click();
   await inbox.getByText('Непрочитанных: 0',{exact:false}).waitFor();
   await inbox.getByRole('button',{name:'Требуют действия',exact:true}).click();
   await inbox.getByRole('heading',{name:'СОП назначен на согласование',exact:true}).waitFor();
   assert.equal(await inbox.getByRole('button',{name:'Отметить прочитанным',exact:true}).count(),0);
   await inbox.getByRole('button',{name:'Открыть согласование',exact:true}).click();
   await q.content.getByText('Изменено действие, уточнено содержание для проверки',{exact:true}).waitFor();
   assert.equal(x.detail('safety',id).round.decisions.length,0);
   console.log('LC835_LC821_BROWSER_PLAN_AND_INBOX_SAME_ROUND_OK');
  }else{await q.go('sop.approvals');await q.button('Открыть согласование').click();}
  await q.button('Просмотреть зафиксированный СОП').click();await q.content.getByText('Браузерная редакция LC83',{exact:true}).first().waitFor();
  await q.content.getByRole('heading',{name:'Сравнение с предыдущей действующей редакцией',exact:true}).waitFor();
  await q.button('Показать прежнее фото шага 1').click();
  await loadedImage(q.content.locator('img[alt="Прежнее фото шага 1"]'));
  await q.button('Показать фото').first().click();
  await loadedImage(q.content.locator('img[alt="Фото шага 1"]').first());
  await q.button(name==='director'?'Утвердить СОП':'Согласовать СОП').click();await q.ready();
  if(name==='director'){
   assert.equal(x.detail('author',id).round.state,'approved');assert(x.effective().includes(x.old));
   assert.equal(await q.button('Ввести в действие').count(),0);
   const m=await profile('manager');await m.go('sop.approvals');await m.button('Открыть согласование').click();
   // A has locator is relative to each candidate form. Do not include
   // #content in the inner selector; it is an ancestor, not a descendant.
   const impactForm=m.content.locator('form').filter({has:m.p.locator('select[name=impact_decision]')});
   await impactForm.locator('select[name=impact_decision]').selectOption('retrain');
   await impactForm.locator('textarea[name=note]').fill('Учебное обоснование');
   await impactForm.getByRole('button',{name:'Зарегистрировать оценку влияния',exact:true}).click();
   await m.content.getByText('Переобучение ·', {exact:false}).first().waitFor();await m.ready();
   assert.equal(x.detail('author',id).impact.record?.decision,'retrain');await m.ctx.close();
   await q.p.bringToFront();await q.ready();
   await q.button('← Назад к списку').click();await q.button('Открыть согласование').click();
   await q.button('Ввести в действие').waitFor();
   const scheduleForm=q.content.locator('form').filter({has:q.p.locator('input[name=publication_due_on]')});
   const tomorrow=new Date(Date.parse(x.day)+86400000).toISOString().slice(0,10);
   async function plan(date){
    await scheduleForm.locator('input[name=publication_due_on]').fill(date);
    await scheduleForm.locator('textarea[name=note]').fill('Плановый ввод · проверка браузера');
    await scheduleForm.getByRole('button',{name:'Запланировать ввод',exact:true}).click();
    await q.content.getByText('Запланирован ввод · '+date,{exact:true}).first().waitFor();
    await q.ready();assert.equal(x.detail('author',id).publication.record.state,'pending');
   }
   await plan(tomorrow);
   assert.equal(await q.button('Ввести в действие').count(),0);
   assert.equal((await x.store.runDueSopPublications()).executed,0);
   assert(x.effective().includes(x.old));
   const cancelForm=q.content.locator('form').filter({has:q.p.getByRole('button',{name:'Отменить запланированный ввод',exact:true})});
   await cancelForm.locator('textarea[name=note]').fill('Перенос даты ввода');
   await cancelForm.getByRole('button',{name:'Отменить запланированный ввод',exact:true}).click();
   await q.content.getByText('Утверждён · ожидает ввода',{exact:true}).first().waitFor();await q.ready();
   assert.equal(x.detail('author',id).publication.record.state,'cancelled');
   await plan(x.day);
   assert.equal((await x.store.runDueSopPublications()).executed,1);
   await q.button('← Назад к списку').click();await q.button('Открыть согласование').click();
   await q.content.getByText('Введён в действие',{exact:true}).first().waitFor();await q.ready();
   assert.equal(x.detail('author',id).publication.record.state,'executed');
   console.log('LC83_BROWSER_SCHEDULE_CANCEL_EXECUTE_OK');
  }
  await q.ctx.close();
 }
 assert.equal(x.detail('author',id).round.state,'effective');assert(x.effective().includes(id));assert(!x.effective().includes(x.old));
 const employee=await profile('author',true);await employee.go('sop.approvals');await employee.button('Ознакомление с СОП').click();await employee.button('Подтвердить ознакомление').click();
 const ackForm=employee.content.locator('form').filter({has:employee.p.locator('input[name=confirmed]')});
 await ackForm.locator('input[name=confirmed]').check();
 await ackForm.getByRole('button',{name:'Подтвердить ознакомление',exact:true}).click();
 await employee.content.getByText('Ознакомлен · ',{exact:false}).first().waitFor();await employee.ready();
 assert.equal(x.store.familiarizationList(x.users.author.id,1,{kind:'mine',revision_id:id}).items[0].state,'confirmed');
 await employee.ctx.close();
 const control=await profile('manager');await control.go('sop.approvals');await control.button('Ознакомление с СОП').click();await control.button('Контроль ознакомления').click();
 await control.content.getByText('Ознакомлен · ',{exact:false}).first().waitFor();
 await control.button('Назначить обучение').first().waitFor();
 await control.button('Открыть СОП').first().click();
 await control.button('Ознакомление и адресное обучение').first().click();
 await control.button('Уточнить состав исполнителей').click();
 const scopeForm=control.content.locator('form').filter({has:control.p.locator('select[name=scope_person]')});
 await scopeForm.locator('select[name=scope_person]').selectOption(x.users.observer.person_id);
 await scopeForm.locator('select[name=scope_skill]').selectOption(x.skill);
 await scopeForm.locator('textarea[name=note]').fill('Дополнительный исполнитель · браузерная проверка');
 await scopeForm.getByRole('button',{name:'Сохранить уточнение состава',exact:true}).click();
 await control.content.getByText('Без полномочий',{exact:true}).first().waitFor();await control.ready();
 assert.equal(x.store.familiarizationList(x.users.observer.id,1,{kind:'mine',revision_id:id}).total,1);
 await control.ctx.close();
 console.log('LC834_BROWSER_EXPLICIT_ROSTER_SUPPLEMENT_OK');
 console.log('LC834_BROWSER_PERSONAL_CONFIRM_AND_CONTROL_OK');
 const prefsProfile=await profile('observer',true);await prefsProfile.p.locator('#lc82-bell').click();
 const inbox=prefsProfile.p.locator('dialog.lc82-notification-dialog');
 await inbox.getByRole('button',{name:'Настройки уведомлений',exact:true}).click();
 await inbox.locator('input[name=window_enabled]').check();
 await inbox.locator('input[name=window_start]').fill('20:00');await inbox.locator('input[name=window_end]').fill('08:00');
 await inbox.locator('input[name=day_1]').check();await inbox.locator('input[name=push_familiarization]').check();
 await inbox.getByRole('button',{name:'Сохранить настройки',exact:true}).click();
 await inbox.getByRole('heading',{name:'Требуется ознакомление с СОП',exact:true}).waitFor();
 const saved=x.store.notificationPreferences(x.users.observer.id,1);
 assert.deepEqual(saved.delivery_window,{days:[1],start:'20:00',end:'08:00'});assert.equal(saved.push_available,false);
 await inbox.getByRole('button',{name:'Устройства Web Push',exact:true}).click();
 await inbox.getByRole('heading',{name:'Устройства Web Push',exact:true}).waitFor();
 await inbox.getByText('Web Push отключён администратором либо отсутствует настройка сервера.',{exact:true}).waitFor();
 assert.equal(await inbox.getByRole('button',{name:'Включить Push на этом устройстве',exact:true}).count(),0);
 await inbox.getByRole('button',{name:'Закрыть',exact:true}).click();await prefsProfile.ctx.close();
 const notice=x.store.notificationFeed(x.users.observer.id,1,{}).items.find(v=>v.kind==='familiarization_required');assert(notice);
 const deep=await profile('observer',true,'/#lc82-notice='+notice.id);
 await deep.button('Подтвердить ознакомление').waitFor();
 await deep.ready();assert(x.store.notificationFeed(x.users.observer.id,1,{}).items.find(v=>v.id===notice.id).read_at);
 assert.equal(x.store.familiarizationList(x.users.observer.id,1,{kind:'mine',revision_id:id}).items[0].state,'pending');
 const sw=await deep.ctx.request.get(url+'/sw.js');assert.equal(sw.status(),200);assert.equal(sw.headers()['service-worker-allowed'],'/');assert.equal(sw.headers()['cache-control'],'no-store');
 assert((await sw.text()).includes('У вас новое действие в портале'));
 await deep.ctx.close();
 const wrong=await profile('engineering',false,'/#lc82-notice='+notice.id);
 await wrong.p.getByText('Уведомление больше недоступно. Проверьте Мой план и колокольчик.',{exact:true}).waitFor();
 assert.equal(await wrong.button('Подтвердить ознакомление').count(),0);await wrong.ctx.close();
 console.log('LC823_BROWSER_DISABLED_DEVICE_AND_EXACT_DEEP_LINK_OK');
 const admin=await profile('admin');await admin.go('admin.notifications');
 await admin.content.getByRole('heading',{name:'Фоновые уведомления',exact:true}).waitFor();
 await admin.content.locator('select[name=familiarization]').selectOption('0');
 await admin.button('Сохранить политику напоминаний').click();await admin.ready();
 assert.equal(x.store.notificationBackgroundStatus(x.admin.id,1).policy.familiarization,0);
 await admin.ctx.close();
 console.log('LC822_BROWSER_PREFERENCES_ADMIN_POLICY_OK');
 assert.deepEqual(errors,[]);
 console.log('LC83_BROWSER_FULL_ROUTE_OK');
}finally{if(browser)await browser.close();await close(proxy);await close(server);await x.cleanup()}
