import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,SQL,schema,migrations} from './lc4-fixture.mjs';
import {createDb,one,uuid} from '../src/core/db.js';
import {centerProjection,centerMetrics} from '../src/modules/training/center-overview.js';
import {METRIC_DEFINITIONS,METRIC_CONTRACTS,METRIC_RELATIONS,evidenceTotals,splitEvidence,filterEvidence,metricScopeValid,metricValue} from '../src/modules/training/metric-catalog.js';
const day='2026-01-22',scope={day,from:'2026-01-01',to:day,unitId:'',personId:''};
function verify(db,s){const before=db.export(),p=centerProjection(db,s,{withEvidence:true});assert.equal(p.metrics.length,30);assert.equal(new Set(p.metrics.map(m=>m.id)).size,30);assert.deepEqual(p.metrics.map(m=>m.id),METRIC_DEFINITIONS.map(m=>m.id));for(const m of p.metrics){assert(METRIC_CONTRACTS[m.id]);assert(m.unit&&m.rules&&m.source&&m.aggregation);assert.equal(m.target,null);assert.deepEqual(evidenceTotals(m),{value:m.value,denominator:m.denominator});for(const d of m.dimensions){const g=splitEvidence(m,d);assert.equal(g.reduce((n,x)=>n+x.value,0),m.value);assert.equal(g.reduce((n,x)=>n+x.records.length,0),m.evidence.length);if(m.denominator!==null)assert.equal(g.reduce((n,x)=>n+x.denominator,0),m.denominator)}}assert.deepEqual(centerMetrics(db,s).map(m=>[m.id,m.value,m.denominator]),p.metrics.map(m=>[m.id,m.value,m.denominator]));assert.deepEqual(db.export(),before);return p}
test('LC7.3A: all 30 metric definitions agree with exact rows on empty v17',()=>{const db=createDb(SQL,schema,migrations[0]);try{const p=verify(db,scope);assert.equal(metricValue(p.metrics.find(m=>m.id==='skill_coverage')),'— (нет знаменателя)');assert.equal(p.currencies.length,0);assert.equal(metricScopeValid({...scope,to:'2026-02-31'}),false)}finally{db.close()}});
test('LC7.3A: evidence and figures in scoped fixture, no writes',async()=>{const f=await fixture();try{const a=await f.addAssignment({due_on:'2026-01-21'});await f.approve(a);const p=verify(f.w.working,scope);assert(p.metrics.find(m=>m.id==='training_overdue').value>=1);verify(f.w.working,{...scope,unitId:f.unit,personId:f.trainee});verify(f.w.working,{...scope,from:'2025-01-01',to:'2025-01-31'})}finally{f.w.working.close();f.w.base.close()}});

import {centerAttention,scopedAttention} from '../src/modules/training/center-attention.js';
test('LC7.3A: scope of attention uses exact source rows; enterprise-only bank remains separate',async()=>{const f=await fixture();try{const a=await f.addAssignment({due_on:'2026-01-21'});await f.approve(a);const db=f.w.working,g=centerAttention(db,day),s=scopedAttention(db,day,f.unit,g);assert.equal(s.items.find(x=>x.id==='training_overdue').count,1);assert.equal(s.items.find(x=>x.id==='training_overdue').records[0].options.id,a);for(const x of s.items){if(x.scope==='unit')assert.equal(x.count,x.records.length);else assert(x.id.startsWith('bank_'))}const p=verify(db,{...scope,unitId:f.unit});const m=p.metrics.find(x=>x.id==='training_assigned');assert.equal(filterEvidence(m,{dimension:'unitId',value:f.unit}).length,m.value);assert.equal(p.cohortMonths.reduce((n,x)=>n+x.assignments,0),m.value)}finally{f.w.close()}});

test('LC7.3A: 5000 employees, exact evidence with unknown requirements, no writes',async()=>{const f=await fixture();try{
 const db=f.w.working;await f.save('role_requirement',{profession_id:f.profession,skill_id:f.skill,scale_id:f.scale,required_level:3,criticality:'important',valid_from:'2026-01-01',valid_to:null});
 db.run('BEGIN');const p=db.prepare('INSERT INTO person(id,employee_code,display_name) VALUES(?,?,?)'),a=db.prepare('INSERT INTO person_assignment(id,person_id,unit_id,profession_id,valid_from,shift_id) VALUES(?,?,?,?,?,?)');
 try{for(let i=0;i<5000;i++){const id='qa-lc73-person-'+i;p.run([id,'QA73-'+i,'QA '+i]);a.run(['qa-lc73-assignment-'+i,id,f.unit,f.profession,'2020-01-01',f.shift])}}finally{p.free();a.free();db.run('COMMIT')}
 const x=verify(db,{...scope,unitId:f.unit}),m=x.metrics.find(v=>v.id==='skill_coverage');assert(m.denominator>=5000);assert.equal(m.value,0);assert.equal(splitEvidence(m,'personId').length,m.denominator);assert(m.evidence.every(v=>v.reason==='Нет оценки'));assert.equal(new Set(METRIC_RELATIONS.flatMap(([a,b])=>[a,b])).size>20,true);
 }finally{f.w.close()}});

import {recordedBusinessDate,economicEventPayload} from '../src/core/business-clock.js';
import {dashboardPeriod} from '../src/modules/training/dashboard-period.js';
import {actionCompletionDate} from '../src/modules/training/audit-domain.js';
import {actionEvidenceExtra,actionEvidenceHeaders,evidenceDateTitle} from '../src/modules/training/metric-catalog.js';
import {analyzeContext,contextSelection} from '../src/modules/assistant/context.js';
test('QA-01/02/03: historical action completion month and unit, current overdue unit and date, export/assistant',async()=>{
 const f=await fixture();const db=f.w.working;try{
  const add=async title=>(await f.save('action_item',{response_id:null,title,owner_id:f.mentor,subject_id:null,due_on:'2026-10-02',kind:'corrective',priority:'normal'})).entity_id;
  const at=async(id,occurred_at,payload)=>{const e={id:uuid(),entity_type:'action_item',entity_id:id,operation:'update',expected_revision:one(db,'SELECT rev FROM action_item WHERE id=?',[id]).rev,payload,occurred_at};await f.w.applyContentEvents([e],f.readContent);return e};
  const sep=await add('QA до полуночи'),oct=await add('QA после полуночи'),late=await add('QA просрочка после выполнения'),legacy=await add('QA старый UTC факт');
  for(const [id,stamp,offset] of [[sep,'2026-09-30T16:59:00Z',420],[oct,'2026-09-30T17:30:00Z',420],[late,'2026-10-12T04:00:00Z',420],[legacy,'2026-09-30T17:40:00Z',null]]){
   await at(id,stamp,{command:'implement',result:'QA',...(offset===null?{}:{business_offset_minutes:offset})});
  }
  for(const id of [sep,oct,legacy])await at(id,'2026-10-13T04:00:00Z',{command:'verify',verifier_id:f.actor,audit_id:null,outcome:'effective',evidence:'QA независимая проверка'});
  const previousTZ=process.env.TZ;
  const select=(day,from,to,unitId,id)=>verify(db,{day,from,to,unitId,personId:''}).metrics.find(x=>x.id===id);
  const getOct=(day,unit=f.unit)=>select(day,'2026-10-01','2026-10-31',unit,'actions_verified');
  try{for(const tz of ['UTC','Asia/Novokuznetsk','America/New_York']){
    process.env.TZ=tz;const x=getOct('2026-10-31');assert.equal(x.value,1);assert.equal(x.denominator,2);assert.deepEqual(new Set(x.evidence.map(r=>r.key)),new Set([oct,late]));assert.equal(x.evidence.find(r=>r.key===oct).date,'2026-10-01');
    const september=select('2026-10-31','2026-09-01','2026-09-30',f.unit,'actions_verified');assert.deepEqual(new Set(september.evidence.map(r=>r.key)),new Set([sep,legacy]));assert.match(september.evidence.find(r=>r.key===legacy).timeBasis,/старая запись/);
  }}finally{if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ}
  const old=one(db,'SELECT * FROM person_assignment WHERE person_id=?',[f.mentor]),u=f.w.edit('org_unit',null,{code:'QA-NEW',name:'Новый участок',kind:'Участок',parent_id:null});
  const assign={person_id:old.person_id,unit_id:old.unit_id,profession_id:old.profession_id,position_id:old.position_id,shift_id:old.shift_id,shift_code:old.shift_code,valid_from:old.valid_from,valid_to:'2026-10-31'};
  f.w.edit('person_assignment',old.id,assign);f.w.edit('person_assignment',null,{...assign,unit_id:u,valid_from:'2026-11-01',valid_to:null});
  const history=getOct('2026-11-01');assert.equal(history.value,1);assert.equal(history.denominator,2);assert(history.evidence.every(r=>r.unitId===f.unit));assert.equal(getOct('2026-11-01',u).denominator,0);
  const overdue=select('2026-11-01','2026-10-01','2026-10-31',u,'actions_overdue'),r=overdue.evidence.find(x=>x.key===late);assert(r);assert.equal(r.date,'2026-10-02');assert.equal(r.dueOn,'2026-10-02');assert.equal(r.implementedOn,'2026-10-12');assert.equal(r.unitId,u);assert.equal(evidenceDateTitle(overdue),'Срок');assert.equal(actionEvidenceHeaders(overdue)[0],'Дата выполнения');assert.equal(actionEvidenceExtra(overdue,r)[0],'2026-10-12');assert.equal(evidenceDateTitle(history),'Дата выполнения');
  const assistant=analyzeContext(db,'2026-11-01',contextSelection('metrics',{route:{from:'2026-10-01',to:'2026-10-31',unitId:f.unit}}));assert.equal(assistant.metrics.find(x=>x.label==='Подтверждён эффект').value,'1 / 2');
  assert.equal(actionCompletionDate(db,one(db,'SELECT * FROM action_item WHERE id=?',[oct])).date,'2026-10-01');
  const wrong=await add('QA invalid offset');await assert.rejects(at(wrong,'2026-10-12T04:00:00Z',{command:'implement',result:'QA',business_offset_minutes:841}),/время предприятия/);assert.equal(one(db,'SELECT implemented_at FROM action_item WHERE id=?',[wrong]).implemented_at,null);
  assert.equal(recordedBusinessDate('2026-09-30T17:30:00Z',420).date,'2026-10-01');assert.equal(recordedBusinessDate('2026-09-30T17:30:00Z').date,'2026-09-30');
 }finally{f.w.close()}
});
test('QA-06 automatic month/quarter/year and fixed manual period',()=>{
 assert.deepEqual(dashboardPeriod('2026-11-01',{periodMode:'month',from:'2026-10-01',to:'2026-10-25'}),{periodMode:'month',from:'2026-11-01',to:'2026-11-01'});
 assert.deepEqual(dashboardPeriod('2026-11-01',{periodMode:'quarter'}),{periodMode:'quarter',from:'2026-10-01',to:'2026-11-01'});
 assert.deepEqual(dashboardPeriod('2027-01-01',{periodMode:'year'}),{periodMode:'year',from:'2027-01-01',to:'2027-01-01'});
 assert.deepEqual(dashboardPeriod('2026-11-01',{periodMode:'manual',from:'2026-10-01',to:'2026-10-25'}),{periodMode:'manual',from:'2026-10-01',to:'2026-10-25'});
 const instant=new Date('2026-09-30T17:30:00Z'),p=economicEventPayload('action_item',{command:'implement',result:'QA'},instant);assert.equal(p.business_offset_minutes,-instant.getTimezoneOffset());assert.deepEqual(economicEventPayload('action_item',{command:'start'},instant),{command:'start'});
});
