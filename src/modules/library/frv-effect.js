// Facts from original verified FRV files; no invented loss reasons or approved savings.
import {rows,invariant} from '../../core/db.js';
import {frvSummary} from './frv-summary.js';
import {actionRows,actionStatus} from '../training/audit-domain.js';
export const FRV_CATEGORIES={VA:'ВДЦ',NVA_Necessary:'М2',NVA_Waste:'М1',WAIT:'Ожидание',BREAK:'Перерыв',OTHER:'Не классифицировано'};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function frvRegistry(db){
 return rows(db,`SELECT f.*,o.unit_id,o.name operation_name FROM frv_study f LEFT JOIN operation o ON o.id=f.operation_id ORDER BY f.observed_at DESC,f.id`).map(x=>{const d=JSON.parse(x.context_json),m=d.projection?.measurements||[],seconds=m.filter(o=>finite(o.seconds)&&o.seconds>0).reduce((n,o)=>n+o.seconds,0),loss=m.filter(o=>finite(o.seconds)&&o.seconds>0&&['NVA_Waste','WAIT'].includes(o.category)).reduce((n,o)=>n+o.seconds,0);return {...x,source:d.source,projection:d.projection,seconds,loss}})
}
export function frvLosses(raw){
 const summary=frvSummary(raw),details=[],byLoss=new Map(),byCause=new Map(),groups=new Map();
 for(const [i,c] of raw.cycles.entries()){
  const phase=['baseline','improved'].includes(c.phase)?c.phase:'unassigned';
  for(const o of c.observations){if(!finite(o.durationSec)||o.durationSec<=0||!String(o.actionRaw||'').trim())continue;
   const kind=Object.hasOwn(FRV_CATEGORIES,o.valueType)?o.valueType:'OTHER',k=phase+'|'+kind;
   groups.set(k,(groups.get(k)||0)+o.durationSec);
   if(!['NVA_Waste','WAIT'].includes(kind))continue;
   const loss=String(o.lossCode||'').trim()|| (kind==='WAIT'?'Ожидание (тип не указан)':'Тип не указан'),cause=String(o.causeCode||'').trim()||'Причина не указана';
   details.push({id:o.id,cycle:i+1,phase,action:o.actionRaw,loss,cause,seconds:o.durationSec});
   for(const [map,name] of [[byLoss,loss],[byCause,cause]]){const key=JSON.stringify([phase,name]);map.set(key,(map.get(key)||0)+o.durationSec)}
  }
 }
 const sorted=m=>[...m].map(([key,seconds])=>{const [phase,label]=JSON.parse(key);return {phase,label,seconds}}).sort((a,b)=>a.phase.localeCompare(b.phase)||b.seconds-a.seconds);
 return {summary,details,byLoss:sorted(byLoss),byCause:sorted(byCause),groups:[...groups].map(([k,seconds])=>{const [phase,category]=k.split('|');return {phase,category,seconds}})};
}
export async function verifiedFrvEffect(db,studyId,readContent){
 const study=frvRegistry(db).find(x=>x.id===studyId);invariant(study?.state==='final','Для расчёта нужен завершённый ФРВ');
 const raw=JSON.parse(await readContent(study.source)),s=frvSummary(raw);
 invariant(s.comparable&&s.baselineCount>0&&s.improvedCount>0&&s.delta!==null,'Нет подтверждённого сопоставления полных циклов до/после');
 const actions=actionRows(db).filter(a=>a.study_id===studyId&&actionStatus(db,a)==='verified');
 invariant(actions.length,'Нет связанных мероприятий с подтверждённой эффективностью');
 return {study,summary:s,actions};
}
export function roiScenario(effect,inputs){
 invariant(effect?.summary?.comparable&&finite(effect.summary.delta),'Нет подтверждённых замеров');
 const {cyclesPerYear,hourRate,realization,investment,annualCost}=inputs;
 invariant([cyclesPerYear,hourRate,realization,investment,annualCost].every(finite)&&cyclesPerYear>0&&hourRate>=0&&realization>=0&&realization<=100&&investment>=0&&annualCost>=0,'Заполните объём, ставку, долю реализации 0–100% и затраты');
 const hours=effect.summary.delta*cyclesPerYear/3600,annualBenefit=hours*hourRate*realization/100,annualNet=annualBenefit-annualCost,yearOne=annualNet-investment;
 return {hours,annualBenefit,annualNet,yearOne,roi:investment>0?yearOne/investment*100:null,payback:investment>0&&annualNet>0?12*investment/annualNet:null};
}
