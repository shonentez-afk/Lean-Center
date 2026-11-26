import {analyticsPalette} from '../analytics/palette.js';
// Local only: snapshots describe the already rendered report, not a second computation.
export function reportSnapshot(node,title,scope,facts,notices=[]){node.dataset.lcReport='1';node.lcReport={title,scope,facts:facts.map(([label,value])=>({label,value:String(value??'—')})),notices}}
export function clearReport(node){delete node.lcReport;delete node.dataset.lcReport}
export function localChart(host,labels,series,{dark=document.documentElement.classList.contains('dark'),onClick=null,percentAxis=false}={}){
 if(!globalThis.echarts||!host.isConnected)return null;
 const p=analyticsPalette(dark),chart=globalThis.echarts.init(host,dark?'dark':null);
 chart.setOption({backgroundColor:'transparent',animation:false,aria:{enabled:true},tooltip:{trigger:'axis'},legend:{textStyle:{color:p.text}},grid:{left:12,right:12,top:44,bottom:20,containLabel:true},xAxis:{type:'category',data:labels,axisLabel:{color:p.text}},yAxis:[{type:'value',minInterval:1,axisLabel:{color:p.text},splitLine:{lineStyle:{color:p.grid}}},...(percentAxis?[{type:'value',min:0,max:100,axisLabel:{color:p.text,formatter:'{value}%'},splitLine:{show:false}}]:[])],series:series.map((s,i)=>({name:s.name,type:s.type||'bar',data:s.data,yAxisIndex:s.yAxisIndex||0,itemStyle:{color:i===0?p.actual:p.categorical[i%p.categorical.length]},connectNulls:false}))});
 if(onClick)chart.on('click',x=>onClick(x.dataIndex,x.seriesIndex));
 let ro;const observer=new MutationObserver(()=>{if(!host.isConnected){observer.disconnect();ro?.disconnect();if(!chart.isDisposed())chart.dispose()}});
 observer.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
 if(globalThis.ResizeObserver){ro=new ResizeObserver(()=>{if(host.isConnected&&!chart.isDisposed())chart.resize()});ro.observe(host)}
 const dispose=chart.dispose.bind(chart);chart.dispose=()=>{ro?.disconnect();observer.disconnect();if(!chart.isDisposed())dispose()};
 return chart
}
export function reportChart(el,labels,series,onClick,options={}){const h=el('div',undefined,'lc73-report-chart');queueMicrotask(()=>localChart(h,labels,series,{onClick,...options}));return h}
