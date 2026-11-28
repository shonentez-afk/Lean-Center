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
 async function profile(name,mobile=false){
  const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:mobile?{width:390,height:844}:{width:1440,height:900}}),p=await ctx.newPage();
  p.on('pageerror',e=>errors.push(String(e)));p.on('dialog',d=>d.dismiss());await p.goto(url);
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
 await a.button('Отправить на согласование').click();
 await a.content.getByText('На согласовании',{exact:true}).first().waitFor();await a.ready();
 assert.equal(x.detail('author',id).round.state,'review');await a.ctx.close();
 const outsider=await profile('observer');await outsider.go('sop.approvals');
 assert.equal(await outsider.button('Открыть согласование').count(),0);await outsider.ctx.close();
 for(const name of ['safety','engineering','twi','director']){
  const q=await profile(name,name==='safety');await q.go('sop.approvals');await q.button('Открыть согласование').click();
  await q.button('Просмотреть зафиксированный СОП').click();await q.content.getByText('Браузерная редакция LC83',{exact:true}).first().waitFor();
  await q.content.getByRole('heading',{name:'Сравнение с предыдущей действующей редакцией',exact:true}).waitFor();
  await q.button('Показать прежнее фото шага 1').click();
  await q.p.waitForFunction(()=>[...document.querySelectorAll('img[alt="Прежнее фото шага 1"]')].some(i=>i.complete&&i.naturalWidth>0));
  await q.button('Показать фото').first().click();await q.content.locator('img.lc81-image').first().waitFor();
  await q.p.waitForFunction(()=>[...document.querySelectorAll('img.lc81-image')].some(i=>i.complete&&i.naturalWidth>0));
  await q.button(name==='director'?'Утвердить СОП':'Согласовать СОП').click();await q.ready();
  if(name==='director'){
   assert.equal(x.detail('author',id).round.state,'approved');assert(x.effective().includes(x.old));
   assert.equal(await q.button('Ввести в действие').count(),0);
   const m=await profile('manager');await m.go('sop.approvals');await m.button('Открыть согласование').click();
   await m.content.locator('select[name=impact_decision]').selectOption('retrain');
   await m.content.locator('form').filter({has:m.button('Зарегистрировать оценку влияния')}).locator('textarea[name=note]').fill('Учебное обоснование');
   await m.button('Зарегистрировать оценку влияния').click();await m.ready();await m.ctx.close();
   await q.p.bringToFront();await q.go('sop.approvals');await q.button('Открыть согласование').click();
   await q.button('Ввести в действие').click();await q.ready();
  }
  await q.ctx.close();
 }
 assert.equal(x.detail('author',id).round.state,'effective');assert(x.effective().includes(id));assert(!x.effective().includes(x.old));assert.deepEqual(errors,[]);
 console.log('LC83_BROWSER_FULL_ROUTE_OK');
}finally{if(browser)await browser.close();await close(proxy);await close(server);await x.cleanup()}
