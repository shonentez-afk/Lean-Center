// Read-only projections of the SAME verified SOP source. Do not create fake
// measured cycles or independently mutable TWI/FRV copies.
const str=x=>typeof x==='string'?x:'';
const part=x=>x===null||x===undefined||String(x).trim()===''?0:Number(x);
export const twiFields=[
 ['prepare','purpose','Цель обучения'],['prepare','known','Опыт обучаемого'],['prepare','prep','Подготовка рабочего места'],['prepare','interest','Мотивация'],
 ['present','round1','Первый показ'],['present','round2','Шаги и ключевые моменты'],['present','round3','Причины'],
 ['tryOut','perform','Пробное выполнение'],['tryOut','explain','Объяснение работником'],['tryOut','check','Проверка выполнения'],['tryOut','correct','Исправление ошибок'],
 ['followUp','help','К кому обращаться'],['followUp','control','Последующий контроль'],['followUp','observe','Что наблюдать'],['followUp','close','Завершение обучения']
];
export function sopTwiSignature(s){
 const meta=s.meta||{},raw=JSON.stringify({operation:meta.operation,executor:meta.executor,workplace:meta.workplace,safety:meta.safety,steps:(s.steps||[]).map((v,i)=>({stepNumber:i+1,action:v.action,keyPoints:Array.isArray(v.keyMoments)?v.keyMoments.filter(Boolean):[],reason:v.reason,successCriteria:v.successCriteria,decisionPoints:v.decisionPoints}))});
 let a=2166136261,b=0;for(let i=0;i<raw.length;i++){const n=raw.charCodeAt(i);a=Math.imul(a^n,16777619)>>>0;b=(b+n)>>>0;b=(b+((b<<10)>>>0))>>>0;b^=b>>>6}
 b=(b+((b<<3)>>>0))>>>0;b^=b>>>11;b=(b+((b<<15)>>>0))>>>0;return 'sop1:'+raw.length+':'+a.toString(16)+':'+(b>>>0).toString(16)
}
export function linkedTwi(s){
 const t=s.twi||{},fields=twiFields.map(([section,key,label])=>({section,key,label,value:str(t[section]?.[key]??(key==='control'?t[section]?.frequency:''))}));
 const exists=fields.some(f=>f.value.trim()),signature=t.sourceSignature;
 return {exists,filled:fields.filter(f=>f.value.trim()).length,fields,trainer:str(t.trainer),trainee:str(t.trainee),status:!exists?'Не создан':!signature?'Требует проверки':signature!==sopTwiSignature(s)?'Требует актуализации':'Сформирован',outdated:!!(exists&&signature&&signature!==sopTwiSignature(s))};
}
export function linkedFrv(s){
 const totals={seconds:0,vdc:0,m1:0,m2:0,unclassified:0,distance:0};let start=0;
 const rows=(s.steps||[]).map((v,i)=>{
  const f=v.frv||{},seconds=v.durationSeconds,m1=part(f.m1),m2=part(f.m2),distance=part(f.move);
  const valid=[seconds,m1,m2,distance].every(x=>Number.isFinite(x)&&x>=0)&&m1+m2<=seconds+.0001;
  const vdc=valid?(f.vdc===true?Math.max(0,seconds-m1-m2):0):null;
  const unclassified=valid?Math.max(0,seconds-vdc-m1-m2):null;
  const row={position:i+1,action:str(v.action),start,seconds,valid,vdc,m1:valid?m1:null,m2:valid?m2:null,unclassified,distance:valid?distance:null,comment:str(f.comment)||v.keyMoments?.filter(Boolean).join('; ')||''};
  if(Number.isFinite(seconds)&&seconds>=0){start+=seconds;totals.seconds+=seconds}
  if(valid){for(const k of ['vdc','m1','m2','unclassified','distance'])totals[k]+=row[k]}
  return row;
 });
 return {rows,totals,invalid:rows.filter(x=>!x.valid).length,exists:rows.some(x=>x.action.trim()),meta:s.frvMeta||{}}
}
