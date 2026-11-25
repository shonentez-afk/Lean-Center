// Shared keyboard-accessible, local directory dropdown (center and embedded editor).
const key=x=>String(x??'').normalize('NFKC').toLocaleLowerCase('ru-RU').replaceAll('ё','е').trim();
export const ROLE_LABELS={instructor:'Инструктор',mentor:'Наставник',trainee:'Обучаемый',evaluator:'Оценщик'};
const tokens=x=>key(x).split(/[\s,;]+/u).filter(Boolean);
export function matchesPerson(p,query){
 const words=tokens([p.display_name,p.employee_code,p.position,p.unit].join(' '));
 return tokens(query).every(q=>words.some(w=>w.startsWith(q)))
}
export function filterPeople(people,query='',allowed=null,role=''){
 return people.filter(p=>(!allowed||p.roles?.some(x=>allowed.includes(x.kind)))&&(!role||p.roles?.some(x=>x.kind===role))&&matchesPerson(p,query))
}
let active=null,serial=0;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
export function closePeopleDropdown(){active?.close()}
export function openPeopleDropdown(trigger,{people,onChoose,allowed=null,roleOptions=['instructor','mentor','trainee','evaluator'],optional=true,selectedId='',label='Сотрудник'}){
 if(active?.trigger===trigger){active.close();return}
 closePeopleDropdown();if(trigger.disabled||!trigger.isConnected)return;
 const popup=node('div',undefined,'lc-picker-popup');popup.id='lc-picker-'+(++serial);popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Выбор: '+label);
 const header=node('div',label,'lc-picker-heading'),search=node('input'),role=node('select'),results=node('div',undefined,'lc-picker-results');
 search.type='search';search.placeholder='Первые буквы ФИО или табельный номер';search.setAttribute('aria-label','Поиск сотрудника');search.autocomplete='off';search.setAttribute('aria-controls',popup.id+'-results');
 role.setAttribute('aria-label','Роль сотрудника');results.id=popup.id+'-results';
 const roles=allowed||roleOptions;
 const option=(value,label)=>{const o=node('option',label);o.value=value;role.append(o)};
 if(roles.length!==1)option('',allowed?'Все подходящие роли':'Все сотрудники');
 roles.forEach(r=>option(r,ROLE_LABELS[r]||r));if(roles.length===1)role.value=roles[0];
 popup.append(header);if(roles.length>1||!allowed)popup.append(role);popup.append(search);
 const footer=node('div',undefined,'lc-picker-footer');const cancel=node('button','Закрыть');cancel.type='button';cancel.onclick=()=>close(true);
 if(optional){const clear=node('button','Очистить выбор');clear.type='button';clear.onclick=()=>{close(true);onChoose(null)};footer.append(clear)}
 footer.append(cancel);popup.append(results,footer);document.body.append(popup);
 trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',popup.id);
 function options(){return Array.from(results.querySelectorAll('button.lc-person-option'))}
 function draw(){
  const list=filterPeople(people(),search.value,allowed,role.value);
  results.replaceChildren();
  if(!list.length){results.append(node('p',search.value?'Нет совпадений по первым буквам.':allowed||role.value?'Нет сотрудников с действующим назначением этой роли. Назначьте роль в справочнике центра.':'Нет активных сотрудников. Добавьте их в справочник центра.','lc-picker-empty'));return}
  for(const p of list.slice(0,100)){
   const btn=node('button',undefined,'lc-person-option');btn.type='button';btn.dataset.personId=p.id;btn.setAttribute('aria-label',p.display_name+' · '+p.employee_code);
   if(p.id===selectedId)btn.classList.add('lc-person-current');
   btn.append(node('strong',p.display_name),node('span',[p.employee_code,p.position,p.unit,...(p.roles||[]).map(x=>x.name)].filter(Boolean).join(' · '),'lc-picker-meta'));
   btn.onclick=()=>{close(true);onChoose(p,role.value||null)};results.append(btn)
  }
  if(list.length>100)results.append(node('p','Первые 100 из '+list.length+'. Уточните поиск.','lc-picker-empty'))
 }
 function place(){
  if(!trigger.isConnected||trigger.getBoundingClientRect().height===0){close();return}
  const a=trigger.getBoundingClientRect(),w=Math.min(Math.max(a.width,360),window.innerWidth-16),below=window.innerHeight-a.bottom-12,above=a.top-12;
  popup.style.width=w+'px';popup.style.left=Math.max(8,Math.min(a.left,window.innerWidth-w-8))+'px';
  const height=Math.min(390,Math.max(150,Math.max(below,above)));
  popup.style.maxHeight=Math.min(window.innerHeight-16,height)+'px';
  const actual=popup.getBoundingClientRect().height;
  popup.style.top=Math.max(8,Math.min(window.innerHeight-actual-8,below>=Math.min(actual,220)||below>=above?a.bottom+4:a.top-actual-4))+'px'
 }
 function outside(e){if(!popup.contains(e.target)&&!trigger.contains(e.target))close()}
 function keyboard(e){
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return}
  if(!popup.contains(e.target))return;
  const opts=options(),i=opts.indexOf(document.activeElement);
  if(e.key==='ArrowDown'&&e.target!==role){e.preventDefault();opts[Math.min(i+1,opts.length-1)]?.focus()}
  else if(e.key==='ArrowUp'&&e.target!==role){e.preventDefault();if(i<=0)search.focus();else opts[i-1]?.focus()}
  else if(e.key==='Enter'&&e.target===search&&opts.length){e.preventDefault();opts[0].click()}
 }
 function close(focus=false){
  if(active?.popup!==popup)return;active=null;popup.remove();trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');
  document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keyboard,true);
  window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);observer.disconnect();if(focus&&trigger.isConnected)trigger.focus({preventScroll:true})
 }
 search.oninput=()=>{draw();place()};role.onchange=()=>{draw();place();search.focus()};
 const observer=new MutationObserver(()=>{if(!trigger.isConnected)close()});observer.observe(document.body,{childList:true,subtree:true});
 active={trigger,popup,close,refresh:()=>{draw();place()}};
 document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keyboard,true);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
 draw();place();search.focus({preventScroll:true});
}
export function refreshPeopleDropdown(){active?.refresh()}
