import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {bytesOf} from '../src/core/db.js';
import {centerProjection,centerMetrics} from '../src/modules/training/center-overview.js';
import {ATTENTION_RULES,centerAttention,scopedAttention} from '../src/modules/training/center-attention.js';
import {METRIC_DEFINITIONS,evidenceTotals,splitEvidence,filterEvidence} from '../src/modules/training/metric-catalog.js';
const metricSignals={sop_overdue:'sop_review',training_overdue:'training_overdue',action_overdue:'actions_overdue',roi_pending:'effect_pending',roi_overdue:'effect_overdue',roi_drafts:'effect_drafts',roi_targets:'effect_targets',roi_deviations:'effect_deviations',prep_overdue:'prep_overdue',prep_review:'prep_review'};
const ids=x=>x.map(r=>r.key).sort();
const numbers=p=>p.metrics.map(m=>[m.id,m.value,m.denominator]);
export function assertAnalyticsContracts(db,day,unitId='',personId=''){
 const bytes=bytesOf(db),scope={day,from:day.slice(0,7)+'-01',to:day,unitId:'',personId:''},global=centerAttention(db,day);
 assert.equal(Object.keys(ATTENTION_RULES).length,24,'24 rules, one of two alternative question bank rules active');
 assert.equal(global.items.length,23,'23 active signals');assert.equal(new Set(global.items.map(x=>x.id)).size,23);
 const p=centerProjection(db,scope,{withEvidence:true}),current=centerProjection(db,{...scope,from:'2000-01-01',to:'2000-01-31'},{withEvidence:true});
 const byId=new Map(p.metrics.map(x=>[x.id,x]));
 function verifyProjection(proj,s){
  assert.deepEqual(proj.metrics.map(m=>m.id),METRIC_DEFINITIONS.map(m=>m.id));
  assert.deepEqual(numbers(proj),centerMetrics(db,s).map(m=>[m.id,m.value,m.denominator]));
  for(const m of proj.metrics){
   assert.deepEqual(evidenceTotals(m),{value:m.value,denominator:m.denominator},m.id);
   for(const d of m.dimensions){const gs=splitEvidence(m,d);assert.equal(gs.reduce((n,g)=>n+g.value,0),m.value,m.id+' '+d);assert.equal(gs.reduce((n,g)=>n+g.records.length,0),m.evidence.length,m.id+' '+d);if(m.denominator!==null)assert.equal(gs.reduce((n,g)=>n+g.denominator,0),m.denominator,m.id+' denominator '+d);for(const g of gs){assert.deepEqual(ids(filterEvidence(m,{dimension:d,value:g.key})),ids(g.records),m.id+' '+d);assert.deepEqual(evidenceTotals(m,filterEvidence(m,{dimension:d,value:g.key})),{value:g.value,denominator:g.denominator},m.id+' group totals '+d)}}
  }
 }
 verifyProjection(p,scope);
 for(const m of current.metrics.filter(x=>x.basis==='current')){const x=byId.get(m.id);assert.deepEqual([m.value,m.denominator,ids(m.evidence)],[x.value,x.denominator,ids(x.evidence)],'Current metric depends on historical period: '+m.id)}
 function verifySignals(proj,signals,enterprise){
  const mm=new Map(proj.metrics.map(m=>[m.id,m])),items=new Map(signals.items.map(x=>[x.id,x]));
  assert.equal(items.size,23);
  for(const x of items.values()){
   if(x.id.startsWith('bank_')){assert.equal(x.scope,'global');if(x.id==='bank_stale')assert.equal(x.records.length,x.count);else assert(!x.records,'absence of bank is a control signal, not a stored record');continue}
   assert(!x.evidenceMismatch,x.id+' mismatched global evidence');
   assert.equal(x.scope,enterprise?'enterprise':'unit',x.id);assert.equal(x.count,x.records.length,x.id);
   if(enterprise)assert.equal(x.count,global.items.find(y=>y.id===x.id).count,x.id);
   else assert(x.count<=global.items.find(y=>y.id===x.id).count,x.id);
   assert.equal(new Set(ids(x.records)).size,x.records.length,x.id+' duplicate evidence keys');
   if(metricSignals[x.id])assert.deepEqual(ids(x.records),ids(mm.get(metricSignals[x.id]).evidence),x.id+' source mismatch');
  }
  assert.deepEqual(ids(items.get('action_verify').records),ids(mm.get('actions_open').evidence.filter(x=>x.state==='implemented')));
 }
 verifySignals(p,scopedAttention(db,day,'',global,p),true);
 if(unitId){const s={...scope,unitId},q=centerProjection(db,s,{withEvidence:true});verifyProjection(q,s);verifySignals(q,scopedAttention(db,day,unitId,global,q),false)}
 if(personId){const s={...scope,personId,unitId},q=centerProjection(db,s,{withEvidence:true});verifyProjection(q,s)}
 assert.deepEqual(bytesOf(db),bytes,'Analytical projections changed DB bytes');
 const snapshot={metrics:p.metrics.map(m=>({id:m.id,value:m.value,denominator:m.denominator})),signals:global.items.map(x=>({id:x.id,count:x.count}))};
 const dir=process.env.LC_ANALYTICS_COVERAGE_DIR;if(dir){fs.mkdirSync(dir,{recursive:true});const site=(new Error().stack||'').match(/tests[\\/](?!lc73b-analytics-contract)([\w.-]+\.mjs):(\d+):\d+/);fs.appendFileSync(path.join(dir,'case-'+process.pid+'.ndjson'),JSON.stringify({test:site?site[1]+':'+site[2]:'unknown',...snapshot})+'\n')}
 return snapshot
}
