import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,SQL,schema,migrations} from './lc4-fixture.mjs';
import {createDb,one} from '../src/core/db.js';
import {centerAttention,recommendedChecks,ATTENTION_RULES} from '../src/modules/training/center-attention.js';
import {centerAuditIndicators,annualAuditCoverage} from '../src/modules/training/audit-analytics.js';
import {effectOverview} from '../src/modules/effect/domain.js';
import {standardControls} from '../src/modules/training/standard-overview.js';
import {retrainingQueue} from '../src/modules/training/center-overview.js';
import {cloudRequest,parseCloudAdvice,askCenterCloud,CENTER_PROXY,CENTER_MODEL} from '../src/modules/assistant/cloud.js';
const day='2026-01-22';
const action=(f,title,due)=>({response_id:null,title,owner_id:f.mentor,subject_id:null,due_on:due,kind:'corrective',priority:'normal'});
test('LC7 empty working database: missing data is not readiness, no fictitious counts',()=>{
 const db=createDb(SQL,schema,migrations[0]);try{
  const data=centerAttention(db,day);assert.equal(data.people,0);assert.equal(data.docs,0);
  assert.deepEqual(recommendedChecks(data).map(x=>[x.id,x.count]),[['bank_unregistered',1]]);
  assert.equal(recommendedChecks(data,'roi').length,0);assert.equal(new Set(data.items.map(x=>x.id)).size,data.items.length);
 }finally{db.close()}
});
test('LC7 shared attention uses existing source projections and never writes; signals change with real events',async()=>{
 const f=await fixture();try{
  const db=f.w.working;
  const a=await f.addAssignment({due_on:'2026-01-21'});await f.approve(a);
  const first=(await f.save('action_item',action(f,'QA confidential action','2026-01-21'))).entity_id;
  const second=(await f.save('action_item',action(f,'QA check result','2026-02-01'))).entity_id;await f.save('action_item',{command:'implement',result:'QA result'},second);
  await f.save('economic_effect',{command:'create',study_id:null,action_id:first,owner_id:f.mentor,unit_id:f.unit,currency:'RUB',method:'direct',title:'QA confidential plan',plan:{annualGross:123456,investment:200,annualCost:100},plan_basis:'QA secret basis',review_due:'2026-01-21'});
  const pending=f.w.pending.length,before=db.export(),data=centerAttention(db,day),get=id=>data.items.find(x=>x.id===id)?.count;
  assert.equal(data.people,4);assert.equal(data.docs,1);assert.equal(get('training_overdue'),1);assert.equal(get('action_overdue'),1);assert.equal(get('action_verify'),1);assert.equal(get('roi_overdue'),1);
  assert.equal(get('annual_l1'),annualAuditCoverage(db,day.slice(0,4),day).filter(x=>x.remaining).length);
  const ai=centerAuditIndicators(db,day),economic=effectOverview(db,{day,from:day.slice(0,7)+'-01',to:day}),prep=standardControls(db,day);
  assert.equal(get('action_overdue'),ai.overdue);assert.equal(get('roi_pending'),economic.pending);assert.equal(get('roi_targets'),economic.targetAttention.length);assert.equal(get('prep_review'),prep.stats.review);assert.equal(get('retraining_need'),retrainingQueue(db,day).filter(x=>x.status==='needs').length);
  assert.deepEqual(recommendedChecks(data,'actions').map(x=>[x.id,x.count]),[['action_overdue',1],['action_verify',1]]);
  assert.equal(recommendedChecks(data)[0].priority,'urgent');assert.deepEqual(data.items.find(x=>x.id==='action_overdue').options,{filter:'overdue'});
  assert.equal(f.w.pending.length,pending);assert.deepEqual(db.export(),before);
  // Only static, allowlisted topics are sent, not snapshot rows, identifiers or values.
  const payload=JSON.stringify(cloudRequest(recommendedChecks(data,'actions').map(x=>x.id)));
  for(const secret of [f.mentor,f.unit,first,'QA confidential','123456','2026-01-22','Инструктор Тестовый','LC4-002'])assert(!payload.includes(secret),secret);
  f.advanceTo(day);await f.save('action_item',{command:'implement',result:'QA actual'},first);
  // Completed implementation awaiting verification may still be overdue according
  // to the existing CAPA rule: do not reinterpret it in the assistant.
  const after=centerAttention(db,day);
  assert.equal(after.items.find(x=>x.id==='action_verify').count,2);
  assert.equal(after.items.find(x=>x.id==='action_overdue').count,centerAuditIndicators(db,day).overdue);
 }finally{f.w.close()}
});
test('LC7 exact outbound contract: arbitrary inputs, unknown IDs and invalid model outputs rejected',()=>{
 const ids=['action_overdue','prep_review'];const body=cloudRequest(ids);assert.equal(body.model,CENTER_MODEL);assert.equal(body.task,'chat');
 assert.deepEqual(JSON.parse(body.messages[1].content).map(x=>x.id),ids);
 assert.throws(()=>cloudRequest(['not-a-rule']),/Недопустимый/);assert.throws(()=>cloudRequest(['__proto__']),/Недопустимый/);assert.throws(()=>cloudRequest(['action_overdue','action_overdue']),/Недопустимый/);assert.throws(()=>cloudRequest(Object.keys(ATTENTION_RULES)),/Недопустимый/);assert.throws(()=>cloudRequest([{id:ids[0],text:'secret'}]),/Недопустимый/);
 const valid={recommendations:[{id:ids[0],text:'Проверить документ.'}]};assert.deepEqual(parseCloudAdvice(JSON.stringify(valid),ids),valid.recommendations);
 for(const malformed of ['bad','{}',JSON.stringify({recommendations:[]}),JSON.stringify({recommendations:[{id:'roi_overdue',text:'x'}]}),JSON.stringify({recommendations:[{id:ids[0],text:'x'.repeat(601)}]}),JSON.stringify({recommendations:[{id:ids[0],text:'x',command:'write'}]}),JSON.stringify({recommendations:[...valid.recommendations,...valid.recommendations]})])assert.throws(()=>parseCloudAdvice(malformed,ids));
});
test('LC7 transport: fixed endpoint, no credentials, no redirects, bounded response, error and cancellation',async()=>{
 const ids=['action_overdue'],answer={recommendations:[{id:ids[0],text:'Уточнить причины задержки.'}]},outer={choices:[{message:{content:JSON.stringify(answer)}}]};
 const opts=[];const mock=async(url,o)=>{opts.push({url,o});return new Response(JSON.stringify(outer))};
 assert.deepEqual(await askCenterCloud(ids,{fetcher:mock}),answer.recommendations);
 assert.equal(opts[0].url,CENTER_PROXY);assert.equal(opts[0].o.credentials,'omit');assert.equal(opts[0].o.redirect,'error');assert.equal(opts[0].o.referrerPolicy,'no-referrer');assert.deepEqual(JSON.parse(opts[0].o.body),cloudRequest(ids));
 assert.deepEqual(await askCenterCloud(ids,{fetcher:async()=>new Response(JSON.stringify({result:{alternatives:[{message:{text:JSON.stringify(answer)}}]}}))}),answer.recommendations);
 await assert.rejects(askCenterCloud(ids,{fetcher:async()=>new Response('secret error',{status:403})}),/HTTP 403/);
 await assert.rejects(askCenterCloud(ids,{fetcher:async()=>new Response('x'.repeat(33000))}),/лимит/);
 await assert.rejects(askCenterCloud(ids,{fetcher:async()=>{throw new TypeError('network')}}),/сеть, CORS/);
 const c=new AbortController();c.abort();await assert.rejects(askCenterCloud(ids,{signal:c.signal,fetcher:async()=>{throw Error('Must not request')}}),/отменён/);
});
