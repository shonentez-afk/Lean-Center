// Annual scenario only; monetary period facts are recorded independently.
const invariant=(ok,message)=>{if(!ok)throw Error(message)};
const bounded=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const exact=(p,keys)=>invariant(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)),'Некорректные параметры расчёта');
export function calculateEffect(method,p){
 invariant(['time','direct'].includes(method),'Выберите способ расчёта');
 exact(p,method==='time'?['deltaSeconds','cyclesPerYear','hourRate','realization','investment','annualCost']:['annualGross','investment','annualCost']);
 invariant(bounded(p.investment,0,1e12)&&bounded(p.annualCost,0,1e12),'Укажите неотрицательные затраты и инвестиции');
 let hours=null,gross;
 if(method==='time'){
  invariant(bounded(p.deltaSeconds,-1e7,1e7)&&Number.isSafeInteger(p.cyclesPerYear)&&bounded(p.cyclesPerYear,1,1e10)&&bounded(p.hourRate,0,1e10)&&bounded(p.realization,0,100),'Укажите разницу секунд, целый годовой объём, ставку и долю реализации 0–100%');
  hours=p.deltaSeconds*p.cyclesPerYear/3600;gross=hours*p.hourRate*p.realization/100;
 }else{invariant(bounded(p.annualGross,-1e12,1e12),'Укажите годовой валовый эффект');gross=p.annualGross}
 const annualNet=gross-p.annualCost,yearOne=annualNet-p.investment;
 invariant([gross,annualNet,yearOne].every(x=>bounded(x,-1e15,1e15)),'Расчёт превышает допустимый диапазон');
 const roi=p.investment>0?yearOne/p.investment*100:null,payback=p.investment>0&&annualNet>0?12*p.investment/annualNet:null;
 invariant((roi===null||Number.isFinite(roi))&&(payback===null||Number.isFinite(payback)),'Проверьте слишком малые значения затрат');
 return {hours,annualBenefit:gross,annualNet,yearOne,roi,payback};
}
