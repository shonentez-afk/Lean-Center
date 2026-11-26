import fs from 'node:fs';
import path from 'node:path';
import {METRIC_DEFINITIONS} from '../../src/modules/training/metric-catalog.js';
import {ATTENTION_RULES} from '../../src/modules/training/center-attention.js';
const dir=process.env.LC_ANALYTICS_COVERAGE_DIR||'artifacts/lc73b-coverage';
const cases=fs.readdirSync(dir).filter(f=>/^case-\d+\.ndjson$/.test(f)).flatMap(f=>fs.readFileSync(path.join(dir,f),'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s)));
if(!cases.length)throw Error('No successful analytical contract snapshots');
const summarize=(kind,ids)=>ids.map(id=>{
 const items=cases.flatMap(c=>(kind==='metric'?c.metrics:c.signals).filter(x=>x.id===id).map(x=>({...x,test:c.test}))),value=x=>kind==='metric'?x.value:x.count;
 return {kind,id,checked:items.length,positive:items.filter(x=>value(x)>0).length,zero:items.filter(x=>value(x)===0).length,ratio:kind==='metric'&&items.some(x=>x.denominator!==null),nonzeroDenominator:kind==='metric'?items.filter(x=>x.denominator>0).length:null,positiveSources:[...new Set(items.filter(x=>value(x)>0).map(x=>x.test))].sort()}
});
const records=[...summarize('metric',METRIC_DEFINITIONS.map(x=>x.id)),...summarize('signal',Object.keys(ATTENTION_RULES))],summary={snapshots:cases.length,metricPositive:records.filter(x=>x.kind==='metric'&&x.positive).length,metricTotal:METRIC_DEFINITIONS.length,signalPositive:records.filter(x=>x.kind==='signal'&&x.positive).length,signalTotal:Object.keys(ATTENTION_RULES).length,missingPositive:records.filter(x=>!x.positive).map(x=>x.kind+':'+x.id),missingZero:records.filter(x=>!x.zero&&!(x.kind==='signal'&&x.id==='bank_unregistered')).map(x=>x.kind+':'+x.id),missingDenominator:records.filter(x=>x.ratio&&!x.nonzeroDenominator).map(x=>x.id)};
fs.writeFileSync(path.join(dir,'coverage.json'),JSON.stringify({summary,records},null,2)+'\n');
const csv=x=>x.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\r\n');
fs.writeFileSync(path.join(dir,'coverage.csv'),'\ufeff'+csv([['Тип','ID','Проверено срезов','Ненулевой результат','Ноль','Ненулевой знаменатель','Тесты ненулевого результата'],...records.map(x=>[x.kind,x.id,x.checked,x.positive,x.zero,x.nonzeroDenominator,x.positiveSources.join(' | ')])]));
console.log('LC7.3B analytics coverage '+JSON.stringify(summary));

// bank_unregistered is emitted only when no bank exists; bank_stale is the alternative branch.
if(process.env.CI==='true'&&(summary.missingPositive.length||summary.missingZero.length||summary.missingDenominator.length)){console.error('LC7.3B incomplete analytical state coverage; see coverage.json');process.exitCode=1}
