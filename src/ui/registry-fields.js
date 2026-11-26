// Shared, presentation-only registry controls; the host supplies definitions,
 // allowed reference options, defaults, and a separate save callback.
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const add=(p,...nodes)=>{p.append(...nodes);return p};
export function registryFields(d,v,{optionsFor,today,lockedFields=[]}){
 const grid=el('div',undefined,'formgrid'),controls={};
 for(const [k,x] of Object.entries(d.fields)){
  let input;const initial=v?.[k]??(k==='criticality'?'normal':k==='kind'?'Участок':k==='valid_from'?today():k==='version_no'?'1':'');
  if(x.legacy){input=el('input');input.type='hidden';input.name=k;input.value=initial;controls[k]=input;grid.append(input);if(initial)grid.append(add(el('div',undefined,'field'),el('span',x.label),el('p',initial,'muted')));continue}
  if(x.ref||x.options){
   input=el('select');const option=el('option','—');option.value='';input.append(option);
   const opts=x.ref?optionsFor(x.ref,k,v):x.options.map(y=>[y,y==='normal'?'Обычная':y==='important'?'Важная':y==='critical'?'Критическая':y]);
   for(const [value,label] of opts){const o=el('option',label);o.value=value;input.append(o)}
  }else if(x.multiline){input=el('textarea');input.rows=5;input.maxLength=5000;input.placeholder='0: Название уровня\n1: Название уровня'}
  else{input=el('input');input.type=x.date?'date':x.integer?'number':'text';input.maxLength=500;if(x.integer){input.min='1';input.step='1'}}
  input.name=k;input.required=!!x.required;input.value=initial;controls[k]=input;
  if(d.history&&v?.id&&k!=='valid_to')input.disabled=true;
  if(d.history&&v?.valid_to&&k==='valid_to')input.disabled=true;
  if(lockedFields.includes(k))input.disabled=true;
  grid.append(add(el('label',undefined,'field'),el('span',x.label),input));
 }

 return {grid,controls,values:()=>Object.fromEntries(Object.entries(controls).map(([k,n])=>[k,n.value||null]))};
}
