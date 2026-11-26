import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=process.env.LC_ATLAS_OUT||'artifacts/lc73b',data=JSON.parse(await fs.readFile(path.join(dir,'atlas.json'),'utf8'));
assert(data.stats.primaryFiles>50&&data.stats.tables>30&&data.stats.functions>500);assert.equal(data.schemaVersion,17);assert(data.stats.calls>0&&data.stats.sqlEdges>0);assert.equal(data.scenarios.length,8);
const b=await chromium.launch({headless:true});try{
 const c=await b.newContext({offline:true,viewport:{width:1440,height:900}}),p=await c.newPage(),errors=[],network=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',q=>{if(/^https?:/.test(q.url()))network.push(q.url())});
 await p.goto(pathToFileURL(path.resolve(dir,'LeanCenter-LC7.3B-Architecture.html')).href);await p.getByRole('heading',{name:'Компоненты',exact:true}).waitFor();
 const tab=name=>p.locator('#tabs').getByRole('button',{name,exact:true});await tab('Карта кода').click();await p.getByRole('heading',{name:'Локальный граф',exact:true}).waitFor();await p.locator('input[type=search]').fill('centerProjection');await p.locator('.scroll').getByRole('button',{name:/centerProjection · Функция/}).first().click();await p.getByRole('heading',{name:'centerProjection',exact:true}).waitFor();await p.getByRole('heading',{name:'SQL в узле',exact:true}).waitFor();
 await tab('База данных').click();await p.locator('.scroll').getByRole('button',{name:'person',exact:true}).click();await p.getByRole('heading',{name:'Физическая структура',exact:true}).waitFor();await p.getByRole('cell',{name:'display_name',exact:true}).waitFor();
 await tab('Сквозные сценарии').click();assert.equal(await p.locator('main > section').count(),8);await tab('Аудит').click();await p.getByRole('heading',{name:/ARCH-06/}).waitFor();
 await tab('Неразрешённые связи').click();await p.locator('input[type=search]').fill('src/app.js');await p.locator('main section .source').first().waitFor();
 await tab('Покрытие').click();await p.locator('input[type=search]').fill('db/schema_v1.sql');await p.getByRole('link',{name:/db\/schema_v1.sql/}).first().waitFor();await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await p.screenshot({path:path.join(dir,'atlas-mobile.png'),fullPage:true});await p.setViewportSize({width:1440,height:900});await tab('Карта кода').click();await p.screenshot({path:path.join(dir,'atlas-desktop.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await c.close();console.log('LC7.3B architecture atlas offline navigation PASS');
}finally{await b.close()}
