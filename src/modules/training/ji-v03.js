// JI-2: standard 03, section 3.2.2.2. JI-1 historical stages are not changed.
import {invariant} from '../../core/db.js';
const exact=(v,keys)=>invariant(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'Некорректные параметры методики JI-2');
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
export const JI2_VARIANTS=['classic','special','smed','hazardous','fractional'];
export function validateJi2(variant,config,stepCount=null){
 invariant(JI2_VARIANTS.includes(variant),'Выберите разновидность инструктажа');
 exact(config,['followups','segments','realShow','realTry','hazardous']);
 invariant(integer(config.followups,2,10),'Укажите от 2 до 10 контрольных проверок');
 invariant(typeof config.hazardous==='boolean','Укажите условия безопасности');
 if(variant==='smed')invariant(integer(config.realShow,1,3)&&integer(config.realTry,1,4),'SMED: выберите место реального показа и реальной пробы');
 else invariant(config.realShow===null&&config.realTry===null,'Порядок реального выполнения задаётся только для SMED');
 if(variant==='fractional'){
  invariant(Array.isArray(config.segments)&&config.segments.length>=1&&config.segments.length<=100,'Дробный инструктаж: укажите последовательные группы шагов СОП');
  let next=1;for(const g of config.segments){exact(g,['from','to']);invariant(g.from===next&&integer(g.to,g.from,10000),'Группы должны без пропусков и пересечений покрывать шаги СОП');next=g.to+1}
  if(stepCount!==null)invariant(Number.isInteger(stepCount)&&next===stepCount+1,'Группы должны охватывать все '+stepCount+' шагов исходной редакции СОП')
 }else invariant(Array.isArray(config.segments)&&config.segments.length===0,'Группы шагов применяются только к дробному инструктажу');
 return config
}
const show=['действия','действия и ключевые моменты','действия, ключевые моменты и причины'];
const trial=['выполнение','объяснение действий','действия и ключевые моменты','действия, ключевые моменты и причины'];
export function ji2Stages(variant,config){
 validateJi2(variant,config);
 const stage=(code,label,phase,extra={})=>({code,label,phase,...extra}),out=[stage('prepare','Подготовка ученика и рабочего места','prepare')];
 const normal=(part=null,special=false)=>{
  const suffix=part?'_part'+part.index:'',prefix=part?'Шаги СОП '+part.from+'–'+part.to+' · ':'',extra=part?{segment:{from:part.from,to:part.to}}:{};
  show.forEach((v,i)=>out.push(stage('show'+(i+1)+suffix,prefix+'Показ: '+v+(special?' · лучший исполнитель и инструктор':''),'presentation',extra)));
  trial.forEach((v,i)=>out.push(stage('try'+(i+1)+suffix,prefix+'Проба: '+v,'practice',extra)));
 };
 if(variant==='classic'||variant==='special')normal(null,variant==='special');
 else if(variant==='fractional')config.segments.forEach((g,i)=>normal({...g,index:i+1}));
 else if(variant==='smed'){
  show.forEach((v,i)=>out.push(stage('show'+(i+1),(config.realShow===i+1?'Реальный показ: ':'Имитация показа: ')+v,'presentation',{execution:config.realShow===i+1?'real':'simulation'})));
  trial.forEach((v,i)=>out.push(stage('try'+(i+1),(config.realTry===i+1?'Реальная проба: ':'Имитация пробы: ')+v,'practice',{execution:config.realTry===i+1?'real':'simulation'})));
 }else{
  out.push(stage('show_explanation','Показ лучшим исполнителем / видео с объяснением','presentation'),stage('try_preparatory','Подготовительные работы / тренажёр','practice'),stage('try_individual','Самостоятельное выполнение по разрешённым условиям','practice'),stage('try_team','Выполнение в команде','practice'))
 }
 out.push(stage('support','Самостоятельное задание, контакты помощи и план поддержки','support'));
 for(let i=1;i<=config.followups;i++)out.push(stage('follow'+i,'Контрольная проверка '+i,'followup'));
 return out
}
export function jiConfig(a){return a?.method_version==='JI-2'?JSON.parse(a.method_config_json||'null'):null}
export function jiMethodLabel(a){return a.method_version==='JI-2'?'JI-2 · стандарт 03':'JI-1 · историческая методика'}
