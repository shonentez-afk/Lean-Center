export const PERIOD_LABELS=Object.freeze({month:'Месяц · автоматически',quarter:'Квартал · автоматически',year:'Год · автоматически',manual:'Ручной диапазон · фиксированный'});
export function dashboardPeriod(day,initial={}){
 const mode=Object.hasOwn(PERIOD_LABELS,initial.periodMode)?initial.periodMode:'month';
 if(mode==='manual')return {periodMode:mode,from:initial.from??'',to:initial.to??''};
 const month=Number(day.slice(5,7)),first=mode==='year'?'01':mode==='quarter'?String(1+3*Math.floor((month-1)/3)).padStart(2,'0'):day.slice(5,7);
 return {periodMode:mode,from:day.slice(0,4)+'-'+first+'-01',to:day};
}
