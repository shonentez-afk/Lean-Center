// Shared analytics visual vocabulary. Business rules classify data separately.
// Brand accents are intentionally not the default color of quantitative series.
const labels=Object.freeze({
 actual:'Факт', comparison:'Сравнение', compliant:'Соответствует',
 attention:'Требует внимания', risk:'Риск / отклонение', critical:'Критическое отклонение',
 plan:'План', not_assessed:'Не оценено', not_applicable:'Неприменимо'
});
const palettes={
 light:{
  surface:'#FFFFFF', text:'#5B626E', grid:'#DADDDF',
  actual:'#242E40', comparison:'#2563EB', compliant:'#27965A', attention:'#A17600',
  risk:'#C46708', critical:'#E30613', plan:'#85878C', unavailable:'#BFC0C0', unavailableOutline:'#686B71',
  categorical:['#242E40','#2563EB','#687B98','#79649A','#476F83','#65749E']
 },
 dark:{
  surface:'#232B39', text:'#BDC6D3', grid:'#424E60',
  actual:'#A9BCD4', comparison:'#74A8FF', compliant:'#69CA90', attention:'#F0CE57',
  risk:'#FFAB62', critical:'#FF777F', plan:'#A6ADB8', unavailable:'#626E80', unavailableOutline:'#C0CAD7',
  categorical:['#A9BCD4','#74A8FF','#91A7C7','#C3A6E0','#80C3D4','#A5B4E8']
 }
};
for(const p of Object.values(palettes)){Object.freeze(p.categorical);Object.freeze(p)}
Object.freeze(palettes);
export function analyticsPalette(dark=false){return palettes[dark?'dark':'light']}

// Explicit states only. Never infer severity from percentages or map missing data to zero.
export function analyticsStyle(state,dark=false){
 if(!Object.hasOwn(labels,state))throw new RangeError('Unknown analytics state: '+String(state));
 const p=analyticsPalette(dark);
 if(state==='not_assessed'||state==='not_applicable'){
  return {label:labels[state],color:p.unavailable,borderColor:p.unavailableOutline,borderWidth:1,marker:state==='not_assessed'?'?':'—',pattern:state==='not_assessed'?'diagonal':'cross'};
 }
 return {label:labels[state],color:p[state],borderColor:p[state],borderWidth:0,marker:state==='plan'?'П':state==='critical'?'!':state==='risk'?'!':state==='attention'?'!':state==='compliant'?'✓':'',pattern:state==='plan'?'outline':'solid'};
}
export function registryCountChart(categories,counts,dark=false){
 if(!Array.isArray(categories)||!Array.isArray(counts)||categories.length!==counts.length||
    counts.some(n=>!Number.isSafeInteger(n)||n<0))throw new TypeError('Invalid registry counts');
 const p=analyticsPalette(dark);
 return {
  backgroundColor:'transparent',animation:false,color:p.categorical.slice(),
  textStyle:{fontFamily:'Proxima Nova, Proxima Nova Rg, Arial, sans-serif'},
  aria:{enabled:true,description:'Количество активных записей: '+categories.map((n,i)=>n+' — '+counts[i]).join('; ')},
  tooltip:{trigger:'axis'},
  grid:{left:24,right:36,bottom:8,top:8,containLabel:true},
  xAxis:{type:'value',minInterval:1,axisLabel:{color:p.text},splitLine:{lineStyle:{color:p.grid}}},
  yAxis:{type:'category',inverse:true,data:categories.slice(),axisLabel:{color:p.text,fontSize:11,width:144,overflow:'truncate'},axisLine:{show:false},axisTick:{show:false}},
  series:[{name:'Активные записи',type:'bar',barMaxWidth:20,data:counts.slice(),label:{show:true,position:'right',color:p.text},itemStyle:{color:p.actual,borderRadius:[0,2,2,0]}}]
 };
}
