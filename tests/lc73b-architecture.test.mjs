import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSources,sqlReferences} from '../tools/lc73b/analyze.mjs';
import {renderAtlas} from '../tools/lc73b/atlas-render.mjs';
import {fixture,date} from './lc4-fixture.mjs';
import {centerProjection} from '../src/modules/training/center-overview.js';
import {centerAttention,scopedAttention} from '../src/modules/training/center-attention.js';
import {filterEvidence,splitEvidence,evidenceTotals} from '../src/modules/training/metric-catalog.js';
import {bytesOf} from '../src/core/db.js';

test('LC7.3B AST resolves imports, lexical shadowing, class methods and flags dynamic calls',()=>{
 const sources={
  'src/core/db.js':"export function rows(db,sql){return db.exec(sql)}",
  'src/a.js':"import {rows as query} from './core/db.js'; export function direct(db){query(db,'SELECT * FROM person JOIN org_unit u ON 1');} export function local(){function query(){return 1}return query()} export function dynamic(fn){return fn()} export function event(btn){btn.addEventListener('click',direct);btn.onclick=()=>local();return Math.max(1,2)} export class Work{start(){return this.done()}done(){return 1}}",
  'src/b.js':"import {direct as run, Work} from './a.js';function launch(db){run(db);new Work();} export function write(db){db.run('UPDATE person SET display_name=? WHERE id=?')} export function partial(db,table){db.run('DELETE FROM '+table)}",
  'src/c.js':"export function shadow(query){return query()}",
  'baselines/sop-stage43/src/x.js':"function helper(){return 1}",
  'baselines/sop-stage43/src/y.js':"function run(){return helper()}"
 };
 const tables=[{name:'person',foreignKeys:[{id:0,from:'unit_id',table:'org_unit',to:'id'}]},{name:'org_unit',foreignKeys:[]}],g=analyzeSources(sources,tables,{scriptFiles:Object.keys(sources).filter(x=>x.startsWith('baselines'))});
 assert.equal(g.errors.length,0);const n=(file,name)=>g.nodes.find(x=>x.file===file&&x.name===name),edge=(from,to,kind)=>g.edges.some(x=>x.from===from.id&&x.to===to.id&&x.kind===kind);
 const direct=n('src/a.js','direct'),rows=n('src/core/db.js','rows'),local=n('src/a.js','local'),shadow=n('src/a.js','query');
 assert(edge(direct,rows,'call'));assert(edge(local,shadow,'call'));assert(!edge(local,rows,'call'));
 assert(edge(n('src/b.js','launch'),direct,'call'));assert(edge(n('src/b.js','launch'),n('src/a.js','Work'),'construct'));assert(edge(n('src/a.js','start'),n('src/a.js','done'),'call'));assert(edge(n('src/a.js','event'),direct,'callback-registration'));assert(g.edges.some(x=>x.from===n('src/a.js','event').id&&x.to==='runtime:Math.max'&&x.kind==='call'));assert(g.edges.some(x=>x.from===n('src/a.js','event').id&&x.registration==='onclick'));
 assert(g.unresolved.some(x=>x.owner===n('src/a.js','dynamic').id&&x.name==='fn'));assert(g.unresolved.some(x=>x.owner===n('src/c.js','shadow').id&&x.name==='query'));
 assert(g.unresolved.some(x=>x.file.endsWith('/y.js')&&x.name==='helper'));
 assert(g.edges.some(x=>x.from===direct.id&&x.to==='table:person'&&x.kind==='sql-read'&&x.certainty==='core-query-literal')===true,'aliases resolve to the actual imported core query');
 assert(g.edges.some(x=>x.to==='table:person'&&x.kind==='sql-write'&&x.certainty==='receiver-unproven'));assert(g.sqlSites.some(x=>x.certainty==='dynamic-sql'));
 assert(g.edges.some(x=>x.from==='table:person'&&x.to==='table:org_unit'&&x.kind==='foreign-key'));
 assert(g.edges.every(x=>g.nodes.some(n=>n.id===x.from)&&g.nodes.some(n=>n.id===x.to)));
 assert.deepEqual(sqlReferences("SELECT * FROM person JOIN org_unit u ON u.id=person.unit_id WHERE name='FROM other'",new Map(tables.map(x=>[x.name,x.name]))),[{mode:'sql-read',table:'person'},{mode:'sql-read',table:'org_unit'}]);
});
test('LC7.3B drilldown never expands from a selected unit to unrelated or unassigned actions',async()=>{
 const f=await fixture();try{
 const noUnit=f.w.edit('person',null,{employee_code:'QA-ARCH-UNASSIGNED',display_name:'QA без подразделения'});
 const unit2=f.w.edit('org_unit',null,{code:'QA-ARCH-2',name:'QA участок 2',kind:'Участок',parent_id:null});
 const owner2=f.w.edit('person',null,{employee_code:'QA-ARCH-2',display_name:'QA участок 2'});
 f.w.edit('person_assignment',null,{person_id:owner2,unit_id:unit2,profession_id:f.profession,position_id:null,shift_id:f.shift,shift_code:null,valid_from:'2020-01-01',valid_to:null});
 const add=async(owner_id,title)=>(await f.save('action_item',{response_id:null,title,owner_id,subject_id:null,due_on:'2026-01-21',kind:'corrective',priority:'normal'})).entity_id;
 const a=await add(f.mentor,'QA участок 1'),b=await add(owner2,'QA участок 2'),c=await add(noUnit,'QA без участка');
 const db=f.w.working,day='2026-01-22',before=bytesOf(db),scope={day,from:'2026-01-01',to:day};
 const metric=(s,id='actions_overdue')=>centerProjection(db,{...scope,...s},{withEvidence:true}).metrics.find(x=>x.id===id);
 const m=metric({});assert.equal(m.value,3);assert.deepEqual(new Set(splitEvidence(m,'unitId').map(g=>g.key)),new Set([f.unit,unit2,'']));
 assert.deepEqual(filterEvidence(m,{dimension:'unitId',value:f.unit}).map(x=>x.key),[a]);assert.deepEqual(filterEvidence(m,{dimension:'unitId',value:unit2}).map(x=>x.key),[b]);assert.deepEqual(filterEvidence(m,{dimension:'unitId',value:''}).map(x=>x.key),[c]);
 const narrow=metric({personId:noUnit});assert.equal(narrow.value,1);assert(narrow.dimensions.includes('unitId'));assert.equal(evidenceTotals(narrow,filterEvidence(narrow,{dimension:'unitId',value:f.unit})).value,0);assert.deepEqual(filterEvidence(narrow,{dimension:'unitId',value:''}).map(x=>x.key),[c]);
 const global=centerAttention(db,day),all=scopedAttention(db,day,'',global);assert.equal(all.items.find(x=>x.id==='action_overdue').count,3);const wrongProjection=centerProjection(db,{...scope,personId:noUnit},{withEvidence:true});assert.equal(scopedAttention(db,day,'',global,wrongProjection).items.find(x=>x.id==='action_overdue').count,3);assert.equal(scopedAttention(db,day,f.unit,global,wrongProjection).items.find(x=>x.id==='action_overdue').count,1);
 for(const [unitId,id] of [[f.unit,a],[unit2,b]]){const signal=scopedAttention(db,day,unitId,global).items.find(x=>x.id==='action_overdue');assert.equal(signal.count,1);assert.equal(signal.records[0].key,id)}
 assert.deepEqual(bytesOf(db),before);
 }finally{f.w.close()}
});

test('LC7.3B atlas template cannot replace markers inside its own JSON source excerpts',()=>{
 const data={excerpt:'/*__LC_ATLAS_CLIENT__*/',other:'/*__LC_ATLAS_DATA__*/',tag:'</script><script>bad()</script>'};
 const html=renderAtlas('<script type="application/json">/*__LC_ATLAS_DATA__*/</script><script>/*__LC_ATLAS_CLIENT__*/</script>',data,'console.log("ready")');
 const m=html.match(/<script type="application\/json">([\s\S]*?)<\/script><script>([\s\S]*?)<\/script>/);
 assert(m);assert.deepEqual(JSON.parse(m[1]),data);assert.equal(m[2],'console.log("ready")');
 assert.throws(()=>renderAtlas('/*__LC_ATLAS_DATA__*/',{},''),/Missing/);
});
