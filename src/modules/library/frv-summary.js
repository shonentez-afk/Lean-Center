import {invariant,sha256,uuid} from '../../core/primitives.js';
import {inspectSource} from './source-validation.js';
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
const median=a=>{const v=a.slice().sort((x,y)=>x-y);return v.length%2?v[v.length>>1]:(v[v.length/2-1]+v[v.length/2])/2};
const clean=(x,max=20000)=>typeof x==='string'?x.trim().slice(0,max):'';
export function frvSummary(raw){
 const totals={VA:0,NVA_Necessary:0,NVA_Waste:0,WAIT:0,BREAK:0,OTHER:0},cycles=[];let missing=0;
 for(const [i,c] of raw.cycles.entries()){
  let seconds=0,complete=c.observations.length>0,measured=0;
  for(const o of c.observations){if(!positive(o.durationSec)||!clean(o.actionRaw)){missing++;complete=false;continue}seconds+=o.durationSec;measured++;totals[Object.hasOwn(totals,o.valueType)?o.valueType:'OTHER']+=o.durationSec}
  cycles.push({index:i+1,phase:['baseline','improved'].includes(c.phase)?c.phase:'unassigned',seconds:measured?seconds:null,complete})
 }
 const a=cycles.filter(c=>c.complete&&c.phase==='baseline').map(c=>c.seconds),b=cycles.filter(c=>c.complete&&c.phase==='improved').map(c=>c.seconds);
 const before=mean(a),after=mean(b),comparable=raw.comparisonApproved===true&&before!==null&&after!==null;
 return {totals,cycles,missing,baselineCount:a.length,improvedCount:b.length,before,after,comparable,delta:comparable?before-after:null,percent:comparable&&before>0?(before-after)/before*100:null};
}
export async function draftFromFrv(text){
 const raw=JSON.parse(text);await inspectSource(text,'frv');
 const candidate=raw.standard;
 invariant(candidate&&!candidate.outdated&&Array.isArray(candidate.steps)&&candidate.steps.length>0&&candidate.steps.length<=12,'Сначала подготовьте актуальный проект СОП из замеров в редакторе ФРВ (не более 12 шагов)');
 const ids=new Map();for(const [i,c] of raw.cycles.entries())for(const o of c.observations)ids.set(o.id,{o,cycle:c.cycleNo||i+1});
 const used=new Set(),steps=candidate.steps.map((s,i)=>{
  invariant(clean(s.action)&&positive(s.plannedTimeSec)&&Array.isArray(s.sourceObservationIds)&&s.sourceObservationIds.length,'Укажите действие, проектное время и наблюдения шага '+(i+1));
  const found=s.sourceObservationIds.map(id=>{const x=ids.get(id);invariant(x&&positive(x.o.durationSec)&&clean(x.o.actionRaw)&&x.o.standardCandidate===true&&!used.has(id),'Шаг '+(i+1)+': отсутствует выбранный фактический замер или он повторяется');used.add(id);return x});
  const observed=median(found.map(x=>x.o.durationSec)),duration=Math.max(1,Math.round(s.plannedTimeSec)),km=[clean(s.keyMoment),s.safety?'Безопасность: '+clean(s.safety):''].filter(Boolean);
  return {id:i+1,action:clean(s.action),keyMoments:km.length?km:[''],reason:clean(s.reason),durationSeconds:duration,hasPhoto:false,photoAnnotations:[],frv:{vdc:s.valueType==='VA',m2:s.valueType==='NVA_Necessary'?duration:'',m1:s.valueType==='NVA_Waste'?duration:'',move:s.distanceM??'',comment:clean(s.comment),autoFullStep:['NVA_Necessary','NVA_Waste'].includes(s.valueType)},frvSource:{studyId:raw.study.studyId||'',libraryId:raw.study.libraryId||'',observationIds:s.sourceObservationIds.slice(),observationId:s.sourceObservationIds[0],cycleNos:found.map(x=>x.cycle),cycleNo:found[0].cycle,observedTimeSec:observed,projectTimeSec:s.plannedTimeSec}}
 });
 const payload={schemaVersion:2,document:{id:uuid(),status:'Черновик',number:'Черновик',version:1},constructor:{schemaVersion:4,meta:{branch:'',date:'',department:'',workplace:clean(raw.study.workplace),executor:clean(raw.study.operator),operation:clean(raw.study.operationId)||clean(raw.study.processDescription)||'Проект СОП по ФРВ',sopNumber:'',safety:'',tools:'',material:'',approverPost:'',approverName:''},steps,description:clean(raw.study.processDescription),responsibles:[''],agreedList:[{post:'',name:''}],totalTimeSeconds:steps.reduce((s,x)=>s+x.durationSeconds,0),twi:{enabled:false}},photoAssets:{}};
 const result=JSON.stringify({...payload,integrity:{algorithm:'SHA-256',sha256:await sha256(JSON.stringify(payload))}},null,2);
 return {text:result,...await inspectSource(result,'sop')};
}
