// LC6.1 reporting: same eligible facts everywhere, currency-safe totals,
 // explicit targets only; compare only covered, closed target periods.
import {DEVIATION_CAUSES,factNet} from './domain.js';
const safeSum=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error('Денежный итог превышает точный диапазон');return n};
const sum=(xs,fn)=>xs.reduce((n,x)=>safeSum(n,fn(x)),0);
const fresh=(currency,key)=>({currency,key,count:0,gross:0,recurring:0,investment:0,net:0,targets:0,planned:0,actual:0,delta:0,shortfalls:0,unreviewed:0});
function addFact(row,f){row.count++;for(const [key,value] of [['gross',f.gross_minor],['recurring',f.recurring_minor],['investment',f.investment_minor],['net',factNet(f)]])row[key]=safeSum(row[key],value)}
function addTarget(row,t){if(!t.complete)return;row.targets++;row.planned=safeSum(row.planned,t.target);row.actual=safeSum(row.actual,t.actual);row.delta=safeSum(row.delta,t.delta);if(t.shortfall){row.shortfalls++;if(!t.currentReview)row.unreviewed++}}
export const attainment=(actual,planned)=>planned>0?100*actual/planned:null;
const byCurrencyKey=(a,b)=>a.currency.localeCompare(b.currency)||a.key.localeCompare(b.key);
export function economicReport(overview,{grain='month'}={}){
 if(!['month','year'].includes(grain))throw Error('Выберите месяц или год');
 const timeline=new Map(),units=new Map(),causes=new Map(),matched=new Map(),facts=overview.facts.filter(f=>f.eligible),targets=overview.targets.filter(t=>!t.cancel&&t.record.state==='active'),bucket=d=>d.slice(0,grain==='year'?4:7);
 const row=(map,c,k)=>{const id=JSON.stringify([c,k]);if(!map.has(id))map.set(id,fresh(c,k));return map.get(id)};
 for(const f of facts){const c=f.effect.currency;addFact(row(timeline,c,bucket(f.period_to)),f);addFact(row(units,c,f.effect.unit_id),f)}
 for(const t of targets){const c=t.record.currency;const u=row(units,c,t.record.unit_id);
  if(t.complete){addTarget(row(timeline,c,bucket(t.to)),t);addTarget(u,t);addTarget(row(matched,c,'all'),t)}
  if(t.shortfall){const cause=t.currentReview?t.review.p.cause:'unreviewed',k=JSON.stringify([c,cause]);if(!causes.has(k))causes.set(k,{currency:c,cause,label:DEVIATION_CAUSES[cause]||'Причина ещё не установлена',count:0,shortfall:0});const g=causes.get(k);g.count++;g.shortfall=safeSum(g.shortfall,-t.delta)}
 }
 const series=[...timeline.values()].sort(byCurrencyKey),running=new Map();
 for(const x of series){const accum=safeSum(running.get(x.currency)||0,x.net);running.set(x.currency,accum);x.cumulative=accum}
 const ranks=[...units.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||Number(b.count>0)-Number(a.count>0)||b.net-a.net||a.key.localeCompare(b.key)),rank=new Map();
 for(const x of ranks){if(!x.count){x.rank=null;continue}const last=rank.get(x.currency)||{n:0,rank:0,net:null};last.n++;if(x.net!==last.net){last.rank=last.n;last.net=x.net}x.rank=last.rank;rank.set(x.currency,last)}
 const totals=[...matched.values()].sort(byCurrencyKey);
 return {grain,series,ranks,causes:[...causes.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||b.shortfall-a.shortfall||a.cause.localeCompare(b.cause)),matched:totals,facts,targets,complete:targets.filter(x=>x.complete).length,incomplete:targets.filter(x=>x.closed&&!x.complete).length,open:targets.filter(x=>!x.closed).length,late:targets.filter(x=>x.late).length,unreviewed:targets.filter(x=>x.shortfall&&!x.currentReview).length};
}
// All export sheets consume exactly the displayed projections and retain IDs.
export function economicReportSheets(report,overview,scope,name){
 const money=n=>n===null?null:n/100,pct=x=>x.targets?attainment(x.actual,x.planned):null;
 return [
 {name:'Сводка',headers:['Показатель','Значение'],rows:[['Начало',scope.from||'Без ограничения'],['Окончание',scope.to],['Дата проверки актуальности',scope.day],['Подразделение',scope.unitId?name('org_unit',scope.unitId):'Все'],['Ответственный',scope.personId?name('person',scope.personId):'Все'],['Периодизация',report.grain==='month'?'Месяц':'Год'],['Полностью покрытые цели',report.complete],['Закрытые цели без полного факта',report.incomplete],['Открытые цели',report.open],['Цели введены после начала периода',report.late],['Неразобранные отклонения',report.unreviewed],['Текущие проверки расчёта',overview.pending],['Просроченные проверки расчёта',overview.overdue],['Черновики денежных фактов',overview.drafts],['Правило','Денежные факты полностью в фильтре; группировка по окончанию периода. Без распределения и конвертации. Цели сравниваются с полным подтверждённым фактом.']]},
 {name:'Валюты',headers:['Валюта','Фактов','Валовый факт','Затраты','Инвестиции','Чистый факт'],rows:overview.currencies.map(x=>[x.currency,x.count,money(x.gross),money(x.recurring),money(x.investment),money(x.net)])},
 {name:'Динамика',headers:['Валюта','Период окончания','Фактов','Чистый факт','Накоплено в фильтре','Сопоставимых целей','План','Факт по целям','Отклонение','Достижение %'],rows:report.series.map(x=>[x.currency,x.key,x.count,money(x.net),money(x.cumulative),x.targets,x.targets?money(x.planned):null,x.targets?money(x.actual):null,x.targets?money(x.delta):null,pct(x)])},
 {name:'Подразделения',headers:['Валюта','Место по сумме факта','Подразделение','ID','Фактов','Чистый факт','Сопоставимых целей','План','Факт по целям','Отклонение','Достижение %'],rows:report.ranks.map(x=>[x.currency,x.rank,name('org_unit',x.key),x.key,x.count,x.count?money(x.net):null,x.targets,x.targets?money(x.planned):null,x.targets?money(x.actual):null,x.targets?money(x.delta):null,pct(x)])},
 {name:'Цели и отклонения',headers:['Карточка','ID карточки','ID цели','Подразделение','Ответственный','Валюта','С','По','Дата записи','После начала периода','План','Доступный факт','Полное покрытие','Отклонение','Статус','Основание','Причина','Решение','ID мероприятия','Дата разбора'],rows:report.targets.map(t=>[t.record.title,t.record.id,t.id,name('org_unit',t.record.unit_id),name('person',t.record.owner_id),t.record.currency,t.from,t.to,t.created_at,t.late?'Да':'Нет',money(t.target),t.factCount?money(t.actual):null,t.complete?'Да':'Нет',money(t.delta),t.status,t.basis,t.currentReview?DEVIATION_CAUSES[t.review.p.cause]:'',t.currentReview?t.review.p.note:'',t.currentReview?t.review.p.action_id:'',t.currentReview?t.review.occurred_at:''])},
 {name:'Причины',headers:['Валюта','Зарегистрированная причина','Целей','Сумма недостижения'],rows:report.causes.map(x=>[x.currency,x.label,x.count,money(x.shortfall)])},
 {name:'Денежные факты',headers:['Карточка','ID карточки','ID факта','Подразделение','Валюта','С','По','Валовый','Затраты','Инвестиции','Чистый','Включён','Основание','Проверяющий','Заключение','ID расчёта'],rows:overview.facts.map(f=>[f.effect.title,f.effect.id,f.id,name('org_unit',f.effect.unit_id),f.effect.currency,f.period_from,f.period_to,money(f.gross_minor),money(f.recurring_minor),money(f.investment_minor),money(factNet(f)),f.eligible?'Да':'Нет — доказательства',f.evidence,name('person',f.verifier_id),f.confirmation_note,f.actual_event_id])},
 {name:'Годовые сценарии',headers:['Карточка','ID','Подразделение','Валюта','Метод','Годовой план (JSON параметров)','Основание','Проверенный сценарий (JSON)','Контрольная дата','Состояние'],rows:overview.effects.map(r=>[r.title,r.id,name('org_unit',r.unit_id),r.currency,r.method,r.plan_json,r.plan_basis,r.actual_json||'',r.review_due,r.state==='active'?'Активна':'Отменена'])}
 ]
}
