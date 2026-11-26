import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {uuid,canonical,sha256} from '../src/core/db.js';
import {mobileAuditHtml} from '../src/modules/training/mobile-audit.js';
import {RC1_CRITERIA} from '../src/modules/training/builtin-forms.js';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'LC53-mobile-')),browser=await chromium.launch({headless:true,...(process.env.RUNNER_OS==='Windows'?{channel:'msedge'}:{})});
try{
 const ctx=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:390,height:844}}),page=await ctx.newPage(),errors=[];page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
 const cfg={database_id:uuid(),assignment_id:uuid(),revision_id:uuid(),mentor_id:uuid(),trainee_id:uuid(),auditor_id:uuid(),method_id:uuid(),method_json:JSON.stringify({criteria:RC1_CRITERIA})},criteria=RC1_CRITERIA.map(q=>({id:cfg.method_id+':'+q.code,position:q.code,question:q.question,section_code:q.section})),file=path.join(tmp,'mobile.html');
 await fs.writeFile(file,mobileAuditHtml({...cfg,criteria,label:'QA'}));await page.goto(pathToFileURL(file).href);
 const fill=async()=>{for(const item of await page.locator('#questions fieldset select').all()){if(await item.locator('option[value="1"]').count())await item.selectOption('1')}};
 await fill();assert.match(await page.locator('#feedback').inputValue(),/отклонений не выявлено/);
 await page.locator('#save').click();await page.getByText(/В очереди: 1$/).waitFor();
 const key='lean-l1-mobile:'+cfg.database_id+':'+cfg.assignment_id+':'+cfg.method_id+':'+cfg.auditor_id,stored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key),first=stored.entries[0].record;
 const records=Array.from({length:100},(_,i)=>i===0?first:{...first,id:uuid(),feedback:'QA '+i});await page.evaluate(({k,records})=>localStorage.setItem(k,JSON.stringify(records)),{k:key,records});await page.reload();await page.getByText(/В очереди: 100$/).waitFor();
 const download=page.waitForEvent('download');await page.locator('#export').click();const packet=path.join(tmp,'packet.json');await (await download).saveAs(packet);assert.equal(JSON.parse(await fs.readFile(packet,'utf8')).audits.length,100);await page.getByText(/Выгружен, не подтверждён: 100/).waitFor();
 const receipt={type:'lean-l1-mobile-receipt-v1',schemaVersion:1,database_id:cfg.database_id,accepted:[{id:first.id,hash:await sha256(canonical(first)),audit_id:uuid()},{id:records[1].id,hash:'0'.repeat(64),audit_id:uuid()}]};const receiptFile=path.join(tmp,'receipt.json');await fs.writeFile(receiptFile,JSON.stringify(receipt));await page.locator('#receipt').setInputFiles(receiptFile);await page.getByText(/Подтверждено новых: 1/).waitFor();await page.getByText(/В очереди: 99$/).waitFor();
 await fill();await page.locator('#feedback').fill('QA новая запись после подтверждения');await page.locator('#save').click();await page.getByText(/В очереди: 100$/).waitFor();
 const historyDownload=page.waitForEvent('download');await page.locator('#historyExport').click();const archived=path.join(tmp,'history.json');await (await historyDownload).saveAs(archived);assert.equal(JSON.parse(await fs.readFile(archived,'utf8')).audits[0].id,first.id);
 await page.reload();await page.getByText(/Принят: 1 · В очереди: 100/).waitFor();assert.deepEqual(errors,[]);await fs.mkdir('artifacts/lc4',{recursive:true});await page.screenshot({path:'artifacts/lc4/lc53-mobile-queue.png',fullPage:true});await ctx.close();console.log('LC5.3 mobile receipt, partial confirmation and re-export PASS')
}finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
