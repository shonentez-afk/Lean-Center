// LC6.1 local charts and XLSX from the same filtered projections.
import {economicReport,economicReportSheets,attainment} from './reporting.js';
import {DEVIATION_CAUSES} from './domain.js';
const fmt=x=>x===null||!Number.isFinite(x)?'—':x.toLocaleString('ru-RU',{maximumFractionDigits:2});
const money=x=>x==null?'—':fmt(x/100);
const pct=x=>x===null?'—':fmt(x)+'%';
function bars(c,h,caption,rows,series){
 const {el,pane}=c,{msg}=h,box=el('div',undefined,'lc6-chart');
 if(!rows.length)return pane(caption,msg('Нет сопоставимых записей в выбранном периоде.'));
 const max=rows.reduce((a,x)=>series.reduce((n,s)=>Math.max(n,Math.abs(x[s.key]??0)),a),1),neg=rows.some(x=>series.some(s=>(x[s.key]??0)<0));
 const legend=el('div',undefined,'lc6-legend');for(const s of series){const item=el('span');item.append(el('i',undefined,'lc6-swatch '+s.kind),el('span',s.label));legend.append(item)}box.append(legend);
 for(const x of rows){const group=el('div',undefined,'lc6-chart-group');group.append(el('strong',x.label));for(const s of series){
  const v=x[s.key],line=el('div',undefined,'lc6-chart-line'),track=el('div',undefined,'lc6-chart-track'+(neg?' signed':''));track.setAttribute('aria-hidden','true');
  const fill=el('span',undefined,'lc6-fill '+s.kind);if(v!=null){const w=Math.abs(v)/max*(neg?50:100);fill.style.width=w+'%';fill.style.left=neg?(v<0?50-w:50)+'%':'0';track.append(fill)}
  line.append(el('span',s.label,'muted'),track,el('strong',money(v)));group.append(line)
 }box.append(group)}
 return pane(caption,box)
}
const planSeries=[{key:'planned',label:'План',kind:'plan'},{key:'actual',label:'Факт по целям',kind:'fact'}];
export function periodComparisonPane(c,h,targets,currency){
 const {pane}=c,{msg,table}=h,complete=targets.filter(t=>t.complete);
 return pane('План и факт за сопоставимые периоды · '+currency,msg('Только закрытые цели с полным подтверждённым фактом; на графике до 18 последних периодов.'),bars(c,h,'Сравнение целей',complete.slice(-18).map(t=>({label:t.from+' — '+t.to,planned:t.target,actual:t.actual})),planSeries),table(['Период','План','Факт','Отклонение','Достижение'],complete.map(t=>[t.from+' — '+t.to,money(t.target),money(t.actual),money(t.delta),pct(attainment(t.actual,t.target))])))
}
export function economicReportView(c,h,overview,scope,grain='month'){
 const {pane,el,btn,go,run,downloadBytes}=c,{msg,table,n}=h,r=economicReport(overview,{grain}),groups=[...new Set([...r.series.map(x=>x.currency),...r.matched.map(x=>x.currency),...r.ranks.map(x=>x.currency)])].sort(),out=el('div',undefined,'stack');
 out.append(pane('Сводный отчёт об экономической эффективности',msg('Период: '+(scope.from||'без ограничения')+' — '+scope.to+'. Доказательства проверяются на текущей базе. Группировка по дате окончания факта; суммы не распределяются по календарным дням.'),msg('Сопоставимых целей: '+r.complete+' · Закрытых без полного факта: '+r.incomplete+' · Открытых: '+r.open+' · Внесённых после начала периода: '+r.late+' · Требуют разбора: '+r.unreviewed),btn('Скачать сводный отчёт XLSX',()=>run(async()=>{
  const w=new window.ExcelJS.Workbook();
  for(const data of economicReportSheets(r,overview,scope,n)){const s=w.addWorksheet(data.name,{pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});s.columns=data.headers.map(x=>({width:Math.max(15,Math.min(40,x.length+12))}));s.addRow(data.headers);s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF242E40'}};for(const line of data.rows){const row=s.addRow(line.map(x=>x??''));row.alignment={vertical:'top',wrapText:true}}s.views=[{state:'frozen',ySplit:1}];s.autoFilter={from:{row:1,column:1},to:{row:1,column:data.headers.length}}}
  downloadBytes('LeanCenter-экономический-эффект-'+scope.to+'.xlsx',await w.xlsx.writeBuffer());return 'Отчёт сформирован'
 },{save:false}))));
 if(!groups.length)out.append(pane('Динамика и рейтинг',msg('Нет подтверждённых фактов или целей по фильтру.')));
 for(const currency of groups){
  const series=r.series.filter(x=>x.currency===currency),matched=r.matched.find(x=>x.currency===currency),units=r.ranks.filter(x=>x.currency===currency);
  out.append(pane('Итоги целей · '+currency,matched?table(['Сопоставимых целей','План','Факт','Отклонение','Достижение'],[[matched.targets,money(matched.planned),money(matched.actual),money(matched.delta),pct(attainment(matched.actual,matched.planned))]]):msg('Нет закрытых целей с полным фактом.')),
   bars(c,h,'План и факт · '+currency,series.filter(x=>x.targets).slice(-24).map(x=>({...x,label:x.key})),planSeries),
   bars(c,h,'Накопленный подтверждённый эффект · '+currency,series.slice(-24).map(x=>({...x,label:x.key})),[{key:'net',label:'За период',kind:'fact'},{key:'cumulative',label:'Накоплено',kind:'total'}]),
   pane('Динамика по '+(grain==='month'?'месяцам':'годам')+' · '+currency,msg('Накопление с начала фильтра. На графиках до 24 последних периодов с данными; таблица и экспорт включают все. Отсутствие записи не равно нулевой экономии.'),table(['Окончание периода','Фактов','Чистый факт','Накоплено','Целей','План по целям','Факт по целям','Отклонение'],series.map(x=>[x.key,x.count,x.count?money(x.net):'—',money(x.cumulative),x.targets,x.targets?money(x.planned):'—',x.targets?money(x.actual):'—',x.targets?money(x.delta):'—']))),
   pane('Рейтинг подразделений · '+currency,msg('Места по сумме подтверждённого чистого факта, а не по численности или производительности. Достижение целей отдельно. Без фактов места не присваиваются.'),table(['Место','Подразделение','Фактов','Чистый факт','Целей','План','Факт по целям','Отклонение','Достижение',''],units.map(x=>[x.rank??'—',n('org_unit',x.key),x.count,x.count?money(x.net):'—',x.targets,x.targets?money(x.planned):'—',x.targets?money(x.actual):'—',x.targets?money(x.delta):'—',x.targets?pct(attainment(x.actual,x.planned)):'—',btn('Открыть',()=>go('roi',{...scope,unitId:x.key}))]))));
 }
 out.append(pane('Причины недостижения целей',msg('Одна основная причина по итогам ручного разбора. Сумма недостижения относится к цели, а не доказывает денежную долю причины.'),table(['Валюта','Причина','Целей','Сумма недостижения'],r.causes.map(x=>[x.currency,x.label,x.count,money(x.shortfall)]))),
  pane('Цели и контроль отклонений',table(['Карточка','Период','Валюта','План','Доступный факт','Отклонение','Состояние','Причина',''],r.targets.map(t=>[t.record.title+(t.late?' · цель внесена после начала':'') ,t.from+' — '+t.to,t.record.currency,money(t.target),t.factCount?money(t.actual):'—',money(t.delta),t.status,t.currentReview?DEVIATION_CAUSES[t.review.p.cause]:'—',btn('Открыть',()=>go('roi',{id:t.record.id,targetId:t.id}))]))));
 return out
}
