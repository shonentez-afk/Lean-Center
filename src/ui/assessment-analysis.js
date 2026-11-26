// Shared descriptive preview for desktop and standalone mobile; no AI, no automatic conclusion.
export function assessmentAnalysis(criteria,responses,type='audit'){
 const levels=criteria[0]?.self_levels||{1:'',2:'',3:'',4:'',5:''},max=Math.max(...Object.keys(levels).map(Number));
 const byId=new Map(responses.map(r=>[r.criterion_id,r])),binary=type!=='self_eval'&&type!=='weighted',rated=v=>binary?v===0||v===1:type==='self_eval'?Number.isInteger(v)&&Object.hasOwn(levels,String(v)):[0,.3,.7,1].includes(v),groups=new Map(),missing=[],exceptions=[],weak=[],unconfirmed=[];
 let count=0,sum=0,weight=0;
 for(const q of criteria){
  const r=byId.get(q.id),v=r?.value,section=q.section_code||'Общие требования',g=groups.get(section)||{label:section,count:0,total:0,sum:0,weight:0};g.total++;groups.set(section,g);
  if(!rated(v)){if(type==='audit'&&['not_observed','not_applicable'].includes(v)&&String(r.note||'').trim())exceptions.push(q);else missing.push(q);continue}
  const w=type==='weighted'?q.weight:1;count++;sum+=v*w;weight+=w;g.count++;g.sum+=v*w;g.weight+=w;
  if(type==='weighted'&&q.scoreSource!=='manual'){unconfirmed.push(q);continue}
  if(binary?v===0:type==='self_eval'?v<max:v<1)weak.push({...q,value:v,note:r?.note||''})
 }
 const value=(s,w)=>w?type==='self_eval'?s/w:100*s/w:null,sections=[...groups.values()].map(g=>({...g,value:value(g.sum,g.weight)}));
 if(type==='self_eval')weak.sort((a,b)=>a.value-b.value||a.position-b.position);
 const top=weak.slice(0,3),weakest=sections.filter(g=>g.value!==null&&weak.some(q=>(q.section_code||'Общие требования')===g.label)).sort((a,b)=>a.value-b.value)[0]||null;
 const complete=missing.length===0&&criteria.length>0;
 const textFor=q=>q.recommendation|| (type==='self_eval'?'Обсудить развитие по критерию №'+q.position+': '+q.question:type==='audit'?'Уточнить и отработать критерий №'+q.position+': '+q.question:'Проверить и устранить замечание по критерию №'+q.position+': '+q.question);
 const summary=!complete?'':top.length?top.map(textFor).join('; ').replace(/[.;\s]+$/,'')+'.':type==='self_eval'?'Все критерии оценены на максимальный заявленный уровень. Требуется фактическое подтверждение навыков.':exceptions.length?'По наблюдавшимся критериям отклонений нет; часть критериев не оценена.':type==='weighted'&&unconfirmed.length?'Результат содержит оценки без ручного подтверждения.':'По оценённым критериям отклонений не выявлено.';
 return {type,max,count,total:criteria.length,missing,exceptions,weak,top:top.map(q=>({...q,suggestion:textFor(q)})),unconfirmed,sections,weakest,value:value(sum,weight),complete,summary}
}
export function renderAssessmentAnalysis(target,model,{feedback=null,onAction=null,onMissing=null,saved=false}={}){
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e},button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=fn;return b},fmt=v=>v===null?'—':v.toLocaleString('ru-RU',{maximumFractionDigits:1})+(model.type==='self_eval'?' / '+model.max:'%');
 target.replaceChildren(node('h3',saved?'Анализ результата':'Предварительный анализ'));
 const p=node('p','Оценено: '+model.count+' / '+model.total+' · Без числовой оценки: '+model.exceptions.length+' · Осталось: '+model.missing.length,'muted');target.append(p);
 if(model.missing.length){const missing=node('div',undefined,'lc53-missing');missing.append(node('p','Не заполнено или нет основания: '+model.missing.map(q=>'№'+q.position).join(', '),'warn'));if(onMissing)missing.append(button('К первому незаполненному',()=>onMissing(model.missing[0])));target.append(missing)}
 const result=node('p',model.complete?'Итоговый результат: '+fmt(model.value):'Предварительно по заполненным: '+fmt(model.value));result.className='lc53-result';target.append(result);
 if(model.weakest)target.append(node('p','Требует внимания: '+model.weakest.label));
 const bars=node('div',undefined,'lc5-bars');for(const g of model.sections){const r=node('div',undefined,'lc5-bar-row'),track=node('div',undefined,'lc5-bar-track'),fill=node('div',undefined,'lc5-bar-fill');fill.style.width=(g.value===null?0:model.type==='self_eval'?g.value/model.max*100:g.value)+'%';track.append(fill);r.append(node('span',g.label),track,node('strong',fmt(g.value)+' · '+g.count+'/'+g.total));bars.append(r)}target.append(bars);
 if(model.unconfirmed.length)target.append(node('p','Оценки без ручного подтверждения: '+model.unconfirmed.length+'. Они не являются подтверждёнными замечаниями.','warn'));
 target.append(node('h3',model.type==='self_eval'?'Приоритеты для обсуждения развития':'Основные рекомендации'));
 if(model.top.length){const list=node('ol',undefined,'lc53-recommendations');for(const q of model.top){const li=node('li');li.append(node('div',q.suggestion),node('small','Критерий №'+q.position+' · '+q.question));if(onAction)li.append(onAction(q));list.append(li)}target.append(list);if(model.weak.length>3)target.append(node('p','Ещё '+(model.weak.length-3)+' замечаний в полном чек-листе.','muted'))}else target.append(node('p',model.complete?model.summary:'Рекомендации появятся по заполненным критериям.','muted'));
 if(model.type==='self_eval')target.append(node('p','Это самооценка, а не подтверждённая квалификация. Приоритеты по меньшим заявленным уровням не являются нарушениями.','muted'));
 if(feedback&&model.complete){
  const text=model.summary.slice(0,Number(feedback.maxLength)>0?feedback.maxLength:500);
  if(!feedback.value.trim()||feedback.value===feedback.dataset.lc53Generated){feedback.value=text;feedback.dataset.lc53Generated=text}
  target.append(button('Подставить рекомендации в обратную связь',()=>{if(feedback.value.trim()&&feedback.value!==feedback.dataset.lc53Generated&&!confirm('Заменить вручную введённую обратную связь?'))return;feedback.value=text;feedback.dataset.lc53Generated=text;feedback.focus()}))
 }
}
