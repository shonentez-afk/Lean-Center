import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import initSqlJs from 'sql.js';
import {configureMigrations,createDb,verifyDb,SCHEMA_VERSION,rows,one} from '../../src/core/db.js';
import {analyzeSources} from './analyze.mjs';
import {SCENARIOS,REVIEW} from './contracts.mjs';
const read=p=>fs.readFileSync(p,'utf8');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
const sha=git('rev-parse','HEAD').trim(),base='46b79c6ab23255a6b211afeadacd2be72f2ad803';
const tracked=git('ls-files','-z').split('\0').filter(Boolean);
const baseline='baselines/sop-stage43/',manifest=JSON.parse(read(baseline+'src/app/stage43-parts.json'));
const stageFiles=manifest.modules.map(p=>baseline+p);
const primary=tracked.filter(p=>/^(src\/.*\.js|tests\/.*\.mjs|tools\/.*\.mjs)$/.test(p));
const scriptFiles=stageFiles.filter(p=>tracked.includes(p));
if(scriptFiles.length!==stageFiles.length)throw Error('Stage43 manifest file missing');
const sourcePaths=[...new Set([...primary,...scriptFiles])].sort(),sources=Object.fromEntries(sourcePaths.map(p=>[p,read(p)]));
const ddl=['db/schema_v1.sql',...tracked.filter(p=>/^db\/migrations\/.*\.sql$/.test(p)).sort()];
const migrations=ddl.slice(1).map(read);configureMigrations(...migrations.slice(1));
const SQL=await initSqlJs(),db=createDb(SQL,read(ddl[0]),migrations[0]);verifyDb(db);
const schemaVersion=Number(one(db,'PRAGMA user_version').user_version);if(schemaVersion!==SCHEMA_VERSION)throw Error('schema mismatch');
const esc=s=>'"'+s.replaceAll('"','""')+'"';
const objects=rows(db,"SELECT name,type,sql,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
const schemaRefs=(name)=>ddl.flatMap(file=>read(file).split('\n').flatMap((s,i)=>new RegExp('\\b(?:CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?|ALTER\\s+TABLE\\s+)["\\x60\\[]?'+name+'\\b','i').test(s)?[{file,line:i+1,excerpt:s.trim()}]:[]));
const tables=objects.filter(x=>x.type==='table'||x.type==='view').map(t=>{const refs=schemaRefs(t.name),r=refs[0]||{file:ddl[0],line:1};return {name:t.name,type:t.type,file:r.file,line:r.line,ddl:t.sql,origins:refs,columns:rows(db,'PRAGMA table_info('+esc(t.name)+')'),foreignKeys:rows(db,'PRAGMA foreign_key_list('+esc(t.name)+')'),indexes:rows(db,'PRAGMA index_list('+esc(t.name)+')'),triggers:objects.filter(x=>x.type==='trigger'&&x.tbl_name===t.name).map(x=>({name:x.name,sql:x.sql}))}});
db.close();
const graph=analyzeSources(sources,tables,{scriptFiles});
const srcErrors=graph.errors.filter(x=>!x.file.startsWith(baseline));if(srcErrors.length)throw Error('Source parse errors: '+JSON.stringify(srcErrors));
const inventory=tracked.filter(p=>/^(src\/|db\/|tests\/|tools\/|\.github\/workflows\/)/.test(p)||scriptFiles.includes(p)||['package.json','package-lock.json',baseline+'src/app/stage43-parts.json',baseline+'releases/stage43-sop-print-formats-20261125.html',baseline+'proxy/index.py'].includes(p)).map(p=>({path:p,bytes:fs.statSync(p).size,sha256:hash(p),coverage:sourcePaths.includes(p)?graph.errors.some(e=>e.file===p)?'parse-error':'AST':ddl.includes(p)?'DDL / migrated schema':'inventory only'}));
const knownNodes=new Set(graph.nodes.map(x=>x.id));
function anchor(x){const s=read(x.file),at=s.indexOf(x.anchor);if(at<0)throw Error('Stale review anchor '+x.file+' :: '+x.anchor);const line=s.slice(0,at).split('\n').length;return {...x,line,excerpt:s.slice(at,at+180).replace(/\s+/g,' ')}}
const scenarios=SCENARIOS.map(s=>({...s,steps:s.steps.map(anchor),tests:s.tests.map(p=>{if(!tracked.includes(p))throw Error('Missing test '+p);return p})}));
const review=REVIEW.map(x=>({...x,proof:x.proof.map(anchor)}));
const fileNodes=graph.nodes.filter(x=>x.kind==='file').map(x=>x.id),adj=new Map(fileNodes.map(x=>[x,[]]));
for(const e of graph.edges)if(e.kind==='import'&&adj.has(e.from)&&adj.has(e.to))adj.get(e.from).push(e.to);
function scc(){
 let count=0;const i=new Map(),low=new Map(),stack=[],on=new Set(),groups=[];
 function dfs(x){i.set(x,count);low.set(x,count++);stack.push(x);on.add(x);for(const y of adj.get(x)||[]){if(!i.has(y)){dfs(y);low.set(x,Math.min(low.get(x),low.get(y)))}else if(on.has(y))low.set(x,Math.min(low.get(x),i.get(y)))}
 if(i.get(x)===low.get(x)){const g=[];let y;do{y=stack.pop();on.delete(y);g.push(y)}while(y!==x);if(g.length>1||adj.get(x)?.includes(x))groups.push(g.sort())}}
 for(const x of adj.keys())if(!i.has(x))dfs(x);return groups.sort((a,b)=>b.length-a.length)
}
for(const e of graph.edges)if(!knownNodes.has(e.from)||!knownNodes.has(e.to))throw Error('Dangling edge '+JSON.stringify(e));
const stats={primaryFiles:primary.length,stageFiles:scriptFiles.length,parsed:graph.files.length-graph.errors.length,parseErrors:graph.errors.length,functions:graph.nodes.filter(x=>['function','method'].includes(x.kind)).length,classes:graph.nodes.filter(x=>x.kind==='class').length,tables:tables.length,foreignKeys:graph.edges.filter(x=>x.kind==='foreign-key').length,imports:graph.edges.filter(x=>x.kind==='import').length,calls:graph.edges.filter(x=>['call','construct'].includes(x.kind)).length,unresolved:graph.unresolved.length,sqlSites:graph.sqlSites.length,sqlEdges:graph.edges.filter(x=>x.kind.startsWith('sql-')).length,cycles:scc().length};
const model={format:1,title:'Lean Center · LC7.3B архитектурный атлас',sha,base,schemaVersion,stats,inventory,scenarios,review,cycles:scc(),...graph};
const out=process.env.LC_ATLAS_OUT||'artifacts/lc73b';fs.mkdirSync(out,{recursive:true});
const json=JSON.stringify(model);fs.writeFileSync(path.join(out,'atlas.json'),json);
const template=read('tools/lc73b/atlas.html'),client=read('tools/lc73b/atlas-client.js');
const safeJson=json.replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const html=template.replace('/*__LC_ATLAS_DATA__*/',()=>safeJson).replace('/*__LC_ATLAS_CLIENT__*/',()=>client.replace(/<\/script/gi,'<\\/script'));
fs.writeFileSync(path.join(out,'LeanCenter-LC7.3B-Architecture.html'),html);
const csv=(xs)=>'\ufeff'+xs.map(line=>line.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(';')).join('\r\n');
fs.writeFileSync(path.join(out,'review.csv'),csv([['ID','Серьёзность','Статус','Название','Наблюдение','Проверка','Источники'],...review.map(x=>[x.id,x.severity,x.state,x.title,x.finding,x.verification,x.proof.map(q=>q.file+':'+q.line).join(' | ')])]));
fs.writeFileSync(path.join(out,'unresolved-calls.csv'),csv([['Файл','Строка','Владелец','Выражение','Тип неопределённости','Фрагмент'],...graph.unresolved.map(x=>[x.file,x.line,x.owner,x.name,x.reason,x.excerpt])]));
fs.writeFileSync(path.join(out,'source-inventory.csv'),csv([['Файл','Байт','SHA256','Покрытие'],...inventory.map(x=>[x.path,x.bytes,x.sha256,x.coverage])]));
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({sha,base,schemaVersion,stats,cycles:model.cycles,parseErrors:graph.errors},null,2)+'\n');
console.log(JSON.stringify({sha,schemaVersion,stats,cycles:model.cycles,parseErrors:graph.errors},null,2));
